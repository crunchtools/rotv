import { describe, it, expect } from 'vitest';
import { jsonLdVenueFor, chooseEventVenue } from '../services/eventVenue.js';

// JSON-LD from summitmetroparks.org/program-events/kayak-canoe-open-house-3/,
// whose Readability markdown only names the Nature Realm contact line.
const mfLakeArea = {
  name: 'Kayak &amp; Canoe Open House',
  location: {
    '@type': 'Place',
    name: 'MF/Lake Area',
    url: 'https://www.summitmetroparks.org/venue/mf-lake-area/',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '521 S. River Rd.',
      addressLocality: 'Munroe Falls',
      addressRegion: 'OH',
      postalCode: '44262',
      addressCountry: 'United States'
    }
  }
};

describe('jsonLdVenueFor', () => {
  it('uses the page\'s only event even when the model renamed it', () => {
    expect(jsonLdVenueFor({ title: 'Paddling Program' }, [mfLakeArea]))
      .toBe('MF/Lake Area, 521 S. River Rd., Munroe Falls, OH');
  });

  it('matches by title on a page with several events', () => {
    const other = { name: 'Moth Night', location: { name: 'Nature Realm Visitors Center' } };
    expect(jsonLdVenueFor({ title: 'Moth Night' }, [mfLakeArea, other])).toBe('Nature Realm Visitors Center');
  });

  it('returns null for a multi-event page with no title match', () => {
    const other = { name: 'Moth Night', location: { name: 'Nature Realm Visitors Center' } };
    expect(jsonLdVenueFor({ title: 'Bird Walk' }, [mfLakeArea, other])).toBeNull();
  });

  it('returns null when the page has no JSON-LD events or no locations', () => {
    expect(jsonLdVenueFor({ title: 'Anything' }, undefined)).toBeNull();
    expect(jsonLdVenueFor({ title: 'Anything' }, [])).toBeNull();
    expect(jsonLdVenueFor({ title: 'Anything' }, [{ name: 'Anything', location: null }])).toBeNull();
  });

  it('handles a name-only place, an address-only place, and a plain string', () => {
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location: { name: 'Howe Meadow' } }])).toBe('Howe Meadow');
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location: { address: { streetAddress: '4040 Riverview Rd.', addressLocality: 'Peninsula', addressRegion: 'OH' } } }]))
      .toBe('4040 Riverview Rd., Peninsula, OH');
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location: 'Boston Mill Visitor Center' }])).toBe('Boston Mill Visitor Center');
  });

  it('does not repeat a name the address already contains', () => {
    const place = { name: 'Peninsula', address: '1565 Boston Mills Rd, Peninsula, OH' };
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location: place }])).toBe('1565 Boston Mills Rd, Peninsula, OH');
  });

  it('does not repeat locality or region already inside streetAddress', () => {
    const location = {
      name: 'Twinsburg City Hall',
      address: { streetAddress: '10075 Ravenna Road, Twinsburg, OH', addressLocality: 'Twinsburg', addressRegion: 'OH' }
    };
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location }])).toBe('Twinsburg City Hall, 10075 Ravenna Road, Twinsburg, OH');
  });

  it('drops a place name that is just the street address spelled differently', () => {
    const location = {
      name: '6751 Akron Peninsula Rd',
      address: { streetAddress: '6751 Akron Peninsula Road, Peninsula, OH 44264', addressLocality: 'Peninsula', addressRegion: 'OH' }
    };
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location }])).toBe('6751 Akron Peninsula Road, Peninsula, OH 44264');
  });

  it('decodes WordPress HTML entities in names and titles', () => {
    const grow = { name: 'Garden Day', location: { name: 'Let&#8217;s Grow Akron Headquarters', address: { streetAddress: '467 Harvey Ave.', addressLocality: 'Akron', addressRegion: 'OH' } } };
    expect(jsonLdVenueFor({ title: 'Garden Day' }, [grow])).toBe('Let’s Grow Akron Headquarters, 467 Harvey Ave., Akron, OH');
    const other = { name: 'Moth Night', location: { name: 'Nature Realm Visitors Center' } };
    expect(jsonLdVenueFor({ title: 'Kayak & Canoe Open House' }, [mfLakeArea, other]))
      .toBe('MF/Lake Area, 521 S. River Rd., Munroe Falls, OH');
  });

  it('decodes hex entities and leaves out-of-range ones intact', () => {
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location: { name: 'Let&#x2019;s Grow' } }])).toBe('Let’s Grow');
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location: { name: 'Bad &#9999999999; Place' } }])).toBe('Bad &#9999999999; Place');
  });

  it('takes the first usable place from a location array', () => {
    const location = [{ '@type': 'VirtualLocation' }, { name: 'Liberty Park' }];
    expect(jsonLdVenueFor({ title: 'A' }, [{ name: 'A', location }])).toBe('Liberty Park');
  });
});

describe('chooseEventVenue', () => {
  const mf = 'MF/Lake Area, 521 S. River Rd., Munroe Falls, OH';

  it('replaces the Nature Realm contact line with the JSON-LD venue', () => {
    expect(chooseEventVenue('Nature Realm Visitors Center (location subject to change based on water conditions)', mf)).toBe(mf);
  });

  it('keeps richer model text that already names the same street number', () => {
    expect(chooseEventVenue('Boston Gallery, 1565 Boston Mills Rd, Peninsula, OH. Parking at Boston Trailhead.', 'Gallery, 1565 Boston Mills Rd, Peninsula, OH'))
      .toBe('Boston Gallery, 1565 Boston Mills Rd, Peninsula, OH. Parking at Boston Trailhead.');
  });

  it('does not treat a number inside a longer number as a match', () => {
    expect(chooseEventVenue('Trailhead at 15210 Main St', 'Lodge, 521 S. River Rd.')).toBe('Lodge, 521 S. River Rd.');
  });

  it('falls back to whichever side exists', () => {
    expect(chooseEventVenue('Liberty Park', null)).toBe('Liberty Park');
    expect(chooseEventVenue('', mf)).toBe(mf);
    expect(chooseEventVenue(undefined, undefined)).toBeNull();
  });
});
