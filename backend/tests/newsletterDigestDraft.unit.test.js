/**
 * Editor's draft of the weekly digest (spec 049).
 * The Oct 9, 2026 issue was edited from a hand-written copy of the digest query
 * that used "now" for its 7-day window and so listed three stories that had
 * already run on Oct 2. The draft is built by the digest's own code as of the
 * real send instant.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/buttondownClient.js', () => ({
  sendEmail: vi.fn(),
  sendDraftToRecipients: vi.fn()
}));

const { upcomingSendISO, getDigestDraft, setDigestExcluded } = await import('../services/newsletterDigestService.js');

const TZ = 'America/New_York';

describe('upcomingSendISO', () => {
  it('resolves a Thursday night to Friday 08:00 Eastern, not 24 hours later', () => {
    // Thu Oct 8, 2026 11:17 PM EDT
    expect(upcomingSendISO(TZ, new Date('2026-10-09T03:17:00Z'))).toBe('2026-10-09T12:00:00.000Z');
  });

  it('stays on today for any time on a Friday', () => {
    expect(upcomingSendISO(TZ, new Date('2026-10-09T10:00:00Z'))).toBe('2026-10-09T12:00:00.000Z'); // 6 AM
    expect(upcomingSendISO(TZ, new Date('2026-10-10T03:00:00Z'))).toBe('2026-10-09T12:00:00.000Z'); // 11 PM
  });

  it('rolls a Saturday forward to the next Friday', () => {
    expect(upcomingSendISO(TZ, new Date('2026-10-10T15:00:00Z'))).toBe('2026-10-16T12:00:00.000Z');
  });

  it('uses the offset in force on the send day across the fall time change', () => {
    // Mon Oct 26 is EDT; Fri Oct 30 is still EDT (change is Sun Nov 1)
    expect(upcomingSendISO(TZ, new Date('2026-10-26T15:00:00Z'))).toBe('2026-10-30T12:00:00.000Z');
    // Sat Oct 31 is EDT; Fri Nov 6 is EST
    expect(upcomingSendISO(TZ, new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-06T13:00:00.000Z');
  });

  it('honors another timezone', () => {
    // Thu Oct 8, 2026 in Los Angeles (PDT, UTC-7)
    expect(upcomingSendISO('America/Los_Angeles', new Date('2026-10-08T20:00:00Z'))).toBe('2026-10-09T15:00:00.000Z');
  });
});

const NEWS_TOPICS = [
  ['Everett Field farming compromise reached', 'Twelve acres conserved as an archaeological site while corn farming continues nearby.'],
  ['Oatmeal festival returns downtown', 'Parade, tastings and a lookalike contest celebrate the cereal mill heritage.'],
  ['Sturgeon stocked in the river again', 'Biologists released juvenile fish below the dam for a second restoration round.'],
  ['Locomotive repowering partner named', 'A utility cooperative will fund cleaner engines for the scenic railroad fleet.'],
  ['Lakefront trail connection opens', 'Cyclists gained a paved link between the east side neighborhoods and the shoreline.'],
  ['Leopard cub receives a name', 'Zoo keepers announced the winning choice after a public naming vote.'],
  ['Boardwalk repairs close a trailhead', 'Crews are replacing rotted decking near the basin through late November.'],
  ['Sculpture dedication scheduled', 'A seventeen foot artwork made from racing tires will be unveiled at the lock.']
];

function newsRow(index) {
  const [title, summary] = NEWS_TOPICS[index];
  return {
    id: 100 + index, poi_id: 10 + index, poi_name: `Place ${index}`, title, summary,
    source_url: `https://outlet${index}.example.org/story`,
    publication_date: `2026-10-0${8 - index}T16:00:00Z`,
    collection_date: `2026-10-0${8 - index}T10:00:00Z`
  };
}

function fakePool({ news = [], events = [] } = {}) {
  const queries = [];
  return {
    queries,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      // The news query also names poi_events in its NOT EXISTS, so check news first.
      if (sql.includes('FROM poi_news')) return { rows: news };
      if (sql.includes('FROM poi_events')) return { rows: events };
      if (sql.includes('admin_settings')) return { rows: [] };
      return { rows: [] };
    })
  };
}

describe('getDigestDraft', () => {
  const sendsAt = '2026-10-09T12:00:00.000Z';

  it('returns the five that send and benches the runners-up', async () => {
    const pool = fakePool({ news: NEWS_TOPICS.map((_, i) => newsRow(i)) });
    const draft = await getDigestDraft(pool, { tz: TZ, asOf: sendsAt });

    expect(draft.sends_at).toBe(sendsAt);
    expect(draft.news.map(n => n.id)).toEqual([100, 101, 102, 103, 104]);
    expect(draft.news_bench.map(n => n.id)).toEqual([105, 106, 107]);
    expect(draft.news[0]).toMatchObject({ poi_name: 'Place 0', source_host: 'outlet0.example.org' });
  });

  it('builds the window from the send instant, not from now', async () => {
    const pool = fakePool();
    await getDigestDraft(pool, { tz: TZ, asOf: sendsAt });

    const newsQuery = pool.queries.find(q => q.sql.includes('FROM poi_news'));
    const eventsQuery = pool.queries.find(q => q.sql.includes('JOIN pois p ON e.poi_id'));
    expect(newsQuery.params).toEqual([sendsAt]);
    expect(eventsQuery.params).toEqual([TZ, sendsAt]);
  });

  it('leaves out items an editor excluded', async () => {
    const pool = fakePool();
    await getDigestDraft(pool, { tz: TZ, asOf: sendsAt });

    expect(pool.queries.find(q => q.sql.includes('FROM poi_news')).sql).toContain('NOT n.digest_excluded');
    expect(pool.queries.find(q => q.sql.includes('JOIN pois p ON e.poi_id')).sql).toContain('NOT e.digest_excluded');
  });

  it('leaves out news rows whose URL is a stored event (#585)', async () => {
    const pool = fakePool();
    await getDigestDraft(pool, { tz: TZ, asOf: sendsAt });

    const newsSql = pool.queries.find(q => q.sql.includes('FROM poi_news')).sql;
    expect(newsSql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM poi_events ev/);
    expect(newsSql).toContain("LOWER(REGEXP_REPLACE(ev.source_url, '/+$', '')) = LOWER(REGEXP_REPLACE(n.source_url, '/+$', ''))");
  });

  it('drops social hosts the email also drops', async () => {
    const social = { ...newsRow(1), id: 900, source_url: 'https://www.facebook.com/somepage/posts/1' };
    const pool = fakePool({ news: [newsRow(0), social] });
    const draft = await getDigestDraft(pool, { tz: TZ, asOf: sendsAt });

    expect(draft.news.map(n => n.id)).toEqual([100]);
  });

  it('shows each event with the location line the email prints', async () => {
    const pool = fakePool({
      events: [{
        id: 390, poi_id: 6360, poi_name: 'Lock 3 Park', title: 'Thirsty Dog Blues & Brews',
        description: 'Sample Ohio breweries.', start_date: '2026-10-11T16:00:00Z', end_date: null,
        location_details: 'Lock 3 Park', source_url: 'https://www.akronohio.gov/lock3'
      }, {
        id: 7757, poi_id: 5654, poi_name: 'Open Trail Collective', title: 'Birding by the Canal',
        description: 'Fall birds along the Towpath.', start_date: '2026-10-11T13:00:00Z', end_date: null,
        location_details: 'Clinton Trailhead', source_url: 'https://www.opentrailcollective.org/events/birding'
      }]
    });
    const draft = await getDigestDraft(pool, { tz: TZ, asOf: sendsAt });

    expect(draft.events.map(e => e.location)).toEqual(['Lock 3 Park', 'Clinton Trailhead · Open Trail Collective']);
    expect(draft.events_overflow).toEqual([]);
  });
});

describe('setDigestExcluded', () => {
  it('flags the item in the table for its content type', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 7592, title: 'Parking lots closing' }] })) };

    const item = await setDigestExcluded(pool, 'news', 7592, true);

    expect(item).toEqual({ id: 7592, title: 'Parking lots closing' });
    expect(pool.query.mock.calls[0][0]).toContain('UPDATE poi_news SET digest_excluded');
    expect(pool.query.mock.calls[0][1]).toEqual([7592, true]);

    await setDigestExcluded(pool, 'event', 13315, false);
    expect(pool.query.mock.calls[1][0]).toContain('UPDATE poi_events SET digest_excluded');
  });

  it('returns null when the item does not exist', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await setDigestExcluded(pool, 'event', 1, true)).toBeNull();
  });
});
