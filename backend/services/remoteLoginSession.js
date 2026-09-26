import { chromium } from 'playwright';
import { LAUNCH_OPTIONS } from './browserPool.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RemoteLogin');

/**
 * Remote-browser login for the admin console.
 *
 * Social sites' login pages can't be iframed (Facebook sends X-Frame-Options:
 * DENY), so ROTV runs the login in its own Chromium on the server: the admin
 * UI polls JPEG frames and relays clicks/keys back. On save, the context's
 * cookies for the provider's domain go into admin_settings for the scrapers.
 *
 * Deliberately a dedicated, non-proxied browser — not browserPool: the pool's
 * 90s watchdog would kill a multi-minute login, and the session must be created
 * from the same egress IP (lotor's own) that the scraper uses.
 *
 * Providers are config: adding one (e.g. X, if it ever walls the cookie paste)
 * is an entry here plus a button in the settings UI.
 */
export const PROVIDERS = {
  facebook: {
    label: 'Facebook',
    loginUrl: 'https://www.facebook.com/login/',
    cookieUrl: 'https://www.facebook.com',
    cookieDomain: 'facebook.com',
    sessionCookie: 'c_user',
    expiryCookie: 'xs',
    settingsKey: 'facebook_cookies',
    failuresKey: 'facebook_consecutive_failures'
  }
};

export const VIEWPORT = { width: 800, height: 900 };
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SESSION_MS = 30 * 60 * 1000;
const MAX_TYPE_LENGTH = 256;
const ALLOWED_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'
]);

export const CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'America/New_York'
};

// One interactive login at a time across all providers — it's a full Chromium.
let session = null; // { provider, userId, browser, context, page, idleTimer, maxTimer }
// Set while startLogin is launching, so a cancel that races the launch still wins.
let pendingStart = null; // { provider, userId, cancelled }

/**
 * @typedef {object} RemoteInputEvent
 * @property {'click'|'type'|'key'|'scroll'} type
 * @property {number} [x] - click: viewport x in pixels (0..VIEWPORT.width)
 * @property {number} [y] - click: viewport y in pixels (0..VIEWPORT.height)
 * @property {string} [text] - type: 1..256 characters, typed as-is
 * @property {string} [key] - key: one of ALLOWED_KEYS (e.g. 'Enter')
 * @property {number} [dy] - scroll: vertical wheel delta, clamped to ±2000
 */

export class LoginSessionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) throw new LoginSessionError(`Unknown login provider: ${name}`, 404);
  return provider;
}

function requireSession(providerName, userId) {
  if (!session || session.provider !== providerName) {
    throw new LoginSessionError('No login session is running for this provider', 404);
  }
  if (session.userId !== userId) throw new LoginSessionError('Another admin owns the running login session', 409);
  return session;
}

function touch() {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => closeSession('idle timeout'), IDLE_TIMEOUT_MS);
}

async function closeSession(reason) {
  if (!session) return;
  const { browser, idleTimer, maxTimer, provider } = session;
  session = null;
  clearTimeout(idleTimer);
  clearTimeout(maxTimer);
  logger.info(`Closing ${provider} login session (${reason})`);
  await browser.close().catch(err => logger.warn(`Browser close failed: ${err.message}`));
}

/** Exact domain or a dot-delimited subdomain — never "evilfacebook.com". */
export function isProviderCookie(cookie, provider) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  return domain === provider.cookieDomain || domain.endsWith(`.${provider.cookieDomain}`);
}

async function hasSessionCookie(context, provider) {
  const cookies = await context.cookies(provider.cookieUrl);
  return cookies.some(c => c.name === provider.sessionCookie && c.value);
}

/**
 * Start (or restart) a login session. Replaces the caller's own running
 * session; refuses if another admin has one open.
 * @param {string} providerName - key of PROVIDERS
 * @param {number} userId
 * @returns {Promise<void>} resolves once the provider's login page has loaded
 * @throws {LoginSessionError} 404 unknown provider; 409 another admin's session is
 *   open, a start is already in progress, or the caller cancelled during startup
 * @throws {Error} browser launch/navigation failures (the browser is closed first)
 */
export async function startLogin(providerName, userId) {
  const provider = getProvider(providerName);
  if (session && session.userId !== userId) {
    throw new LoginSessionError('Another admin owns the running login session', 409);
  }
  if (pendingStart) throw new LoginSessionError('A login browser is already starting', 409);
  // Reserve synchronously, before any await, so concurrent starts can't both launch.
  const pending = { provider: providerName, userId, cancelled: false };
  pendingStart = pending;
  let browser = null;
  try {
    await closeSession('restart');
    browser = await chromium.launch(LAUNCH_OPTIONS);
    const context = await browser.newContext({ ...CONTEXT_OPTIONS, viewport: VIEWPORT });
    const page = await context.newPage();
    session = { provider: providerName, userId, browser, context, page, idleTimer: null, maxTimer: null };
    session.maxTimer = setTimeout(() => closeSession('max session length'), MAX_SESSION_MS);
    touch();
    await page.goto(provider.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    if (session?.browser === browser) await closeSession('start failed');
    else if (browser) await browser.close().catch(() => {});
    throw err;
  } finally {
    pendingStart = null;
  }
  if (pending.cancelled) {
    await closeSession('cancelled during start');
    throw new LoginSessionError('Login cancelled', 409);
  }
  logger.info(`${provider.label} login session started for user ${userId}`);
}

/**
 * Current screen as JPEG plus page state.
 * @param {string} providerName
 * @param {number} userId
 * @returns {Promise<{image: Buffer, url: string, loggedIn: boolean}>}
 */
export async function getFrame(providerName, userId) {
  const s = requireSession(providerName, userId);
  const image = await s.page.screenshot({ type: 'jpeg', quality: 60 });
  return { image, url: s.page.url(), loggedIn: await hasSessionCookie(s.context, getProvider(providerName)) };
}

/**
 * Relay one input event from the admin UI into the remote page.
 * Coordinates are in VIEWPORT pixels; keys are limited to ALLOWED_KEYS.
 * @param {string} providerName
 * @param {number} userId
 * @param {RemoteInputEvent} evt
 * @returns {Promise<void>}
 * @throws {LoginSessionError} 404 no session for this provider; 409 owned by another
 *   admin; 400 invalid event (off-viewport click, disallowed key, bad text/scroll)
 */
export async function sendInput(providerName, userId, evt) {
  const s = requireSession(providerName, userId);
  touch();
  switch (evt?.type) {
    case 'click': {
      const { x, y } = evt;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > VIEWPORT.width || y > VIEWPORT.height) {
        throw new LoginSessionError('Click outside the viewport');
      }
      await s.page.mouse.click(x, y);
      return;
    }
    case 'type': {
      if (typeof evt.text !== 'string' || !evt.text || evt.text.length > MAX_TYPE_LENGTH) {
        throw new LoginSessionError('Invalid text');
      }
      await s.page.keyboard.type(evt.text);
      return;
    }
    case 'key': {
      if (!ALLOWED_KEYS.has(evt.key)) throw new LoginSessionError(`Key not allowed: ${evt.key}`);
      await s.page.keyboard.press(evt.key);
      return;
    }
    case 'scroll': {
      if (!Number.isFinite(evt.dy)) throw new LoginSessionError('Invalid scroll');
      await s.page.mouse.wheel(0, Math.max(-2000, Math.min(2000, evt.dy)));
      return;
    }
    default:
      throw new LoginSessionError(`Unknown input type: ${evt?.type}`);
  }
}

/**
 * Persist the logged-in session's cookies for the provider's domain, reset its
 * failure counter, and close the browser.
 * @param {import('pg').Pool} pool
 * @param {string} providerName
 * @param {number} userId
 * @returns {Promise<{cookiesCount: number, expires: string|null}>}
 */
export async function saveLogin(pool, providerName, userId) {
  const s = requireSession(providerName, userId);
  const provider = getProvider(providerName);
  if (!(await hasSessionCookie(s.context, provider))) {
    throw new LoginSessionError(`Not logged in yet — finish the ${provider.label} login first`);
  }
  const { cookies } = await s.context.storageState();
  const siteCookies = cookies.filter(c => isProviderCookie(c, provider));

  await pool.query(
    `INSERT INTO admin_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
    [provider.settingsKey, JSON.stringify(siteCookies), userId]
  );
  await pool.query(
    `INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, '0', NOW())
     ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW()`,
    [provider.failuresKey]
  );
  await closeSession('saved');

  const expiryCookie = siteCookies.find(c => c.name === provider.expiryCookie);
  const expires = expiryCookie && expiryCookie.expires > 0 ? new Date(expiryCookie.expires * 1000).toISOString() : null;
  logger.info(`Saved ${siteCookies.length} ${provider.label} cookies (expires ${expires || 'session'})`);
  return { cookiesCount: siteCookies.length, expires };
}

/**
 * Close the caller's running session for this provider, if any.
 * @param {string} providerName
 * @param {number} userId
 */
export async function cancelLogin(providerName, userId) {
  if (pendingStart && pendingStart.provider === providerName && pendingStart.userId === userId) {
    pendingStart.cancelled = true;
    return;
  }
  if (!session || session.provider !== providerName) return;
  requireSession(providerName, userId);
  await closeSession('cancelled');
}
