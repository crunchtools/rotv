// X/Twitter session cookies for the authenticated rendering tests. They used to be
// hardcoded in the test files, which published a live session (auth_token included)
// in a public repo. Supply them as JSON in TEST_TWITTER_COOKIES to run those tests.
/**
 * Playwright cookie objects parsed from the TEST_TWITTER_COOKIES JSON array, or []
 * when it is unset, not JSON, or not an array (the authenticated tests then skip).
 * @type {Array<object>}
 */
export const TWITTER_COOKIES = (() => {
  const raw = process.env.TEST_TWITTER_COOKIES;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`[Test Setup] TEST_TWITTER_COOKIES is not valid JSON (${error.message}); authenticated X tests will skip`);
    return [];
  }
})();
export const hasTwitterCookies = TWITTER_COOKIES.length > 0;
