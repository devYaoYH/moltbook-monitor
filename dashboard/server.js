const express = require('express');
const { execSync } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;

// BigQuery config
const PROJECT = 'the-molt-report';
const DATASET = 'moltbook';
const TABLE = 'posts';
const FULL_TABLE = `\`${PROJECT}.${DATASET}.${TABLE}\``; // Pre-escaped for SQL

// Helper to run BigQuery queries via bq CLI
function runQuery(sql) {
  try {
    const { spawnSync } = require('child_process');
    // Clean up SQL - remove extra whitespace
    const cleanSql = sql.replace(/\s+/g, ' ').trim();
    
    const result = spawnSync('bq', [
      'query',
      '--nouse_legacy_sql',
      '--format=json',
      '--use_cache=false',
      '--max_rows=50000',
      cleanSql
    ], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    
    if (result.error) {
      console.error('Query spawn error:', result.error);
      return [];
    }
    if (result.stderr && result.stderr.includes('Error')) {
      console.error('Query stderr:', result.stderr);
    }
    
    return JSON.parse(result.stdout || '[]');
  } catch (error) {
    console.error('Query error:', error.message);
    return [];
  }
}

// API: Submolt trends over time
app.get('/api/submolt-trends', (req, res) => {
  const days = parseInt(req.query.days) || 14;
  const minPosts = parseInt(req.query.min) || 5;
  
  const sql = `SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) as day, submolt, COUNT(*) as posts, SUM(upvotes) as upvotes FROM \`${PROJECT}.${DATASET}.${TABLE}\` WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY) AND submolt NOT IN ('general', 'mbc-20', 'mbc20', 'all', 'gpt') AND submolt IS NOT NULL GROUP BY day, submolt HAVING posts >= ${minPosts} ORDER BY day DESC, posts DESC`;
  
  console.log('Running query:', sql.substring(0, 100) + '...');
  const result = runQuery(sql);
  console.log('Got', result.length, 'rows, first day:', result[0]?.day);
  res.json(result);
});

// API: Top submolts summary
app.get('/api/top-submolts', (req, res) => {
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
  
  res.json(runQuery(sql));
});

// API: Emerging topics (growth rate)
app.get('/api/emerging', (req, res) => {
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
  
  res.json(runQuery(sql));
});

// API: Hourly activity pattern
app.get('/api/hourly', (req, res) => {
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
  
  res.json(runQuery(sql));
});

// API: Keyword extraction from titles
app.get('/api/keywords', (req, res) => {
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
  
  res.json(runQuery(sql));
});

// API: Author activity leaders
app.get('/api/authors', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const limit = parseInt(req.query.limit) || 20;
  
  const sql = `
    SELECT 
      author,
      COUNT(*) as posts,
      SUM(upvotes) as upvotes,
      COUNT(DISTINCT submolt) as submolts,
      ARRAY_AGG(DISTINCT submolt LIMIT 5) as top_submolts
    FROM \`${PROJECT}.${DATASET}.${TABLE}\`
    WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
      AND author NOT IN ('KingMolt', 'donaldtrump', 'CryptoMolt')
    GROUP BY author
    ORDER BY upvotes DESC
    LIMIT ${limit}
  `;
  
  res.json(runQuery(sql));
});

// API: Stats summary
app.get('/api/stats', (req, res) => {
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
  
  const stats = runQuery(sql)[0] || {};
  const recentStats = runQuery(recent)[0] || {};
  
  res.json({ ...stats, ...recentStats });
});

// Serve static dashboard
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Moltbook Trends Dashboard running on http://localhost:${PORT}`);
});
