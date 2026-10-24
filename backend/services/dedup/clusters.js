/**
 * Group items by a pairwise "same" test. Every pair is compared and matches are
 * joined transitively (union-find), so the groups do not depend on input order:
 * if A matches B and B matches C, all three are one group even when A and C
 * would not match directly.
 *
 * @param {number} count number of items
 * @param {(i: number, j: number) => boolean} isSame called once per compared pair, i < j
 * @param {{block?: (i: number) => string|null}} [options] block: items with different
 *   keys are never compared, so a batch with a natural partition (events by day)
 *   costs the sum of its blocks' squares, not the square of the whole
 * @returns {number[][]} groups of indices, each ascending, ordered by first index
 */
export function clusterBy(count, isSame, { block = null } = {}) {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const blocks = new Map();
  for (let i = 0; i < count; i++) {
    const key = block ? block(i) : '';
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(i);
  }
  for (const members of blocks.values()) {
    for (let outer = 0; outer < members.length; outer++) {
      for (let inner = outer + 1; inner < members.length; inner++) {
        const [i, j] = [members[outer], members[inner]];
        if (isSame(i, j)) {
          const [a, b] = [find(i), find(j)];
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  return [...groups.values()].sort((a, b) => a[0] - b[0]);
}
