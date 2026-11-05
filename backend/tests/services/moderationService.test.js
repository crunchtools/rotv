/**
 * Moderation Service Quality Filters Tests
 * Tests for domain reputation, URL validation, and date confidence penalties
 */

import { describe, test, expect } from 'vitest';
import { getDomainReputation, evaluateDateGate, evaluateRegionGate, rescoreFromSignals, buildRegionPrompt } from '../../services/moderationService.js';

// Test domain lists (mirrors production config from migration 019)
const TRUSTED_DOMAINS = [
  'nps.gov', 'doi.gov', 'usgs.gov',
  'summitmetroparks.org', 'clevelandmetroparks.com', 'metroparks.org',
  'cleveland.com', 'wkyc.com', 'fox8.com', 'beaconjournal.com', 'recordpub.com',
  'ohiohistory.org', 'clevelandhistorical.org', 'wrhs.org'
];

const COMPETITOR_DOMAINS = [
  'cuyahogavalley.com',
  'cvnp.guide',
  'cuyahogavalleyguide.com'
];

// Create Sets for tests (getDomainReputation expects Sets)
const TRUSTED_SET = new Set(TRUSTED_DOMAINS);
const COMPETITOR_SET = new Set(COMPETITOR_DOMAINS);

describe('Domain reputation detection', () => {
  test('identifies trusted federal sources', () => {
    expect(getDomainReputation('https://nps.gov/cuva/article', TRUSTED_SET, COMPETITOR_SET)).toBe('trusted');
    expect(getDomainReputation('https://www.nps.gov/cuva/article', TRUSTED_SET, COMPETITOR_SET)).toBe('trusted');
    expect(getDomainReputation('https://doi.gov/news', TRUSTED_SET, COMPETITOR_SET)).toBe('trusted');
  });

  test('identifies trusted metro parks', () => {
    expect(getDomainReputation('https://summitmetroparks.org/news', TRUSTED_SET, COMPETITOR_SET)).toBe('trusted');
    expect(getDomainReputation('https://clevelandmetroparks.com/article', TRUSTED_SET, COMPETITOR_SET)).toBe('trusted');
  });

  test('identifies trusted local news', () => {
    expect(getDomainReputation('https://cleveland.com/metro/2025/03/article.html', TRUSTED_SET, COMPETITOR_SET)).toBe('trusted');
    expect(getDomainReputation('https://wkyc.com/news/local/story', TRUSTED_SET, COMPETITOR_SET)).toBe('trusted');
  });

  test('identifies blocklisted domains', () => {
    expect(getDomainReputation('https://cuyahogavalley.com/', TRUSTED_SET, COMPETITOR_SET)).toBe('blocklisted');
    expect(getDomainReputation('https://cvnp.guide/trail', TRUSTED_SET, COMPETITOR_SET)).toBe('blocklisted');
    expect(getDomainReputation('https://www.cuyahogavalleyguide.com/news', TRUSTED_SET, COMPETITOR_SET)).toBe('blocklisted');
  });

  test('identifies unknown domains', () => {
    expect(getDomainReputation('https://example.com/article', TRUSTED_SET, COMPETITOR_SET)).toBe('unknown');
    expect(getDomainReputation('https://blog.random-site.org/post', TRUSTED_SET, COMPETITOR_SET)).toBe('unknown');
  });

  test('handles malformed URLs', () => {
    expect(getDomainReputation('not-a-url', TRUSTED_SET, COMPETITOR_SET)).toBe('unknown');
    expect(getDomainReputation('', TRUSTED_SET, COMPETITOR_SET)).toBe('unknown');
    expect(getDomainReputation(null, TRUSTED_SET, COMPETITOR_SET)).toBe('unknown');
  });
});

describe('Date gate (spec 030)', () => {
  const cfg = { threshold: 4, floorYear: 2010 };

  test('missing date -> review', () => {
    expect(evaluateDateGate(null, 0, cfg).verdict).toBe('review');
  });

  test('consensus at/above threshold passes', () => {
    expect(evaluateDateGate('2023-06-01', 6, cfg).verdict).toBe('pass');
  });

  // A weak-consensus date goes to manual review regardless of source reputation — an
  // official domain earns no date-gate credit of its own.
  test('low consensus -> review regardless of source', () => {
    expect(evaluateDateGate('2024-09-10', 1, cfg).verdict).toBe('review');
  });

  test('old date with good consensus still passes (age never penalized)', () => {
    expect(evaluateDateGate('2015-04-01', 6, cfg).verdict).toBe('pass');
  });

  test('hallucinated pre-floor year -> review', () => {
    expect(evaluateDateGate('1899-01-01', 8, cfg).verdict).toBe('review');
  });

  // spec 044: date-only news is stored at noon Eastern; the 7 AM sweep must not call a
  // same-day article "future" and strand it in pending.
  test('same-day noon date passes; tomorrow is still future', () => {
    const now = new Date('2026-09-25T11:00:00Z'); // 7 AM Eastern
    expect(evaluateDateGate('2026-09-25T16:00:00Z', 6, { ...cfg, now }).verdict).toBe('pass');
    expect(evaluateDateGate('2026-09-26T16:00:00Z', 6, { ...cfg, now }).verdict).toBe('review');
  });

  test('future news date -> review, but events allow future', () => {
    const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    expect(evaluateDateGate(future, 6, cfg).verdict).toBe('review');
    expect(evaluateDateGate(future, 6, { ...cfg, allowFuture: true }).verdict).toBe('pass');
  });

  // PR #496: 4 unanimous LLM voters score exactly 4, meeting the threshold, so a clean date
  // with no machine-readable tag auto-publishes only on unanimity.
  test('passes when unanimous voters reach threshold (score 4)', () => {
    expect(evaluateDateGate('2021-12-03', 4, cfg).verdict).toBe('pass');
  });

  test('only 3 of 4 votes (score 3) -> review', () => {
    expect(evaluateDateGate('2021-12-03', 3, cfg).verdict).toBe('review');
  });
});

describe('Region gate (spec 041)', () => {
  const inRegion = { in_region: true, reasoning: 'in NE Ohio' };
  const outRegion = { in_region: false, reasoning: 'in Virginia' };

  test('unanimous in-region -> pass', () => {
    expect(evaluateRegionGate([inRegion, inRegion, inRegion]).verdict).toBe('pass');
  });

  // Regression: news #5416 — a Coast Guard change-of-command ceremony in Portsmouth, VA
  // that all three voters flagged out-of-region yet published via the relevance about_poi
  // hole. The Region gate must reject it.
  test('unanimous out-of-region -> fail (Coast Guard Virginia regression)', () => {
    const votes = [
      { in_region: false, reasoning: 'change of command ceremony in Virginia' },
      { in_region: false, reasoning: 'ceremony in Portsmouth, VA, outside NE Ohio' },
      { in_region: false, reasoning: 'located in Virginia' }
    ];
    const g = evaluateRegionGate(votes);
    expect(g.verdict).toBe('fail');
    expect(g.reason).toMatch(/Virginia/);
  });

  test('split verdict -> review (never auto-publishes, never auto-rejects)', () => {
    expect(evaluateRegionGate([inRegion, outRegion, inRegion]).verdict).toBe('review');
  });

  test('fewer than 3 votes (LLM failures) -> review, never fail', () => {
    expect(evaluateRegionGate([outRegion, outRegion]).verdict).toBe('review');
    expect(evaluateRegionGate([]).verdict).toBe('review');
  });

  // An out-of-region verdict auto-rejects, so absence of a local anchor must not be
  // treated as evidence of being elsewhere. Cleveland Metroparks' own posts often say
  // just "Metroparks" with no city; those must reach a human, not get dropped.
  test('unanimous out-of-region on an ambiguous agency name -> review, not fail', () => {
    const ambiguous = { in_region: false, ambiguous_agency: true, reasoning: 'only "MetroParks" named, no city' };
    const g = evaluateRegionGate([ambiguous, ambiguous, ambiguous]);
    expect(g.verdict).toBe('review');
    expect(g.reason).toMatch(/[Aa]mbiguous agency/);
  });

  test('a minority ambiguity flag still fails when the rest saw real evidence', () => {
    const votes = [
      { in_region: false, ambiguous_agency: true, reasoning: 'no city named' },
      { in_region: false, ambiguous_agency: false, reasoning: 'West Chester, Butler County' },
      { in_region: false, ambiguous_agency: false, reasoning: 'southwest Ohio' }
    ];
    expect(evaluateRegionGate(votes).verdict).toBe('fail');
  });

  test('the Coast Guard case still fails once ambiguity is in play', () => {
    const votes = [
      { in_region: false, ambiguous_agency: false, reasoning: 'ceremony in Portsmouth, VA' },
      { in_region: false, ambiguous_agency: false, reasoning: 'located in Virginia' },
      { in_region: false, ambiguous_agency: false, reasoning: 'outside NE Ohio' }
    ];
    expect(evaluateRegionGate(votes).verdict).toBe('fail');
  });
});

describe('Region prompt guardrails', () => {
  const butlerCounty = {
    title: 'MetroParks officially has two new GRIT All-Terrain Wheelchairs available for public use',
    description: 'MetroParks believes parks and green spaces should be accessible for all.',
    poiName: 'Open Trail Collective'
  };

  test('names the in-region counties so the voter has a geographic anchor', () => {
    const prompt = buildRegionPrompt(butlerCounty);
    for (const county of ['Cuyahoga', 'Summit', 'Medina', 'Lorain', 'Lake', 'Geauga', 'Portage', 'Stark', 'Wayne']) {
      expect(prompt).toContain(county);
    }
  });

  // Regression: news #8309 — an Instagram post saying only "MetroParks" passed the
  // region gate 3/3 and turned out to be MetroParks of Butler County in West Chester,
  // southwest Ohio. The voters were following the lean-IN rule correctly; the rule
  // itself was wrong for an agency name that is ambiguous across Ohio.
  test('generically named agencies are carved out of the lean-IN default (Butler County regression)', () => {
    const prompt = buildRegionPrompt(butlerCounty);
    expect(prompt).toMatch(/lean-IN does NOT apply to a generically named public agency/);
    expect(prompt).toMatch(/Butler County/);
    expect(prompt).toMatch(/A regional-sounding name is\s+not a location/);
  });

  test('asks for ambiguous_agency so the gate can route it to review, not reject', () => {
    const prompt = buildRegionPrompt(butlerCounty);
    expect(prompt).toMatch(/"ambiguous_agency"/);
    expect(prompt).toMatch(/ambiguous_agency": true\b/);
    expect(prompt).toMatch(/sends the item to a human instead of rejecting it/);
  });

  test('lean-IN default survives for content with no signal placing it outside', () => {
    expect(buildRegionPrompt(butlerCounty)).toMatch(/genuinely unclear[\s\S]*lean IN/);
  });

  test('labels the filed-under POI as a search guess, not evidence of location', () => {
    const prompt = buildRegionPrompt(butlerCounty);
    expect(prompt).toContain('Open Trail Collective');
    expect(prompt).toMatch(/a guess, not evidence/);
  });

  test('tolerates a missing description and POI name', () => {
    const prompt = buildRegionPrompt({ title: 'Untitled', description: null, poiName: null });
    expect(prompt).toContain('(none)');
    expect(prompt).toContain('(unknown)');
  });
});

describe('rescoreFromSignals (spec 044)', () => {
  test('events read the start signals instead of scoring nothing', () => {
    const eventSignals = {
      start: { jsonLd: ['2026-09-27T10:00'], meta: [], timeTags: [], url: null, llmVotes: ['2026-09-27T10:00'] },
      end: { jsonLd: ['2026-09-27T14:00'], llmVotes: [] }
    };
    const consensus = rescoreFromSignals('event', eventSignals);
    expect(consensus.date).toBe('2026-09-27T10:00');
    expect(consensus.score).toBe(5);
  });

  test('missing or empty signals score nothing instead of throwing', () => {
    for (const [type, signals] of [['event', null], ['event', {}], ['news', undefined], ['event', { start: null }]]) {
      expect(rescoreFromSignals(type, signals)).toEqual({ date: null, score: 0, sourceMap: {} });
    }
  });

  test('news reads top-level signals', () => {
    const consensus = rescoreFromSignals('news', { jsonLd: ['2026-09-20'], llmVotes: ['2026-09-20'] });
    expect(consensus.date).toBe('2026-09-20');
    expect(consensus.score).toBe(5);
  });
});
