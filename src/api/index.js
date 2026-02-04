const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { extractKeywords, computeSimilarity, tokenize } = require('../analysis/text');
const { clusterPosts, extractClusterTheme } = require('../analysis/clustering');
const { findNovelPosts, getHighQualityPosts, detectSpamPatterns } = require('../analysis/novelty');

const router = express.Router();

// Connect to moltbook tracker database
const DB_PATH = process.env.MOLTBOOK_DB || path.join(process.env.HOME, 'moltbook-tracker/moltbook.db');
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.env.HOME, 'moltbook-monitor/cache');
const db = new Database(DB_PATH, { readonly: true });

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// GET /api/stats - Overview statistics
router.get('/stats', (req, res) => {
  const startTime = req.query.start;
  const endTime = req.query.end;
  
  let whereClause = '1=1';
  const params = [];
  
  if (startTime) {
    whereClause += ' AND created_at >= ?';
    params.push(startTime);
  }
  if (endTime) {
    whereClause += ' AND created_at <= ?';
    params.push(endTime);
  }
  
  const stats = {
    totalPosts: db.prepare(`SELECT COUNT(*) as n FROM posts WHERE ${whereClause}`).get(...params).n,
    uniqueAuthors: db.prepare(`SELECT COUNT(DISTINCT author) as n FROM posts WHERE ${whereClause}`).get(...params).n,
    uniqueSubmolts: db.prepare(`SELECT COUNT(DISTINCT submolt) as n FROM posts WHERE ${whereClause}`).get(...params).n,
    curatedPosts: db.prepare(`SELECT COUNT(*) as n FROM posts WHERE curated = 1 AND ${whereClause}`).get(...params).n,
    totalUpvotes: db.prepare(`SELECT SUM(upvotes) as n FROM posts WHERE ${whereClause}`).get(...params).n || 0,
    totalComments: db.prepare(`SELECT SUM(comment_count) as n FROM posts WHERE ${whereClause}`).get(...params).n || 0,
    timeRange: {
      oldest: db.prepare('SELECT MIN(created_at) as t FROM posts').get().t,
      newest: db.prepare('SELECT MAX(created_at) as t FROM posts').get().t,
      filter: { start: startTime, end: endTime }
    }
  };
  res.json(stats);
});

// GET /api/wordcloud - Word frequency data for cloud visualization
router.get('/wordcloud', (req, res) => {
  const source = req.query.source || 'titles'; // titles, content, both
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);
  
  let text = '';
  if (source === 'titles' || source === 'both') {
    const titles = db.prepare('SELECT title FROM posts WHERE title IS NOT NULL').all();
    text += titles.map(r => r.title).join(' ');
  }
  if (source === 'content' || source === 'both') {
    const contents = db.prepare('SELECT content FROM posts WHERE content IS NOT NULL').all();
    text += ' ' + contents.map(r => r.content).join(' ');
  }
  
  const keywords = extractKeywords(text, limit);
  res.json(keywords);
});

// GET /api/trends/submolts - Submolt activity over time
router.get('/trends/submolts', (req, res) => {
  const data = db.prepare(`
    SELECT submolt, COUNT(*) as posts, SUM(upvotes) as upvotes, SUM(comment_count) as comments
    FROM posts
    WHERE submolt IS NOT NULL
    GROUP BY submolt
    ORDER BY posts DESC
    LIMIT 20
  `).all();
  res.json(data);
});

// GET /api/trends/authors - Most active authors
router.get('/trends/authors', (req, res) => {
  const data = db.prepare(`
    SELECT author, COUNT(*) as posts, SUM(upvotes) as upvotes, SUM(comment_count) as comments
    FROM posts
    WHERE author IS NOT NULL
    GROUP BY author
    ORDER BY posts DESC
    LIMIT 20
  `).all();
  res.json(data);
});

// GET /api/trends/timeline - Posts over time with adjustable granularity
router.get('/trends/timeline', (req, res) => {
  const granularity = req.query.granularity || 'day'; // hour, day, week
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  
  let groupBy, dateFormat;
  switch (granularity) {
    case 'hour':
      // SQLite: strftime for hour-level grouping
      groupBy = "strftime('%Y-%m-%d %H:00', created_at)";
      dateFormat = 'datetime';
      break;
    case 'week':
      // ISO week: year-week format
      groupBy = "strftime('%Y-W%W', created_at)";
      dateFormat = 'week';
      break;
    case 'day':
    default:
      groupBy = "date(created_at)";
      dateFormat = 'date';
  }
  
  const data = db.prepare(`
    SELECT ${groupBy} as date, COUNT(*) as posts, SUM(upvotes) as upvotes, SUM(comment_count) as comments
    FROM posts
    WHERE created_at IS NOT NULL
    GROUP BY ${groupBy}
    ORDER BY date DESC
    LIMIT ?
  `).all(limit);
  
  res.json({
    granularity,
    dateFormat,
    data: data.reverse()
  });
});

// GET /api/posts - Paginated posts with filters
router.get('/posts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const submolt = req.query.submolt;
  const author = req.query.author;
  const sort = req.query.sort || 'recent'; // recent, upvotes, comments
  const startTime = req.query.start; // ISO date string
  const endTime = req.query.end; // ISO date string
  
  let query = 'SELECT * FROM posts WHERE 1=1';
  const params = [];
  
  if (submolt) {
    query += ' AND submolt = ?';
    params.push(submolt);
  }
  if (author) {
    query += ' AND author = ?';
    params.push(author);
  }
  if (startTime) {
    query += ' AND created_at >= ?';
    params.push(startTime);
  }
  if (endTime) {
    query += ' AND created_at <= ?';
    params.push(endTime);
  }
  
  const orderBy = {
    recent: 'created_at DESC',
    upvotes: 'upvotes DESC',
    comments: 'comment_count DESC'
  }[sort] || 'created_at DESC';
  
  query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const posts = db.prepare(query).all(...params);
  const total = db.prepare(query.replace(/SELECT \*/, 'SELECT COUNT(*) as n').replace(/LIMIT.*/, '')).get(...params.slice(0, -2));
  
  res.json({
    posts,
    total: total?.n || posts.length,
    limit,
    offset,
    filters: { submolt, author, startTime, endTime, sort }
  });
});

// GET /api/duplicates - Find similar posts (potential duplicates)
router.get('/duplicates', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 0.7;
  const posts = db.prepare('SELECT id, title, content, author, submolt, upvotes FROM posts WHERE title IS NOT NULL LIMIT 200').all();
  
  const duplicates = [];
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      const textA = (posts[i].title || '') + ' ' + (posts[i].content || '');
      const textB = (posts[j].title || '') + ' ' + (posts[j].content || '');
      const similarity = computeSimilarity(textA, textB);
      
      if (similarity >= threshold) {
        duplicates.push({
          postA: { 
            id: posts[i].id, 
            title: posts[i].title, 
            content: posts[i].content,
            author: posts[i].author,
            submolt: posts[i].submolt,
            upvotes: posts[i].upvotes
          },
          postB: { 
            id: posts[j].id, 
            title: posts[j].title, 
            content: posts[j].content,
            author: posts[j].author,
            submolt: posts[j].submolt,
            upvotes: posts[j].upvotes
          },
          similarity: Math.round(similarity * 100) / 100
        });
      }
    }
  }
  
  res.json(duplicates.sort((a, b) => b.similarity - a.similarity).slice(0, 50));
});

// GET /api/clusters - Cluster similar posts together
router.get('/clusters', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 0.4;
  const startTime = req.query.start;
  const endTime = req.query.end;
  const hidePerfectDupes = req.query.hidePerfectDupes === 'true';
  const limit = Math.min(parseInt(req.query.limit) || 1000, 5000); // Default 1000, max 5000
  
  let query = `
    SELECT id, title, content, author, submolt, upvotes, comment_count, created_at 
    FROM posts 
    WHERE title IS NOT NULL
  `;
  const params = [];
  
  if (startTime) {
    query += ' AND created_at >= ?';
    params.push(startTime);
  }
  if (endTime) {
    query += ' AND created_at <= ?';
    params.push(endTime);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const posts = db.prepare(query).all(...params);
  
  // Get total posts in time range (without limit) for accurate stats
  let countQuery = 'SELECT COUNT(*) as n FROM posts WHERE title IS NOT NULL';
  const countParams = [];
  if (startTime) {
    countQuery += ' AND created_at >= ?';
    countParams.push(startTime);
  }
  if (endTime) {
    countQuery += ' AND created_at <= ?';
    countParams.push(endTime);
  }
  const totalInRange = db.prepare(countQuery).get(...countParams).n;
  
  const clusters = clusterPosts(posts, threshold);
  
  // Separate perfect duplicates (100% similarity) from other clusters
  const perfectDupes = clusters.filter(c => c.avgSimilarity >= 0.99);
  const otherClusters = clusters.filter(c => c.avgSimilarity < 0.99);
  
  // Calculate duplicate stats
  const perfectDupePostCount = perfectDupes.reduce((sum, c) => sum + c.size, 0);
  const dupePercentage = posts.length > 0 ? Math.round((perfectDupePostCount / posts.length) * 100) : 0;
  
  // Choose which clusters to return
  const displayClusters = hidePerfectDupes ? otherClusters : clusters;
  
  // Add theme keywords to each cluster
  const enrichedClusters = displayClusters.map(cluster => ({
    ...cluster,
    theme: extractClusterTheme(cluster)
  }));
  
  res.json({
    totalPosts: posts.length,
    totalInRange,
    clusteredPosts: clusters.reduce((sum, c) => sum + c.size, 0),
    clusterCount: clusters.length,
    // Duplicate metrics
    duplicateStats: {
      perfectDupeClusterCount: perfectDupes.length,
      perfectDupePostCount,
      dupePercentage,
      hidingPerfectDupes: hidePerfectDupes
    },
    clusters: enrichedClusters
  });
});

// GET /api/clusters/precomputed - Serve precomputed cluster data
router.get('/clusters/precomputed', (req, res) => {
  const range = req.query.range || 'all'; // '24h', '7d', 'all'
  const cacheFile = path.join(CACHE_DIR, `clusters-${range}.json`);
  
  try {
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      res.json(data);
    } else {
      // Fallback: compute on-demand for small datasets
      res.json({
        error: 'Precomputed data not available',
        message: 'Run the precompute script to generate cluster data',
        totalPosts: 0,
        clusteredPosts: 0,
        clusterCount: 0,
        duplicateStats: { perfectDupeClusterCount: 0, perfectDupePostCount: 0, dupePercentage: 0 },
        clusters: []
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/novel - Find high-perplexity/novel posts that stand out
router.get('/novel', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const minNovelty = parseFloat(req.query.minNovelty) || 0.3;
  const startTime = req.query.start;
  const endTime = req.query.end;
  
  let query = `
    SELECT id, title, content, author, submolt, upvotes, comment_count, created_at 
    FROM posts 
    WHERE (title IS NOT NULL OR content IS NOT NULL)
  `;
  const params = [];
  
  if (startTime) {
    query += ' AND created_at >= ?';
    params.push(startTime);
  }
  if (endTime) {
    query += ' AND created_at <= ?';
    params.push(endTime);
  }
  
  query += ' ORDER BY created_at DESC LIMIT 500';
  
  const posts = db.prepare(query).all(...params);
  
  const novelPosts = getHighQualityPosts(posts, { limit, minNovelty });
  
  res.json({
    total: posts.length,
    novelCount: novelPosts.length,
    posts: novelPosts.map(p => ({
      id: p.id,
      title: p.title,
      content: p.content,
      author: p.author,
      submolt: p.submolt,
      upvotes: p.upvotes,
      commentCount: p.comment_count,
      createdAt: p.created_at,
      noveltyScore: p.novelty.finalScore,
      tokenCount: p.novelty.tokenCount,
      uniqueTerms: p.novelty.uniqueTerms,
      postUrl: `https://moltbook.com/post/${p.id}`,
      authorUrl: `https://moltbook.com/u/${p.author}`,
      submoltUrl: `https://moltbook.com/m/${p.submolt}`
    }))
  });
});

// GET /api/spam - Identify likely spam posts
router.get('/spam', (req, res) => {
  const posts = db.prepare(`
    SELECT id, title, content, author, submolt, upvotes, created_at 
    FROM posts 
    ORDER BY created_at DESC 
    LIMIT 300
  `).all();
  
  const analyzed = detectSpamPatterns(posts);
  const spamPosts = analyzed.filter(p => p.isLikelySpam);
  
  res.json({
    total: posts.length,
    spamCount: spamPosts.length,
    spamRate: Math.round((spamPosts.length / posts.length) * 100),
    posts: spamPosts.slice(0, 50).map(p => ({
      id: p.id,
      title: p.title,
      author: p.author,
      submolt: p.submolt,
      spamSignals: p.spamSignals,
      spamScore: p.spamScore
    }))
  });
});

// GET /api/search - Full text search
router.get('/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);
  
  const posts = db.prepare(`
    SELECT * FROM posts 
    WHERE title LIKE ? OR content LIKE ?
    ORDER BY upvotes DESC
    LIMIT 50
  `).all(`%${q}%`, `%${q}%`);
  
  res.json(posts);
});

module.exports = router;
