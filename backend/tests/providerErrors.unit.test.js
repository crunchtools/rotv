import { describe, it, expect } from 'vitest';
import { classifyProviderError, firstProviderFailure } from '../services/providerErrors.js';
import { pipelineVerdict } from '../routes/collectionHealth.js';

describe('classifyProviderError', () => {
  it('flags Serper out of credits', () => {
    const err = new Error('Serper API error (news): 400 - {"message":"Not enough credits"}');
    expect(classifyProviderError(err)).toEqual({ provider: 'serper', error_class: 'quota_exhausted' });
  });

  it('flags OpenRouter 402 as quota exhausted', () => {
    expect(classifyProviderError(new Error('OpenRouter returned 402: payment'))).toEqual({
      provider: 'openrouter', error_class: 'quota_exhausted'
    });
  });

  it('flags 401/403 and invalid keys as auth failures', () => {
    expect(classifyProviderError(new Error('Invalid OpenRouter API key: nope')).error_class).toBe('auth_failed');
    expect(classifyProviderError(new Error('Serper API error (search): 403 - forbidden'))).toEqual({
      provider: 'serper', error_class: 'auth_failed'
    });
  });

  it('flags a missing key for either provider as an auth failure', () => {
    expect(classifyProviderError(new Error('OpenRouter API key not configured. Please add your API key in Settings.')))
      .toEqual({ provider: 'openrouter', error_class: 'auth_failed' });
    expect(classifyProviderError(new Error('Serper API key not configured. Please add your API key in Settings → Data Collection.')))
      .toEqual({ provider: 'serper', error_class: 'auth_failed' });
  });

  it('does not page on an OpenRouter 403 for a flagged input', () => {
    expect(classifyProviderError(new Error('OpenRouter returned 403: {"error":{"message":"Input was flagged by moderation"}}')))
      .toBeNull();
  });

  it('ignores credit and key words that a flagged 403 quotes from the page', () => {
    const flagged = (text) => new Error(
      `OpenRouter returned 403: {"error":{"message":"Input was flagged","metadata":{"flagged_input":"${text}"}}}`
    );
    expect(classifyProviderError(flagged('Payment required to view this story'))).toBeNull();
    expect(classifyProviderError(flagged('Error: invalid api key for the park camera feed'))).toBeNull();
  });

  it('ignores other errors', () => {
    expect(classifyProviderError(new Error('Serper API error (news): 500 - oops'))).toBeNull();
    expect(classifyProviderError(new Error('OpenRouter returned 503'))).toBeNull();
    expect(classifyProviderError(null)).toBeNull();
  });
});

describe('firstProviderFailure', () => {
  it('finds the credit failure among dropped page results', () => {
    const results = [
      { news: [] },
      new Error('render timed out'),
      new Error('OpenRouter returned 402: {"error":{"message":"Insufficient credits"}}')
    ];
    expect(firstProviderFailure(results)).toEqual({
      message: 'OpenRouter returned 402: {"error":{"message":"Insufficient credits"}}',
      details: { provider: 'openrouter', error_class: 'quota_exhausted' }
    });
  });

  it('is null when no page failed on a provider', () => {
    expect(firstProviderFailure([{ news: [] }, new Error('render timed out'), null])).toBeNull();
  });
});

describe('pipelineVerdict', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const run = { completed_at: '2026-11-13T11:00:00Z', total_pois: 10 };

  it('is CRITICAL naming the provider on a quota error', () => {
    const v = pipelineVerdict('current_news', run, { provider: 'serper', error_class: 'quota_exhausted', message: 'x' }, 0, now);
    expect(v.status).toBe('CRITICAL');
    expect(v.message).toContain('serper');
  });

  it('is CRITICAL when most searches failed', () => {
    expect(pipelineVerdict('events', run, null, 6, now).status).toBe('CRITICAL');
  });

  it('is WARNING when stale or never run', () => {
    expect(pipelineVerdict('events', { ...run, completed_at: '2026-11-12T00:00:00Z' }, null, 0, now).status).toBe('WARNING');
    expect(pipelineVerdict('events', null, null, 0, now).status).toBe('WARNING');
  });

  it('is OK for a healthy run', () => {
    expect(pipelineVerdict('events', run, null, 1, now).status).toBe('OK');
  });
});
