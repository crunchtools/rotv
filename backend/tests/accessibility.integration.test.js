/**
 * Accessibility Integration Tests using axe-core + Playwright
 * Verifies WCAG 2.1 AA compliance across main application views.
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 * - Playwright browsers must be installed
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

describe('Accessibility Tests (WCAG 2.1 AA)', () => {
  let browser;
  let context;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      timeout: 30000
    });
  }, 30000);

  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
  }, 30000);

  afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it('Map view has no critical or serious accessibility violations', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.header-tabs', { timeout: 15000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (critical.length > 0) {
      console.log('Critical/serious violations on Map view:');
      critical.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
        v.nodes.forEach(n => console.log(`    ${n.html.substring(0, 100)}`));
      });
    }
    expect(critical).toHaveLength(0);
  }, 60000);

  it('Results view has no critical or serious accessibility violations', async () => {
    await page.goto(`${BASE_URL}/results`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.results-tab-list', { timeout: 15000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude('[aria-hidden="true"]')
      .analyze();

    const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (critical.length > 0) {
      console.log('Critical/serious violations on Results view:');
      critical.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
        v.nodes.slice(0, 3).forEach(n => console.log(`    ${n.html.substring(0, 120)}`));
      });
    }
    expect(critical).toHaveLength(0);
  }, 60000);

  it('News view has no critical or serious accessibility violations', async () => {
    await page.goto(`${BASE_URL}/news`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main#main-content', { timeout: 15000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude('[aria-hidden="true"]')
      .analyze();

    const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (critical.length > 0) {
      console.log('Critical/serious violations on News view:');
      critical.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
        v.nodes.slice(0, 3).forEach(n => console.log(`    ${n.html.substring(0, 120)}`));
      });
    }
    expect(critical).toHaveLength(0);
  }, 60000);

  it('Events view has no critical or serious accessibility violations', async () => {
    await page.goto(`${BASE_URL}/events`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main#main-content', { timeout: 15000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude('[aria-hidden="true"]')
      .analyze();

    const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (critical.length > 0) {
      console.log('Critical/serious violations on Events view:');
      critical.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
        v.nodes.slice(0, 3).forEach(n => console.log(`    ${n.html.substring(0, 120)}`));
      });
    }
    expect(critical).toHaveLength(0);
  }, 60000);

  it('skip navigation link exists and is focusable', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.skip-link', { timeout: 15000 });

    const href = await page.locator('.skip-link').getAttribute('href');
    expect(href).toBe('#main-content');

    // Focus the skip link directly and verify it becomes visible
    await page.locator('.skip-link').focus();
    await page.waitForTimeout(300);
    const box = await page.locator('.skip-link').boundingBox();
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('tab navigation buttons have aria-current on active tab', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tab-btn.active', { timeout: 15000 });

    const ariaCurrent = await page.locator('.tab-btn.active').getAttribute('aria-current');
    expect(ariaCurrent).toBe('page');
  }, 30000);

  it('map controls are keyboard accessible', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.zoom-locate-control', { timeout: 15000 });

    // Verify zoom controls have proper ARIA
    expect(await page.locator('.zoom-in-btn').getAttribute('role')).toBe('button');
    expect(await page.locator('.zoom-in-btn').getAttribute('aria-label')).toBe('Zoom in');

    expect(await page.locator('.zoom-out-btn').getAttribute('role')).toBe('button');
    expect(await page.locator('.zoom-out-btn').getAttribute('aria-label')).toBe('Zoom out');

    expect(await page.locator('.locate-button').getAttribute('role')).toBe('button');
    expect(await page.locator('.locate-button').getAttribute('aria-label')).toBe('Find my location');
  }, 30000);
});
