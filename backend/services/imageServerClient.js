import { createLogger } from '../utils/logger.js';

const logger = createLogger('ImageServer');

class ImageServerClient {
  constructor() {
    this.serverUrl = null;
    this.initialized = false;
  }

  initialize() {
    this.serverUrl = process.env.IMAGE_SERVER_URL || null;

    this.initialized = !!this.serverUrl;

    if (this.initialized) {
      logger.info(`Initialized with server: ${this.serverUrl}`);
    } else {
      logger.warn('Not configured - set IMAGE_SERVER_URL');
    }

    return this.initialized;
  }

  // Fetch `path` from the image server; a non-2xx response throws
  // "<failureLabel>: <status>" (plus the response body when includeBody is set).
  async fetchOk(path, init, failureLabel, { includeBody = false } = {}) {
    const response = await fetch(`${this.serverUrl}${path}`, init);
    if (!response.ok) {
      const detail = includeBody ? ` - ${await response.text()}` : '';
      throw new Error(`${failureLabel}: ${response.status}${detail}`);
    }
    return response;
  }

  // Send an optional JSON payload and parse the JSON reply.
  async sendJson(path, method, payload, failureLabel) {
    const init = { method };
    if (payload !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(payload);
    }
    const response = await this.fetchOk(path, init, failureLabel);
    return response.json();
  }

  /**
   * Run an image-server call; on failure log it and return onError(error) so
   * callers get a result object instead of an exception.
   *
   * @param {string} failureMessage - Log prefix for the failure.
   * @param {() => Promise<*>} call - The request; its resolved value is returned as-is.
   * @param {(error: Error) => *} [onError] - Builds the fallback result; defaults to
   *   `{ success: false, error: error.message }`.
   * @returns {Promise<*>} The call's result, or onError's. Never rejects.
   */
  async guarded(failureMessage, call, onError = error => ({ success: false, error: error.message })) {
    try {
      return await call();
    } catch (error) {
      logger.error(failureMessage, error);
      return onError(error);
    }
  }

  /**
   * Fetch a binary asset rendition. Non-2xx responses carry the upstream status so
   * the proxy route can pass it through; network failures map to 503.
   *
   * @param {string} path - Image-server path of the rendition (e.g. /api/assets/:id/thumbnail).
   * @param {string} what - Label for log lines ("thumbnail", "original").
   * @returns {Promise<{success: true, data: Buffer, contentType: string} |
   *   {success: false, error: string, statusCode: number}>} Never rejects.
   */
  async fetchAssetBinary(path, what) {
    try {
      const response = await fetch(`${this.serverUrl}${path}`);

      if (!response.ok) {
        return {
          success: false,
          error: `Fetch failed: ${response.status}`,
          statusCode: response.status
        };
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      return {
        success: true,
        data: Buffer.from(buffer),
        contentType
      };
    } catch (error) {
      logger.error(`Failed to fetch ${what}:`, error);
      return {
        success: false,
        error: error.message,
        statusCode: 503
      };
    }
  }

  async testConnection() {
    if (!this.serverUrl) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/health`);
      if (response.ok) {
        const healthStatus = await response.json();
        return { success: true, message: 'Connected to image server', data: healthStatus };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async uploadImage(imageBuffer, poiId, role, filename, mimeType, options = {}) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: mimeType });
      formData.append('file', blob, filename);
      formData.append('poi_id', String(poiId));
      formData.append('role', role);
      if (options.theme) {
        formData.append('theme', options.theme);
      }
      if (options.sortOrder !== undefined) {
        formData.append('sort_order', String(options.sortOrder));
      }

      const response = await fetch(`${this.serverUrl}/api/assets`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const asset = await response.json();
      logger.info(`Uploaded ${role} image for POI ${poiId}: asset ${asset.id}`);

      return { success: true, assetId: asset.id, asset };
    } catch (error) {
      logger.error(`Failed to upload image:`, error);
      return { success: false, error: error.message };
    }
  }

  async uploadVideo(videoBuffer, poiId, filename, mimeType, role = 'gallery') {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const formData = new FormData();
      const blob = new Blob([videoBuffer], { type: mimeType });
      formData.append('file', blob, filename);
      formData.append('poi_id', String(poiId));
      formData.append('role', role);

      const response = await fetch(`${this.serverUrl}/api/assets`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const asset = await response.json();
      logger.info(`Uploaded video for POI ${poiId}: asset ${asset.id}`);

      return { success: true, assetId: asset.id, asset };
    } catch (error) {
      logger.error(`Failed to upload video:`, error);
      return { success: false, error: error.message };
    }
  }

  async fetchAssetData(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }
    return this.fetchAssetBinary(`/api/assets/${assetId}/original`, 'asset data');
  }

  async fetchThumbnailData(assetId, size) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }
    const sizeParam = size && ['small', 'medium', 'large'].includes(size) ? `?size=${size}` : '';
    return this.fetchAssetBinary(`/api/assets/${assetId}/thumbnail${sizeParam}`, 'thumbnail');
  }

  async deleteAsset(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }
    return this.guarded('Failed to delete asset:', async () => {
      await this.fetchOk(`/api/assets/${assetId}`, { method: 'DELETE' }, 'Delete failed');
      logger.info(`Deleted asset: ${assetId}`);
      return { success: true };
    });
  }

  async getPoiAssets(poiId, options = {}) {
    if (!this.initialized) {
      return [];
    }
    let path = `/api/assets?poi_id=${poiId}`;
    if (options.role) {
      path += `&role=${options.role}`;
    }
    return this.guarded('Failed to get POI assets:', async () => {
      const assets = await (await this.fetchOk(path, undefined, 'Fetch failed')).json();
      // Callers iterate the result; a non-array body (error object, proxy page) must not reach them.
      if (!Array.isArray(assets)) throw new Error(`expected an asset array, got ${typeof assets}`);
      return assets;
    }, () => []);
  }

  async getPrimaryAsset(poiId) {
    const assets = await this.getPoiAssets(poiId, { role: 'primary' });
    return assets.length > 0 ? assets[0] : null;
  }

  async getThemeAssets(poiId) {
    const assets = await this.getPoiAssets(poiId, { role: 'theme' });
    const themeMap = {};
    for (const asset of assets) {
      if (asset.theme) {
        themeMap[asset.theme] = asset.id;
      }
    }
    return themeMap;
  }

  async updateAsset(assetId, updates) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }
    return this.guarded('Failed to update asset:', async () =>
      ({ success: true, asset: await this.sendJson(`/api/assets/${assetId}`, 'PUT', updates, 'Update failed') }));
  }

  async triggerCaption(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }
    return this.guarded('Failed to caption asset:', async () =>
      ({ success: true, asset: await this.sendJson(`/api/assets/${assetId}/caption`, 'POST', undefined, 'Caption failed') }));
  }

  async search(query, options = {}) {
    if (!this.initialized) {
      return [];
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          limit: options.limit || 20,
          poi_id: options.poiId,
          role: options.role
        })
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`Search failed:`, error);
      return [];
    }
  }

  async getThemeVideoUrl(themeName) {
    if (!this.initialized) {
      return null;
    }

    return `${this.serverUrl}/api/theme-videos/${themeName}`;
  }

  async fetchThemeVideoData(themeName) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/theme-videos/${themeName}`);

      if (!response.ok) {
        return { success: false, error: `Theme video not found: ${response.status}` };
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'video/mp4';

      return {
        success: true,
        data: Buffer.from(buffer),
        contentType
      };
    } catch (error) {
      logger.error(`Failed to fetch theme video:`, error);
      return { success: false, error: error.message };
    }
  }

  async getPoiMediaWithThemes(poiId) {
    if (!this.initialized) {
      return { photos: [], videos: [], themePrimaries: {} };
    }

    const allAssets = await this.getPoiAssets(poiId);
    const photos = [];
    const videos = [];
    const themePrimaries = {};

    for (const asset of allAssets) {
      const item = {
        assetId: asset.id,
        type: asset.asset_type,
        role: asset.role,
        theme: asset.theme,
        tags: asset.tags || [],
        caption: asset.caption,
        isPrimary: asset.role === 'primary',
        createdAt: asset.created_at,
        originalFileName: asset.original_filename
      };

      if (asset.asset_type === 'video') {
        videos.push(item);
      } else {
        photos.push(item);
      }

      if (asset.role === 'primary') {
        themePrimaries.default = asset.id;
      }
      if (asset.role === 'theme' && asset.theme) {
        themePrimaries[asset.theme] = asset.id;
      }
    }

    photos.sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    return { photos, videos, themePrimaries };
  }

  async listAllAssets() {
    if (!this.initialized) {
      return [];
    }
    return this.guarded('Failed to list all assets:',
      async () => (await this.fetchOk('/api/assets/all', undefined, 'Fetch failed')).json(), () => []);
  }

  async bulkCaption(assetIds) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }
    return this.guarded('Bulk caption failed:',
      () => this.sendJson('/api/bulk/caption', 'POST', { asset_ids: assetIds }, 'Bulk caption failed'));
  }

  async fetchDbDump() {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }
    return this.guarded('Failed to fetch DB dump:', async () => {
      const response = await this.fetchOk('/api/backup/db', undefined, 'DB dump failed');
      return { success: true, data: Buffer.from(await response.arrayBuffer()) };
    });
  }

  async restoreDb(sqlBuffer) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }
    return this.guarded('Failed to restore DB:', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([sqlBuffer], { type: 'application/sql' }), 'restore.sql');
      const response = await this.fetchOk('/api/restore/db', { method: 'POST', body: formData },
        'DB restore failed', { includeBody: true });
      const restoreResponse = await response.json();
      return { success: true, output: restoreResponse.output };
    });
  }

  async listMediaFiles() {
    if (!this.initialized) {
      throw new Error('Image server not configured');
    }

    const response = await fetch(`${this.serverUrl}/api/media/files`);
    if (!response.ok) {
      throw new Error(`List media failed: ${response.status}`);
    }

    const mediaFiles = await response.json();
    if (!Array.isArray(mediaFiles)) {
      throw new Error('Image server returned invalid media file list (expected array)');
    }
    return mediaFiles;
  }

  async fetchMediaFile(subdir, filename) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }
    return this.guarded(`Failed to fetch media ${subdir}/${filename}:`, async () => {
      const response = await this.fetchOk(`/api/media/${subdir}/${filename}`, undefined, 'Fetch media failed');
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      return { success: true, data: Buffer.from(await response.arrayBuffer()), contentType };
    });
  }

  async uploadMediaFile(subdir, filename, buffer) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }
    return this.guarded(`Failed to upload media ${subdir}/${filename}:`, async () => {
      const formData = new FormData();
      formData.append('file', new Blob([buffer], { type: 'application/octet-stream' }), filename);
      await this.fetchOk(`/api/media/${subdir}/${filename}`, { method: 'PUT', body: formData },
        'Upload media failed', { includeBody: true });
      return { success: true };
    });
  }

}

export default new ImageServerClient();
