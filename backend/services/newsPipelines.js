// Current News and Historical News (spec 044). One pipeline answered both "what's
// happening now" and "what's the story of this place", with one search and one set of
// prompts, so history crowded out news: 411 of 603 news items published in a 30-day
// window were already more than 90 days old. Everything that differs between the two
// pipelines lives here; the collection, moderation, and digest code asks this module.

export const DEFAULT_CURRENT_WINDOW_DAYS = 30;
export const DEFAULT_HISTORY_MAX_URLS = 3;
export const DEFAULT_HISTORY_DRY_RUN_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

// An item's pipeline comes from its age when found, not from which search found it:
// a Google News hit can be old and a web-search hit can be fresh. Undated items are
// historical — they can't prove they're news.
export function newsPipelineFor(publishedDate, windowDays = DEFAULT_CURRENT_WINDOW_DAYS, now = new Date()) {
  if (!publishedDate) return 'historical';
  const published = new Date(publishedDate);
  if (Number.isNaN(published.getTime())) return 'historical';
  return now.getTime() - published.getTime() > windowDays * DAY_MS ? 'historical' : 'current';
}

// Tier is how often Current News checks a POI. A slightly short interval keeps a
// daily-tier POI due at the same cron time every day despite scheduler jitter.
const CADENCE_MS = {
  daily: DAY_MS - 2 * 60 * 60 * 1000,
  weekly: 7 * DAY_MS - 2 * 60 * 60 * 1000,
  monthly: 30 * DAY_MS - 2 * 60 * 60 * 1000
};

export function isDueForCurrentNews(tier, lastCollected, now = new Date()) {
  if (!lastCollected) return true;
  const interval = CADENCE_MS[tier] ?? CADENCE_MS.weekly;
  return now.getTime() - new Date(lastCollected).getTime() >= interval;
}

// Historical News rotates its angle each monthly run so repeat runs explore instead
// of re-asking the same question.
const HISTORY_QUERY_TEMPLATES = [
  (name, context) => `history of ${name}${context ? ` ${context}` : ''}`,
  (name, context) => `${name} historic${context ? ` ${context}` : ''}`,
  (name, context) => `${name}${context ? ` ${context}` : ''} archives photos`
];

// Serper request per pipeline. Current News asks Google News for the past month only
// (tbs=qdr:m); without it, /news for Brandywine Falls returned stories 3-11 months old.
export function serperRequestFor(pipeline, poiName, context, queryIndex = 0) {
  if (pipeline === 'historical') {
    const template = HISTORY_QUERY_TEMPLATES[queryIndex % HISTORY_QUERY_TEMPLATES.length];
    return { endpoint: 'search', query: template(poiName, context), extraBody: {} };
  }
  return {
    endpoint: 'news',
    query: `"${poiName}"${context ? ` ${context}` : ''}`,
    extraBody: { tbs: 'qdr:m' }
  };
}

export function buildNewsPrompt(pipeline, poi, markdown) {
  if (pipeline === 'historical') {
    return `Summarize the interesting history this page tells about "${poi.name}": what happened, when (a year or era if the page states one), and why it matters to the place's story.

PAGE CONTENT:
${markdown}

Return ONLY valid JSON:
{"title": "Headline for this piece of history", "summary": "2-3 sentence summary", "source_name": "Source name (e.g., Cleveland Historical, Akron Beacon Journal)", "news_type": "general|wildlife|infrastructure|community", "story_year": 1827}

story_year: the year the history happened, only if the page states it; otherwise null. It is not the date the page was published.
Do NOT include date or source_url fields — those are set separately.
Return {} if the page has no history about this place.`;
  }
  return `Summarize this news about "${poi.name}": what happened or is changing, when, and what it means for visitors.

PAGE CONTENT:
${markdown}

Return ONLY valid JSON:
{"title": "News headline", "summary": "2-3 sentence summary", "source_name": "Source name (e.g., NPS.gov, Cleveland.com)", "news_type": "general|alert|wildlife|infrastructure|community"}

Do NOT include date or source_url fields — those are set separately.
Return {} if no news found.`;
}

// Relevance criteria for news, per pipeline. Events keep the shared criteria in
// moderationService. Current News used to approve evergreen guides and hike recaps
// because the one prompt welcomed them; they're history or nothing, not news.
export function newsRelevanceCriteria(pipeline) {
  if (pipeline === 'historical') {
    return `This is the HISTORICAL NEWS collection: stories about the past of places in the
Cuyahoga Valley / Northeast Ohio region.

APPROVE if the content tells something about the history of the place named in Location, or of the
region's parks, trails, and communities — people, structures,
industry, the canal and railroad era, events, eras, legends, preservation, archaeology — or is a
historical feature about it. Old articles are expected and welcome.

REJECT if it has no historical substance:
- Trip reports, hike recaps, reviews, or "things to do" listings with no history in them
- Current announcements with no historical content
- Off-topic subjects (religious services, political events, private parties, commercial listings)
- Spam, navigation chrome, error pages, or content with no discernible subject`;
  }
  return `This is the CURRENT NEWS collection: what is happening now in the Cuyahoga Valley /
Northeast Ohio parks and outdoors.

APPROVE if the content reports something that happened or changed — announcements, openings,
closures, trail or park operations, conservation and wildlife news, construction, programs being
launched, awards, or press releases — about nature, trails, parks, outdoor recreation, or regional
history sites. News from or about the specific place named in Location counts even when that place
is a business (a brewery, a farm, a venue), as long as it reports something that happened or changed.

REJECT if it is not news:
- Evergreen guides, destination descriptions, reference pages, or "things to do" lists
- Personal trip reports, hike recaps, and social posts about a visit
- Off-topic subjects (religious services, political events, private parties, commercial listings,
  general community events unrelated to nature, parks, or regional history)
- Spam, navigation chrome, error pages, or content with no discernible subject`;
}
