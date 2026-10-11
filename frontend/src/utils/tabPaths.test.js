import { describe, it, expect } from 'vitest';
import { parseTabPath, listPath } from './tabPaths';

const parse = (path) => parseTabPath(path.split('/').filter(Boolean));

describe('parseTabPath', () => {
  it('reads the tab paths', () => {
    expect(parse('/find')).toEqual({ tab: 'find' });
    expect(parse('/settings')).toEqual({ tab: 'settings' });
    expect(parse('/about')).toEqual({ tab: 'about' });
    expect(parse('/happening')).toEqual({ tab: 'happening', view: 'news' });
    expect(parse('/happening/events')).toEqual({ tab: 'happening', view: 'events' });
  });

  it('gives the Fall Hiking Spree an address of its own', () => {
    expect(parse('/fall-hiking-spree')).toEqual({ tab: 'find', list: 'fall-hiking-spree' });
    expect(parse('/find/fall-hiking-spree'))
      .toEqual({ tab: 'find', list: 'fall-hiking-spree', redirectTo: '/fall-hiking-spree' });
    expect(listPath('fall-hiking-spree')).toBe('/fall-hiking-spree');
  });

  it('reads any other curated list out of a Find path', () => {
    expect(parse('/find/winter-challenge')).toEqual({ tab: 'find', list: 'winter-challenge' });
    expect(listPath('winter-challenge')).toBe('/find/winter-challenge');
    // A place's own sub-tabs are not lists
    expect(parse('/fall-hiking-spree/news')).toBeNull();
  });

  it('redirects links from before the tabs were renamed', () => {
    expect(parse('/results')).toEqual({ tab: 'find', redirectTo: '/find' });
    expect(parse('/news')).toEqual({ tab: 'happening', view: 'news', redirectTo: '/happening' });
    expect(parse('/events')).toEqual({ tab: 'happening', view: 'events', redirectTo: '/happening/events' });
  });

  it('leaves place paths alone', () => {
    expect(parse('/')).toBeNull();
    expect(parse('/furnace-run-metro-park')).toBeNull();
    // A place's own news and events sub-tabs, and its article permalinks
    expect(parse('/furnace-run-metro-park/news')).toBeNull();
    expect(parse('/furnace-run-metro-park/events/fall-hike')).toBeNull();
    expect(parse('/happening/news')).toBeNull();
    expect(parse('/find/fall-hiking-spree/extra')).toBeNull();
    // Sub-tabbed pages are routed by their own two-part handlers
    expect(parse('/settings/general')).toBeNull();
    expect(parse('/about/story')).toBeNull();
    expect(parse('/mtb-trail-status')).toBeNull();
  });
});
