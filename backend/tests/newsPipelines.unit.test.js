import { describe, it, expect } from 'vitest';
import {
  newsPipelineFor, isDueForCurrentNews, serperRequestFor, buildNewsPrompt, newsRelevanceCriteria
} from '../services/newsPipelines.js';

const now = new Date('2026-09-25T12:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();

describe('newsPipelineFor', () => {
  it('labels items inside the window as Current News', () => {
    expect(newsPipelineFor(daysAgo(0), 30, now)).toBe('current');
    expect(newsPipelineFor(daysAgo(29), 30, now)).toBe('current');
    expect(newsPipelineFor(daysAgo(30), 30, now)).toBe('current');
  });

  it('labels older items as Historical News, whichever search found them', () => {
    expect(newsPipelineFor(daysAgo(31), 30, now)).toBe('historical');
    expect(newsPipelineFor('2020-08-27T16:00:00Z', 30, now)).toBe('historical');
  });

  it('labels undated or unparseable items historical, since they cannot prove they are news', () => {
    expect(newsPipelineFor(null, 30, now)).toBe('historical');
    expect(newsPipelineFor('not a date', 30, now)).toBe('historical');
  });

  it('honors a configured window', () => {
    expect(newsPipelineFor(daysAgo(10), 7, now)).toBe('historical');
  });
});

describe('isDueForCurrentNews', () => {
  it('is due when never collected', () => {
    expect(isDueForCurrentNews('monthly', null, now)).toBe(true);
  });

  it('daily POIs are due at the next day\'s run despite jitter', () => {
    const yesterdayLate = new Date(now.getTime() - 23 * 3600000);
    expect(isDueForCurrentNews('daily', yesterdayLate, now)).toBe(true);
    expect(isDueForCurrentNews('daily', new Date(now.getTime() - 3600000), now)).toBe(false);
  });

  it('weekly and monthly POIs wait their interval', () => {
    expect(isDueForCurrentNews('weekly', daysAgo(3), now)).toBe(false);
    expect(isDueForCurrentNews('weekly', daysAgo(7), now)).toBe(true);
    expect(isDueForCurrentNews('monthly', daysAgo(20), now)).toBe(false);
    expect(isDueForCurrentNews('monthly', daysAgo(30), now)).toBe(true);
  });

  it('treats an unknown tier as weekly', () => {
    expect(isDueForCurrentNews(undefined, daysAgo(3), now)).toBe(false);
  });
});

describe('serperRequestFor', () => {
  it('Current News asks Google News for the past month', () => {
    expect(serperRequestFor('current', 'Brandywine Falls', 'Cuyahoga Valley National Park')).toEqual({
      endpoint: 'news', query: '"Brandywine Falls" Cuyahoga Valley National Park', extraBody: { tbs: 'qdr:m' }
    });
  });

  it('Historical News rotates through its angles and wraps around', () => {
    const queries = [0, 1, 2, 3].map(i => serperRequestFor('historical', 'Jaite Mill', '', i));
    expect(queries.map(q => q.endpoint)).toEqual(['search', 'search', 'search', 'search']);
    expect(queries.map(q => q.query)).toEqual([
      'history of Jaite Mill', 'Jaite Mill historic', 'Jaite Mill archives photos', 'history of Jaite Mill'
    ]);
    expect(queries[0].extraBody).toEqual({});
  });
});

describe('prompts per pipeline', () => {
  const poi = { name: 'Jaite Mill Historic District' };

  it('Historical extraction asks for the story and its year, not the web date', () => {
    const prompt = buildNewsPrompt('historical', poi, 'page text');
    expect(prompt).toContain('interesting history');
    expect(prompt).toContain('story_year');
  });

  it('Current extraction asks what happened or is changing', () => {
    const prompt = buildNewsPrompt('current', poi, 'page text');
    expect(prompt).toContain('what happened or is changing');
    expect(prompt).not.toContain('story_year');
  });

  it('relevance criteria differ: Current rejects trip reports, Historical wants history', () => {
    expect(newsRelevanceCriteria('current')).toContain('CURRENT NEWS');
    expect(newsRelevanceCriteria('current')).toMatch(/trip reports/i);
    expect(newsRelevanceCriteria('historical')).toContain('HISTORICAL NEWS');
  });
});
