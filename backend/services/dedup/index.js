/**
 * Duplicate detection for news and events, shared by collection, moderation
 * and the newsletter. Matching is pure; candidates.js is the only part that
 * reads the database.
 *
 *   dedupeNews(items, ctx)    group a batch, keep one item per story
 *   newsPairMatch(a, b, ctx)  compare two items, with the reason
 *   createMatchContext(...)   POI names and thresholds for a caller
 */
import { clusterBy } from './clusters.js';
import { urlHost } from './normalize.js';
import { withItemPlaces } from './context.js';
import { newsFeatures, matchNewsFeatures } from './newsIdentity.js';
import { eventFeatures, matchEventFeatures } from './eventIdentity.js';

export * from './normalize.js';
export * from './similarity.js';
export { clusterBy } from './clusters.js';
export { createMatchContext, withItemPlaces, NEWS_THRESHOLDS, EVENT_THRESHOLDS, MODERATION_NEWS_THRESHOLDS } from './context.js';
export { extractEntities, isTitleCase } from './entities.js';
export { newsFeatures, matchNewsFeatures, newsPairMatch } from './newsIdentity.js';
export { eventFeatures, matchEventFeatures, eventPairMatch } from './eventIdentity.js';

/**
 * Keep the first item of a group (callers sort most-preferred first), except
 * that a same-outlet copy with a fuller summary replaces it: one outlet's
 * photo gallery and its article are one story, and the article says more.
 * @param {object[]} items the group, in input order
 * @returns {object} the item to keep
 */
function pickFreshestOrFuller(items) {
  // Fix: a same-outlet repeat keeps the fuller summary (PR #694 review)
  const [first] = items;
  const length = (item) => (item.summary || '').length;
  const firstHost = urlHost(first.source_url);
  if (!firstHost) return first;
  return items.reduce((best, item) =>
    (urlHost(item.source_url) === firstHost && length(item) > length(best) ? item : best), first);
}

/**
 * Keep the first item of a group.
 * @param {object[]} items
 * @returns {object}
 */
const pickFirst = (items) => items[0];

function groupBatch(items, features, isSame, pick, block = null) {
  const edges = new Map();
  const groups = clusterBy(items.length, (i, j) => {
    const result = isSame(features[i], features[j]);
    if (result.match) {
      if (!edges.has(i)) edges.set(i, { other: j, reason: result.reason });
      if (!edges.has(j)) edges.set(j, { other: i, reason: result.reason });
    }
    return result.match;
  }, { block });
  const kept = [];
  const collapsed = [];
  for (const group of groups) {
    const members = group.map(i => items[i]);
    const keep = pick(members);
    kept.push(keep);
    for (const i of group) {
      if (items[i] === keep) continue;
      const edge = edges.get(i);
      collapsed.push({
        id: items[i].id, title: items[i].title, into: keep.id,
        matched: edge ? items[edge.other].id : null, reason: edge?.reason ?? null
      });
    }
  }
  return { kept, collapsed };
}

/**
 * Group news items that report one story and keep one per group.
 * The result does not depend on input order except through `pick`.
 * @param {object[]} items news rows, most preferred first
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @param {{pick?: (group: object[]) => object}} [options]
 * @returns {{kept: object[], collapsed: {id: number, title: string, into: number, matched: number, reason: string}[]}}
 *   kept in the position of each group's first item; collapsed lists each dropped item, the
 *   kept item it was folded into, the item it matched directly, and the signal that matched
 */
export function dedupeNews(items, ctx, { pick = pickFreshestOrFuller } = {}) {
  const local = withItemPlaces(ctx, items);
  const features = items.map(item => newsFeatures(item, local));
  const entityDf = new Map();
  for (const f of features) for (const e of f.entities) entityDf.set(e, (entityDf.get(e) || 0) + 1);
  return groupBatch(items, features, (a, b) => matchNewsFeatures(a, b, local, entityDf, items.length), pick);
}

/**
 * Group events that are one event and keep one per group.
 * @param {object[]} items event rows, most preferred first (the digest sorts by start, so a real
 *   start time beats the noon fallback)
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @param {{pick?: (group: object[]) => object}} [options]
 * @returns {{kept: object[], collapsed: {id: number, title: string, into: number, matched: number, reason: string}[]}}
 */
export function dedupeEvents(items, ctx, { pick = pickFirst } = {}) {
  const features = items.map(item => eventFeatures(item, ctx));
  // Events only match on the same calendar day, so only same-day pairs are compared
  return groupBatch(items, features, (a, b) => matchEventFeatures(a, b, ctx), pick, i => features[i].day);
}

function bestMatch(item, candidates, ctx, features, match) {
  const mine = features(item, ctx);
  let best = null;
  for (const candidate of candidates) {
    const result = match(mine, features(candidate, ctx), ctx);
    if (result.match && (!best || result.score > best.score)) best = { ...result, of: candidate };
  }
  return best;
}

/**
 * The candidate `item` most likely duplicates, if any matches.
 * @param {object} item news row
 * @param {object[]} candidates news rows (findNewsCandidates)
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @returns {{match: true, reason: string, score: number, of: object}|null}
 */
export function bestNewsMatch(item, candidates, ctx) {
  const local = withItemPlaces(ctx, [item, ...candidates]);
  return bestMatch(item, candidates, local, newsFeatures, matchNewsFeatures);
}

/**
 * The candidate `event` most likely duplicates, if any matches.
 * @param {object} event event row
 * @param {object[]} candidates event rows (findEventCandidates)
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @returns {{match: true, reason: string, score: number, of: object}|null}
 */
export function bestEventMatch(event, candidates, ctx) {
  return bestMatch(event, candidates, ctx, eventFeatures, matchEventFeatures);
}
