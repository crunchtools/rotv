/**
 * Runs scrapePluginPosts in real Chromium against a Page Plugin-shaped
 * fixture (no network), covering the page.evaluate path the unit tests mock.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { scrapePluginPosts, formatPosts, fetchFacebookPosts } from '../services/facebookService.js';

const FIXTURE = `<!doctype html><body>
  <div class="_2pi9">
    <div class="_4-u2"><div><a>Medina Trails</a><abbr data-utime="1790198756" class="_5ptz">on Wednesday</abbr></div>
      <div data-testid="post_message" class="_5pbx userContent"><p>9/23 Open! Ride through puddles not around.</p></div>
      <div><span>11</span><a>Share</a></div></div>
    <div class="_4-u2"><div><a>Medina Trails</a><abbr data-utime="1789993195" class="_5ptz">last Monday</abbr></div>
      <div data-testid="post_message" class="_5pbx userContent"><p>9/21/26 All trails CLOSED<br>Too much continuous rain</p></div></div>
  </div></body>`;

describe('facebookService in Chromium', () => {
  let browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('extracts dated posts from Page Plugin markup', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    const { posts } = await page.evaluate(scrapePluginPosts);
    await page.close();

    expect(formatPosts(posts)).toBe(
      '[2026-09-23] 9/23 Open! Ride through puddles not around.\n\n---\n\n' +
      '[2026-09-21] 9/21/26 All trails CLOSED\nToo much continuous rain'
    );
  });

  // Opt-in contract check against the real Page Plugin (network, Facebook-controlled).
  // Run with FACEBOOK_LIVE_TEST=1 to confirm Facebook hasn't changed the plugin markup.
  it.skipIf(!process.env.FACEBOOK_LIVE_TEST)('fetches dated posts from the live medinaTRAILS Page Plugin', async () => {
    const r = await fetchFacebookPosts('https://www.facebook.com/medinaTRAILS/');
    expect(r.reachable).toBe(true);
    expect(r.markdown).toMatch(/^\[\d{4}-\d{2}-\d{2}\] \S/);
  }, 60000);
});
