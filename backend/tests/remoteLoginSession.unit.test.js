import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let cookieJar = [];
const mainFrame = { url: () => 'https://www.facebook.com/checkpoint/?token=secret' };
const pageStub = {
  on: vi.fn(),
  mainFrame: vi.fn(() => mainFrame),
  goto: vi.fn(async () => {}),
  url: vi.fn(() => 'https://www.facebook.com/login/'),
  screenshot: vi.fn(async () => Buffer.from('jpeg')),
  mouse: { click: vi.fn(async () => {}), wheel: vi.fn(async () => {}) },
  keyboard: { type: vi.fn(async () => {}), press: vi.fn(async () => {}) }
};
const contextStub = {
  on: vi.fn(),
  newPage: vi.fn(async () => pageStub),
  cookies: vi.fn(async () => cookieJar),
  storageState: vi.fn(async () => ({ cookies: cookieJar }))
};
const browserStub = { newContext: vi.fn(async () => contextStub), close: vi.fn(async () => {}) };

const loggerStub = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../utils/logger.js', () => ({ createLogger: () => loggerStub }));

vi.mock('../services/humanBrowser.js', () => ({
  launchHumanBrowser: vi.fn(async () => browserStub),
  humanContextOptions: vi.fn(async (_browser, extra) => ({ locale: 'en-US', timezoneId: 'America/New_York', ...extra }))
}));

const { launchHumanBrowser } = await import('../services/humanBrowser.js');
const chromium = { launch: launchHumanBrowser };
const {
  startLogin, getFrame, sendInput, saveLogin, cancelLogin, VIEWPORT, isProviderCookie, PROVIDERS, redactUrl
} = await import('../services/remoteLoginSession.js');

const ADMIN = 1;
const OTHER_ADMIN = 2;
const LOGGED_IN_COOKIES = [
  { name: 'c_user', value: '123', domain: '.facebook.com', path: '/', expires: -1 },
  { name: 'xs', value: 'abc', domain: '.facebook.com', path: '/', expires: 1790000000 },
  { name: 'other', value: 'z', domain: '.example.com', path: '/', expires: -1 },
  { name: 'spoof', value: 'z', domain: 'evilfacebook.com', path: '/', expires: -1 }
];

beforeEach(async () => {
  vi.clearAllMocks();
  cookieJar = [];
  await startLogin('facebook', ADMIN);
});

afterEach(async () => {
  await cancelLogin('facebook', ADMIN);
  vi.useRealTimers();
});

describe('startLogin', () => {
  it('launches the shared human browser on the login page', () => {
    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(browserStub.newContext.mock.calls[0][0]).toMatchObject({ viewport: VIEWPORT, timezoneId: 'America/New_York' });
    expect(pageStub.goto.mock.calls[0][0]).toBe('https://www.facebook.com/login/');
  });

  it('rejects unknown providers and a second admin', async () => {
    await expect(startLogin('myspace', ADMIN)).rejects.toMatchObject({ status: 404 });
    await expect(startLogin('constructor', ADMIN)).rejects.toMatchObject({ status: 404 });
    await expect(startLogin('__proto__', ADMIN)).rejects.toMatchObject({ status: 404 });
    await expect(startLogin('facebook', OTHER_ADMIN)).rejects.toMatchObject({ status: 409 });
  });
});

describe('redactUrl', () => {
  it('keeps host and path, drops query and fragment', () => {
    expect(redactUrl('https://www.facebook.com/checkpoint/?next=abc&token=secret#x')).toBe('www.facebook.com/checkpoint/');
    expect(redactUrl('not a url')).toBe('(unparseable URL)');
    expect(redactUrl('https://www.facebook.com/checkpoint/1501092823525282/two_step')).toBe('www.facebook.com/checkpoint/:id/two_step');
    expect(redactUrl('https://www.facebook.com/r.php/aB3xYz9QwErT/')).toBe('www.facebook.com/r.php/:id/');
  });
});

describe('login flow tracing', () => {
  it('logs cookie state on main-frame navigations only', async () => {
    const onNav = pageStub.on.mock.calls.find(([evt]) => evt === 'framenavigated')[1];
    contextStub.cookies.mockClear();
    onNav({ url: () => 'https://www.facebook.com/plugins/iframe' });
    expect(contextStub.cookies).not.toHaveBeenCalled();
    cookieJar = [{ name: 'xs', value: 'SECRETXS', domain: '.facebook.com' }, { name: 'datr', value: 'SECRETDATR', domain: '.facebook.com' }];
    onNav(mainFrame);
    expect(contextStub.cookies).toHaveBeenCalledWith('https://www.facebook.com');
    await vi.waitFor(() => expect(loggerStub.info).toHaveBeenCalledWith(
      'Login nav: www.facebook.com/checkpoint/ cookies=[datr,xs]'
    ));
    expect(JSON.stringify(loggerStub.info.mock.calls)).not.toMatch(/SECRET|token=/);
  });

  it('survives a failed cookie read without an info log', async () => {
    const onNav = pageStub.on.mock.calls.find(([evt]) => evt === 'framenavigated')[1];
    loggerStub.info.mockClear();
    contextStub.cookies.mockRejectedValueOnce(new Error('context closed'));
    onNav(mainFrame);
    await vi.waitFor(() => expect(loggerStub.debug).toHaveBeenCalledWith('Login nav cookie read failed: context closed'));
    expect(loggerStub.info).not.toHaveBeenCalled();
  });

  it('logs a new tab by host and path only', () => {
    const onPage = contextStub.on.mock.calls.find(([evt]) => evt === 'page')[1];
    onPage({ url: () => 'https://www.facebook.com/two_step/?code=123456#frag' });
    expect(loggerStub.info).toHaveBeenCalledWith('Login flow opened a new tab: www.facebook.com/two_step/');
  });
});

describe('getFrame', () => {
  it('returns a screenshot and login state', async () => {
    let frame = await getFrame('facebook', ADMIN);
    expect(frame.loggedIn).toBe(false);
    expect(frame.image).toBeInstanceOf(Buffer);

    cookieJar = LOGGED_IN_COOKIES;
    frame = await getFrame('facebook', ADMIN);
    expect(frame.loggedIn).toBe(true);
  });

  it('refuses callers who do not own the session', async () => {
    await expect(getFrame('facebook', OTHER_ADMIN)).rejects.toMatchObject({ status: 409 });
  });
});

describe('sendInput', () => {
  it('relays clicks, text, allowed keys, and scrolls', async () => {
    await sendInput('facebook', ADMIN, { type: 'click', x: 100, y: 200 });
    await sendInput('facebook', ADMIN, { type: 'type', text: 'user@example.com' });
    await sendInput('facebook', ADMIN, { type: 'key', key: 'Enter' });
    await sendInput('facebook', ADMIN, { type: 'scroll', dy: 99999 });
    expect(pageStub.mouse.click).toHaveBeenCalledWith(100, 200);
    expect(pageStub.keyboard.type).toHaveBeenCalledWith('user@example.com');
    expect(pageStub.keyboard.press).toHaveBeenCalledWith('Enter');
    expect(pageStub.mouse.wheel).toHaveBeenCalledWith(0, 2000);
  });

  it.each([
    [{ type: 'click', x: -1, y: 10 }, /viewport/],
    [{ type: 'click', x: Number.NaN, y: 10 }, /viewport/],
    [{ type: 'click', x: 10 }, /viewport/],
    [{ type: 'type', text: '' }, /Invalid text/],
    [{ type: 'type', text: 42 }, /Invalid text/],
    [{ type: 'scroll', dy: Number.POSITIVE_INFINITY }, /Invalid scroll/],
    [{ type: 'scroll' }, /Invalid scroll/],
    [null, /Unknown input/]
  ])('rejects %j', async (evt, message) => {
    await expect(sendInput('facebook', ADMIN, evt)).rejects.toThrow(message);
  });

  it('clamps negative scrolls too', async () => {
    await sendInput('facebook', ADMIN, { type: 'scroll', dy: -99999 });
    expect(pageStub.mouse.wheel).toHaveBeenCalledWith(0, -2000);
  });

  it('rejects out-of-viewport clicks, disallowed keys, and unknown events', async () => {
    await expect(sendInput('facebook', ADMIN, { type: 'click', x: 5000, y: 1 })).rejects.toThrow(/viewport/);
    await expect(sendInput('facebook', ADMIN, { type: 'key', key: 'Control+w' })).rejects.toThrow(/not allowed/);
    await expect(sendInput('facebook', ADMIN, { type: 'type', text: 'x'.repeat(300) })).rejects.toThrow(/Invalid text/);
    await expect(sendInput('facebook', ADMIN, { type: 'eval' })).rejects.toThrow(/Unknown input/);
  });
});

describe('saveLogin', () => {
  it('refuses to save before the login completes', async () => {
    const pool = { query: vi.fn() };
    await expect(saveLogin(pool, 'facebook', ADMIN)).rejects.toThrow(/Not logged in/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('stores only facebook.com cookies, resets failures, and closes the browser', async () => {
    cookieJar = LOGGED_IN_COOKIES;
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const result = await saveLogin(pool, 'facebook', ADMIN);

    const [, [key, value, userId]] = pool.query.mock.calls[0];
    expect(key).toBe('facebook_cookies');
    expect(JSON.parse(value).map(c => c.name)).toEqual(['c_user', 'xs']);
    expect(userId).toBe(ADMIN);
    expect(pool.query.mock.calls[1][1]).toEqual(['facebook_consecutive_failures']);
    expect(result).toEqual({ cookiesCount: 2, expires: new Date(1790000000 * 1000).toISOString() });
    expect(browserStub.close).toHaveBeenCalled();
    await expect(getFrame('facebook', ADMIN)).rejects.toMatchObject({ status: 404 });
  });
});

describe('session lifetime', () => {
  it('closes after the idle timeout', async () => {
    await cancelLogin('facebook', ADMIN);
    vi.useFakeTimers();
    await startLogin('facebook', ADMIN);
    browserStub.close.mockClear();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    expect(browserStub.close).toHaveBeenCalled();
    await expect(getFrame('facebook', ADMIN)).rejects.toMatchObject({ status: 404 });
  });
});

describe('isProviderCookie', () => {
  it('accepts the domain and dot-delimited subdomains only', () => {
    const fb = PROVIDERS.facebook;
    expect(isProviderCookie({ domain: '.facebook.com' }, fb)).toBe(true);
    expect(isProviderCookie({ domain: 'www.facebook.com' }, fb)).toBe(true);
    expect(isProviderCookie({ domain: 'facebook.com' }, fb)).toBe(true);
    expect(isProviderCookie({ domain: 'evilfacebook.com' }, fb)).toBe(false);
    expect(isProviderCookie({ domain: 'facebook.com.evil.net' }, fb)).toBe(false);
  });
});

describe('startLogin failures', () => {
  beforeEach(async () => {
    await cancelLogin('facebook', ADMIN);
    browserStub.close.mockClear();
  });

  it('closes the browser and leaves no session when navigation fails', async () => {
    pageStub.goto.mockRejectedValueOnce(new Error('net::ERR_TIMED_OUT'));
    await expect(startLogin('facebook', ADMIN)).rejects.toThrow('ERR_TIMED_OUT');
    expect(browserStub.close).toHaveBeenCalled();
    await expect(getFrame('facebook', ADMIN)).rejects.toMatchObject({ status: 404 });
  });

  it('closes the browser when context creation fails', async () => {
    browserStub.newContext.mockRejectedValueOnce(new Error('context boom'));
    await expect(startLogin('facebook', ADMIN)).rejects.toThrow('context boom');
    expect(browserStub.close).toHaveBeenCalled();
    await expect(getFrame('facebook', ADMIN)).rejects.toMatchObject({ status: 404 });
  });

  it('propagates launch failures without a session', async () => {
    chromium.launch.mockRejectedValueOnce(new Error('no chromium'));
    await expect(startLogin('facebook', ADMIN)).rejects.toThrow('no chromium');
    await expect(getFrame('facebook', ADMIN)).rejects.toMatchObject({ status: 404 });
  });

  it('honors a cancel that arrives while the browser is still starting', async () => {
    let finishGoto;
    pageStub.goto.mockImplementationOnce(() => new Promise(resolve => { finishGoto = resolve; }));
    const starting = startLogin('facebook', ADMIN);
    await vi.waitFor(() => expect(finishGoto).toBeTypeOf('function'));
    await cancelLogin('facebook', ADMIN);
    finishGoto();
    await expect(starting).rejects.toThrow(/cancelled/);
    expect(browserStub.close).toHaveBeenCalled();
    await expect(getFrame('facebook', ADMIN)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a second start while the first is still launching', async () => {
    chromium.launch.mockClear();
    let finishGoto;
    pageStub.goto.mockImplementationOnce(() => new Promise(resolve => { finishGoto = resolve; }));
    const first = startLogin('facebook', ADMIN);
    await expect(startLogin('facebook', ADMIN)).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(() => expect(finishGoto).toBeTypeOf('function'));
    finishGoto();
    await first;
    expect(chromium.launch).toHaveBeenCalledTimes(1);
  });
});
