import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import imageServerClient from '../services/imageServerClient.js';

const SERVER = 'http://images.test';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const textResponse = (body, status, contentType = 'text/plain') =>
  new Response(body, { status, headers: { 'content-type': contentType } });

let fetchMock;
let errorSpy;

beforeEach(() => {
  vi.stubEnv('IMAGE_SERVER_URL', SERVER);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  imageServerClient.initialize();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('fetchOk + guarded: JSON results', () => {
  it('returns the updated asset on 2xx and sends a JSON PUT body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'a1', caption: 'Falls' }));

    const result = await imageServerClient.updateAsset('a1', { caption: 'Falls' });

    expect(result).toEqual({ success: true, asset: { id: 'a1', caption: 'Falls' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SERVER}/api/assets/a1`);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ caption: 'Falls' });
  });

  it('omits body and headers when there is no payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'a2' }));

    await imageServerClient.triggerCaption('a2');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SERVER}/api/assets/a2/caption`);
    expect(init).toEqual({ method: 'POST' });
  });

  it('maps a non-2xx status to {success:false, error:"<label>: <status>"}', async () => {
    fetchMock.mockResolvedValue(textResponse('nope', 404));

    const result = await imageServerClient.updateAsset('a1', {});

    expect(result).toEqual({ success: false, error: 'Update failed: 404' });
    expect(errorSpy).toHaveBeenCalledWith('[ImageServer] Failed to update asset:', expect.any(Error));
  });

  it('maps a network rejection to {success:false, error: message}', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const result = await imageServerClient.triggerCaption('a1');

    expect(result).toEqual({ success: false, error: 'fetch failed' });
  });

  it('maps an unparseable JSON body to {success:false}', async () => {
    fetchMock.mockResolvedValue(textResponse('<html>oops</html>', 200, 'text/html'));

    const result = await imageServerClient.bulkCaption(['a1']);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/JSON/);
  });

  it('bulkCaption returns the server JSON as-is on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queued: 2 }));

    await expect(imageServerClient.bulkCaption(['a', 'b'])).resolves.toEqual({ queued: 2 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ asset_ids: ['a', 'b'] });
  });

  it('deleteAsset returns {success:true} on 2xx and the status on failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(imageServerClient.deleteAsset('a1')).resolves.toEqual({ success: true });
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'DELETE' });

    fetchMock.mockResolvedValueOnce(textResponse('gone', 500));
    await expect(imageServerClient.deleteAsset('a1')).resolves.toEqual({ success: false, error: 'Delete failed: 500' });
  });
});

describe('guarded with a custom fallback: list endpoints', () => {
  it('getPoiAssets returns the parsed list and builds the role filter', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 'p1' }]));

    await expect(imageServerClient.getPoiAssets(9, { role: 'primary' })).resolves.toEqual([{ id: 'p1' }]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER}/api/assets?poi_id=9&role=primary`);
  });

  it.each([
    ['non-2xx', () => fetchMock.mockResolvedValue(textResponse('err', 502))],
    ['network rejection', () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))],
    ['bad JSON', () => fetchMock.mockResolvedValue(textResponse('not json', 200))]
  ])('getPoiAssets and listAllAssets fall back to [] on %s', async (_label, arrange) => {
    arrange();
    await expect(imageServerClient.getPoiAssets(1)).resolves.toEqual([]);
    await expect(imageServerClient.listAllAssets()).resolves.toEqual([]);
  });

  it('getPoiAssets falls back to [] when the server replies with a non-array body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'maintenance' }));
    await expect(imageServerClient.getPoiAssets(1)).resolves.toEqual([]);
    await expect(imageServerClient.getThemeAssets(1)).resolves.toEqual({});
  });

  it('getPrimaryAsset returns null when the lookup fails', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    await expect(imageServerClient.getPrimaryAsset(1)).resolves.toBeNull();
  });
});

describe('fetchOk + guarded: binary results', () => {
  it('fetchDbDump returns the body as a Buffer on 2xx', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const result = await imageServerClient.fetchDbDump();

    expect(result.success).toBe(true);
    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect([...result.data]).toEqual([1, 2, 3]);
  });

  it('fetchDbDump maps non-2xx and network failure to {success:false}', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('x', 503));
    await expect(imageServerClient.fetchDbDump()).resolves.toEqual({ success: false, error: 'DB dump failed: 503' });

    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(imageServerClient.fetchDbDump()).resolves.toEqual({ success: false, error: 'socket hang up' });
  });

  it('fetchMediaFile returns data plus content type, defaulting to octet-stream', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'image/png' } }));
    const png = await imageServerClient.fetchMediaFile('icons', 'a.png');
    expect(png).toEqual({ success: true, data: Buffer.from([9]), contentType: 'image/png' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER}/api/media/icons/a.png`);

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));
    const raw = await imageServerClient.fetchMediaFile('icons', 'b.bin');
    expect(raw.contentType).toBe('application/octet-stream');
  });

  it('fetchMediaFile maps non-2xx to the failure label', async () => {
    fetchMock.mockResolvedValue(textResponse('missing', 404));
    await expect(imageServerClient.fetchMediaFile('icons', 'x.png'))
      .resolves.toEqual({ success: false, error: 'Fetch media failed: 404' });
  });
});

describe('fetchOk includeBody', () => {
  it('restoreDb includes the response body in the error', async () => {
    fetchMock.mockResolvedValue(textResponse('syntax error at line 3', 400));

    const result = await imageServerClient.restoreDb(Buffer.from('SELECT 1;'));

    expect(result).toEqual({ success: false, error: 'DB restore failed: 400 - syntax error at line 3' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SERVER}/api/restore/db`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('restoreDb returns the server output on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: 'RESTORED 12 rows' }));
    await expect(imageServerClient.restoreDb(Buffer.from('x')))
      .resolves.toEqual({ success: true, output: 'RESTORED 12 rows' });
  });

  it('uploadMediaFile reports success and body-bearing failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    await expect(imageServerClient.uploadMediaFile('icons', 'a.png', Buffer.from('x')))
      .resolves.toEqual({ success: true });
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');

    fetchMock.mockResolvedValueOnce(textResponse('too large', 413));
    await expect(imageServerClient.uploadMediaFile('icons', 'a.png', Buffer.from('x')))
      .resolves.toEqual({ success: false, error: 'Upload media failed: 413 - too large' });
  });
});

describe('fetchAssetBinary (asset proxy)', () => {
  it('returns data and upstream content type on 2xx', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([4, 5]), { status: 200, headers: { 'content-type': 'image/webp' } }));

    const result = await imageServerClient.fetchThumbnailData('a1', 'medium');

    expect(result).toEqual({ success: true, data: Buffer.from([4, 5]), contentType: 'image/webp' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER}/api/assets/a1/thumbnail?size=medium`);
  });

  it('defaults content type to image/jpeg and drops unknown sizes', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

    const result = await imageServerClient.fetchThumbnailData('a1', 'huge');

    expect(result.contentType).toBe('image/jpeg');
    expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER}/api/assets/a1/thumbnail`);
  });

  it('passes the upstream status through on non-2xx', async () => {
    fetchMock.mockResolvedValue(textResponse('gone', 404));
    await expect(imageServerClient.fetchAssetData('a1'))
      .resolves.toEqual({ success: false, error: 'Fetch failed: 404', statusCode: 404 });
  });

  it('maps a network failure to statusCode 503', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(imageServerClient.fetchAssetData('a1'))
      .resolves.toEqual({ success: false, error: 'ECONNRESET', statusCode: 503 });
  });
});

describe('unconfigured client', () => {
  it('short-circuits without calling fetch', async () => {
    vi.stubEnv('IMAGE_SERVER_URL', '');
    imageServerClient.initialize();

    await expect(imageServerClient.updateAsset('a1', {})).resolves.toEqual({
      success: false, error: 'Image server not configured or no asset ID'
    });
    await expect(imageServerClient.getPoiAssets(1)).resolves.toEqual([]);
    await expect(imageServerClient.fetchDbDump()).resolves.toEqual({ success: false, error: 'Image server not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
