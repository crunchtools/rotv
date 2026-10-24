/**
 * Match context: the settings a caller brings to the matchers. Pure; the
 * database-backed loader lives in candidates.js.
 */
import { nameWords } from './normalize.js';
import { stemWord } from './entities.js';

// Words of the region itself. They name places, not stories.
const REGION_WORDS = [
  'cuyahoga', 'valley', 'national', 'park', 'parks', 'metro', 'metroparks', 'ohio',
  'akron', 'cleveland', 'summit', 'county', 'northeast', 'river', 'lake', 'erie',
  'trail', 'towpath', 'reservation', 'preserve', 'city', 'township', 'village'
];

/** News thresholds. The digest uses these; moderation passes stricter ones. */
export const NEWS_THRESHOLDS = Object.freeze({
  // Text similarity is the share of the shorter item's 4-character n-grams
  // (title + summary, minus the POI's name) found in the longer one.
  // Same POI: text similarity alone. Replaying six months of digests, every
  // same-POI pair at 0.5 or above was one story; 0.45–0.5 held two that were not.
  text: 0.5,
  // ...raised when either side has fewer than shortTokens content words, and
  // measured as Dice when both do
  shortText: 0.7,
  shortTokens: 12,
  // A text score this far under the bar counts when both mention the same calendar day
  dateBand: 0.05,
  // Any POI: a shared distinctive name in a headline, plus this much text similarity
  entityText: 0.35,
  // Ignore a name carried by more than this share of the batch (and more than entityMinDf items)
  entityMaxShare: 0.25,
  entityMinDf: 4,
  // Any POI: one outlet within outletDays calendar days, and either a shared name
  // in a headline, or headlines at least outletTitle (Dice, region words dropped)
  // alike with corroboration (outletText or outletStrongTitle)
  outletTitle: 0.5,
  outletStrongTitle: 0.65,
  outletText: 0.4,
  outletDays: 2,
  // Any POI: identical headlines need at least this many content words
  titleMinTokens: 4,
  // Shared names count as evidence at all (moderation turns them off)
  useEntities: true,
  // A shared URL also needs headlines this alike (Dice)
  urlTitle: 0
});

/**
 * Moderation rejects on a match, and a rejected story leaves the site, where a
 * second outlet's take or a later update still has value. So it only rejects
 * copies: the same link with a like headline, the same headline, one outlet's
 * near-identical headlines, or near-identical text. Shared names never count here: a replay rejected the
 * second week's Fishing Report and later Szalay's Farm updates on them.
 */
export const MODERATION_NEWS_THRESHOLDS = Object.freeze({
  useEntities: false,
  urlTitle: 0.6,
  text: 0.8,
  shortText: 0.9,
  dateBand: 0,
  outletText: 2,
  outletStrongTitle: 0.8
});

export const EVENT_THRESHOLDS = Object.freeze({
  // Same day, same organizer or venue, and start times that agree
  slotTitle: 0.6,
  // Same venue (by POI or venue text), starts close together
  venueTitle: 0.5,
  venueText: 0.6,
  venueMinutes: 30
});

// Names are compared singular ("metropark"), so place words must be too
function withStems(words) {
  for (const word of [...words]) words.add(stemWord(word));
  return words;
}

/**
 * Build a match context.
 * @param {object} [options]
 * @param {string[]} [options.poiNames] every POI name; their words stop counting as story names
 * @param {Partial<typeof NEWS_THRESHOLDS>} [options.news] news threshold overrides
 * @param {Partial<typeof EVENT_THRESHOLDS>} [options.events] event threshold overrides
 * @param {string} [options.tz] timezone for calendar-day comparisons
 * @returns {{placeWords: Set<string>, regionWords: Set<string>, news: typeof NEWS_THRESHOLDS, events: typeof EVENT_THRESHOLDS, tz: string}}
 */
export function createMatchContext({ poiNames = [], news = {}, events = {}, tz = 'America/New_York' } = {}) {
  const placeWords = withStems(nameWords(...poiNames, ...REGION_WORDS));
  return {
    placeWords,
    regionWords: withStems(new Set(REGION_WORDS)),
    news: { ...NEWS_THRESHOLDS, ...news },
    events: { ...EVENT_THRESHOLDS, ...events },
    tz
  };
}

/**
 * The same context with other thresholds, so a caller can match at two bars
 * without loading POI names twice.
 * @param {ReturnType<typeof createMatchContext>} ctx
 * @param {{news?: Partial<typeof NEWS_THRESHOLDS>, events?: Partial<typeof EVENT_THRESHOLDS>}} overrides
 * @returns {ReturnType<typeof createMatchContext>}
 */
export function withThresholds(ctx, { news = {}, events = {} } = {}) {
  return { ...ctx, news: { ...NEWS_THRESHOLDS, ...news }, events: { ...EVENT_THRESHOLDS, ...events } };
}

/**
 * The context plus the POI names carried on the items themselves, so a caller
 * with no POI list still treats each item's own place name as a place.
 * @param {ReturnType<typeof createMatchContext>} ctx
 * @param {{poi_name?: string}[]} items
 * @returns {ReturnType<typeof createMatchContext>}
 */
export function withItemPlaces(ctx, items) {
  const placeWords = new Set(ctx.placeWords);
  for (const w of withStems(nameWords(...items.map(item => item.poi_name)))) placeWords.add(w);
  return { ...ctx, placeWords };
}
