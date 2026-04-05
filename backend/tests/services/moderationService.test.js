/**
 * Moderation Service Quality Filters Tests
 * Tests for domain reputation, URL validation, and date confidence penalties
 */

import { describe, test, expect } from 'vitest';
import { applyQualityFilters, getDomainReputation } from '../../services/moderationService.js';

describe('Quality filters', () => {
  test('rejects competitor domains', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://cuyahogavalley.com/', {});
    expect(filtered.confidence_score).toBeLessThan(0.5);
    expect(filtered.issues).toContain('competitor_domain');
    expect(filtered.reasoning).toContain('competitor aggregator');
  });

  test('penalizes generic URLs', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://nps.gov/', {});
    expect(filtered.issues).toContain('generic_url');
    expect(filtered.reasoning).toContain('bare homepage');
  });

  test('caps confidence when no date', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://nps.gov/article', { dateConfidence: 'unknown' });
    expect(filtered.confidence_score).toBeLessThanOrEqual(0.7);
    expect(filtered.reasoning).toContain('No publication date');
  });

  test('allows trusted domains with specific URLs', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://nps.gov/cuva/new-trail.htm', {
      publicationDate: '2025-03-15',
      dateConfidence: 'exact'
    });
    expect(filtered.confidence_score).toBeGreaterThanOrEqual(0.9);
  });

  test('compounds penalties for multiple quality issues', () => {
    // Competitor domain + generic URL + no date should result in very low score
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://cuyahogavalley.com/', {
      dateConfidence: 'unknown'
    });
    // 1.0 * 0.3 (competitor) * 0.6 (generic) = 0.18, capped at 0.7 = 0.18
    expect(filtered.confidence_score).toBeLessThan(0.2);
    expect(filtered.issues).toContain('competitor_domain');
    expect(filtered.issues).toContain('generic_url');
  });

  test('unknown domain with specific URL gets slight penalty', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://example.com/specific-article', {
      publicationDate: '2025-03-15',
      dateConfidence: 'exact'
    });
    // 1.0 * 0.9 (unknown domain) = 0.9
    expect(filtered.confidence_score).toBeCloseTo(0.9, 1);
  });

  test('trusted domain with generic URL still gets penalized', () => {
    const scoring = { confidence_score: 1.0, reasoning: '', issues: [] };
    const filtered = applyQualityFilters(scoring, 'https://clevelandmetroparks.com/news', {
      publicationDate: '2025-03-15',
      dateConfidence: 'exact'
    });
    // 1.0 * 1.0 (trusted) * 0.6 (generic) = 0.6
    expect(filtered.confidence_score).toBeCloseTo(0.6, 1);
    expect(filtered.issues).toContain('generic_url');
  });
});

describe('Domain reputation detection', () => {
  test('identifies trusted federal sources', () => {
    expect(getDomainReputation('https://nps.gov/cuva/article')).toBe('trusted');
    expect(getDomainReputation('https://www.nps.gov/cuva/article')).toBe('trusted');
    expect(getDomainReputation('https://doi.gov/news')).toBe('trusted');
  });

  test('identifies trusted metro parks', () => {
    expect(getDomainReputation('https://summitmetroparks.org/news')).toBe('trusted');
    expect(getDomainReputation('https://clevelandmetroparks.com/article')).toBe('trusted');
  });

  test('identifies trusted local news', () => {
    expect(getDomainReputation('https://cleveland.com/metro/2025/03/article.html')).toBe('trusted');
    expect(getDomainReputation('https://wkyc.com/news/local/story')).toBe('trusted');
  });

  test('identifies competitor domains', () => {
    expect(getDomainReputation('https://cuyahogavalley.com/')).toBe('competitor');
    expect(getDomainReputation('https://cvnp.guide/trail')).toBe('competitor');
    expect(getDomainReputation('https://www.cuyahogavalleyguide.com/news')).toBe('competitor');
  });

  test('identifies unknown domains', () => {
    expect(getDomainReputation('https://example.com/article')).toBe('unknown');
    expect(getDomainReputation('https://blog.random-site.org/post')).toBe('unknown');
  });

  test('handles malformed URLs', () => {
    expect(getDomainReputation('not-a-url')).toBe('unknown');
    expect(getDomainReputation('')).toBe('unknown');
    expect(getDomainReputation(null)).toBe('unknown');
  });
});
