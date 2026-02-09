import NodeCache from 'node-cache';

// 1-hour URL cache (3600 seconds)
const urlCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

class ImmichService {
  constructor() {
    this.serverUrl = null;
    this.apiKey = null;
    this.albumId = null;
    this.initialized = false;
  }

  async initialize(pool) {
    try {
      const result = await pool.query(
        `SELECT key, value FROM admin_settings
         WHERE key IN ('immich_server_url', 'immich_api_key', 'immich_album_id')`
      );

      const settings = {};
      result.rows.forEach(row => {
        settings[row.key] = row.value;
      });

      this.serverUrl = process.env.IMMICH_SERVER_URL || settings.immich_server_url || null;
      this.apiKey = process.env.IMMICH_API_KEY || settings.immich_api_key || null;
      this.albumId = process.env.IMMICH_ALBUM_ID || settings.immich_album_id || null;

      this.initialized = !!(this.serverUrl && this.apiKey && this.albumId);

      if (this.initialized) {
        console.log(`[Immich] Initialized with server: ${this.serverUrl}`);
      } else {
        console.warn('[Immich] Not configured - using fallback static videos');
      }

      return this.initialized;
    } catch (error) {
      console.error('[Immich] Initialization failed:', error);
      this.initialized = false;
      return false;
    }
  }

  async getThemeVideoUrl(themeName) {
    if (!this.initialized) {
      return null; // Triggers fallback to static video
    }

    // Check cache first
    const cacheKey = `video:${themeName}`;
    const cachedUrl = urlCache.get(cacheKey);
    if (cachedUrl) {
      console.log(`[Immich] Cache hit for ${themeName}`);
      return cachedUrl;
    }

    try {
      // Get album assets
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

      // Find asset matching theme name (e.g., "christmas.mp4")
      const asset = album.assets.find(a =>
        a.originalFileName.toLowerCase() === `${themeName.toLowerCase()}.mp4`
      );

      if (!asset) {
        console.warn(`[Immich] No asset found for theme: ${themeName}`);
        return null;
      }

      // Generate download URL
      const downloadUrl = `${this.serverUrl}/api/assets/${asset.id}/original?key=${this.apiKey}`;

      // Cache for 1 hour
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
        const data = await response.json();
        return { success: true, message: 'Connected to Immich', data };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default new ImmichService();
