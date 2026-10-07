import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/renderPage.js', () => ({ renderPage: vi.fn() }));
vi.mock('../services/serperService.js', () => ({ searchNewsUrls: vi.fn() }));
vi.mock('../services/llmService.js', () => ({ generateTextWithCustomPrompt: vi.fn() }));

const { renderPage } = await import('../services/renderPage.js');
const { searchNewsUrls } = await import('../services/serperService.js');
const {
  gatherResearchSources, truncatePageText, RESEARCH_MAX_SEARCH_PAGES, RESEARCH_PAGE_CHARS
} = await import('../services/researchSources.js');

const LONG = 'Cascade Locks Park holds Locks 10 through 16 of the Ohio & Erie Canal. '.repeat(6);
const blocklistPool = (blocklist = []) => ({
  query: vi.fn().mockResolvedValue({ rows: [{ value: JSON.stringify(blocklist) }] })
});
const hits = urls => ({
  query: '"Cascade Locks Park" Akron',
  grounded: true,
  urls: urls.map(url => ({ url, title: `Title of ${url}` }))
});
const page = (fields = {}) => ({ markdown: LONG, rawText: LONG, title: 'Rendered title', reachable: true, ...fields });
const park = {
  id: 5508,
  name: 'Cascade Locks Park',
  more_info_link: 'https://www.cascadelocks.org/park'
};

beforeEach(() => {
  renderPage.mockReset().mockResolvedValue(page());
  searchNewsUrls.mockReset().mockResolvedValue(hits([]));
});

describe('gatherResearchSources', () => {
  it('reads the reference page first, then the search results, numbered in that order', async () => {
    searchNewsUrls.mockResolvedValue(hits(['https://example.org/a', 'https://example.org/b']));
    renderPage.mockImplementation(async (pool, url) => page({ title: `Page ${url}`, cached: url.includes('cascadelocks') }));

    const gathered = await gatherResearchSources(blocklistPool(), park);

    expect(searchNewsUrls).toHaveBeenCalledWith(expect.anything(), park, { pipeline: 'research' });
    expect(gathered.query).toBe('"Cascade Locks Park" Akron');
    expect(gathered.sources.map(s => [s.n, s.url, s.origin, s.cached])).toEqual([
      [1, 'https://www.cascadelocks.org/park', 'reference', true],
      [2, 'https://example.org/a', 'search', false],
      [3, 'https://example.org/b', 'search', false]
    ]);
    expect(gathered.sources[0].text).toBe(LONG.trim());
    expect(gathered.unreachable).toEqual([]);
  });

  it('does not fetch the reference page again when search returns it', async () => {
    searchNewsUrls.mockResolvedValue(hits(['https://cascadelocks.org/park/', 'https://example.org/a']));

    const gathered = await gatherResearchSources(blocklistPool(), park);

    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(gathered.sources.map(s => s.url)).toEqual(['https://www.cascadelocks.org/park', 'https://example.org/a']);
  });

  it('skips pages it cannot read or should not trust', async () => {
    searchNewsUrls.mockResolvedValue(hits([
      'https://www.facebook.com/cascadelocks',
      'https://grokipedia.com/page/Cascade_Locks',
      'https://example.org/brochure.PDF',
      'https://spam.example/locks',
      'ftp://example.org/locks',
      'http://169.254.169.254/latest',
      'https://example.org/good'
    ]));

    const gathered = await gatherResearchSources(blocklistPool(['spam.example']), { ...park, more_info_link: '' });

    expect(renderPage.mock.calls.map(call => call[1])).toEqual(['https://example.org/good']);
    expect(gathered.sources.map(s => s.url)).toEqual(['https://example.org/good']);
  });

  it('reports an unusable reference page as unreachable', async () => {
    const gathered = await gatherResearchSources(blocklistPool(), { ...park, more_info_link: 'http://localhost/admin' });

    expect(renderPage).not.toHaveBeenCalled();
    expect(gathered.sources).toEqual([]);
    expect(gathered.unreachable).toEqual([{ url: 'http://localhost/admin', reason: 'not a public web address' }]);
  });

  it(`reads at most ${RESEARCH_MAX_SEARCH_PAGES} search results`, async () => {
    searchNewsUrls.mockResolvedValue(hits([1, 2, 3, 4, 5, 6, 7].map(i => `https://example.org/${i}`)));

    const gathered = await gatherResearchSources(blocklistPool(), park);

    expect(gathered.sources).toHaveLength(RESEARCH_MAX_SEARCH_PAGES + 1);
    expect(gathered.sources.at(-1).url).toBe('https://example.org/4');
  });

  it('lists pages that gave no text as unreachable and keeps the numbering unbroken', async () => {
    searchNewsUrls.mockResolvedValue(hits(['https://example.org/404', 'https://example.org/crash', 'https://example.org/ok']));
    renderPage.mockImplementation(async (pool, url) => {
      if (url.endsWith('/404')) return { markdown: null, reachable: false, reason: 'HTTP 404' };
      if (url.endsWith('/crash')) throw new Error('browser closed');
      return page();
    });

    const gathered = await gatherResearchSources(blocklistPool(), { ...park, more_info_link: null });

    expect(gathered.sources.map(s => [s.n, s.url])).toEqual([[1, 'https://example.org/ok']]);
    expect(gathered.unreachable).toEqual([
      { url: 'https://example.org/404', reason: 'HTTP 404' },
      { url: 'https://example.org/crash', reason: 'browser closed' }
    ]);
  });

  it('uses raw text when the extracted article is a fragment, and truncates long pages', async () => {
    const raw = 'Full page text about the locks. '.repeat(20);
    renderPage.mockResolvedValueOnce(page({ markdown: 'Menu', rawText: raw }));
    const short = await gatherResearchSources(blocklistPool(), park);
    expect(short.sources[0].text).toBe(raw.trim());

    renderPage.mockResolvedValueOnce(page({ markdown: 'x'.repeat(RESEARCH_PAGE_CHARS + 500) }));
    const long = await gatherResearchSources(blocklistPool(), park);
    expect(long.sources[0].text).toBe(`${'x'.repeat(RESEARCH_PAGE_CHARS)}\n[truncated]`);
  });

  it('reads the reference page alone when search is down', async () => {
    searchNewsUrls.mockRejectedValue(new Error('Serper API error (search): 503 - unavailable'));

    const gathered = await gatherResearchSources(blocklistPool(), park);

    expect(gathered.query).toBeNull();
    expect(gathered.sources.map(s => s.url)).toEqual(['https://www.cascadelocks.org/park']);
  });

  it('surfaces a missing Serper key instead of drafting from nothing', async () => {
    searchNewsUrls.mockRejectedValue(new Error('Serper API key not configured. Please add your API key in Settings → Data Collection.'));

    await expect(gatherResearchSources(blocklistPool(), park)).rejects.toThrow('Serper API key not configured');
    expect(renderPage).not.toHaveBeenCalled();
  });

  it('renders nothing when there is no reference page and no search result', async () => {
    const gathered = await gatherResearchSources({ query: vi.fn().mockResolvedValue({ rows: [] }) }, { name: 'New Overlook' });

    expect(renderPage).not.toHaveBeenCalled();
    expect(gathered.sources).toEqual([]);
    expect(gathered.unreachable).toEqual([]);
  });
});

describe('truncatePageText', () => {
  it('leaves short text alone and marks what it cut', () => {
    expect(truncatePageText('  short  ')).toBe('short');
    expect(truncatePageText(null)).toBe('');
    expect(truncatePageText('abcdef', 3)).toBe('abc\n[truncated]');
  });
});
