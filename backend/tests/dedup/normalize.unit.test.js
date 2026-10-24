import { describe, it, expect } from 'vitest';
import {
  canonicalUrl, normalizeTitle, titleSiteSuffix, stripBoilerplate, contentTokens, titleKey
} from '../../services/dedup/normalize.js';
import { extractEntities, isTitleCase, stemWord } from '../../services/dedup/entities.js';
import { createMatchContext } from '../../services/dedup/context.js';

describe('canonicalUrl', () => {
  it('ignores scheme, www/m/amp hosts, amp paths, tracking, fragments and trailing slashes', () => {
    const key = canonicalUrl('https://www.cleveland19.com/2026/10/21/primate-forest/');
    expect(canonicalUrl('http://m.cleveland19.com/2026/10/21/primate-forest')).toBe(key);
    expect(canonicalUrl('https://amp.cleveland19.com/2026/10/21/primate-forest/amp/')).toBe(key);
    expect(canonicalUrl('https://www.cleveland19.com/2026/10/21/primate-forest/?utm_source=x&fbclid=y#top')).toBe(key);
    expect(canonicalUrl('https://www.cleveland19.com/2026/10/21/primate-forest/index.html')).toBe(key);
  });

  it('keeps parameters that select content, in a stable order', () => {
    expect(canonicalUrl('https://a.org/story?id=2&page=1')).toBe(canonicalUrl('https://a.org/story?page=1&id=2'));
    expect(canonicalUrl('https://a.org/story?id=2')).not.toBe(canonicalUrl('https://a.org/story?id=3'));
  });

  it('agrees with the SQL rule: URLs equal there are equal here', () => {
    const sqlKey = (url) => url.toLowerCase().replace(/\/+$/, '');
    const pairs = [['https://A.org/Story/', 'https://a.org/story'], ['https://a.org/x//', 'https://a.org/x']];
    for (const [a, b] of pairs) {
      expect(sqlKey(a)).toBe(sqlKey(b));
      expect(canonicalUrl(a)).toBe(canonicalUrl(b));
    }
  });

  it('is idempotent on its own output and handles junk', () => {
    const key = canonicalUrl('https://www.a.org/b/?utm_medium=c');
    expect(canonicalUrl(`https://${key}`)).toBe(key);
    expect(canonicalUrl(null)).toBeNull();
    expect(canonicalUrl('not a url/')).toBe('not a url');
  });
});

describe('normalizeTitle', () => {
  it('drops a short site-name suffix and a leading "the"', () => {
    expect(normalizeTitle('The Fall Hike | Summit Metro Parks')).toBe('fall hike');
    expect(normalizeTitle('New Day Cleveland: Cleveland Metroparks - YouTube')).toBe('new day cleveland cleveland metroparks');
  });

  it('keeps a numbered tail that is part of the title', () => {
    expect(normalizeTitle('Fall Hike - Part 2')).toBe('fall hike part 2');
  });

  it('drops a site name with digits when it spells the outlet host', () => {
    expect(titleSiteSuffix('Lake sturgeon release - Fox 8 Cleveland WJW', 'fox8.com')).toBe('Fox 8 Cleveland WJW');
    expect(normalizeTitle('Lake sturgeon release - Fox 8 Cleveland WJW', 'fox8.com')).toBe('lake sturgeon release');
  });

  it('folds entities and diacritics', () => {
    expect(normalizeTitle('Día de los Muertos &amp; Boo')).toBe('dia de los muertos boo');
  });

  it('leaves the SQL title key alone', () => {
    expect(titleKey('The Steam in the Valley!')).toBe('steam in the valley!');
  });
});

describe('stripBoilerplate', () => {
  it('removes datelines, bylines, read times, share prompts and short pipe tails', () => {
    expect(stripBoilerplate('Trail reopens. Published: Oct. 21, 2026 at 9:26 AM PDT')).toBe('Trail reopens.');
    expect(stripBoilerplate('Trail reopens Saturday. By Jane Doe | Akron Beacon Journal | Local News')).toBe('Trail reopens Saturday.');
    expect(stripBoilerplate('Trail reopens. 5 min read. Share on Facebook')).toBe('Trail reopens. .');
  });

  it('keeps a long pipe segment, which is content', () => {
    const text = 'Lead | The towpath reopens between Boston and Peninsula after repairs';
    expect(stripBoilerplate(text)).toBe(text);
  });
});

describe('contentTokens', () => {
  it('drops stopwords, short words and the given place words', () => {
    expect(contentTokens('The Akron Zoo will open its new exhibit', { drop: new Set(['akron', 'zoo']) }))
      .toEqual(['open', 'exhibit']);
  });
});

describe('extractEntities', () => {
  const { placeWords } = createMatchContext({ poiNames: ['Cleveland Metroparks Zoo', 'Firestone Metro Park'] });

  it('finds distinctive names and skips place names', () => {
    const entities = extractEntities({
      title: 'Cleveland Metroparks Zoo Unveils First Phase of Primate Forest',
      summary: 'Cleveland Metroparks Zoo is opening the first phase of Primate Forest, its largest project, on October 22.'
    }, placeWords);
    expect([...entities]).toEqual(['primate forest']);
  });

  it('splits names joined by "and" and folds plurals', () => {
    const entities = extractEntities({ summary: "including Kids' and Special Needs Fishing Derbies, in June." }, placeWords);
    expect(entities.has('special need fishing derby')).toBe(true);
  });

  it('reads names from a sentence-case title but not a Title Case one', () => {
    expect(isTitleCase('Cleveland Metroparks Zoo Unveils First Phase of Primate Forest')).toBe(true);
    expect(isTitleCase('Akron Zoo opens public trail to John Brown Monument')).toBe(false);
    expect([...extractEntities({ title: 'Boo at the Zoo is back this year' }, placeWords)]).toEqual(['boo at the zoo']);
  });

  it('stems lightly', () => {
    expect(stemWord('derbies')).toBe('derby');
    expect(stemWord('metroparks')).toBe('metropark');
    expect(stemWord('grass')).toBe('grass');
    expect(stemWord('bus')).toBe('bus');
  });
});
