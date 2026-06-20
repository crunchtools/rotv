/**
 * Unit tests for the date-voter configuration (PR #496).
 *
 * Guards the invariants that make the "4 unanimous voters = auto-publish" design hold:
 *   - every voter is assigned a distinct persona (decorrelation)
 *   - unanimous voters score exactly the default threshold (no more, no less)
 */
import { describe, it, expect } from 'vitest';
import { DATE_VOTER_PERSONAS, DEFAULT_NEWS_DATE_THRESHOLD } from '../services/newsService.js';

describe('date voter configuration', () => {
  it('provides at least one distinct persona per voter', () => {
    // There must be enough personas to cover every vote (LLM_DATE_VOTES = 4).
    expect(DATE_VOTER_PERSONAS.length).toBeGreaterThanOrEqual(DEFAULT_NEWS_DATE_THRESHOLD);
    const unique = new Set(DATE_VOTER_PERSONAS);
    expect(unique.size).toBe(DATE_VOTER_PERSONAS.length);
  });

  it('unanimous voters exactly meet the default threshold', () => {
    // Each voter contributes +1; full unanimity (4) must equal the threshold (4) so that
    // anything short of unanimity needs a corroborating structural signal to pass.
    expect(DEFAULT_NEWS_DATE_THRESHOLD).toBe(4);
  });
});
