import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildRequestBody, complete, getApiKey, LLM_MODEL, researchLocation, researchLocationMultiPass
} from '../services/llmService.js';

vi.mock('../services/jobLogger.js', () => ({ logInfo: vi.fn(), logError: vi.fn(), flush: vi.fn() }));

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
  const jsonReply = () => reply(200, { choices: [{ message: { content: '{"sources": []}' } }] });

  it('bounds reasoning on single-pass research', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonReply());
    vi.stubGlobal('fetch', fetchMock);

    await researchLocation(keyPool(), { name: 'Brandywine Falls' });
    const [body] = sentBodies(fetchMock);
    expect(body.reasoning).toEqual({ max_tokens: 2048 });
    expect(body.max_tokens).toBe(8192);
    expect(body.temperature).toBe(0);
  });

  it('bounds reasoning on both multi-pass calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonReply());
    vi.stubGlobal('fetch', fetchMock);

    await researchLocationMultiPass(keyPool(), { name: 'Brandywine Falls' });
    const bodies = sentBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.reasoning).toEqual({ max_tokens: 2048 });
      expect(body.max_tokens).toBe(8192);
    }
  });
});
