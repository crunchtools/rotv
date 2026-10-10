/**
 * Event pages ingested as news (#585). Akron Zoo event pages reached poi_news with
 * publication_date parsed off the event date; 90 poi_news rows shared a source_url
 * with poi_events. Two save-time guards: a news crawl skips URLs already stored as
 * events, and a news item dated past tomorrow (Eastern) is not saved.
 */
import { describe, it, expect, vi } from 'vitest';
import { saveNewsItems, filterKnownPages, filterDetailLinks } from '../services/newsService.js';
import { easternDay } from '../services/dateExtractor.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Empty table: the settings read, the dedup SELECT and the INSERT all see no rows.
function emptyPool() {
  return { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
}

const insertCalls = (pool) => pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO poi_news'));

describe('saveNewsItems future-date skip', () => {
  it('skips a news item whose publication date is past tomorrow', async () => {
    const pool = emptyPool();
    const log = vi.fn();
    const saved = await saveNewsItems(pool, 42, [{
      title: 'Boo at the Zoo', summary: 'Trick or treat at the zoo.',
      published_date: easternDay(new Date(Date.now() + 3 * DAY_MS)),
      source_url: 'https://www.akronzoo.org/boo-at-the-zoo'
    }], { log });

    expect(saved).toBe(0);
    expect(insertCalls(pool)).toHaveLength(0);
    expect(log).toHaveBeenCalledWith('[Save] Skip news "Boo at the Zoo" — publication date in the future (likely an event page)');
  });

  it('still saves an item dated tomorrow (timezone slack, not an event signal)', async () => {
    const pool = emptyPool();
    const saved = await saveNewsItems(pool, 42, [{
      title: 'Trail reopens Friday', summary: 'Crews finished early.',
      published_date: easternDay(new Date(Date.now() + DAY_MS)),
      source_url: 'https://www.summitmetroparks.org/news/trail-reopens'
    }]);

    expect(saved).toBe(1);
    expect(insertCalls(pool)).toHaveLength(1);
  });

  it('leaves undated items to the moderation gate', async () => {
    const pool = emptyPool();
    const saved = await saveNewsItems(pool, 42, [{
      title: 'Undated story', summary: 'No date on the page.',
      published_date: null, source_url: 'https://example.org/story'
    }]);

    expect(saved).toBe(1);
  });
});

describe('filterKnownPages', () => {
  const pages = [
    { url: 'https://www.akronzoo.org/boo-at-the-zoo/' },
    { url: 'https://www.akronzoo.org/news/new-leopard-cub' }
  ];

  it('treats a news URL already stored in poi_events as known', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ url: 'https://www.akronzoo.org/boo-at-the-zoo' }] })) };

    const kept = await filterKnownPages(pool, pages, 'news');

    expect(kept.map(p => p.url)).toEqual(['https://www.akronzoo.org/news/new-leopard-cub']);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('FROM poi_news');
    expect(sql).toContain('FROM poi_events');
    expect(sql).toContain('UNION');
  });

  it('checks only poi_events for an event crawl', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };

    const kept = await filterKnownPages(pool, pages, 'event');

    expect(kept).toHaveLength(2);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('FROM poi_events');
    expect(sql).not.toContain('FROM poi_news');
  });
});

// #732: a WebTrac listing links each program several ways. The cap used to count the
// variants, so 30 programs came out as 4 detail pages.
describe('filterDetailLinks', () => {
  it('collapses parameter variants of one page before the cap', () => {
    const base = 'https://example.myvscloud.com/webtrac/web';
    const links = [];
    for (let fmid = 100; fmid < 130; fmid++) {
      const item = `${base}/iteminfo.html?Module=AR&FMID=${fmid}`;
      links.push(item, `${item}&InterfaceParameter=x`, `${item}&option=fees`, `${item}&option=docs`, `${item}&option=share&mode=1`);
    }

    const followed = filterDetailLinks(links, `${base}/search.html?module=AR`, '/webtrac/web', ['iteminfo.html']);

    expect(followed).toHaveLength(20);
    expect(followed.every(url => /FMID=\d+$/.test(url))).toBe(true);
  });

  // An events page that sends each event to a registration site: the zoo's 5Ks link
  // only to runsignup.com.
  it('follows an off-site link to a trusted host, and no other off-site link', () => {
    const listing = 'https://www.example.org/zoo/program-events/zoo-events';
    const followed = filterDetailLinks([
      'https://runsignup.com/Race/OH/Cleveland/Halloween5K',
      'https://www.runsignup.com/Race/OH/Cleveland/UglySweater5k',
      'https://www.facebook.com/ExampleZoo',
      'https://notrunsignup.com/Race/OH/Cleveland/Other',
      'https://evil.example/runsignup.com/Race',
      'http://127.0.0.1/host:runsignup.com'
    ], listing, '/zoo/program-events', ['/events', 'iteminfo.html', 'host:runsignup.com']);

    expect(followed).toEqual([
      'https://runsignup.com/Race/OH/Cleveland/Halloween5K',
      'https://www.runsignup.com/Race/OH/Cleveland/UglySweater5k'
    ]);
  });

  it('does not keep crawling a trusted host from one of its own pages', () => {
    const racePage = 'https://runsignup.com/Race/OH/Cleveland/Halloween5K';
    const followed = filterDetailLinks(
      ['https://runsignup.com/Race/OH/Akron/SomeOtherRace'],
      racePage, '/zoo/program-events', ['host:runsignup.com']);

    expect(followed).toEqual([]);
  });
});
