import { describe, it, expect, beforeEach, vi } from 'vitest';

const pageStub = { goto: vi.fn(), evaluate: vi.fn(), url: vi.fn() };
const contextStub = { newPage: vi.fn(async () => pageStub), addCookies: vi.fn(async () => {}) };
const browserStub = { newContext: vi.fn(async () => contextStub), close: vi.fn(async () => {}) };

vi.mock('playwright', () => ({ chromium: { launch: vi.fn(async () => browserStub) } }));

const { chromium } = await import('playwright');
const {
  isFacebookUrl, extractFacebookPageUrl, buildPagePluginUrl, formatPosts, fetchFacebookPosts,
  scrapePluginPosts, isLoginWall
} = await import('../services/facebookService.js');

const SESSION_COOKIES = [{ name: 'c_user', value: '123', domain: '.facebook.com', path: '/' }];
const poolWith = (cookies) => ({
  query: vi.fn(async () => ({ rows: cookies ? [{ value: JSON.stringify(cookies) }] : [] }))
});
const PLUGIN_URL_RE = /\/plugins\/page\.php\?/;

beforeEach(() => {
  vi.clearAllMocks();
  pageStub.goto.mockResolvedValue(undefined);
  pageStub.url.mockReturnValue('https://www.facebook.com/plugins/page.php?href=x');
});

describe('isFacebookUrl', () => {
  it('detects Facebook URLs', () => {
    expect(isFacebookUrl('https://www.facebook.com/medinaTRAILS/')).toBe(true);
    expect(isFacebookUrl('https://clevelandmagazine.com/article')).toBe(false);
    expect(isFacebookUrl(null)).toBe(false);
  });
});

describe('extractFacebookPageUrl / buildPagePluginUrl', () => {
  it('normalizes page URLs', () => {
    expect(extractFacebookPageUrl('https://m.facebook.com/medinaTRAILS?ref=x')).toBe('https://www.facebook.com/medinaTRAILS/');
    expect(extractFacebookPageUrl('https://example.com')).toBeNull();
  });
  it('builds a timeline page-plugin URL', () => {
    const url = new URL(buildPagePluginUrl('https://www.facebook.com/medinaTRAILS/'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/plugins/page.php');
    expect(url.searchParams.get('href')).toBe('https://www.facebook.com/medinaTRAILS/');
    expect(url.searchParams.get('tabs')).toBe('timeline');
  });
});

describe('formatPosts', () => {
  it('dates posts, drops empty ones, and respects maxItems', () => {
    const md = formatPosts([
      { utime: '1790198756', text: '9/23 Open! Ride through puddles not around.' },
      { utime: '1789993195', text: '' },
      { utime: '1789993195', text: '9/21/26 All trails CLOSED' },
      { utime: null, text: 'undated' }
    ], 2);
    expect(md).toBe('[2026-09-23] 9/23 Open! Ride through puddles not around.\n\n---\n\n[2026-09-21] 9/21/26 All trails CLOSED');
  });
});

describe('formatPosts timestamp boundaries', () => {
  it('treats malformed, non-positive, and out-of-range utime as undated', () => {
    const md = formatPosts([
      { utime: 'abc', text: 'a' },
      { utime: '0', text: 'b' },
      { utime: '-5', text: 'c' },
      { utime: '1e20', text: 'd' },
      { utime: '1790198756', text: 'e' }
    ]);
    expect(md).toBe('a\n\n---\n\nb\n\n---\n\nc\n\n---\n\nd\n\n---\n\n[2026-09-23] e');
  });
});

describe('fetchFacebookPosts', () => {
  it('renders the page plugin and returns dated markdown', async () => {
    pageStub.evaluate.mockResolvedValue({
      posts: [{ utime: '1790198756', text: '9/23 Open!' }],
      bodyText: 'Medina Trails\n9/23 Open!'
    });
    const r = await fetchFacebookPosts(poolWith(SESSION_COOKIES), 'https://www.facebook.com/medinaTRAILS/');
    expect(r).toEqual({ markdown: '[2026-09-23] 9/23 Open!', reachable: true, reason: null });
    expect(pageStub.goto.mock.calls[0][0]).toMatch(PLUGIN_URL_RE);
    expect(contextStub.addCookies).toHaveBeenCalledWith(SESSION_COOKIES);
    expect(chromium.launch.mock.calls[0][0].proxy).toBeUndefined();
    expect(browserStub.close).toHaveBeenCalled();
  });

  it('falls back to page text when no timestamped posts are found', async () => {
    pageStub.evaluate.mockResolvedValue({ posts: [], bodyText: '  Medina Trails\nTrails closed today  ' });
    const r = await fetchFacebookPosts(poolWith(SESSION_COOKIES), 'https://www.facebook.com/medinaTRAILS/');
    expect(r.reachable).toBe(true);
    expect(r.markdown).toBe('Medina Trails\nTrails closed today');
  });

  it('reports no posts when the page is empty', async () => {
    pageStub.evaluate.mockResolvedValue({ posts: [], bodyText: '' });
    const r = await fetchFacebookPosts(poolWith(SESSION_COOKIES), 'https://www.facebook.com/medinaTRAILS/');
    expect(r).toEqual({ markdown: null, reachable: true, reason: 'no posts found' });
  });

  it('returns unreachable and still closes the browser on navigation errors', async () => {
    pageStub.goto.mockRejectedValue(new Error('Timeout 45000ms exceeded'));
    const r = await fetchFacebookPosts(poolWith(SESSION_COOKIES), 'https://www.facebook.com/medinaTRAILS/');
    expect(r.reachable).toBe(false);
    expect(r.reason).toContain('Timeout');
    expect(browserStub.close).toHaveBeenCalled();
  });

  it('rejects non-page URLs without touching the browser', async () => {
    const r = await fetchFacebookPosts(poolWith(null), 'https://example.com/x');
    expect(r.reason).toBe('invalid Facebook URL');
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});

describe('scrapePluginPosts (DOM)', () => {
  const html = `
    <div id="timeline">
      <div class="post"><div><span>Medina Trails</span><abbr data-utime="1790198756">on Wednesday</abbr></div>
        <div data-testid="post_message"><p>9/23 Open! Ride through puddles not around.</p></div><div>11 Share</div></div>
      <div class="post"><div><abbr data-utime="1789993195">last Monday</abbr></div>
        <div class="userContent"><p>9/21/26 All trails CLOSED</p></div></div>
      <div class="post"><div><abbr data-utime="1789840097">a week ago</abbr></div><div>photo only</div></div>
    </div>`;

  it('pairs each timestamp with its own post message', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(`<body>${html}</body>`);
    vi.stubGlobal('document', dom.window.document);
    try {
      const { posts, bodyText } = scrapePluginPosts();
      expect(posts).toEqual([
        { utime: '1790198756', text: '9/23 Open! Ride through puddles not around.' },
        { utime: '1789993195', text: '9/21/26 All trails CLOSED' },
        { utime: '1789840097', text: '' }
      ]);
      expect(bodyText).toContain('photo only');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('fetchFacebookPosts fallback when post text selector misses', () => {
  it('uses page text when timestamps exist but no message text parses', async () => {
    pageStub.evaluate.mockResolvedValue({
      posts: [{ utime: '1790198756', text: '' }],
      bodyText: 'Medina Trails\n9/23 Open!'
    });
    const r = await fetchFacebookPosts(poolWith(SESSION_COOKIES), 'https://www.facebook.com/medinaTRAILS/');
    expect(r).toEqual({ markdown: 'Medina Trails\n9/23 Open!', reachable: true, reason: null });
  });
});

describe('login wall handling', () => {
  it('detects the /login redirect and login-form text', () => {
    expect(isLoginWall('https://www.facebook.com/login/?next=x', 0, '')).toBe(true);
    expect(isLoginWall('https://www.facebook.com/plugins/page.php', 0, 'Log into Facebook\nPassword')).toBe(true);
    expect(isLoginWall('https://www.facebook.com/plugins/page.php', 0, 'Log in to Facebook')).toBe(true);
    expect(isLoginWall('https://www.facebook.com/plugins/page.php', 3, 'Log in to Facebook')).toBe(false);
    expect(isLoginWall('https://www.facebook.com/plugins/page.php', 0, 'Medina Trails')).toBe(false);
  });

  it('reports login required instead of passing login-page text to the classifier', async () => {
    pageStub.url.mockReturnValue('https://www.facebook.com/login/?next=plugin');
    pageStub.evaluate.mockResolvedValue({ posts: [], bodyText: 'Log into Facebook\nEmail or mobile number\nPassword' });
    const r = await fetchFacebookPosts(poolWith(null), 'https://www.facebook.com/medinaTRAILS/');
    expect(r.reachable).toBe(false);
    expect(r.markdown).toBeNull();
    expect(r.reason).toMatch(/login required/i);
    expect(contextStub.addCookies).not.toHaveBeenCalled();
    expect(browserStub.close).toHaveBeenCalled();
  });

  it('reports a session-load failure as itself, without launching a browser', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('connection refused'); }) };
    const r = await fetchFacebookPosts(pool, 'https://www.facebook.com/medinaTRAILS/');
    expect(r.reachable).toBe(false);
    expect(r.reason).toContain('connection refused');
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});
