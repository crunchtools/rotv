import { acquireBrowser, releaseBrowser } from './browserPool.js';

function withHardTimeout(promise, ms, operationName = 'Operation') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export async function isJavaScriptHeavySite(url, options = {}) {
  const { checkContent = true } = options;

  if (!url || url === 'No website available' || url === 'No dedicated events page' || url === 'No dedicated news page') {
    return false;
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    const jsHeavyDomains = [
      'wix.com',
      'wixsite.com',
      'wixstatic.com',
      'squarespace.com',
      'webflow.io',
      'webflow.com',
      'carrd.co',
      'weebly.com',
      'wordpress.com',
      'sites.google.com',
      'conservancyforcvnp.org',
      'preservethevalley.com',
      'bsky.app',
      'twitter.com',
      'x.com',
      'facebook.com',
      'clevelandmetroparks.com'
    ];

    if (jsHeavyDomains.some(domain => hostname.includes(domain))) {
      return true;
    }

    if (checkContent) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(5000)
        });

        const server = response.headers.get('server') || '';
        const xWixRequestId = response.headers.get('x-wix-request-id');

        if (server.toLowerCase().includes('pepyaka') || xWixRequestId) {
          console.log(`[JS Renderer] Detected Wix site via headers: ${url}`);
          return true;
        }

        const html = await response.text();
        const htmlLower = html.toLowerCase();

        const signatures = [
          'wix.com',
          'wixstatic.com',
          'parastorage.com',
          'squarespace.com',
          'webflow.com',
          'window.wixSite',
          'thunderbolt',
          '__NEXT_DATA__'
        ];

        if (signatures.some(sig => htmlLower.includes(sig))) {
          console.log(`[JS Renderer] Detected JS-heavy framework in HTML: ${url}`);
          return true;
        }
      } catch (fetchError) {
        console.log(`[JS Renderer] Fetch failed for ${url}, will try rendering: ${fetchError.message}`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error(`[JS Renderer] Error checking site ${url}:`, error.message);
    return false;
  }
}

async function loginToTwitter(page, credentials = {}) {
  const { username, password } = credentials;

  console.log('[JS Renderer] Twitter login check - Username:', username ? 'SET' : 'NOT SET', 'Password:', password ? 'SET' : 'NOT SET');

  if (!username || !password) {
    console.log('[JS Renderer] ⚠️ Twitter credentials not configured, skipping login');
    return false;
  }

  try {
    console.log('[JS Renderer] 🔐 Attempting Twitter login...');

    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    const usernameInput = await page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
    await usernameInput.fill(username);
    await page.waitForTimeout(1000);

    const nextButton = await page.locator('button:has-text("Next")').first();
    await nextButton.click();
    await page.waitForTimeout(2000);

    const passwordInput = await page.waitForSelector('input[name="password"]', { timeout: 10000 });
    await passwordInput.fill(password);
    await page.waitForTimeout(1000);

    const loginButton = await page.locator('button:has-text("Log in")').first();
    await loginButton.click();
    await page.waitForTimeout(3000);

    const isLoggedIn = await page.evaluate(() => {
      const url = window.location.href;
      return url.includes('/home') || url.includes('/compose') || !url.includes('/flow/login');
    });

    if (isLoggedIn) {
      console.log('[JS Renderer] ✓ Twitter login successful');
      return true;
    } else {
      console.log('[JS Renderer] ⚠️ Twitter login may have failed - checking...');
      return false;
    }
  } catch (error) {
    console.error('[JS Renderer] ❌ Twitter login failed:', error.message);
    return false;
  }
}

export async function renderJavaScriptPage(url, options = {}) {
  const {
    timeout = 15000,
    waitForSelector = null,
    waitTime = 3000,
    extractSelectors = [],
    hardTimeout = 60000,
    browserLaunchTimeout = 30000,
    requireTwitterLogin = null,
    twitterCredentials = null
  } = options;

  console.log(`[JS Renderer] Acquiring browser context for: ${url}`);

  // Only the BrowserContext gets closed on hard timeout — the shared browser process stays alive
  let contextRef = { context: null, acquisitionId: null };
  let hardTimeoutId;
  let isTimedOut = false;

  const hardTimeoutPromise = new Promise((_, reject) => {
    hardTimeoutId = setTimeout(async () => {
      isTimedOut = true;
      console.error(`[JS Renderer] ⏰ Hard timeout (${hardTimeout}ms) reached for ${url}, forcing cleanup...`);

      if (contextRef.context) {
        try {
          await contextRef.context.close();
          releaseBrowser(contextRef.acquisitionId);
          console.log(`[JS Renderer] ✓ Context force-closed after hard timeout`);
        } catch (closeError) {
          console.error(`[JS Renderer] Failed to force-close context: ${closeError.message}`);
        }
      }

      reject(new Error(`JS Renderer hard timeout after ${hardTimeout}ms`));
    }, hardTimeout);
  });

  try {
    const needsTwitterLogin = requireTwitterLogin !== null
      ? requireTwitterLogin
      : (url.includes('twitter.com') || url.includes('x.com'));

    const renderedPage = await Promise.race([
      renderJavaScriptPageInternal(url, {
        timeout, waitForSelector, waitTime, extractSelectors, contextRef, needsTwitterLogin, twitterCredentials
      }),
      hardTimeoutPromise
    ]);

    return renderedPage;
  } catch (error) {
    console.error(`[JS Renderer] ❌ Error for ${url}:`, error.message);
    return {
      text: '',
      html: '',
      title: '',
      url: url,
      success: false,
      error: error.message
    };
  } finally {
    clearTimeout(hardTimeoutId);

    if (isTimedOut && contextRef.context) {
      try {
        await contextRef.context.close();
        releaseBrowser(contextRef.acquisitionId);
      } catch (e) {
        // ignore
      }
    }
  }
}

async function renderJavaScriptPageInternal(url, options) {
  const { timeout, waitForSelector, waitTime, extractSelectors, contextRef, needsTwitterLogin, twitterCredentials } = options;

  let context = null;
  try {
    const { browser, acquisitionId } = await acquireBrowser();
    contextRef.acquisitionId = acquisitionId;

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true
    });

    if (contextRef) {
      contextRef.context = context;
    }

    if (needsTwitterLogin) {
      try {
        const pkg = await import('pg');
        const { Pool } = pkg.default || pkg;
        const dbPool = new Pool({
          user: process.env.PGUSER || 'postgres',
          host: process.env.PGHOST || 'localhost',
          database: process.env.PGDATABASE || 'rotv',
          password: process.env.PGPASSWORD || 'rotv',
          port: process.env.PGPORT || 5432,
        });

        const cookieQuery = await dbPool.query(
          "SELECT value FROM admin_settings WHERE key = 'twitter_cookies'"
        );

        await dbPool.end();

        if (cookieQuery.rows.length > 0) {
          const cookies = JSON.parse(cookieQuery.rows[0].value);

          // Playwright rejects cookies unless sameSite is exactly "Strict"|"Lax"|"None" —
          // raw browser exports often use null/"no_restriction"/lowercase values
          const sanitizedCookies = cookies.map(cookie => {
            const sanitized = { ...cookie };

            const sameSiteValue = sanitized.sameSite;
            if (!sameSiteValue || sameSiteValue === 'no_restriction' || sameSiteValue === 'unspecified') {
              sanitized.sameSite = 'None';
            } else if (typeof sameSiteValue === 'string') {
              const normalized = sameSiteValue.charAt(0).toUpperCase() + sameSiteValue.slice(1).toLowerCase();
              if (['Strict', 'Lax', 'None'].includes(normalized)) {
                sanitized.sameSite = normalized;
              } else {
                sanitized.sameSite = 'None';
              }
            } else {
              sanitized.sameSite = 'None';
            }

            if (!sanitized.name || !sanitized.value) {
              return null;
            }

            if (sanitized.expirationDate && !sanitized.expires) {
              sanitized.expires = sanitized.expirationDate;
            }

            return sanitized;
          }).filter(c => c !== null);

          await context.addCookies(sanitizedCookies);
          console.log('[JS Renderer] ✓ Loaded', sanitizedCookies.length, 'saved Twitter cookies');
        } else {
          console.log('[JS Renderer] ⚠️ No saved Twitter cookies found, trying public access');
        }
      } catch (err) {
        console.error('[JS Renderer] ❌ Error loading Twitter cookies:', err.message);
      }
    }

    const page = await context.newPage();

    console.log(`[JS Renderer] Navigating to ${url}...`);
    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout
      });
    } catch (navError) {
      if (navError.message.includes('Timeout') || navError.message.includes('timeout')) {
        console.log(`[JS Renderer] Network idle timeout, retrying with domcontentloaded...`);
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: Math.min(timeout, 10000)
        });
      } else {
        throw navError;
      }
    }

    if (waitForSelector) {
      console.log(`[JS Renderer] Waiting for selector: ${waitForSelector}`);
      await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {
        console.log(`[JS Renderer] Selector ${waitForSelector} not found, continuing anyway`);
      });
    }

    console.log(`[JS Renderer] Waiting ${waitTime}ms for dynamic content...`);
    await page.waitForTimeout(waitTime);

    if (url.includes('x.com') || url.includes('twitter.com')) {
      console.log('[JS Renderer] Waiting for Twitter tweets to load...');

      try {
        await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 });
        console.log('[JS Renderer] ✓ Tweets loaded');
      } catch (e) {
        console.log('[JS Renderer] ⚠️ Tweets not found via selector, trying scroll');
      }

      await page.waitForTimeout(2000);

      console.log('[JS Renderer] Scrolling Twitter page to load more content...');
      await page.evaluate(async () => {
        // Aggressive scroll triggers Twitter's lazy-loading for tweets below the fold
        for (let i = 0; i < 5; i++) {
          window.scrollBy(0, 800);
          await new Promise(resolve => setTimeout(resolve, 800));
        }
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 1000));
      });
    }

    const content = await page.evaluate((selectors) => {
      const getTextFromSelectors = (sels) => {
        const results = {};
        sels.forEach(sel => {
          const elements = document.querySelectorAll(sel);
          results[sel] = Array.from(elements).map(el => el.innerText.trim()).filter(t => t.length > 0);
        });
        return results;
      };

      const extractLinks = () => {
        const links = [];
        const anchorElements = document.querySelectorAll('a[href]');

        anchorElements.forEach(anchor => {
          const href = anchor.href;

          if (!href ||
              href.startsWith('mailto:') ||
              href.startsWith('tel:') ||
              href.startsWith('#') ||
              href === window.location.href ||
              href.includes('facebook.com') ||
              href.includes('twitter.com') ||
              href.includes('instagram.com') ||
              href.includes('linkedin.com')) {
            return;
          }

          const linkText = anchor.innerText?.trim() || anchor.textContent?.trim() || '';

          let contextText = '';
          let parent = anchor.parentElement;
          let depth = 0;

          while (parent && depth < 3) {
            const classList = Array.from(parent.classList || []);
            const className = parent.className || '';

            const isContainer = classList.some(c =>
              c.includes('event') || c.includes('article') || c.includes('news') ||
              c.includes('card') || c.includes('item') || c.includes('post')
            ) || className.includes('event') || className.includes('article');

            if (isContainer) {
              contextText = parent.innerText?.trim() || '';
              break;
            }

            parent = parent.parentElement;
            depth++;
          }

          if (!contextText && anchor.parentElement) {
            contextText = anchor.parentElement.innerText?.trim() || '';
          }

          if (contextText.length > 500) {
            contextText = contextText.substring(0, 500);
          }

          links.push({
            url: href,
            text: linkText,
            context: contextText,
            className: anchor.className || '',
            parentClassName: anchor.parentElement?.className || ''
          });
        });

        return links;
      };

      return {
        text: document.body.innerText,
        html: document.body.innerHTML,
        title: document.title,
        url: window.location.href,
        selectedContent: selectors.length > 0 ? getTextFromSelectors(selectors) : null,
        links: extractLinks()
      };
    }, extractSelectors);

    console.log(`[JS Renderer] ✓ Extracted ${content.text.length} characters from ${url}`);
    console.log(`[JS Renderer]   Title: ${content.title}`);
    console.log(`[JS Renderer]   Found ${content.links.length} links on page`);

    await context.close();
    releaseBrowser(contextRef.acquisitionId);

    return {
      ...content,
      success: true
    };

  } catch (error) {
    console.error(`[JS Renderer] ❌ Error rendering ${url}:`, error.message);

    if (context) {
      await context.close().catch(() => {});
      releaseBrowser(contextRef.acquisitionId);
    }

    return {
      text: '',
      html: '',
      title: '',
      url: url,
      success: false,
      error: error.message
    };
  }
}

export function extractEventContent(text) {
  const lines = text.split('\n');

  const eventLines = lines.filter(line => {
    const lower = line.toLowerCase().trim();

    if (lower.length === 0) return false;

    const navKeywords = ['home', 'about', 'contact', 'login', 'sign in', 'sign up', 'menu', 'search'];
    if (navKeywords.some(kw => lower === kw)) return false;

    const eventKeywords = [
      'event', 'adventure', 'program', 'workshop', 'class', 'tour',
      'hike', 'walk', 'festival', 'concert', 'volunteer',
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
      '2026', '2025', 'upcoming', 'register', 'rsvp'
    ];

    return eventKeywords.some(kw => lower.includes(kw));
  });

  return eventLines.join('\n');
}
