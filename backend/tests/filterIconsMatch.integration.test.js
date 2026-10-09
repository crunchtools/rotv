/**
 * Integration test to verify Find tab filter icons match Map legend icons
 *
 * Issue #73: Ensure filter buttons use actual icons instead of letters
 * and that they match the icons shown in the map legend.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

// The type chips live behind the Filters button in the Find tab (spec 048).
async function openFindFilters(page) {
  await page.click('[data-nav="find"]');
  await page.waitForSelector('.filter-sheet-btn', { timeout: 10000 });
  if (!(await page.$('.filter-sheet'))) await page.click('.filter-sheet-btn');
  await page.waitForSelector('.filter-sheet .type-filter-chip', { timeout: 5000 });
}

describe('Find Filter Icons Match Legend', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    // Dismiss tour prompt so the overlay stops intercepting pointer events
    await page.addInitScript(() => {
      localStorage.setItem('rotv-tour-seen', 'true');
    });
    await page.goto('http://localhost:8080');
    await page.waitForTimeout(3000);
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should display filter chips with icons instead of letters', async () => {
    await openFindFilters(page);

    const filterChips = await page.$$('.results-type-filters .type-filter-chip');
    expect(filterChips.length).toBeGreaterThan(0);

    for (const chip of filterChips) {
      const img = await chip.$('img.type-filter-icon');
      const span = await chip.$('span.type-filter-icon');

      expect(img).toBeTruthy();
      expect(span).toBeNull();

      if (img) {
        const src = await img.getAttribute('src');
        expect(src).toBeTruthy();
        expect(src).toMatch(/^\/(?:icons|api\/icons)\//);
      }
    }
  });

  it('should have Trails filter with layer icon', async () => {
    await openFindFilters(page);

    const trailChip = await page.$('.type-filter-chip.trails');
    expect(trailChip).toBeTruthy();

    const text = await trailChip.innerText();
    expect(text.trim()).toBe('Trails');

    const img = await trailChip.$('img.type-filter-icon');
    expect(img).toBeTruthy();

    const src = await img.getAttribute('src');
    expect(src).toBe('/icons/layers/trails.svg');
  });

  it('should have Rivers filter with layer icon', async () => {
    await openFindFilters(page);

    const riverChip = await page.$('.type-filter-chip.rivers');
    expect(riverChip).toBeTruthy();

    const text = await riverChip.innerText();
    expect(text.trim()).toBe('Rivers');

    const img = await riverChip.$('img.type-filter-icon');
    expect(img).toBeTruthy();

    const src = await img.getAttribute('src');
    expect(src).toBe('/icons/layers/rivers.svg');
  });

  it('should have Boundaries filter with layer icon', async () => {
    await openFindFilters(page);

    const boundaryChip = await page.$('.type-filter-chip.boundaries');
    expect(boundaryChip).toBeTruthy();

    const text = await boundaryChip.innerText();
    expect(text.trim()).toBe('Boundaries');

    const img = await boundaryChip.$('img.type-filter-icon');
    expect(img).toBeTruthy();

    const src = await img.getAttribute('src');
    expect(src).toBe('/icons/layers/boundaries.svg');
  });

  it('should use layer icon paths matching map legend convention', async () => {
    await openFindFilters(page);

    const trailFilterImg = await page.$('.type-filter-chip.trails img.type-filter-icon');
    const trailFilterSrc = await trailFilterImg.getAttribute('src');

    const riverFilterImg = await page.$('.type-filter-chip.rivers img.type-filter-icon');
    const riverFilterSrc = await riverFilterImg.getAttribute('src');

    const boundaryFilterImg = await page.$('.type-filter-chip.boundaries img.type-filter-icon');
    const boundaryFilterSrc = await boundaryFilterImg.getAttribute('src');

    expect(trailFilterSrc).toBe('/icons/layers/trails.svg');
    expect(riverFilterSrc).toBe('/icons/layers/rivers.svg');
    expect(boundaryFilterSrc).toBe('/icons/layers/boundaries.svg');
  });

  it('should NOT have letter badges in filter chips', async () => {
    await openFindFilters(page);

    const filterChips = await page.$$('.results-type-filters .type-filter-chip');

    for (const chip of filterChips) {
      const html = await chip.innerHTML();

      expect(html).not.toContain('<span class="type-filter-icon">D</span>');
      expect(html).not.toContain('<span class="type-filter-icon">T</span>');
      expect(html).not.toContain('<span class="type-filter-icon">R</span>');
      expect(html).not.toContain('<span class="type-filter-icon">B</span>');
    }
  });
});
