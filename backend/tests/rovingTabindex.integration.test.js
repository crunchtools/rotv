/**
 * Roving Tabindex Integration Tests
 * Validates keyboard navigation behavior in the header tab bar.
 *
 * Expected behavior:
 * 1. Tab key lands on the active tab button (one stop)
 * 2. ArrowRight/Left moves focus + highlight between tabs (no view switch)
 * 3. Enter/Space on a nav tab activates it (switches view)
 * 4. ArrowRight to Login button → highlight shows on Login
 * 5. Enter on Login → toggles dropdown, focus+highlight STAY on Login
 * 6. ArrowDown on Login → focus drops into dropdown's first item
 * 7. ArrowUp/Down in dropdown → navigate items
 * 8. Escape in dropdown → closes dropdown, focus+highlight back to Login
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

describe('Roving Tabindex - Header Tab Navigation', () => {
  let browser;
  let context;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, timeout: 30000 });
  }, 30000);

  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tab-btn.active', { timeout: 15000 });
  }, 30000);

  afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it('active tab has tabIndex=0, others have tabIndex=-1', async () => {
    const tabs = await page.$$eval('.tab-btn', els => els.map(el => ({
      text: el.textContent.trim(),
      tabIndex: el.tabIndex,
      isActive: el.classList.contains('active')
    })));

    const activeTabs = tabs.filter(t => t.isActive);
    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0].tabIndex).toBe(0);

    const inactiveTabs = tabs.filter(t => !t.isActive);
    for (const t of inactiveTabs) {
      expect(t.tabIndex).toBe(-1);
    }
  }, 15000);

  it('ArrowRight moves focus AND kbd-focus highlight to next tab', async () => {
    // Focus the active (Map) tab
    await page.locator('.tab-btn.active').focus();
    await page.waitForTimeout(100);

    // Press ArrowRight
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    // Check: focused element should be "Results" (or next tab)
    const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(focusedText).toBe('Results');

    // Check: the focused tab should have kbd-focus class
    const hasKbdFocus = await page.evaluate(() => document.activeElement?.classList.contains('kbd-focus'));
    expect(hasKbdFocus).toBe(true);

    // Check: the previous tab (Map) should NOT have kbd-focus
    const mapHasKbdFocus = await page.$eval('.tab-btn.active', el => el.classList.contains('kbd-focus'));
    expect(mapHasKbdFocus).toBe(false);
  }, 15000);

  it('ArrowRight cycles through all tabs to Login and highlights each', async () => {
    await page.locator('.tab-btn.active').focus();
    await page.waitForTimeout(100);

    // Get total tab count
    const tabCount = await page.$$eval('.tab-btn', els => els.length);

    // Arrow through all tabs (skip the first one since we start there)
    for (let i = 1; i < tabCount; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);

      // The focused element should have kbd-focus
      const result = await page.evaluate(() => ({
        text: document.activeElement?.textContent?.trim().substring(0, 20),
        hasKbdFocus: document.activeElement?.classList.contains('kbd-focus'),
      }));
      expect(result.hasKbdFocus).toBe(true);
    }

    // The last tab should be Login (unauthenticated) or account avatar
    const lastText = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(['Login', 'T', '']).toContain(lastText.substring(0, 5));
  }, 30000);

  it('Enter on Login toggles dropdown, focus+highlight STAY on Login', async () => {
    await page.locator('.tab-btn.active').focus();
    await page.waitForTimeout(100);

    // Arrow to the last tab (Login)
    const tabCount = await page.$$eval('.tab-btn', els => els.length);
    for (let i = 1; i < tabCount; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
    }

    // Now on Login — press Enter to open dropdown
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Dropdown should be visible
    const dropdownVisible = await page.locator('.tab-dropdown').isVisible();
    expect(dropdownVisible).toBe(true);

    // Focus should STILL be on the Login button
    const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim().substring(0, 10));
    expect(['Login', 'T']).toContain(focusedText);

    // Login button should still have kbd-focus highlight
    const hasKbdFocus = await page.evaluate(() => document.activeElement?.classList.contains('kbd-focus'));
    expect(hasKbdFocus).toBe(true);

    // Press Enter again to close dropdown
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Dropdown should be gone
    const dropdownGone = await page.locator('.tab-dropdown').count();
    expect(dropdownGone).toBe(0);

    // Focus + highlight still on Login
    const stillFocused = await page.evaluate(() => document.activeElement?.classList.contains('kbd-focus'));
    expect(stillFocused).toBe(true);
  }, 30000);

  it('ArrowDown on Login moves focus into dropdown first item', async () => {
    await page.locator('.tab-btn.active').focus();
    await page.waitForTimeout(100);

    // Arrow to Login
    const tabCount = await page.$$eval('.tab-btn', els => els.length);
    for (let i = 1; i < tabCount; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
    }

    // Open dropdown with Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Now press ArrowDown to enter dropdown
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Focus should be on the first item in the dropdown (a link or button)
    const focusedInDropdown = await page.evaluate(() => {
      const el = document.activeElement;
      const dropdown = el?.closest('.tab-dropdown');
      return {
        isInDropdown: !!dropdown,
        tag: el?.tagName,
        text: el?.textContent?.trim().substring(0, 30)
      };
    });
    expect(focusedInDropdown.isInDropdown).toBe(true);

    // kbd-focus should be cleared from Login button
    const loginStillHighlighted = await page.$$eval('.tab-btn.kbd-focus', els => els.length);
    expect(loginStillHighlighted).toBe(0);
  }, 30000);

  it('Escape from dropdown closes it and returns focus+highlight to Login', async () => {
    await page.locator('.tab-btn.active').focus();
    await page.waitForTimeout(100);

    // Arrow to Login
    const tabCount = await page.$$eval('.tab-btn', els => els.length);
    for (let i = 1; i < tabCount; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
    }

    // Open dropdown and enter it
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Dropdown should be closed
    const dropdownCount = await page.locator('.tab-dropdown').count();
    expect(dropdownCount).toBe(0);

    // Focus should be back on Login button with kbd-focus
    const result = await page.evaluate(() => ({
      text: document.activeElement?.textContent?.trim().substring(0, 10),
      hasKbdFocus: document.activeElement?.classList.contains('kbd-focus'),
    }));
    expect(['Login', 'T']).toContain(result.text);
    expect(result.hasKbdFocus).toBe(true);
  }, 30000);

  it('Enter on a nav tab switches view and clears highlight', async () => {
    await page.locator('.tab-btn.active').focus();
    await page.waitForTimeout(100);

    // Arrow to Results
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    // Press Enter to activate Results tab
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Results should now be the active tab
    const activeText = await page.$eval('.tab-btn.active', el => el.textContent.trim());
    expect(activeText).toBe('Results');

    // kbd-focus should be cleared (focus moved to main content)
    const kbdFocusCount = await page.$$eval('.tab-btn.kbd-focus', els => els.length);
    expect(kbdFocusCount).toBe(0);
  }, 15000);
});
