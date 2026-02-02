const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { extractKeywords, computeSimilarity, tokenize } = require('../analysis/text');
const { clusterPosts, extractClusterTheme } = require('../analysis/clustering');
const { findNovelPosts, getHighQualityPosts, detectSpamPatterns } = require('../analysis/novelty');

const router = express.Router();

// Connect to moltbook tracker database
const DB_PATH = process.env.MOLTBOOK_DB || path.join(process.env.HOME, 'moltbook-tracker/moltbook.db');
const db = new Database(DB_PATH, { readonly: true });

// GET /api/stats - Overview statistics
router.get('/stats', (req, res) => {
  const stats = {
    totalPosts: db.prepare('SELECT COUNT(*) as n FROM posts').get().n,
    uniqueAuthors: db.prepare('SELECT COUNT(DISTINCT author) as n FROM posts').get().n,
    uniqueSubmolts: db.prepare('SELECT COUNT(DISTINCT submolt) as n FROM posts').get().n,
    curatedPosts: db.prepare('SELECT COUNT(*) as n FROM posts WHERE curated = 1').get().n,
    totalUpvotes: db.prepare('SELECT SUM(upvotes) as n FROM posts').get().n || 0,
    totalComments: db.prepare('SELECT SUM(comment_count) as n FROM posts').get().n || 0,
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

// GET /api/trends/timeline - Posts over time
router.get('/trends/timeline', (req, res) => {
  const data = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as posts, SUM(upvotes) as upvotes
    FROM posts
    WHERE created_at IS NOT NULL
    GROUP BY date(created_at)
    ORDER BY date DESC
    LIMIT 30
  `).all();
  res.json(data.reverse());
});

// GET /api/posts - Paginated posts with filters
router.get('/posts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const submolt = req.query.submolt;
  const author = req.query.author;
  const sort = req.query.sort || 'recent'; // recent, upvotes, comments
  
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
  
  const orderBy = {
    recent: 'created_at DESC',
    upvotes: 'upvotes DESC',
    comments: 'comment_count DESC'
  }[sort] || 'created_at DESC';
  
  query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const posts = db.prepare(query).all(...params);
  res.json(posts);
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
  const posts = db.prepare(`
    SELECT id, title, content, author, submolt, upvotes, comment_count, created_at 
    FROM posts 
    WHERE title IS NOT NULL 
    ORDER BY created_at DESC 
    LIMIT 300
  `).all();
  
  const clusters = clusterPosts(posts, threshold);
  
  // Add theme keywords to each cluster
  const enrichedClusters = clusters.map(cluster => ({
    ...cluster,
    theme: extractClusterTheme(cluster)
  }));
  
  res.json({
    totalPosts: posts.length,
    clusteredPosts: clusters.reduce((sum, c) => sum + c.size, 0),
    clusterCount: clusters.length,
    clusters: enrichedClusters
  });
});

// GET /api/novel - Find high-perplexity/novel posts that stand out
router.get('/novel', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const minNovelty = parseFloat(req.query.minNovelty) || 0.3;
  
  const posts = db.prepare(`
    SELECT id, title, content, author, submolt, upvotes, comment_count, created_at 
    FROM posts 
    WHERE title IS NOT NULL OR content IS NOT NULL
    ORDER BY created_at DESC 
    LIMIT 500
  `).all();
  
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
