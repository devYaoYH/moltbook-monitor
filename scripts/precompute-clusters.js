#!/usr/bin/env node
/**
 * Precompute clusters for the 3 time ranges (24h, 7d, all)
 * Run this after each database sync
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Import analysis functions
const { clusterPosts, extractClusterTheme } = require('../src/analysis/clustering');

const DB_PATH = process.env.MOLTBOOK_DB || path.join(process.env.HOME, 'moltbook-tracker/moltbook.db');
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '../cache');
const THRESHOLD = 0.2;

// Limits per range to keep computation reasonable
// O(n²) clustering: 500 posts = 125K comparisons (~10-15s on this server)
// TODO: Optimize clustering algorithm or run on more powerful machine
const LIMITS = {
  '24h': 500,
  '7d': 1000,
  'all': 5000
};

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const db = new Database(DB_PATH, { readonly: true });

function getTimeFilter(range) {
  const now = new Date();
  switch (range) {
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'all':
    default:
      return null;
  }
}

function computeAndSave(range) {
  console.log(`Computing clusters for range: ${range}...`);
  const startTime = getTimeFilter(range);
  const limit = LIMITS[range] || 1000;
  
  // First get total count
  let countQuery = 'SELECT COUNT(*) as n FROM posts WHERE title IS NOT NULL';
  const countParams = [];
  if (startTime) {
    countQuery += ' AND created_at >= ?';
    countParams.push(startTime);
  }
  const totalInRange = db.prepare(countQuery).get(...countParams).n;
  
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
  
  query += ` ORDER BY created_at DESC LIMIT ${limit}`;
  
  const posts = db.prepare(query).all(...params);
  const limitNote = posts.length < totalInRange ? ` (limited from ${totalInRange})` : '';
  console.log(`  Analyzing ${posts.length} posts${limitNote}`);
  
  if (posts.length === 0) {
    const result = {
      range,
      computedAt: new Date().toISOString(),
      totalPosts: 0,
      clusteredPosts: 0,
      clusterCount: 0,
      duplicateStats: {
        perfectDupeClusterCount: 0,
        perfectDupePostCount: 0,
        dupePercentage: 0
      },
      clusters: []
    };
    
    const cacheFile = path.join(CACHE_DIR, `clusters-${range}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
    console.log(`  Saved to ${cacheFile}`);
    return;
  }
  
  // Compute clusters
  const clusterStart = Date.now();
  const clusters = clusterPosts(posts, THRESHOLD);
  const clusterTime = Date.now() - clusterStart;
  console.log(`  Clustering took ${clusterTime}ms`);
  
  // Calculate stats
  const perfectDupes = clusters.filter(c => c.avgSimilarity >= 0.99);
  const perfectDupePostCount = perfectDupes.reduce((sum, c) => sum + c.size, 0);
  const dupePercentage = posts.length > 0 ? Math.round((perfectDupePostCount / posts.length) * 100) : 0;
  
  // Add themes to clusters
  const enrichedClusters = clusters.map(cluster => ({
    ...cluster,
    theme: extractClusterTheme(cluster)
  }));
  
  const result = {
    range,
    computedAt: new Date().toISOString(),
    computeTimeMs: clusterTime,
    totalPosts: posts.length,
    clusteredPosts: clusters.reduce((sum, c) => sum + c.size, 0),
    clusterCount: clusters.length,
    duplicateStats: {
      perfectDupeClusterCount: perfectDupes.length,
      perfectDupePostCount,
      dupePercentage
    },
    clusters: enrichedClusters
  };
  
  const cacheFile = path.join(CACHE_DIR, `clusters-${range}.json`);
  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  console.log(`  Found ${clusters.length} clusters (${perfectDupes.length} perfect dupes)`);
  console.log(`  Saved to ${cacheFile}`);
}

// Main
console.log('=== Precomputing Clusters ===');
console.log(`Database: ${DB_PATH}`);
console.log(`Cache dir: ${CACHE_DIR}`);
console.log('');

const ranges = ['24h', '7d', 'all'];
for (const range of ranges) {
  computeAndSave(range);
  console.log('');
}

db.close();
console.log('Done!');
