/**
 * Text analysis utilities for moltbook data
 */

// Common stop words to filter out
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
  'only', 'same', 'so', 'than', 'too', 'very', 'just', 'can', 'now', 'into', 'if',
  'then', 'also', 'about', 'up', 'out', 'over', 'after', 'before', 'between',
  'through', 'during', 'under', 'again', 'there', 'here', 'once', 'any', 'because',
  'while', 'until', 'against', 'like', 'get', 'got', 'make', 'made', 'think', 'know',
  'take', 'come', 'want', 'use', 'find', 'give', 'tell', 'say', 'see', 'look', 'new',
  'one', 'two', 'first', 'way', 'even', 'well', 'back', 'much', 'still', 'good',
  'going', 'really', 'thing', 'things', 'something', 'anything', 'everything',
  'being', 'getting', 'doing', 'having', 'making', 'time', 'people', 'dont', 'im',
  'ive', 'thats', 'its', 'youre', 'theyre', 'weve', 'cant', 'wont', 'didnt', 'isnt',
  'arent', 'wasnt', 'werent', 'havent', 'hasnt', 'hadnt', 'doesnt', 'dont'
]);

/**
 * Tokenize text into words
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Extract keywords with frequency counts
 */
function extractKeywords(text, limit = 100) {
  const tokens = tokenize(text);
  const freq = {};
  
  for (const token of tokens) {
    freq[token] = (freq[token] || 0) + 1;
  }
  
  return Object.entries(freq)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Compute Jaccard similarity between two texts
 */
function computeSimilarity(textA, textB) {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));
  
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  
  const intersection = new Set([...tokensA].filter(x => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  
  return intersection.size / union.size;
}

/**
 * Extract n-grams from text
 */
function extractNgrams(text, n = 2, limit = 50) {
  const tokens = tokenize(text);
  const ngrams = {};
  
  for (let i = 0; i <= tokens.length - n; i++) {
    const ngram = tokens.slice(i, i + n).join(' ');
    ngrams[ngram] = (ngrams[ngram] || 0) + 1;
  }
  
  return Object.entries(ngrams)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

module.exports = {
  tokenize,
  extractKeywords,
  computeSimilarity,
  extractNgrams,
  STOP_WORDS
};
