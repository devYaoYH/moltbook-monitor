#!/usr/bin/env node
/**
 * Moltbook Scraper Daemon
 * Continuously fetches new posts and updates the database
 */

const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');
const fs = require('fs');

// Config
const DB_PATH = process.env.MOLTBOOK_DB || path.join(process.env.HOME, 'moltbook-tracker/moltbook.db');
const CREDS_PATH = path.join(process.env.HOME, '.config/moltbook/credentials.json');
const API_BASE = 'https://www.moltbook.com/api/v1';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 60000; // 1 minute default
const POSTS_PER_FETCH = 50;

// State
let lastFetchTime = null;
let totalFetched = 0;
let newPostsCount = 0;

// Load API key
function getApiKey() {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  return creds.api_key;
}

// Make API request with timeout
function apiRequest(endpoint, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    const url = new URL(API_BASE + endpoint);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: timeoutMs
    };
    
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.slice(0, 100)}`));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    
    // Backup timeout
    setTimeout(() => {
      req.destroy();
      reject(new Error('Request timed out (backup)'));
    }, timeoutMs + 5000);
  });
}

// Store posts in database
function storePosts(db, posts) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO posts 
    (id, title, content, author, submolt, url, upvotes, downvotes, comment_count, created_at, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  
  let stored = 0;
  let newPosts = 0;
  
  for (const post of posts) {
    // Check if post exists
    const existing = db.prepare('SELECT id FROM posts WHERE id = ?').get(post.id);
    
    stmt.run(
      post.id,
      post.title,
      post.content,
      post.author?.name,
      post.submolt?.name,
      post.url,
      post.upvotes || 0,
      post.downvotes || 0,
      post.comment_count || 0,
      post.created_at
    );
    stored++;
    
    if (!existing) {
      newPosts++;
      console.log(`  📝 New: "${(post.title || '').slice(0, 50)}..." by ${post.author?.name}`);
    }
  }
  
  return { stored, newPosts };
}

// Fetch posts from different sorts
async function fetchAllSorts(db) {
  const sorts = ['new', 'hot', 'top'];
  let totalStored = 0;
  let totalNew = 0;
  
  for (const sort of sorts) {
    try {
      const response = await apiRequest(`/posts?sort=${sort}&limit=${POSTS_PER_FETCH}`);
      const posts = response.posts || [];
      
      if (posts.length > 0) {
        const { stored, newPosts } = storePosts(db, posts);
        totalStored += stored;
        totalNew += newPosts;
      }
    } catch (err) {
      console.error(`  ❌ Failed to fetch ${sort}: ${err.message}`);
    }
  }
  
  return { totalStored, totalNew };
}

// Main daemon loop
async function runDaemon() {
  console.log('🦞 Moltbook Scraper Daemon starting...');
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Poll interval: ${POLL_INTERVAL / 1000}s`);
  
  const db = new Database(DB_PATH);
  
  // Get initial stats
  const initialCount = db.prepare('SELECT COUNT(*) as n FROM posts').get().n;
  console.log(`   Initial posts in DB: ${initialCount}`);
  console.log('');
  
  // Initial fetch
  await poll(db);
  
  // Schedule recurring fetches
  setInterval(() => poll(db), POLL_INTERVAL);
  
  console.log(`\n⏰ Polling every ${POLL_INTERVAL / 1000} seconds. Press Ctrl+C to stop.\n`);
}

async function poll(db) {
  const now = new Date().toISOString();
  console.log(`[${now}] Fetching posts...`);
  
  try {
    const { totalStored, totalNew } = await fetchAllSorts(db);
    totalFetched += totalStored;
    newPostsCount += totalNew;
    lastFetchTime = now;
    
    const stats = db.prepare('SELECT COUNT(*) as n FROM posts').get();
    console.log(`   ✅ Processed ${totalStored} posts (${totalNew} new). Total in DB: ${stats.n}`);
  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  console.log(`   Total fetched this session: ${totalFetched}`);
  console.log(`   New posts added: ${newPostsCount}`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down...');
  process.exit(0);
});

// Run if called directly
if (require.main === module) {
  runDaemon().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runDaemon, poll, fetchAllSorts };
