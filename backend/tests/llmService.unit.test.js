import { describe, it, expect, afterEach, vi } from 'vitest';
import { getContainingBoundaries, getReassignmentCandidates } from '../services/geoService.js';
import {
  buildRequestBody, complete, getApiKey, LLM_MODEL, researchLocationMultiPass
} from '../services/llmService.js';

vi.mock('../services/jobLogger.js', () => ({ logInfo: vi.fn(), logError: vi.fn(), flush: vi.fn() }));
vi.mock('../services/geoService.js', () => ({
  getContainingBoundaries: vi.fn().mockResolvedValue(['Garfield Park Reservation', 'Garfield Heights', 'Cuyahoga County']),
  getReassignmentCandidates: vi.fn().mockResolvedValue({
    owner: { id: 5658, name: 'Cleveland Metroparks' },
    boundary: { id: 77, name: 'Garfield Park Reservation' }
  })
}));

const keyPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [{ value: 'sk-or-test' }] }) });

// retry-after: 0 keeps the backoff path instant
const reply = (status, body, headers = { 'retry-after': '0' }) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Headers(headers),
  json: async () => body,
  text: async () => JSON.stringify(body)
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('buildRequestBody', () => {
  it('requires zero data retention and lists a cross-vendor fallback', () => {
    const body = buildRequestBody('hi');
    expect(body.provider).toMatchObject({ zdr: true, data_collection: 'deny' });
    expect(body.models[0]).toBe(LLM_MODEL);
    expect(body.models).toContain('openai/gpt-6-luna');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('maps the Gemini-era options onto OpenRouter fields', () => {
    const body = buildRequestBody('hi', { maxOutputTokens: 64, thinkingBudget: 0, temperature: 0 });
    expect(body.max_tokens).toBe(64);
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect(body.temperature).toBe(0);
  });

  it('turns reasoning off when no budget is given', () => {
    const body = buildRequestBody('hi');
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBe(0.3);
  });

  it('bounds reasoning to a positive thinkingBudget', () => {
    const body = buildRequestBody('hi', { thinkingBudget: 2048, maxOutputTokens: 8192 });
    expect(body.reasoning).toEqual({ max_tokens: 2048 });
    expect(body.max_tokens).toBe(8192);
  });

  it('never leaves reasoning unbounded', () => {
    for (const thinkingBudget of [undefined, 0, -1, 1, 2048]) {
      const { reasoning } = buildRequestBody('hi', { thinkingBudget });
      expect(reasoning.effort === 'none' || reasoning.max_tokens > 0).toBe(true);
    }
  });
});

describe('getApiKey', () => {
  it('prefers the environment over admin_settings', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-env');
    const pool = keyPool();
    expect(await getApiKey(pool)).toBe('sk-or-env');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('reads admin_settings when the environment has no key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(await getApiKey(keyPool())).toBe('sk-or-test');
  });

  it('explains a missing key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(getApiKey(pool)).rejects.toThrow('OpenRouter API key not configured');
  });
});

describe('complete', () => {
  it('returns the first choice and sends the key as a bearer token', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { choices: [{ message: { content: '2026-09-22' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await complete(keyPool(), 'date?')).toBe('2026-09-22');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-test');
  });

  it('retries a 429 and a 200 carrying an upstream error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(429, {}))
      .mockResolvedValueOnce(reply(200, { error: { message: 'provider timeout' } }))
      .mockResolvedValueOnce(reply(200, { choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await complete(keyPool(), 'x')).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('falls back to exponential backoff when Retry-After is absent', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(502, {}, {}))
      .mockResolvedValueOnce(reply(200, { choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = complete(keyPool(), 'x');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe('ok');
    vi.useRealTimers();
  });

  it('honours an HTTP-date Retry-After', async () => {
    vi.useFakeTimers();
    const retryAt = new Date(Date.now() + 5000).toUTCString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(429, {}, { 'retry-after': retryAt }))
      .mockResolvedValueOnce(reply(200, { choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = complete(keyPool(), 'x');
    await vi.advanceTimersByTimeAsync(3500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe('ok');
    vi.useRealTimers();
  });

  it('gives up on a persistent 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(429, {}));
    vi.stubGlobal('fetch', fetchMock);

    await expect(complete(keyPool(), 'x')).rejects.toThrow('OpenRouter returned 429');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('names OpenRouter when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(complete(keyPool(), 'x')).rejects.toThrow('OpenRouter request failed: ECONNRESET');
  });

  it('gives up after five attempts with the last error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { error: { message: 'provider timeout' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(complete(keyPool(), 'x')).rejects.toThrow('provider timeout');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it.each([502, 503])('retries a %i', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(status, {}))
      .mockResolvedValueOnce(reply(200, { choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await complete(keyPool(), 'x')).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a bad key without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(401, { error: { message: 'No auth credentials found' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(complete(keyPool(), 'x')).rejects.toThrow('Invalid OpenRouter API key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast on a non-retryable status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(400, { error: { message: 'bad request' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(complete(keyPool(), 'x')).rejects.toThrow('OpenRouter returned 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('POI research', () => {
  const sentBodies = fetchMock => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
  const jsonReply = fields => reply(200, { choices: [{ message: { content: JSON.stringify(fields) } }] });
  const trail = {
    id: 1045,
    name: 'Meadow Trail',
    poi_roles: ['trail'],
    more_info_link: 'https://www.clevelandmetroparks.com/parks/visit/parks/garfield-park-reservation'
  };

  it('bounds reasoning on both passes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonReply({ brief_description: 'A falls on Brandywine Creek.' }));
    vi.stubGlobal('fetch', fetchMock);

    await researchLocationMultiPass(keyPool(), { name: 'Brandywine Falls' });
    const bodies = sentBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.reasoning).toEqual({ max_tokens: 2048 });
      expect(body.max_tokens).toBe(8192);
      expect(body.temperature).toBe(0);
    }
  });

  it('frames both passes around the POI, with its parent park as context only (#721)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonReply({ brief_description: 'A loop through the meadow.' }));
    vi.stubGlobal('fetch', fetchMock);

    await researchLocationMultiPass(keyPool(), trail);
    const prompts = sentBodies(fetchMock).map(body => body.messages[0].content);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain('Type: trail');
      expect(prompt).toContain('Parent park (context only, not the subject): Garfield Park Reservation');
      expect(prompt).toContain('Located in: Garfield Heights, Cuyahoga County');
      expect(prompt).toContain('Owner/manager: Cleveland Metroparks');
      expect(prompt).toContain('Write about Meadow Trail itself and nothing else.');
      expect(prompt).toContain('Reference page (may describe the parent park rather than this place)');
      expect(prompt).not.toContain('researcher for Cuyahoga Valley National Park');
      expect(prompt).not.toContain('Search the web');
      expect(prompt).not.toContain('%%');
    }
  });

  it('falls back to the editor\'s owner and adds no parent for an unsaved or unplaced POI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonReply({ brief_description: null }));
    vi.stubGlobal('fetch', fetchMock);
    const firstPrompt = () => sentBodies(fetchMock).at(-1).messages[0].content;
    vi.clearAllMocks();

    await researchLocationMultiPass(keyPool(), { name: 'New Overlook', property_owner: 'Private' });
    expect(getReassignmentCandidates).not.toHaveBeenCalled();
    expect(getContainingBoundaries).not.toHaveBeenCalled();
    expect(firstPrompt()).toContain('Owner/manager: Private');
    expect(firstPrompt()).not.toContain('Parent park');

    getReassignmentCandidates.mockResolvedValueOnce({ owner: null, boundary: null });
    getContainingBoundaries.mockResolvedValueOnce([]);
    await researchLocationMultiPass(keyPool(), { id: 9, name: 'New Overlook', property_owner: 'Private' });
    expect(firstPrompt()).toContain('Owner/manager: Private');
    expect(firstPrompt()).not.toContain('Parent park');
    expect(firstPrompt()).not.toContain('Located in');
  });

  it('skips the history pass when pass 1 knows nothing specific to the POI (#721)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonReply({ brief_description: null, pets: 'Leashed', sources: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const research = await researchLocationMultiPass(keyPool(), trail);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(research.brief_description).toBeNull();
    expect(research.historical_description).toBeNull();
    expect(research.pets).toBe('Leashed');
    expect(research.sources).toEqual([]);
  });
});
