/**
 * Set similarity measures. Inputs are Sets; every measure is symmetric except
 * containment, and every measure is 0 when either side is empty.
 */

/**
 * Character n-grams of each token, padded with spaces so word boundaries count.
 * Tokens shorter than n contribute themselves.
 * @param {string[]} tokens
 * @param {number} [n]
 * @returns {Set<string>}
 */
export function charNgrams(tokens, n = 4) {
  const grams = new Set();
  for (const token of tokens) {
    const padded = ` ${token} `;
    if (padded.length <= n) {
      grams.add(padded);
      continue;
    }
    for (let i = 0; i + n <= padded.length; i++) grams.add(padded.slice(i, i + n));
  }
  return grams;
}

function intersectionSize(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of small) if (big.has(value)) shared++;
  return shared;
}

/**
 * Sørensen–Dice coefficient: 2|A∩B| / (|A|+|B|).
 * @param {Set<any>} a
 * @param {Set<any>} b
 * @returns {number} 0..1
 */
export function dice(a, b) {
  if (!a.size || !b.size) return 0;
  return (2 * intersectionSize(a, b)) / (a.size + b.size);
}

/**
 * Jaccard index: |A∩B| / |A∪B|.
 * @param {Set<any>} a
 * @param {Set<any>} b
 * @returns {number} 0..1
 */
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const shared = intersectionSize(a, b);
  return shared / (a.size + b.size - shared);
}

/**
 * Share of `part` found in `whole`.
 * @param {Set<any>} part
 * @param {Set<any>} whole
 * @returns {number} 0..1
 */
export function containment(part, whole) {
  if (!part.size || !whole.size) return 0;
  return intersectionSize(part, whole) / part.size;
}
