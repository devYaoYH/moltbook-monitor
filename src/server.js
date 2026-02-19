const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { BigQuery } = require('@google-cloud/bigquery');
const { getHighQualityPosts } = require('./analysis/novelty');

const app = express();
const PORT = process.env.PORT || 8080;

// BigQuery config
const PROJECT = process.env.GCP_PROJECT || 'the-molt-report';
const DATASET = 'moltbook';
const TABLE = 'posts';

const bigquery = new BigQuery({ projectId: PROJECT });

// SQLite config (for high-quality posts)
const DB_PATH = process.env.MOLTBOOK_DB || path.join(process.env.HOME, 'moltbook-tracker/moltbook.db');
let db;
try {
  db = new Database(DB_PATH, { readonly: true });
  console.log(`SQLite database opened: ${DB_PATH}`);
} catch (err) {
  console.warn(`Warning: Could not open SQLite database at ${DB_PATH}:`, err.message);
}

// Helper to run BigQuery queries
async function runQuery(sql) {
  try {
    const [rows] = await bigquery.query({ query: sql, location: 'US' });
    return rows;
  } catch (error) {
    console.error('BigQuery error:', error.message);
    return [];
  }
}

// --- BigQuery (Trends) API endpoints ---

app.get('/api/submolt-trends', async (req, res) => {
  const days = parseInt(req.query.days) || 14;
  const minPosts = parseInt(req.query.min) || 5;

  const sql = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', DATE(created_at)) as day,
      submolt,
      COUNT(*) as posts,
      SUM(upvotes) as upvotes
    FROM \`${PROJECT}.${DATASET}.${TABLE}\`
    WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
      AND submolt NOT IN ('general', 'mbc-20', 'mbc20', 'all', 'gpt')
      AND submolt IS NOT NULL
    GROUP BY day, submolt
    HAVING posts >= ${minPosts}
    ORDER BY day, posts DESC
  `;

  res.json(await runQuery(sql));
});

app.get('/api/top-submolts', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const limit = parseInt(req.query.limit) || 20;

  const sql = `
    SELECT
      submolt,
      COUNT(*) as posts,
      SUM(upvotes) as upvotes,
      COUNT(DISTINCT author) as authors,
      AVG(comment_count) as avg_comments
    FROM \`${PROJECT}.${DATASET}.${TABLE}\`
    WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
      AND submolt NOT IN ('general', 'mbc-20', 'mbc20', 'all', 'gpt')
      AND submolt IS NOT NULL
    GROUP BY submolt
    ORDER BY posts DESC
    LIMIT ${limit}
  `;

  res.json(await runQuery(sql));
});

app.get('/api/emerging', async (req, res) => {
  const sql = `
    WITH recent AS (
      SELECT submolt, COUNT(*) as recent_posts
      FROM \`${PROJECT}.${DATASET}.${TABLE}\`
      WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 DAY)
        AND submolt NOT IN ('general', 'mbc-20', 'mbc20', 'all', 'gpt')
      GROUP BY submolt
    ),
    older AS (
      SELECT submolt, COUNT(*) as older_posts
      FROM \`${PROJECT}.${DATASET}.${TABLE}\`
      WHERE created_at BETWEEN
        TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        AND TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 DAY)
        AND submolt NOT IN ('general', 'mbc-20', 'mbc20', 'all', 'gpt')
      GROUP BY submolt
    )
    SELECT
      COALESCE(r.submolt, o.submolt) as submolt,
      COALESCE(r.recent_posts, 0) as recent_posts,
      COALESCE(o.older_posts, 0) as older_posts,
      CASE
        WHEN COALESCE(o.older_posts, 0) = 0 THEN 999
        ELSE ROUND((COALESCE(r.recent_posts, 0) - COALESCE(o.older_posts, 0)) * 100.0 / COALESCE(o.older_posts, 1), 1)
      END as growth_pct
    FROM recent r
    FULL OUTER JOIN older o ON r.submolt = o.submolt
    WHERE COALESCE(r.recent_posts, 0) + COALESCE(o.older_posts, 0) >= 10
    ORDER BY growth_pct DESC
    LIMIT 15
  `;

  res.json(await runQuery(sql));
});

app.get('/api/hourly', async (req, res) => {
  const days = parseInt(req.query.days) || 7;

  const sql = `
    SELECT
      EXTRACT(HOUR FROM created_at) as hour,
      COUNT(*) as posts,
      COUNT(DISTINCT author) as authors
    FROM \`${PROJECT}.${DATASET}.${TABLE}\`
    WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
    GROUP BY hour
    ORDER BY hour
  `;

  res.json(await runQuery(sql));
});

app.get('/api/keywords', async (req, res) => {
  const days = parseInt(req.query.days) || 3;

  const sql = `
    SELECT word, COUNT(*) as count
    FROM \`${PROJECT}.${DATASET}.${TABLE}\`,
    UNNEST(REGEXP_EXTRACT_ALL(LOWER(title), r'[a-z]{4,}')) as word
    WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
      AND word NOT IN ('this', 'that', 'with', 'from', 'have', 'your', 'what', 'when', 'where', 'which', 'their', 'there', 'been', 'being', 'would', 'could', 'should', 'about', 'into', 'just', 'very', 'also', 'only', 'some', 'more', 'most', 'other', 'than', 'then', 'these', 'those', 'here', 'moltbook', 'post', 'mint', 'token', 'daily')
    GROUP BY word
    HAVING count >= 5
    ORDER BY count DESC
    LIMIT 50
  `;

  res.json(await runQuery(sql));
});

app.get('/api/authors', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const limit = parseInt(req.query.limit) || 20;

  const sql = `
    SELECT
      author,
      COUNT(*) as posts,
      SUM(upvotes) as upvotes,
      COUNT(DISTINCT submolt) as submolts
    FROM \`${PROJECT}.${DATASET}.${TABLE}\`
    WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
      AND author NOT IN ('KingMolt', 'donaldtrump', 'CryptoMolt')
    GROUP BY author
    ORDER BY upvotes DESC
    LIMIT ${limit}
  `;

  res.json(await runQuery(sql));
});

app.get('/api/stats', async (req, res) => {
  const sql = `
    SELECT
      COUNT(*) as total_posts,
      COUNT(DISTINCT author) as total_authors,
      COUNT(DISTINCT submolt) as total_submolts,
      SUM(upvotes) as total_upvotes,
      MAX(created_at) as latest_post
    FROM \`${PROJECT}.${DATASET}.${TABLE}\`
  `;

  const recent = `
    SELECT COUNT(*) as posts_24h
    FROM \`${PROJECT}.${DATASET}.${TABLE}\`
    WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
  `;

  const [stats, recentStats] = await Promise.all([runQuery(sql), runQuery(recent)]);
  res.json({ ...(stats[0] || {}), ...(recentStats[0] || {}) });
});

// --- SQLite (High-quality posts) API endpoint ---

app.get('/api/novel', (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not available' });
  }

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

// Serve static dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Moltbook Monitor running on http://localhost:${PORT}`);
});
