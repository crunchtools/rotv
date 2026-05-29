import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';
const FALLBACK_IMAGE_PATH = '/brand/rotv-og-share-1200x630.jpg';

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

  it('injects POI og:image for the bare-path permalink', async () => {
    const poi = poiWithPhoto || pois[0];
    const slug = generateSlug(poi.name);
    const res = await request(BASE_URL).get(`/${slug}`).expect(200);

    const ogImages = metaContent(res.text, 'property', 'og:image');
    expect(ogImages.length).toBe(1);
    const [ogUrl] = metaContent(res.text, 'property', 'og:url');
    expect(ogUrl.endsWith(`/${slug}`)).toBe(true);
    if (poiWithPhoto) {
      expect(ogImages[0]).toMatch(new RegExp(`/api/pois/${poiWithPhoto.id}/thumbnail\\?size=large$`));
    }
  }, 15000);

  it('does not hijack reserved single-segment routes', async () => {
    const res = await request(BASE_URL).get('/about').expect(200);
    const [ogUrl] = metaContent(res.text, 'property', 'og:url');
    expect(ogUrl.endsWith('/about')).toBe(false);
  }, 15000);

  it('uses the POI primary photo at size=large when a photo exists', async () => {
    if (!poiWithPhoto) {
      console.warn('[og-share] No POI with a photo in seed — skipping primary-photo assertion');
      return;
    }
    const slug = generateSlug(poiWithPhoto.name);
    const res = await request(BASE_URL).get(`/?poi=${slug}`).expect(200);

    const [ogImage] = metaContent(res.text, 'property', 'og:image');
    const [twitterImage] = metaContent(res.text, 'name', 'twitter:image');

    expect(ogImage).toMatch(new RegExp(`/api/pois/${poiWithPhoto.id}/thumbnail\\?size=large$`));
    expect(twitterImage).toBe(ogImage);
  }, 15000);

  it('falls back to the branded card when a POI has no photo', async () => {
    if (!poiWithoutPhoto) {
      console.warn('[og-share] Every scanned POI has a photo — skipping fallback assertion');
      return;
    }
    const slug = generateSlug(poiWithoutPhoto.name);
    const res = await request(BASE_URL).get(`/?poi=${slug}`).expect(200);

    const ogImages = metaContent(res.text, 'property', 'og:image');
    expect(ogImages.length).toBe(1);
    expect(ogImages[0].endsWith(FALLBACK_IMAGE_PATH)).toBe(true);
  }, 15000);

  it('emits a real share image for a news permalink (source image or POI photo, never brand)', async () => {
    // Priority is source article image -> POI primary photo -> brand fallback
    // (server.js). For a POI that has a photo, the permalink must resolve to one
    // of the first two, never the brand card.
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
    const [twitterImage] = metaContent(res.text, 'name', 'twitter:image');
    expect(ogImages.length).toBe(1);
    expect(ogImages[0].endsWith(FALLBACK_IMAGE_PATH)).toBe(false);
    const isPoiPhoto = new RegExp(`/api/pois/${target.poi.id}/thumbnail\\?size=large$`).test(ogImages[0]);
    const isSourceImage = /^https?:\/\//i.test(ogImages[0]);
    expect(isPoiPhoto || isSourceImage).toBe(true);
    expect(twitterImage).toBe(ogImages[0]);
  }, 60000);
});
