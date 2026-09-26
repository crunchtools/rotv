import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let cookieJar = [];
const pageStub = {
  goto: vi.fn(async () => {}),
  url: vi.fn(() => 'https://www.facebook.com/login/'),
  screenshot: vi.fn(async () => Buffer.from('jpeg')),
  mouse: { click: vi.fn(async () => {}), wheel: vi.fn(async () => {}) },
  keyboard: { type: vi.fn(async () => {}), press: vi.fn(async () => {}) }
};
const contextStub = {
  newPage: vi.fn(async () => pageStub),
  cookies: vi.fn(async () => cookieJar),
  storageState: vi.fn(async () => ({ cookies: cookieJar }))
};
const browserStub = { newContext: vi.fn(async () => contextStub), close: vi.fn(async () => {}) };

vi.mock('playwright', () => ({ chromium: { launch: vi.fn(async () => browserStub) } }));

const { chromium } = await import('playwright');
const {
  startLogin, getFrame, sendInput, saveLogin, cancelLogin, VIEWPORT, isProviderCookie, PROVIDERS
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
  it('launches a dedicated, non-proxied browser on the login page', () => {
    expect(chromium.launch.mock.calls[0][0].proxy).toBeUndefined();
    expect(browserStub.newContext.mock.calls[0][0].viewport).toEqual(VIEWPORT);
    expect(pageStub.goto.mock.calls[0][0]).toBe('https://www.facebook.com/login/');
  });

  it('rejects unknown providers and a second admin', async () => {
    await expect(startLogin('myspace', ADMIN)).rejects.toMatchObject({ status: 404 });
    await expect(startLogin('constructor', ADMIN)).rejects.toMatchObject({ status: 404 });
    await expect(startLogin('__proto__', ADMIN)).rejects.toMatchObject({ status: 404 });
    await expect(startLogin('facebook', OTHER_ADMIN)).rejects.toMatchObject({ status: 409 });
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
