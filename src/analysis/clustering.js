/**
 * Post clustering using union-find and similarity thresholds
 */

const { computeSimilarity, tokenize } = require('./text');

/**
 * Union-Find data structure for clustering
 */
class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array(n).fill(0);
  }

  find(x) {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // path compression
    }
    return this.parent[x];
  }

  union(x, y) {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return false;

    // union by rank
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py;
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px;
    } else {
      this.parent[py] = px;
      this.rank[px]++;
    }
    return true;
  }

  getClusters() {
    const clusters = {};
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!clusters[root]) clusters[root] = [];
      clusters[root].push(i);
    }
    return Object.values(clusters).filter(c => c.length > 1);
  }
}

/**
 * Cluster posts by content similarity
 * @param {Array} posts - Array of post objects with id, title, content
 * @param {number} threshold - Similarity threshold (0-1)
 * @returns {Array} Array of clusters, each cluster is array of posts
 */
function clusterPosts(posts, threshold = 0.4) {
  const n = posts.length;
  if (n === 0) return [];

  // Compute text representations
  const texts = posts.map(p => (p.title || '') + ' ' + (p.content || ''));
  
  // Union-find to group similar posts
  const uf = new UnionFind(n);
  
  // Compare all pairs (O(n²) - fine for hundreds of posts)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const similarity = computeSimilarity(texts[i], texts[j]);
      if (similarity >= threshold) {
        uf.union(i, j);
      }
    }
  }

  // Get clusters and map back to posts
  const clusterIndices = uf.getClusters();
  
  return clusterIndices.map(indices => {
    const clusterPosts = indices.map(i => posts[i]);
    
    // Calculate cluster centroid similarity (average pairwise similarity)
    let totalSim = 0;
    let count = 0;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        totalSim += computeSimilarity(texts[indices[i]], texts[indices[j]]);
        count++;
      }
    }
    const avgSimilarity = count > 0 ? totalSim / count : 1;

    // Find representative post (most similar to others in cluster)
    let bestRep = 0;
    let bestScore = -1;
    for (let i = 0; i < indices.length; i++) {
      let score = 0;
      for (let j = 0; j < indices.length; j++) {
        if (i !== j) {
          score += computeSimilarity(texts[indices[i]], texts[indices[j]]);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestRep = i;
      }
    }

    return {
      size: clusterPosts.length,
      avgSimilarity: Math.round(avgSimilarity * 100) / 100,
      representative: clusterPosts[bestRep],
      posts: clusterPosts.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0))
    };
  }).sort((a, b) => b.size - a.size);
}

/**
 * Extract common themes from a cluster
 */
function extractClusterTheme(cluster) {
  const allText = cluster.posts.map(p => (p.title || '') + ' ' + (p.content || '')).join(' ');
  const tokens = tokenize(allText);
  
  // Count frequencies
  const freq = {};
  for (const token of tokens) {
    freq[token] = (freq[token] || 0) + 1;
  }
  
  // Get top keywords
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

module.exports = {
  UnionFind,
  clusterPosts,
  extractClusterTheme
};
