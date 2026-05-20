/**
 * Integration tests for Open Graph share images.
 *
 * Regression coverage for the bug where sharing a POI/news/event on social media
 * showed no image: the server injected the POI thumbnail *and* left the static
 * logo og:image in place (two og:image tags), and pointed at the default 250x139
 * thumbnail declared as 1200x630 — which Facebook rejects as too small.
 *
 * The fix: emit exactly one og:image, sourced from the POI's primary photo at
 * size=large (1200px), falling back to the branded card only when no photo exists.
 *
 * These tests hit the running container on localhost:8080 against production seed
 * data, which contains POIs both with and without photos.
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';
const FALLBACK_IMAGE_PATH = '/brand/rotv-og-share-1200x630.jpg';

// Must match generateSlug in backend/server.js / frontend/src/utils/slug.js
function generateSlug(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function metaContent(html, attr, value) {
  // Returns all content="" values for <meta {attr}="{value}" content="...">
  const re = new RegExp(`<meta ${attr}="${value}" content="([^"]*)"`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

describe('Open Graph share images', () => {
  let pois = [];
  let poiWithPhoto = null;
  let poiWithoutPhoto = null;

  beforeAll(async () => {
    const res = await request(BASE_URL).get('/api/pois').expect(200);
    pois = Array.isArray(res.body) ? res.body : (res.body.pois || []);

    // Discover one POI with a published photo and one without (bounded scan).
    for (const poi of pois.slice(0, 80)) {
      if (poiWithPhoto && poiWithoutPhoto) break;
      const media = await request(BASE_URL).get(`/api/pois/${poi.id}/media`);
      const hasPhoto = media.status === 200 && Array.isArray(media.body.mosaic) && media.body.mosaic.length > 0;
      if (hasPhoto && !poiWithPhoto) poiWithPhoto = poi;
      if (!hasPhoto && !poiWithoutPhoto) poiWithoutPhoto = poi;
    }
  }, 60000);

  it('emits exactly one og:image for a POI deep link', async () => {
    const poi = poiWithPhoto || pois[0];
    const slug = generateSlug(poi.name);
    const res = await request(BASE_URL).get(`/?poi=${slug}`).expect(200);

    const ogImages = metaContent(res.text, 'property', 'og:image');
    expect(ogImages.length).toBe(1);
  }, 15000);

  it('uses the POI primary photo at size=large when a photo exists', async () => {
    expect(poiWithPhoto, 'seed data must contain at least one POI with a photo').toBeTruthy();
    const slug = generateSlug(poiWithPhoto.name);
    const res = await request(BASE_URL).get(`/?poi=${slug}`).expect(200);

    const [ogImage] = metaContent(res.text, 'property', 'og:image');
    const [twitterImage] = metaContent(res.text, 'name', 'twitter:image');

    expect(ogImage).toMatch(new RegExp(`/api/pois/${poiWithPhoto.id}/thumbnail\\?size=large$`));
    expect(twitterImage).toBe(ogImage); // twitter mirrors og
  }, 15000);

  it('falls back to the branded card when a POI has no photo', async () => {
    expect(poiWithoutPhoto, 'seed data must contain at least one POI without a photo').toBeTruthy();
    const slug = generateSlug(poiWithoutPhoto.name);
    const res = await request(BASE_URL).get(`/?poi=${slug}`).expect(200);

    const ogImages = metaContent(res.text, 'property', 'og:image');
    expect(ogImages.length).toBe(1);
    expect(ogImages[0].endsWith(FALLBACK_IMAGE_PATH)).toBe(true);
  }, 15000);

  it('uses the associated POI photo for a news permalink', async () => {
    // Find a POI that has both a photo and a published news item.
    let target = null;
    for (const poi of (poiWithPhoto ? [poiWithPhoto, ...pois] : pois).slice(0, 80)) {
      const news = await request(BASE_URL).get(`/api/pois/${poi.id}/news`);
      if (news.status === 200 && Array.isArray(news.body) && news.body.length > 0) {
        const media = await request(BASE_URL).get(`/api/pois/${poi.id}/media`);
        const hasPhoto = media.status === 200 && Array.isArray(media.body.mosaic) && media.body.mosaic.length > 0;
        if (hasPhoto) { target = { poi, news: news.body[0] }; break; }
      }
    }

    if (!target) {
      console.warn('[og-share] No POI with both a photo and news in seed — skipping news permalink assertion');
      return;
    }

    const url = `/${generateSlug(target.poi.name)}/news/${generateSlug(target.news.title)}`;
    const res = await request(BASE_URL).get(url).expect(200);

    const ogImages = metaContent(res.text, 'property', 'og:image');
    expect(ogImages.length).toBe(1);
    expect(ogImages[0]).toMatch(new RegExp(`/api/pois/${target.poi.id}/thumbnail\\?size=large$`));
  }, 60000);
});
