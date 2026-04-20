/**
 * Unit Tests for Deep Crawler
 * Tests deepCrawlForArticle() and isGenericUrl() with injected extractors
 */
import { describe, it, expect } from 'vitest';
import { deepCrawlForArticle, isGenericUrl } from '../services/deepCrawler.js';
import { contentMatchesItem, calculateSimilarity } from '../services/textUtils.js';

describe('isGenericUrl', () => {
  it('should detect domain roots', () => {
    expect(isGenericUrl('https://example.com')).toBe(true);
    expect(isGenericUrl('https://example.com/')).toBe(true);
  });

  it('should detect common index paths', () => {
    expect(isGenericUrl('https://example.com/news')).toBe(true);
    expect(isGenericUrl('https://example.com/events')).toBe(true);
    expect(isGenericUrl('https://example.com/blog')).toBe(true);
    expect(isGenericUrl('https://example.com/press')).toBe(true);
    expect(isGenericUrl('https://example.com/about')).toBe(true);
    expect(isGenericUrl('https://example.com/calendar')).toBe(true);
  });

  it('should NOT flag specific article URLs', () => {
    expect(isGenericUrl('https://example.com/news/2026/trail-closure')).toBe(false);
    expect(isGenericUrl('https://example.com/events/spring-hike-2026')).toBe(false);
    expect(isGenericUrl('https://example.com/blog/my-article')).toBe(false);
  });

  it('should detect index.html paths', () => {
    expect(isGenericUrl('https://example.com/index.html')).toBe(true);
    expect(isGenericUrl('https://example.com/default.aspx')).toBe(true);
  });

  it('should handle null/empty', () => {
    expect(isGenericUrl(null)).toBe(false);
    expect(isGenericUrl('')).toBe(false);
  });
});

describe('textUtils', () => {
  describe('contentMatchesItem', () => {
    it('should match when title words appear in content', () => {
      const markdown = 'The Cuyahoga Valley Scenic Railroad announces new summer excursion trains for families.';
      const item = { title: 'Cuyahoga Valley Scenic Railroad Summer Excursion' };
      expect(contentMatchesItem(markdown, item)).toBe(true);
    });

    it('should not match unrelated content', () => {
      const markdown = 'Weather forecast for today: sunny with a high of 75 degrees.';
      const item = { title: 'Cuyahoga Valley Scenic Railroad Summer Excursion' };
      expect(contentMatchesItem(markdown, item)).toBe(false);
    });

    it('should return false for empty inputs', () => {
      expect(contentMatchesItem(null, { title: 'Test' })).toBe(false);
      expect(contentMatchesItem('content', { title: null })).toBe(false);
      expect(contentMatchesItem('content', {})).toBe(false);
    });

    it('should handle titles with only short words', () => {
      expect(contentMatchesItem('the and for', { title: 'The And For' })).toBe(false);
    });
  });

  describe('calculateSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(calculateSimilarity('hello world', 'hello world')).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      expect(calculateSimilarity('apple banana', 'cherry grape')).toBe(0);
    });

    it('should return partial similarity', () => {
      const score = calculateSimilarity('trail closure notice', 'trail closure update');
      expect(score).toBeGreaterThan(0.3);
      expect(score).toBeLessThan(1);
    });

    it('should handle null inputs', () => {
      expect(calculateSimilarity(null, 'test')).toBe(0);
      expect(calculateSimilarity('test', null)).toBe(0);
    });
  });
});

function fakeExtractor(pages) {
  return async (url) => {
    return pages[url] || { reachable: false, markdown: null, reason: 'not found' };
  };
}

describe('deepCrawlForArticle', () => {
  it('should return immediately if article is on source page (Level 0)', async () => {
    const extractor = fakeExtractor({
      'https://example.com/news': {
        reachable: true,
        markdown: 'The Brandywine Falls trail closure affects hikers this weekend due to maintenance work.',
        links: []
      }
    });

    const result = await deepCrawlForArticle(
      null,
      'https://example.com/news',
      { title: 'Brandywine Falls Trail Closure This Weekend' },
      { extractor }
    );

    expect(result.foundUrl).toBe('https://example.com/news');
    expect(result.pagesChecked).toBe(1);
  });

  it('should find article on linked page (Level 1)', async () => {
    const extractor = fakeExtractor({
      'https://example.com': {
        reachable: true,
        markdown: 'Welcome to our park. See latest news below.',
        links: [
          { url: 'https://example.com/news/trail-closure', text: 'Brandywine Falls Trail Closure', context: 'Trail closure notice for this weekend', className: '', parentClassName: '' },
          { url: 'https://example.com/news/event-recap', text: 'Summer Event Recap', context: 'Photos from summer festival', className: '', parentClassName: '' }
        ]
      },
      'https://example.com/news/trail-closure': {
        reachable: true,
        markdown: 'Brandywine Falls trail closure announced for this weekend. Hikers should plan alternate routes during maintenance.',
        links: []
      }
    });

    const result = await deepCrawlForArticle(
      null,
      'https://example.com',
      { title: 'Brandywine Falls Trail Closure This Weekend' },
      { maxDepth: 1, maxPages: 3, extractor }
    );

    expect(result.foundUrl).toBe('https://example.com/news/trail-closure');
    expect(result.pagesChecked).toBe(2);
  });

  it('should return null after max depth with no match', async () => {
    const extractor = fakeExtractor({
      'https://example.com': {
        reachable: true,
        markdown: 'Completely unrelated content about cooking recipes.',
        links: [
          { url: 'https://example.com/page2', text: 'More recipes', context: 'See more recipes', className: '', parentClassName: '' }
        ]
      },
      'https://example.com/page2': {
        reachable: true,
        markdown: 'Even more unrelated cooking content.',
        links: []
      }
    });

    const result = await deepCrawlForArticle(
      null,
      'https://example.com',
      { title: 'Brandywine Falls Trail Closure' },
      { maxDepth: 1, maxPages: 3, extractor }
    );

    expect(result.foundUrl).toBeNull();
    expect(result.pagesChecked).toBeGreaterThan(0);
  });

  it('should filter out cross-origin links when sameOriginOnly is true', async () => {
    const extractor = fakeExtractor({
      'https://example.com': {
        reachable: true,
        markdown: 'Park homepage',
        links: [
          { url: 'https://other-site.com/article', text: 'Brandywine Falls Closure', context: 'Trail closure article', className: '', parentClassName: '' }
        ]
      }
    });

    const result = await deepCrawlForArticle(
      null,
      'https://example.com',
      { title: 'Brandywine Falls Trail Closure' },
      { maxDepth: 1, maxPages: 3, sameOriginOnly: true, extractor }
    );

    expect(result.foundUrl).toBeNull();
    expect(result.pagesChecked).toBe(1);
  });

  it('should detect cycles (page A links to page B links to page A)', async () => {
    const extractor = fakeExtractor({
      'https://example.com': {
        reachable: true,
        markdown: 'Page A content',
        links: [
          { url: 'https://example.com/b', text: 'Brandywine Falls Trail News', context: 'Trail closure updates', className: '', parentClassName: '' }
        ]
      },
      'https://example.com/b': {
        reachable: true,
        markdown: 'Page B content',
        links: [
          { url: 'https://example.com', text: 'Brandywine Falls Homepage', context: 'Back to trail closures', className: '', parentClassName: '' }
        ]
      }
    });

    const result = await deepCrawlForArticle(
      null,
      'https://example.com',
      { title: 'Brandywine Falls Trail Closure' },
      { maxDepth: 2, maxPages: 5, extractor }
    );

    expect(result.pagesChecked).toBe(2);
    expect(result.foundUrl).toBeNull();
  });

  it('should respect maxPages limit', async () => {
    let callCount = 0;
    const extractor = async () => {
      callCount++;
      return {
        reachable: true,
        markdown: `Unrelated content page ${callCount}`,
        links: [
          { url: `https://example.com/p${callCount}a`, text: 'Trail link', context: 'trail closure info', className: '', parentClassName: '' },
          { url: `https://example.com/p${callCount}b`, text: 'Another trail', context: 'more trail news', className: '', parentClassName: '' }
        ]
      };
    };

    const result = await deepCrawlForArticle(
      null,
      'https://example.com',
      { title: 'Brandywine Falls Trail Closure' },
      { maxDepth: 2, maxPages: 3, extractor }
    );

    expect(result.pagesChecked).toBeLessThanOrEqual(3);
    expect(result.foundUrl).toBeNull();
  });

  it('should handle unreachable pages gracefully', async () => {
    const extractor = fakeExtractor({
      'https://example.com': {
        reachable: true,
        markdown: 'Homepage',
        links: [
          { url: 'https://example.com/broken', text: 'Brandywine Falls Closure', context: 'Trail closure', className: '', parentClassName: '' }
        ]
      }
    });

    const result = await deepCrawlForArticle(
      null,
      'https://example.com',
      { title: 'Brandywine Falls Trail Closure' },
      { maxDepth: 1, maxPages: 3, extractor }
    );

    expect(result.foundUrl).toBeNull();
    expect(result.pagesChecked).toBe(2);
  });

  it('should handle invalid source URL', async () => {
    const result = await deepCrawlForArticle(
      null,
      'not-a-url',
      { title: 'Test' }
    );

    expect(result.foundUrl).toBeNull();
    expect(result.pagesChecked).toBe(0);
  });

  it('should use prefetched data and skip Level 0 render', async () => {
    let renderCalls = [];
    const extractor = async (url) => {
      renderCalls.push(url);
      if (url === 'https://example.com/news/trail-closure') {
        return {
          reachable: true,
          markdown: 'Brandywine Falls trail closure announced for this weekend. Hikers should plan alternate routes.',
          links: []
        };
      }
      return { reachable: false, markdown: null, reason: 'not found' };
    };

    const result = await deepCrawlForArticle(
      null,
      'https://example.com',
      { title: 'Brandywine Falls Trail Closure This Weekend' },
      {
        maxDepth: 1,
        maxPages: 3,
        extractor,
        prefetched: {
          markdown: 'Welcome to our park. See latest news below.',
          links: [
            { url: 'https://example.com/news/trail-closure', text: 'Brandywine Falls Trail Closure', context: 'Trail closure notice for this weekend', className: '', parentClassName: '' }
          ]
        }
      }
    );

    expect(result.foundUrl).toBe('https://example.com/news/trail-closure');
    expect(renderCalls).not.toContain('https://example.com');
    expect(result.pagesChecked).toBe(1);
  });

  it('should match on prefetched page content without rendering', async () => {
    let renderCalls = [];
    const extractor = async (url) => {
      renderCalls.push(url);
      return { reachable: false, markdown: null, reason: 'not found' };
    };

    const result = await deepCrawlForArticle(
      null,
      'https://example.com/article',
      { title: 'Brandywine Falls Trail Closure This Weekend' },
      {
        extractor,
        prefetched: {
          markdown: 'Brandywine Falls trail closure announced for this weekend. Hikers should plan alternate routes during maintenance.',
          links: []
        }
      }
    );

    expect(result.foundUrl).toBe('https://example.com/article');
    expect(renderCalls).toHaveLength(0);
    expect(result.pagesChecked).toBe(0);
  });
});
