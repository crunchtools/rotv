/**
 * Moderation Service Quality Filters Tests
 * Tests for domain reputation, URL validation, and date confidence penalties
 */

import { describe, test, expect } from 'vitest';
import { applyQualityFilters, getDomainReputation, evaluateDateGate } from '../../services/moderationService.js';

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

// Create Sets for tests (getDomainReputation and applyQualityFilters now expect Sets)
const TRUSTED_SET = new Set(TRUSTED_DOMAINS);
const COMPETITOR_SET = new Set(COMPETITOR_DOMAINS);

describe('Quality filters', () => {
  test('rejects blocklisted domains', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://cuyahogavalley.com/', {}, TRUSTED_SET, COMPETITOR_SET);
    expect(filtered.confidence_score).toBeLessThan(0.5);
    expect(filtered.issues).toContain('blocklisted_domain');
    expect(filtered.reasoning).toContain('blocklist');
  });

  test('penalizes generic URLs', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://nps.gov/', {}, TRUSTED_SET, COMPETITOR_SET);
    expect(filtered.issues).toContain('generic_url');
    expect(filtered.reasoning).toContain('bare homepage');
  });

  test('caps confidence when no date', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://nps.gov/article', { dateConfidence: 'unknown' }, TRUSTED_SET, COMPETITOR_SET);
    expect(filtered.confidence_score).toBeLessThanOrEqual(0.7);
    expect(filtered.reasoning).toContain('No publication date');
  });

  test('allows trusted domains with specific URLs', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://nps.gov/cuva/new-trail.htm', {
      publicationDate: '2025-03-15',
      dateConfidence: 'exact'
    }, TRUSTED_SET, COMPETITOR_SET);
    expect(filtered.confidence_score).toBeGreaterThanOrEqual(0.9);
  });

  test('compounds penalties for multiple quality issues', () => {
    // Competitor domain + generic URL + no date should result in very low score
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://cuyahogavalley.com/', {
      dateConfidence: 'unknown'
    }, TRUSTED_SET, COMPETITOR_SET);
    // 1.0 * 0.3 (blocklisted) * 0.6 (generic) = 0.18
    expect(filtered.confidence_score).toBeLessThan(0.2);
    expect(filtered.issues).toContain('blocklisted_domain');
    expect(filtered.issues).toContain('generic_url');
  });

  test('unknown domain with specific URL gets slight penalty', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://example.com/specific-article', {
      publicationDate: '2025-03-15',
      dateConfidence: 'exact'
    }, TRUSTED_SET, COMPETITOR_SET);
    // 1.0 * 0.9 (unknown domain) = 0.9
    expect(filtered.confidence_score).toBeCloseTo(0.9, 1);
  });

  test('trusted domain with generic URL still gets penalized', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://clevelandmetroparks.com/news', {
      publicationDate: '2025-03-15',
      dateConfidence: 'exact'
    }, TRUSTED_SET, COMPETITOR_SET);
    // 1.0 * 1.0 (trusted) * 0.6 (generic) = 0.6
    expect(filtered.confidence_score).toBeCloseTo(0.6, 1);
    expect(filtered.issues).toContain('generic_url');
  });
});

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
  const cfg = { threshold: 4, floorYear: 2010, trustedSet: TRUSTED_SET };

  test('missing date -> review', () => {
    expect(evaluateDateGate(null, 0, 'https://nps.gov/a', cfg).verdict).toBe('review');
  });

  test('high consensus passes from any source', () => {
    const g = evaluateDateGate('2023-06-01', 6, 'https://example.com/a', cfg);
    expect(g.verdict).toBe('pass');
  });

  test('trusted source passes a recent date with low consensus', () => {
    const g = evaluateDateGate('2024-09-10', 1, 'https://cleveland.com/story', cfg);
    expect(g.verdict).toBe('pass');
    expect(g.trusted_source).toBe(true);
  });

  test('untrusted source with low consensus -> review', () => {
    expect(evaluateDateGate('2024-09-10', 1, 'https://example.com/a', cfg).verdict).toBe('review');
  });

  test('old date from trusted source still passes (age never penalized)', () => {
    expect(evaluateDateGate('2015-04-01', 1, 'https://beaconjournal.com/x', cfg).verdict).toBe('pass');
  });

  test('hallucinated pre-floor year -> review', () => {
    expect(evaluateDateGate('1899-01-01', 8, 'https://cleveland.com/x', cfg).verdict).toBe('review');
  });

  test('future news date -> review, but events allow future', () => {
    const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    expect(evaluateDateGate(future, 6, 'https://cleveland.com/x', cfg).verdict).toBe('review');
    expect(evaluateDateGate(future, 6, 'https://cleveland.com/x', { ...cfg, allowFuture: true }).verdict).toBe('pass');
  });
});
