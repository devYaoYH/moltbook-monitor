/**
 * Novelty detection - find posts that stand out from the noise
 * 
 * Uses TF-IDF inspired scoring:
 * - Posts with common/repetitive terms (mint, claw, crypto spam) score LOW
 * - Posts with rare/unique terms score HIGH
 * - Singleton posts (don't cluster with anything) get bonus
 */

const { tokenize, extractKeywords } = require('./text');

/**
 * Build corpus statistics for novelty scoring
 */
function buildCorpusStats(posts) {
  const docFreq = {};  // How many docs contain each term
  const totalDocs = posts.length;
  
  // Count document frequency for each term
  for (const post of posts) {
    const text = (post.title || '') + ' ' + (post.content || '');
    const uniqueTokens = new Set(tokenize(text));
    for (const token of uniqueTokens) {
      docFreq[token] = (docFreq[token] || 0) + 1;
    }
  }
  
  // Compute IDF (inverse document frequency)
  const idf = {};
  for (const [term, df] of Object.entries(docFreq)) {
    idf[term] = Math.log(totalDocs / (1 + df));
  }
  
  return { docFreq, idf, totalDocs };
}

/**
 * Score a post's novelty based on term rarity
 * Higher score = more unique/novel content
 */
function scoreNovelty(post, corpusStats) {
  const text = (post.title || '') + ' ' + (post.content || '');
  const tokens = tokenize(text);
  
  if (tokens.length === 0) return 0;
  
  // TF-IDF score: sum of (term frequency * inverse doc frequency)
  const termFreq = {};
  for (const token of tokens) {
    termFreq[token] = (termFreq[token] || 0) + 1;
  }
  
  let tfidfScore = 0;
  for (const [term, tf] of Object.entries(termFreq)) {
    const idf = corpusStats.idf[term] || 0;
    tfidfScore += (tf / tokens.length) * idf;
  }
  
  // Normalize by text length (longer posts shouldn't auto-win)
  const lengthBonus = Math.min(tokens.length / 50, 1); // Bonus for substantive content, caps at 50 words
  
  return {
    score: Math.round(tfidfScore * 100) / 100,
    lengthBonus: Math.round(lengthBonus * 100) / 100,
    finalScore: Math.round((tfidfScore * (0.7 + 0.3 * lengthBonus)) * 100) / 100,
    tokenCount: tokens.length,
    uniqueTerms: Object.keys(termFreq).length
  };
}

/**
 * Find novel/interesting posts in a collection
 * Returns posts sorted by novelty score (highest first)
 */
function findNovelPosts(posts, options = {}) {
  const {
    minScore = 0.5,
    minLength = 20,  // Minimum tokens to consider
    excludeClustered = false,
    clusterThreshold = 0.4
  } = options;
  
  // Build corpus stats
  const corpusStats = buildCorpusStats(posts);
  
  // Score each post
  const scoredPosts = posts.map(post => {
    const novelty = scoreNovelty(post, corpusStats);
    return {
      ...post,
      novelty
    };
  });
  
  // Filter and sort
  return scoredPosts
    .filter(p => p.novelty.finalScore >= minScore && p.novelty.tokenCount >= minLength)
    .sort((a, b) => b.novelty.finalScore - a.novelty.finalScore);
}

/**
 * Detect spam patterns - posts that look like bot activity
 */
function detectSpamPatterns(posts) {
  const patterns = {
    cryptoMint: /\b(mint|airdrop|token|nft|whitelist)\b/i,
    repetitiveCaps: /[A-Z]{5,}/,
    excessiveEmoji: /[\u{1F300}-\u{1F9FF}]{3,}/u,
    shortSpam: text => text.length < 50 && /\b(join|click|free)\b/i.test(text)
  };
  
  return posts.map(post => {
    const text = (post.title || '') + ' ' + (post.content || '');
    const spamSignals = {
      cryptoMint: patterns.cryptoMint.test(text),
      repetitiveCaps: patterns.repetitiveCaps.test(text),
      excessiveEmoji: patterns.excessiveEmoji.test(text),
      shortSpam: patterns.shortSpam(text)
    };
    const spamScore = Object.values(spamSignals).filter(Boolean).length;
    
    return {
      ...post,
      spamSignals,
      spamScore,
      isLikelySpam: spamScore >= 2
    };
  });
}

/**
 * Get high-quality posts (novel + not spam)
 */
function getHighQualityPosts(posts, options = {}) {
  const { limit = 20, minNovelty = 0.3 } = options;
  
  // Score novelty
  const corpusStats = buildCorpusStats(posts);
  const withNovelty = posts.map(post => ({
    ...post,
    novelty: scoreNovelty(post, corpusStats)
  }));
  
  // Detect spam
  const withSpam = detectSpamPatterns(withNovelty);
  
  // Filter: high novelty, not spam, decent engagement
  return withSpam
    .filter(p => 
      p.novelty.finalScore >= minNovelty && 
      !p.isLikelySpam &&
      p.novelty.tokenCount >= 15
    )
    .sort((a, b) => {
      // Sort by novelty + engagement combo
      const scoreA = a.novelty.finalScore + Math.log1p(a.upvotes || 0) * 0.1;
      const scoreB = b.novelty.finalScore + Math.log1p(b.upvotes || 0) * 0.1;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

module.exports = {
  buildCorpusStats,
  scoreNovelty,
  findNovelPosts,
  detectSpamPatterns,
  getHighQualityPosts
};
