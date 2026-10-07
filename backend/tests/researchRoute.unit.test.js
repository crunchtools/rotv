import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/researchSources.js', () => ({ gatherResearchSources: vi.fn() }));
vi.mock('../services/llmService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  researchLocationMultiPass: vi.fn()
}));

const { gatherResearchSources } = await import('../services/researchSources.js');
const { researchLocationMultiPass } = await import('../services/llmService.js');
const { createAdminRouter } = await import('../routes/admin.js');

const pool = {
  query: vi.fn(async (sql) => {
    if (sql.includes('FROM activities')) return { rows: [{ name: 'Hiking' }] };
    if (sql.includes('FROM eras')) return { rows: [{ id: 3, name: 'Canal Era' }] };
    if (sql.includes('FROM surfaces')) return { rows: [{ name: 'Paved' }] };
    return { rows: [] };
  })
};

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.isAuthenticated = () => true;
  req.user = { id: 7, email: 'admin@rotv.local', is_admin: true };
  next();
});
app.use('/api/admin', createAdminRouter(pool, () => {}));

const park = { id: 5508, name: 'Cascade Locks Park', more_info_link: 'https://www.cascadelocks.org/park' };
const gathered = {
  query: '"Cascade Locks Park" Akron',
  sources: [{ n: 1, url: park.more_info_link, title: 'Cascade Locks Park', text: 'Locks 10 through 16.', origin: 'reference', cached: false }],
  unreachable: []
};

beforeEach(() => {
  gatherResearchSources.mockReset().mockResolvedValue(gathered);
  researchLocationMultiPass.mockReset().mockResolvedValue({
    brief_description: 'Locks 10 through 16 of the Ohio & Erie Canal.', sources: [park.more_info_link]
  });
});

describe('POST /ai/research-v2', () => {
  it('gathers pages for the editor\'s POI and drafts from them (#724)', async () => {
    const res = await request(app).post('/api/admin/ai/research-v2')
      .send({ destination: park, adminContext: 'the Akron one' })
      .expect(200);

    const researched = { ...park, research_context: 'the Akron one' };
    expect(gatherResearchSources).toHaveBeenCalledWith(pool, researched);
    expect(researchLocationMultiPass).toHaveBeenCalledWith(pool, researched, ['Hiking'], ['Canal Era'], ['Paved'], gathered);
    expect(res.body).toEqual({
      draft: true,
      data: { brief_description: 'Locks 10 through 16 of the Ohio & Erie Canal.', sources: [park.more_info_link] },
      destination_id: 5508
    });
  });

  it('answers 400 and drafts nothing when the Serper key is missing', async () => {
    gatherResearchSources.mockRejectedValue(new Error('Serper API key not configured. Please add your API key in Settings → Data Collection.'));

    const res = await request(app).post('/api/admin/ai/research-v2').send({ destination: park }).expect(400);

    expect(res.body.error).toContain('Serper API key not configured');
    expect(researchLocationMultiPass).not.toHaveBeenCalled();
  });

  it('requires a named destination', async () => {
    await request(app).post('/api/admin/ai/research-v2').send({ destination: {} }).expect(400);
    expect(gatherResearchSources).not.toHaveBeenCalled();
  });
});
