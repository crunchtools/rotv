/**
 * Integration test to verify Results tab filter icons match Map legend icons
 *
 * Issue #73: Ensure filter buttons use actual icons instead of letters
 * and that they match the icons shown in the map legend.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

describe('Results Filter Icons Match Legend', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto('http://localhost:8080');
    await page.waitForTimeout(3000);
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should display filter chips with icons instead of letters', async () => {
    await page.click('button:has-text("Results")');
    await page.waitForTimeout(1000);

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
    await page.click('button:has-text("Results")');
    await page.waitForTimeout(500);

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
    await page.click('button:has-text("Results")');
    await page.waitForTimeout(500);

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
    await page.click('button:has-text("Results")');
    await page.waitForTimeout(500);

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
    await page.click('button:has-text("Results")');
    await page.waitForTimeout(500);

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
    await page.click('button:has-text("Results")');
    await page.waitForTimeout(500);

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
