/**
 * Moderation Service Quality Filters Tests
 * Tests for domain reputation, URL validation, and date confidence penalties
 */

import { describe, test, expect } from 'vitest';
import { getDomainReputation, evaluateDateGate, evaluateRegionGate } from '../../services/moderationService.js';

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
});
