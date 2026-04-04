/**
 * Image Server Client
 *
 * Talks to the purpose-built image server at images.rootsofthevalley.org.
 * No API key needed — image server is internal.
 */

class ImageServerClient {
  constructor() {
    this.serverUrl = null;
    this.initialized = false;
  }

  initialize() {
    this.serverUrl = process.env.IMAGE_SERVER_URL || null;

    this.initialized = !!this.serverUrl;

    if (this.initialized) {
      console.log(`[ImageServer] Initialized with server: ${this.serverUrl}`);
    } else {
      console.warn('[ImageServer] Not configured - set IMAGE_SERVER_URL');
    }

    return this.initialized;
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

  /**
   * Upload an image to the image server
   * @param {Buffer} imageBuffer - Image data
   * @param {number} poiId - POI database ID
   * @param {string} role - 'primary' | 'gallery' | 'theme'
   * @param {string} filename - Original filename
   * @param {string} mimeType - MIME type
   * @param {Object} options - { theme, sortOrder }
   * @returns {Object} - { success, assetId, asset, error }
   */
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
      console.log(`[ImageServer] Uploaded ${role} image for POI ${poiId}: asset ${asset.id}`);

      return { success: true, assetId: asset.id, asset };
    } catch (error) {
      console.error(`[ImageServer] Failed to upload image:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Upload a video to the image server
   */
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
      console.log(`[ImageServer] Uploaded video for POI ${poiId}: asset ${asset.id}`);

      return { success: true, assetId: asset.id, asset };
    } catch (error) {
      console.error(`[ImageServer] Failed to upload video:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch original image/video data (for proxying to frontend)
   */
  async fetchAssetData(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets/${assetId}/original`);

      if (!response.ok) {
        // Fix: Return detailed error status for better error handling (Gemini review)
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
      console.error(`[ImageServer] Failed to fetch asset data:`, error);
      // Network/timeout errors -> 503 Service Unavailable
      return {
        success: false,
        error: error.message,
        statusCode: 503
      };
    }
  }

  /**
   * Fetch thumbnail data (for proxying to frontend)
   */
  async fetchThumbnailData(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets/${assetId}/thumbnail`);

      if (!response.ok) {
        // Fix: Return detailed error status for better error handling (Gemini review)
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
      console.error(`[ImageServer] Failed to fetch thumbnail:`, error);
      // Network/timeout errors -> 503 Service Unavailable
      return {
        success: false,
        error: error.message,
        statusCode: 503
      };
    }
  }

  /**
   * Delete an asset
   */
  async deleteAsset(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets/${assetId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }

      console.log(`[ImageServer] Deleted asset: ${assetId}`);
      return { success: true };
    } catch (error) {
      console.error(`[ImageServer] Failed to delete asset:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all assets for a POI
   */
  async getPoiAssets(poiId, options = {}) {
    if (!this.initialized) {
      return [];
    }

    try {
      let url = `${this.serverUrl}/api/assets?poi_id=${poiId}`;
      if (options.role) {
        url += `&role=${options.role}`;
      }

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[ImageServer] Failed to get POI assets:`, error);
      return [];
    }
  }

  /**
   * Get the primary asset for a POI
   * @returns {Object|null} - Asset object or null
   */
  async getPrimaryAsset(poiId) {
    const assets = await this.getPoiAssets(poiId, { role: 'primary' });
    return assets.length > 0 ? assets[0] : null;
  }

  /**
   * Get theme assets for a POI
   * @returns {Object} - { theme: assetId, ... }
   */
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

  /**
   * Update asset metadata
   */
  async updateAsset(assetId, updates) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets/${assetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.status}`);
      }

      const asset = await response.json();
      return { success: true, asset };
    } catch (error) {
      console.error(`[ImageServer] Failed to update asset:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger AI captioning for an asset
   */
  async triggerCaption(assetId) {
    if (!this.initialized || !assetId) {
      return { success: false, error: 'Image server not configured or no asset ID' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets/${assetId}/caption`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`Caption failed: ${response.status}`);
      }

      const asset = await response.json();
      return { success: true, asset };
    } catch (error) {
      console.error(`[ImageServer] Failed to caption asset:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Semantic search for assets
   */
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
      console.error(`[ImageServer] Search failed:`, error);
      return [];
    }
  }

  /**
   * Get theme video URL (proxied through ROTV)
   */
  async getThemeVideoUrl(themeName) {
    if (!this.initialized) {
      return null;
    }

    return `${this.serverUrl}/api/theme-videos/${themeName}`;
  }

  /**
   * Fetch theme video data (for proxying)
   */
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
      console.error(`[ImageServer] Failed to fetch theme video:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get structured media data for a POI (photos + videos with roles)
   */
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

  /**
   * List all assets on the image server
   */
  async listAllAssets() {
    if (!this.initialized) {
      return [];
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/assets/all`);

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[ImageServer] Failed to list all assets:`, error);
      return [];
    }
  }

  /**
   * Bulk caption multiple assets
   */
  async bulkCaption(assetIds) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/bulk/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_ids: assetIds })
      });

      if (!response.ok) {
        throw new Error(`Bulk caption failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[ImageServer] Bulk caption failed:`, error);
      return { success: false, error: error.message };
    }
  }

  // -------------------------------------------------------------------
  // Backup / Restore / Media endpoints
  // -------------------------------------------------------------------

  /**
   * Fetch a pg_dump of the image server database
   * @returns {{ success: boolean, data?: Buffer, error?: string }}
   */
  async fetchDbDump() {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/backup/db`);
      if (!response.ok) {
        throw new Error(`DB dump failed: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      return { success: true, data: Buffer.from(buffer) };
    } catch (error) {
      console.error('[ImageServer] Failed to fetch DB dump:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Restore the image server database from a SQL dump
   * @param {Buffer} sqlBuffer - SQL dump data
   * @returns {{ success: boolean, output?: string, error?: string }}
   */
  async restoreDb(sqlBuffer) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const formData = new FormData();
      const blob = new Blob([sqlBuffer], { type: 'application/sql' });
      formData.append('file', blob, 'restore.sql');

      const response = await fetch(`${this.serverUrl}/api/restore/db`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DB restore failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      return { success: true, output: result.output };
    } catch (error) {
      console.error('[ImageServer] Failed to restore DB:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * List all media files on the image server.
   * Throws on error so callers (backup job) can detect failures.
   * @returns {Array<{ subdir: string, filename: string, size: number, modified: number }>}
   */
  async listMediaFiles() {
    if (!this.initialized) {
      throw new Error('Image server not configured');
    }

    const response = await fetch(`${this.serverUrl}/api/media/files`);
    if (!response.ok) {
      throw new Error(`List media failed: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Image server returned invalid media file list (expected array)');
    }
    return data;
  }

  /**
   * Fetch a specific media file from the image server
   * @param {string} subdir - Subdirectory (originals, thumbnails, videos, theme-videos)
   * @param {string} filename - Filename
   * @returns {{ success: boolean, data?: Buffer, contentType?: string, error?: string }}
   */
  async fetchMediaFile(subdir, filename) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/media/${subdir}/${filename}`);
      if (!response.ok) {
        throw new Error(`Fetch media failed: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'application/octet-stream';

      return { success: true, data: Buffer.from(buffer), contentType };
    } catch (error) {
      console.error(`[ImageServer] Failed to fetch media ${subdir}/${filename}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Upload a media file to the image server (for restore)
   * @param {string} subdir - Subdirectory
   * @param {string} filename - Filename
   * @param {Buffer} buffer - File data
   * @returns {{ success: boolean, error?: string }}
   */
  async uploadMediaFile(subdir, filename, buffer) {
    if (!this.initialized) {
      return { success: false, error: 'Image server not configured' };
    }

    try {
      const formData = new FormData();
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      formData.append('file', blob, filename);

      const response = await fetch(`${this.serverUrl}/api/media/${subdir}/${filename}`, {
        method: 'PUT',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload media failed: ${response.status} - ${errorText}`);
      }

      return { success: true };
    } catch (error) {
      console.error(`[ImageServer] Failed to upload media ${subdir}/${filename}:`, error);
      return { success: false, error: error.message };
    }
  }
}

export default new ImageServerClient();
