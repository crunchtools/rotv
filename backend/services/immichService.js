import NodeCache from 'node-cache';

const urlCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

class ImmichService {
  constructor() {
    this.serverUrl = null;
    this.apiKey = null;
    this.albumId = null;
    this.initialized = false;
  }

  initialize() {
    this.serverUrl = process.env.IMMICH_SERVER_URL || null;
    this.apiKey = process.env.IMMICH_API_KEY || null;
    this.albumId = process.env.IMMICH_ALBUM_ID || null;

    this.initialized = !!(this.serverUrl && this.apiKey && this.albumId);

    if (this.initialized) {
      console.log(`[Immich] Initialized with server: ${this.serverUrl}, album: ${this.albumId}`);
    } else {
      console.warn('[Immich] Not configured - set IMMICH_SERVER_URL, IMMICH_API_KEY, and IMMICH_ALBUM_ID');
    }

    return this.initialized;
  }

  async getThemeVideoUrl(themeName) {
    if (!this.initialized) {
      return null;
    }

    const cacheKey = `video:${themeName}`;
    const cachedUrl = urlCache.get(cacheKey);
    if (cachedUrl) {
      console.log(`[Immich] Cache hit for ${themeName}`);
      return cachedUrl;
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/albums/${this.albumId}`, {
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Immich API error: ${response.status}`);
      }

      const album = await response.json();
      const asset = album.assets.find(a =>
        a.originalFileName.toLowerCase() === `${themeName.toLowerCase()}.mp4`
      );

      if (!asset) {
        console.warn(`[Immich] No asset found for theme: ${themeName}`);
        return null;
      }

      const downloadUrl = `${this.serverUrl}/api/assets/${asset.id}/original?key=${this.apiKey}`;
      urlCache.set(cacheKey, downloadUrl);
      console.log(`[Immich] Generated URL for ${themeName}, cached for 1 hour`);

      return downloadUrl;
    } catch (error) {
      console.error(`[Immich] Failed to get video URL for ${themeName}:`, error);
      return null;
    }
  }

  async testConnection() {
    if (!this.serverUrl || !this.apiKey) {
      return { success: false, error: 'Immich not configured' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/server/ping`, {
        headers: { 'x-api-key': this.apiKey }
      });

      if (response.ok) {
        const pingResponse = await response.json();
        return { success: true, message: 'Connected to Immich', data: pingResponse };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the original image URL for a POI asset
   * @param {string} assetId - Immich asset ID
   * @returns {string|null} - Direct URL to original image
   */
  async getPoiImageUrl(assetId) {
    if (!this.initialized || !assetId) {
      return null;
    }

    const cacheKey = `poi:${assetId}`;
    const cachedUrl = urlCache.get(cacheKey);
    if (cachedUrl) {
      return cachedUrl;
    }

    const url = `${this.serverUrl}/api/assets/${assetId}/original`;
    urlCache.set(cacheKey, url);
    return url;
  }

  /**
   * Get a thumbnail URL for a POI asset
   * @param {string} assetId - Immich asset ID
   * @param {string} size - 'thumbnail' (250px) or 'preview' (1440px)
   * @returns {string|null} - URL to thumbnail
   */
  async getThumbnailUrl(assetId, size = 'thumbnail') {
    if (!this.initialized || !assetId) {
      return null;
    }

    const immichSize = size === 'small' ? 'thumbnail' : 'preview';
    return `${this.serverUrl}/api/assets/${assetId}/${immichSize}`;
  }

  /**
   * Upload a POI image to Immich
   * @param {Buffer} imageBuffer - Image data
   * @param {number} poiId - POI database ID
   * @param {string} filename - Original filename
   * @param {string} mimeType - MIME type (image/jpeg, image/png, etc.)
   * @returns {Object} - { success, assetId, error }
   */
  async uploadPoiImage(imageBuffer, poiId, filename, mimeType) {
    if (!this.initialized) {
      return { success: false, error: 'Immich not configured' };
    }

    try {
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: mimeType });
      formData.append('assetData', blob, filename);
      formData.append('deviceAssetId', `poi-${poiId}-${Date.now()}`);
      formData.append('deviceId', 'rotv-backend');
      formData.append('fileCreatedAt', new Date().toISOString());
      formData.append('fileModifiedAt', new Date().toISOString());

      const response = await fetch(`${this.serverUrl}/api/assets`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey
        },
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const asset = await response.json();
      console.log(`[Immich] Uploaded POI image for POI ${poiId}: ${asset.id}`);

      await this.addAssetToAlbum(asset.id, this.albumId);

      await this.tagAsset(asset.id, [`poi_${poiId}`, 'type_primary']);

      return { success: true, assetId: asset.id };
    } catch (error) {
      console.error(`[Immich] Failed to upload POI image:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add an asset to an album
   * @param {string} assetId - Immich asset ID
   * @param {string} albumId - Immich album ID
   */
  async addAssetToAlbum(assetId, albumId) {
    try {
      const response = await fetch(`${this.serverUrl}/api/albums/${albumId}/assets`, {
        method: 'PUT',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: [assetId] })
      });

      if (!response.ok) {
        console.warn(`[Immich] Failed to add asset to album: ${response.status}`);
      }
    } catch (error) {
      console.warn(`[Immich] Failed to add asset to album:`, error.message);
    }
  }

  /**
   * Tag an asset with labels (stores in description field)
   * @param {string} assetId - Immich asset ID
   * @param {string[]} tags - Array of tag names
   */
  async tagAsset(assetId, tags) {
    try {
      const response = await fetch(`${this.serverUrl}/api/assets/${assetId}`, {
        method: 'PUT',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: tags.join(', ')
        })
      });

      if (!response.ok) {
        console.warn(`[Immich] Failed to tag asset: ${response.status}`);
      }
    } catch (error) {
      console.warn(`[Immich] Failed to tag asset:`, error.message);
    }
  }

  /**
   * Delete an asset from Immich
   * @param {string} assetId - Immich asset ID
   * @returns {Object} - { success, error }
   */
  async deleteAsset(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Immich not configured or no asset ID' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets`, {
        method: 'DELETE',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: [assetId] })
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }

      urlCache.del(`poi:${assetId}`);
      console.log(`[Immich] Deleted asset: ${assetId}`);

      return { success: true };
    } catch (error) {
      console.error(`[Immich] Failed to delete asset:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch an asset's original image data (for proxying)
   * @param {string} assetId - Immich asset ID
   * @returns {Object} - { success, data, contentType, error }
   */
  async fetchAssetData(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Immich not configured or no asset ID' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets/${assetId}/original`, {
        headers: {
          'x-api-key': this.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }

      const imageBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      return {
        success: true,
        data: Buffer.from(imageBuffer),
        contentType
      };
    } catch (error) {
      console.error(`[Immich] Failed to fetch asset data:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch a thumbnail for an asset (for proxying)
   * @param {string} assetId - Immich asset ID
   * @param {string} size - 'thumbnail' or 'preview'
   * @returns {Object} - { success, data, contentType, error }
   */
  async fetchThumbnailData(assetId, size = 'thumbnail') {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Immich not configured or no asset ID' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets/${assetId}/${size}`, {
        headers: {
          'x-api-key': this.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }

      const thumbnailBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      return {
        success: true,
        data: Buffer.from(thumbnailBuffer),
        contentType
      };
    } catch (error) {
      console.error(`[Immich] Failed to fetch thumbnail:`, error);
      return { success: false, error: error.message };
    }
  }
}

export default new ImmichService();
