/**
 * rendered_page_cache freshness (#732). Detail pages are cached forever, which also
 * froze a zero item count taken from a bad render; a detail page that yielded nothing
 * for the crawling content type now gets a second look after seven days.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/contentExtractor.js', () => ({ extractPageContent: vi.fn() }));

import { isCacheFresh, renderPage } from '../services/renderPage.js';
import { extractPageContent } from '../services/contentExtractor.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const renderedDaysAgo = (days, fields = {}) => ({
  page_type: 'detail', rendered_at: new Date(Date.now() - days * DAY_MS), markdown: 'cached', ...fields
});

describe('isCacheFresh', () => {
  it('keeps a detail page with items forever', () => {
    expect(isCacheFresh(renderedDaysAgo(400, { item_count_events: 1 }), 'event')).toBe(true);
  });

  it('keeps a detail page that has not been counted yet', () => {
    expect(isCacheFresh(renderedDaysAgo(400, { item_count_events: null }), 'event')).toBe(true);
  });

  it('expires an empty detail page after seven days, for the crawling content type only', () => {
    const emptyForEvents = renderedDaysAgo(8, { item_count_events: 0, item_count_news: 2 });
    expect(isCacheFresh(emptyForEvents, 'event')).toBe(false);
    expect(isCacheFresh(emptyForEvents, 'news')).toBe(true);
    expect(isCacheFresh(renderedDaysAgo(6, { item_count_events: 0 }), 'event')).toBe(true);
  });

  it('leaves callers that pass no content type on the old rule', () => {
    expect(isCacheFresh(renderedDaysAgo(400, { item_count_events: 0 }))).toBe(true);
  });

  it('still expires a listing within a day', () => {
    expect(isCacheFresh(renderedDaysAgo(2, { page_type: 'listing' }), 'event')).toBe(false);
  });
});

describe('renderPage', () => {
  it('re-renders a stale empty detail page and clears its item counts', async () => {
    extractPageContent.mockResolvedValue({ reachable: true, markdown: 'fresh', rawText: 'fresh', title: 'T', links: [] });
    const pool = {
      query: vi.fn(async (sql) => sql.startsWith('SELECT')
        ? { rows: [renderedDaysAgo(8, { item_count_events: 0 })] }
        : { rows: [] })
    };

    const page = await renderPage(pool, 'https://example.org/item', { contentType: 'event' });

    expect(page.markdown).toBe('fresh');
    const upsert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO rendered_page_cache'));
    expect(upsert[0]).toMatch(/item_count_news = NULL,\s*item_count_events = NULL/);
  });
});
