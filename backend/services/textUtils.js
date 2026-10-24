/**
 * Text Utilities
 * Shared text comparison functions used by news collection, deep crawling, and moderation.
 */
import { jaccard } from './dedup/similarity.js';

/**
 * Calculate simple string similarity (0-1) using Jaccard word overlap
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score 0-1
 */
export function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const s1 = normalize(str1);
  const s2 = normalize(str2);

  if (s1 === s2) return 1;

  return jaccard(new Set(s1.split(/\s+/)), new Set(s2.split(/\s+/)));
}

/**
 * Quick check: does a page's markdown content appear to contain an article
 * matching the given item? Uses title word overlap without calling an LLM.
 * @param {string} markdown - Page content as markdown
 * @param {Object} item - Item with title and optionally summary/description
 * @returns {boolean} - true if content likely matches
 */
export function contentMatchesItem(markdown, item) {
  if (!markdown || !item.title) return false;
  const text = markdown.toLowerCase();
  const titleWords = item.title.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
    .filter(w => w.length > 3);
  if (titleWords.length === 0) return false;
  const matchCount = titleWords.filter(w => new RegExp(`\\b${w}\\b`).test(text)).length;
  return (matchCount / titleWords.length) >= 0.6;
}
