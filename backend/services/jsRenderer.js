import { acquireBrowser, releaseBrowser } from './browserPool.js';

/**
 * Hard timeout wrapper - ensures a promise resolves within a time limit
 * This is a safety net for operations that may hang indefinitely
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operationName - Name of operation for error messages
 * @returns {Promise} - Resolves with result or rejects with timeout error
 */
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

/**
 * Detect if a URL is likely a JavaScript-heavy site that needs rendering
 * @param {string} url - URL to check
 * @param {Object} options - Detection options
 * @returns {Promise<boolean>} - True if site should be rendered with browser
 */
export async function isJavaScriptHeavySite(url, options = {}) {
  const { checkContent = true } = options;

  if (!url || url === 'No website available' || url === 'No dedicated events page' || url === 'No dedicated news page') {
    return false;
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Known JavaScript-heavy platforms (domain-based detection)
    const jsHeavyDomains = [
      'wix.com',
      'wixsite.com',
      'wixstatic.com',
      'squarespace.com',
      'webflow.io',
      'webflow.com',
      'carrd.co',
      'weebly.com',
      'wordpress.com', // WordPress.com (hosted) often uses heavy JS
      'sites.google.com',
      'conservancyforcvnp.org', // Force rendering to extract structured data and links
      'preservethevalley.com', // Force rendering for better link extraction
      'bsky.app', // Bluesky social media - requires rendering for posts
      'twitter.com', // Twitter - requires rendering for posts
      'x.com', // X (Twitter rebrand) - requires rendering for posts
      'facebook.com', // Facebook - requires rendering for posts and page content
      'clevelandmetroparks.com' // Cleveland Metroparks - dynamic trail status table
    ];

    // Quick check: domain-based
    if (jsHeavyDomains.some(domain => hostname.includes(domain))) {
      return true;
    }

    // Optional: Check HTML content for Wix/other framework signatures
    if (checkContent) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(5000)
        });

        // Check response headers for Wix signatures
        const server = response.headers.get('server') || '';
        const xWixRequestId = response.headers.get('x-wix-request-id');

        if (server.toLowerCase().includes('pepyaka') || xWixRequestId) {
          console.log(`[JS Renderer] Detected Wix site via headers: ${url}`);
          return true;
        }

        // Check HTML content for framework signatures
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
          '__NEXT_DATA__' // Next.js (often needs rendering)
        ];

        if (signatures.some(sig => htmlLower.includes(sig))) {
          console.log(`[JS Renderer] Detected JS-heavy framework in HTML: ${url}`);
          return true;
        }
      } catch (fetchError) {
        // If fetch fails, assume we might need rendering
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

/**
 * Login to Twitter/X with credentials
 * @param {Page} page - Playwright page object
 * @param {Object} credentials - Twitter credentials { username, password }
 * @returns {Promise<boolean>} - True if login successful
 */
async function loginToTwitter(page, credentials = {}) {
  const { username, password } = credentials;

  console.log('[JS Renderer] Twitter login check - Username:', username ? 'SET' : 'NOT SET', 'Password:', password ? 'SET' : 'NOT SET');

  if (!username || !password) {
    console.log('[JS Renderer] ⚠️ Twitter credentials not configured, skipping login');
    return false;
  }

  try {
    console.log('[JS Renderer] 🔐 Attempting Twitter login...');

    // Go to Twitter login page
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Enter username
    const usernameInput = await page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
    await usernameInput.fill(username);
    await page.waitForTimeout(1000);

    // Click Next button
    const nextButton = await page.locator('button:has-text("Next")').first();
    await nextButton.click();
    await page.waitForTimeout(2000);

    // Enter password
    const passwordInput = await page.waitForSelector('input[name="password"]', { timeout: 10000 });
    await passwordInput.fill(password);
    await page.waitForTimeout(1000);

    // Click Log in button
    const loginButton = await page.locator('button:has-text("Log in")').first();
    await loginButton.click();
    await page.waitForTimeout(3000);

    // Check if login was successful by looking for home timeline or profile
    const isLoggedIn = await page.evaluate(() => {
      // Check if we're redirected to home feed or if login failed
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

/**
 * Render a JavaScript-heavy page and extract content
 * @param {string} url - URL to render
 * @param {Object} options - Rendering options
 * @returns {Promise<Object>} - { text, html, title, success }
 */
export async function renderJavaScriptPage(url, options = {}) {
  const {
    timeout = 15000,
    waitForSelector = null,
    waitTime = 3000, // Extra wait for dynamic content
    extractSelectors = [], // Optional specific selectors to extract
    hardTimeout = 60000, // Hard timeout for entire operation (default 60s)
    browserLaunchTimeout = 30000, // Timeout for browser launch specifically
    requireTwitterLogin = null, // Auto-detect from URL if not specified
    twitterCredentials = null // Twitter credentials { username, password }
  } = options;

  console.log(`[JS Renderer] Acquiring browser context for: ${url}`);

  // Track the BrowserContext and acquisitionId for cleanup on hard timeout.
  // We close only the context, never the shared browser process.
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

    const result = await Promise.race([
      renderJavaScriptPageInternal(url, {
        timeout, waitForSelector, waitTime, extractSelectors, contextRef, needsTwitterLogin, twitterCredentials
      }),
      hardTimeoutPromise
    ]);

    return result;
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

    // Extra safety: release context if still open after hard timeout
    if (isTimedOut && contextRef.context) {
      try {
        await contextRef.context.close();
        releaseBrowser(contextRef.acquisitionId);
      } catch (e) {
        // Ignore - context may already be closed
      }
    }
  }
}

/**
 * Internal implementation of page rendering (wrapped by hard timeout)
 */
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

    // Store context reference so the hard timeout can close it if needed
    if (contextRef) {
      contextRef.context = context;
    }

    // Load Twitter cookies if this is a Twitter URL
    if (needsTwitterLogin) {
      try {
        // Import database pool
        const pkg = await import('pg');
        const { Pool } = pkg.default || pkg;
        const dbPool = new Pool({
          user: process.env.PGUSER || 'postgres',
          host: process.env.PGHOST || 'localhost',
          database: process.env.PGDATABASE || 'rotv',
          password: process.env.PGPASSWORD || 'rotv',
          port: process.env.PGPORT || 5432,
        });

        const result = await dbPool.query(
          "SELECT value FROM admin_settings WHERE key = 'twitter_cookies'"
        );

        await dbPool.end();

        if (result.rows.length > 0) {
          const cookies = JSON.parse(result.rows[0].value);

          // Sanitize cookies for Playwright compatibility
          const sanitizedCookies = cookies.map(cookie => {
            const sanitized = { ...cookie };

            // Fix sameSite - Playwright only accepts Strict, Lax, or None (capitalized)
            // Handle null, "no_restriction", lowercase values, etc.
            const sameSiteValue = sanitized.sameSite;
            if (!sameSiteValue || sameSiteValue === 'no_restriction' || sameSiteValue === 'unspecified') {
              sanitized.sameSite = 'None';
            } else if (typeof sameSiteValue === 'string') {
              // Capitalize properly: lax -> Lax, strict -> Strict, none -> None
              const normalized = sameSiteValue.charAt(0).toUpperCase() + sameSiteValue.slice(1).toLowerCase();
              if (['Strict', 'Lax', 'None'].includes(normalized)) {
                sanitized.sameSite = normalized;
              } else {
                sanitized.sameSite = 'None';
              }
            } else {
              sanitized.sameSite = 'None';
            }

            // Ensure required fields exist
            if (!sanitized.name || !sanitized.value) {
              return null;
            }

            // Convert expirationDate to expires if needed
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

    // Navigate to the page
    console.log(`[JS Renderer] Navigating to ${url}...`);
    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout
      });
    } catch (navError) {
      // If networkidle times out, try with domcontentloaded as fallback
      if (navError.message.includes('Timeout') || navError.message.includes('timeout')) {
        console.log(`[JS Renderer] Network idle timeout, retrying with domcontentloaded...`);
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: Math.min(timeout, 10000) // Shorter timeout for fallback
        });
      } else {
        throw navError;
      }
    }

    // Wait for specific selector if provided
    if (waitForSelector) {
      console.log(`[JS Renderer] Waiting for selector: ${waitForSelector}`);
      await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {
        console.log(`[JS Renderer] Selector ${waitForSelector} not found, continuing anyway`);
      });
    }

    // Wait additional time for dynamic content to load
    console.log(`[JS Renderer] Waiting ${waitTime}ms for dynamic content...`);
    await page.waitForTimeout(waitTime);

    // For Twitter/X pages, wait for tweets and scroll to load content
    if (url.includes('x.com') || url.includes('twitter.com')) {
      console.log('[JS Renderer] Waiting for Twitter tweets to load...');

      // Wait for tweet articles to appear (up to 10 seconds)
      try {
        await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 });
        console.log('[JS Renderer] ✓ Tweets loaded');
      } catch (e) {
        console.log('[JS Renderer] ⚠️ Tweets not found via selector, trying scroll');
      }

      // Additional wait for content to fully render
      await page.waitForTimeout(2000);

      console.log('[JS Renderer] Scrolling Twitter page to load more content...');
      await page.evaluate(async () => {
        // Scroll down more aggressively to trigger lazy loading
        for (let i = 0; i < 5; i++) {
          window.scrollBy(0, 800);
          await new Promise(resolve => setTimeout(resolve, 800));
        }
        // Scroll back to top to see newest tweets
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 1000));
      });
    }

    // Extract content including structured links
    const content = await page.evaluate((selectors) => {
      // Helper to get text from specific selectors
      const getTextFromSelectors = (sels) => {
        const results = {};
        sels.forEach(sel => {
          const elements = document.querySelectorAll(sel);
          results[sel] = Array.from(elements).map(el => el.innerText.trim()).filter(t => t.length > 0);
        });
        return results;
      };

      // Extract all links with context for event/news deep linking
      const extractLinks = () => {
        const links = [];
        const anchorElements = document.querySelectorAll('a[href]');

        anchorElements.forEach(anchor => {
          const href = anchor.href;

          // Skip navigation links, social media, mailto, tel, etc.
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

          // Get link text and surrounding context
          const linkText = anchor.innerText?.trim() || anchor.textContent?.trim() || '';

          // Get parent container text for context
          let contextText = '';
          let parent = anchor.parentElement;
          let depth = 0;

          // Traverse up to find meaningful context (event card, article, etc.)
          while (parent && depth < 3) {
            const classList = Array.from(parent.classList || []);
            const className = parent.className || '';

            // Check if parent looks like an event/article container
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

          // Fallback to immediate parent text if no container found
          if (!contextText && anchor.parentElement) {
            contextText = anchor.parentElement.innerText?.trim() || '';
          }

          // Limit context text length
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

/**
 * Extract event-like content from rendered page text
 * @param {string} text - Rendered page text
 * @returns {string} - Cleaned text focused on events
 */
export function extractEventContent(text) {
  // Remove common navigation/footer text
  const lines = text.split('\n');

  // Filter out lines that are likely navigation/footer
  const eventLines = lines.filter(line => {
    const lower = line.toLowerCase().trim();

    // Skip empty lines
    if (lower.length === 0) return false;

    // Skip common navigation items
    const navKeywords = ['home', 'about', 'contact', 'login', 'sign in', 'sign up', 'menu', 'search'];
    if (navKeywords.some(kw => lower === kw)) return false;

    // Keep lines that look like event-related content
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
