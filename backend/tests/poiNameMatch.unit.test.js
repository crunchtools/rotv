import { describe, it, expect } from 'vitest';
import { normalizeForMatch, findNamedPois } from '../services/poiNameMatch.js';
import { buildPoiOptions } from '../services/moderationService.js';

// The POIs behind issue #713.
const TRAILHEAD = { id: 6358, name: 'University of Akron Trailhead' };
const HOUSE = { id: 5848, name: 'John Brown House' };
const MONUMENT = { id: 5849, name: 'John Brown Monument' };
const ZOO = { id: 100, name: 'Akron Zoo' };
const POIS = [TRAILHEAD, HOUSE, MONUMENT, ZOO, { id: 7, name: 'Akron' }, { id: 8, name: 'John Brown' }];

describe('normalizeForMatch', () => {
  it('drops apostrophes, accents and punctuation', () => {
    expect(normalizeForMatch('Akron’s John Brown Monument opens!')).toBe('akron john brown monument opens');
    expect(normalizeForMatch("O'Neil Woods — Café")).toBe('oneil woods cafe');
  });
});

describe('findNamedPois (issue #713)', () => {
  // news #7169: filed under University of Akron Trailhead.
  it('finds the monument in the Signal Akron headline', () => {
    const named = findNamedPois({
      title: 'Akron’s John Brown Monument opens for public visits after years of neglect',
      description: 'Monument on Akron Zoo property in Sherbondy Hill was erected in 1910.'
    }, POIS, { excludeIds: new Set([TRAILHEAD.id]) });
    expect(named[0]).toEqual(MONUMENT);
    expect(named.map(p => p.id)).toEqual([MONUMENT.id, ZOO.id]);
  });

  // news #7178: filed under John Brown House, which the headline never names.
  it('ranks the longer title match first and drops names it contains', () => {
    const named = findNamedPois({
      title: 'Akron Zoo opens public trail to John Brown Monument',
      description: 'Memorial to Akron abolitionist has been off limits to the public.'
    }, POIS, { excludeIds: new Set([HOUSE.id]) });
    expect(named.map(p => p.id)).toEqual([MONUMENT.id, ZOO.id]);
  });

  // news #4199: nothing local is named, so the gate falls back to the votes.
  it('finds nothing in an out-of-region headline', () => {
    expect(findNamedPois({
      title: 'Juneteenth events in the Wilmington area to know about for 2026',
      description: 'The holiday known as Juneteenth dates to June 19, 1865.'
    }, POIS)).toEqual([]);
  });

  it('skips single-word names, excluded ids, and honors the limit', () => {
    const item = { title: 'Akron Zoo opens public trail to John Brown Monument' };
    expect(findNamedPois(item, POIS, { excludeIds: new Set([MONUMENT.id, ZOO.id]) })
      .map(p => p.name)).toEqual(['John Brown']);
    expect(findNamedPois(item, POIS, { limit: 1 })).toEqual([MONUMENT]);
  });

  it('matches whole-word phrases only', () => {
    const sandRun = [{ id: 30, name: 'Sand Run Trail' }];
    expect(findNamedPois({ title: 'Work begins on Sand Run Trailhead' }, sandRun)).toEqual([]);
    expect(findNamedPois({ title: 'Work begins on Sand Run Trail.' }, sandRun)).toEqual(sandRun);
  });

  it('matches possessives and a leading "The" in the POI name', () => {
    const pois = [ZOO, { id: 40, name: "Mary Campbell's Cave" }, { id: 41, name: 'The Gorge Metro Park' }];
    expect(findNamedPois({ title: "Akron Zoo's new trail opens" }, pois)).toEqual([ZOO]);
    expect(findNamedPois({ title: 'Hike to Mary Campbell\u2019s Cave' }, pois)).toEqual([pois[1]]);
    expect(findNamedPois({ title: 'Flooding closes Gorge Metro Park' }, pois)).toEqual([pois[2]]);
  });

  it('keeps a shorter name that also appears on its own', () => {
    const pois = [{ id: 50, name: 'Sand Run' }, { id: 51, name: 'Sand Run Metro Park' }];
    expect(findNamedPois({
      title: 'Sand Run floods after storm', description: 'Crews closed Sand Run Metro Park.'
    }, pois).map(p => p.id)).toEqual([50, 51]);
    expect(findNamedPois({ title: 'Sand Run Metro Park floods' }, pois).map(p => p.id)).toEqual([51]);
  });

  it('keeps one POI when two share a name', () => {
    const twins = [{ id: 20, name: 'Sand Run Metro Park' }, { id: 10, name: 'Sand Run Metro Park' }];
    expect(findNamedPois({ title: 'New trail at Sand Run Metro Park' }, twins)).toEqual([twins[1]]);
  });
});

describe('buildPoiOptions', () => {
  const owner = { id: 1, name: 'Summit Metro Parks' };
  const boundary = { id: 2, name: 'Sand Run Metro Park' };

  it('lists named POIs first, then owner and boundary', () => {
    expect(buildPoiOptions({ owner, boundary }, [MONUMENT, ZOO]).map(o => [o.key, o.id])).toEqual([
      ['named_1', MONUMENT.id], ['named_2', ZOO.id], ['owner', 1], ['boundary', 2]
    ]);
  });

  it('lists a POI once when it is both named and the owner', () => {
    expect(buildPoiOptions({ owner, boundary: null }, [owner]).map(o => o.key)).toEqual(['named_1']);
  });

  it('is empty with no candidates', () => {
    expect(buildPoiOptions({ owner: null, boundary: null })).toEqual([]);
  });
});
