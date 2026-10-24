/**
 * Are two news items the same story? Each signal is checked in order and the
 * first that holds is the reason. Items filed under different POIs need a
 * strong signal (url, title, outlet or entity); text similarity alone only
 * merges within one POI, since two parks' stories share plenty of vocabulary.
 */
import {
  canonicalUrl, urlHost, normalizeTitle, titleSiteSuffix, stripBoilerplate, contentTokens, nameWords, dayInTimezone
} from './normalize.js';
import { charNgrams, dice, containment } from './similarity.js';
import { extractEntities, mentionedDays, stemWord } from './entities.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function outletWords(item, placeWords) {
  const host = urlHost(item.source_url);
  const words = nameWords(item.source_name, host && host.split('.').slice(0, -1).join(' '),
    titleSiteSuffix(item.title, host));
  if (!words.size) return placeWords;
  return new Set([...placeWords, ...words]);
}

/**
 * Precompute what the matcher compares. Call once per item per batch.
 * @param {object} item news row: title, summary, source_url, alt_urls, poi_id, poi_name,
 *   publication_date, collection_date
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @returns {object} opaque features for matchNewsFeatures
 */
export function newsFeatures(item, ctx) {
  const poiWords = nameWords(item.poi_name);
  const summary = stripBoilerplate(item.summary);
  const host = urlHost(item.source_url);
  const title = normalizeTitle(item.title, host);
  const textTokens = contentTokens(`${item.title || ''} ${summary}`, { drop: poiWords });
  const when = item.publication_date || item.collection_date;
  const urls = new Set([item.source_url, ...(item.alt_urls || [])].map(canonicalUrl).filter(Boolean));
  return {
    id: item.id,
    poiId: item.poi_id,
    urls,
    host,
    title,
    truncated: /(?:\.\.\.|…)\s*$/.test(item.title || ''),
    // Names are stored singular; compare them against a singular headline
    titleStem: ` ${title.split(' ').map(stemWord).join(' ')} `,
    titleTokenCount: contentTokens(title).length,
    // Outlet repeats compare headlines without region words ("Cleveland", "Cuyahoga")
    // but with POI names: sibling POIs ("John Brown House", "John Brown Monument")
    // would otherwise drop different words from one headline
    titleGrams: charNgrams(contentTokens(title, { drop: ctx.regionWords })),
    headlineGrams: charNgrams(contentTokens(title, { drop: poiWords })),
    textGrams: charNgrams(textTokens),
    tokenCount: new Set(textTokens).size,
    day: when ? dayInTimezone(when, ctx.tz) : null,
    // The outlet's own name ("Fox 8 Cleveland WJW") is no more a story than a place is
    entities: extractEntities({ title: item.title, summary }, outletWords(item, ctx.placeWords)),
    days: mentionedDays(summary, when ? new Date(when) : new Date(), ctx.tz)
  };
}

// Share of the shorter text found in the longer one. A wire rewrite or a
// headline-only TV summary is mostly contained in the full story, while Dice
// would score it low just for being short.
const overlap = (a, b) => (a.size <= b.size ? containment(a, b) : containment(b, a));
// Equal headlines, or one cut short with an ellipsis ("After federal cuts, here's
// how Conservancy for Cuyahoga Valley ...") that the other starts with
function sameHeadline(fa, fb) {
  if (!fa.title || !fb.title) return false;
  if (fa.title === fb.title) return true;
  const prefixOf = (cut, full) => cut.truncated && ` ${full.title} `.startsWith(` ${cut.title} `);
  return prefixOf(fa, fb) || prefixOf(fb, fa);
}

const dayGap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
const shares = (a, b) => [...a].some(value => b.has(value));
const matched = (reason, score) => ({ match: true, reason, score });

function sharedEntity(fa, fb, entityDf, limit) {
  for (const entity of fa.entities) {
    if (!fb.entities.has(entity)) continue;
    if (entityDf && (entityDf.get(entity) || 0) > limit) continue;
    // A name only counts when a headline is about it
    if (fa.titleStem.includes(` ${entity} `) || fb.titleStem.includes(` ${entity} `)) return entity;
  }
  return null;
}

/**
 * Compare precomputed features.
 * @param {object} fa newsFeatures of one item
 * @param {object} fb newsFeatures of the other
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @param {Map<string, number>} [entityDf] how many items in the batch carry each name
 * @param {number} [batchSize] items in the batch, for the name-frequency limit
 * @returns {{match: boolean, reason: string|null, score: number}}
 */
export function matchNewsFeatures(fa, fb, ctx, entityDf = null, batchSize = 0) {
  const t = ctx.news;
  if (shares(fa.urls, fb.urls)) return matched('url', 1);

  const samePoi = fa.poiId != null && fa.poiId === fb.poiId;
  if (sameHeadline(fa, fb) && (samePoi || Math.min(fa.titleTokenCount, fb.titleTokenCount) >= t.titleMinTokens)) {
    return matched('title', 1);
  }

  const text = overlap(fa.textGrams, fb.textGrams);
  const dfLimit = Math.max(t.entityMinDf, Math.floor(batchSize * t.entityMaxShare));
  const entity = sharedEntity(fa, fb, entityDf, dfLimit);

  // One outlet, two pieces on one event a day apart (a gallery and the article):
  // the headlines carry it, and the summaries may share little
  if (fa.host && fa.host === fb.host && fa.day && fb.day && dayGap(fa.day, fb.day) <= t.outletDays) {
    const title = dice(fa.titleGrams, fb.titleGrams);
    const corroborated = title >= t.outletStrongTitle || text >= t.outletText;
    if (entity || (title >= t.outletTitle && corroborated)) {
      return matched('outlet', title);
    }
  }

  if (entity && text >= t.entityText) return { match: true, reason: `entity:${entity}`, score: text };

  if (samePoi) {
    // A short item is cheap to contain, so it needs a higher bar; when both are
    // short, the bar is on symmetric Dice ("closed Monday for staff training" vs
    // "staff honored at Monday training banquet" share most of either one's words)
    const shortCount = [fa, fb].filter(f => f.tokenCount < t.shortTokens).length;
    const score = shortCount === 2 ? dice(fa.textGrams, fb.textGrams) : text;
    const needed = shortCount ? t.shortText : t.text;
    if (score >= needed) return matched('text', score);
    if (score >= needed - t.dateBand && shares(fa.days, fb.days)) return matched('text+date', score);
  }
  return { match: false, reason: null, score: text };
}

/**
 * Are two news rows the same story?
 * @param {object} a news row
 * @param {object} b news row
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @returns {{match: boolean, reason: string|null, score: number}}
 */
export function newsPairMatch(a, b, ctx) {
  return matchNewsFeatures(newsFeatures(a, ctx), newsFeatures(b, ctx), ctx);
}
