import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAdmin, isAuthenticated } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  createDriveService,
  createDriveServiceWithRefresh,
  ensureDriveFolders,
  uploadIconToDrive,
  downloadFileFromDrive,
  deleteFileFromDrive,
  getDriveFolderLink,
  getDriveImageUrl,
  countDriveFiles,
  getAllDriveSettings,
  getDriveSetting,
  setDriveSetting
} from '../services/driveImageService.js';
import {
  runNewsCollection,
  runBatchNewsCollection,
  createNewsCollectionJob,
  getAllPoisForCollection,
  getPoisForTierCollection,
  getNewsForPoi,
  getEventsForPoi,
  getRecentNews,
  getUpcomingEvents,
  getLatestJobStatus,
  getJobStatus,
  collectPoi,
  saveNewsItems,
  saveEventItems,
  buildDomainOwnershipMap,
  getCollectionProgress,
  clearProgress,
  updateProgress,
  requestCancellation,
  getAllActiveProgress,
  getDisplaySlots as getNewsDisplaySlots
} from '../services/newsService.js';
import { submitBatchNewsJob, getJobScheduler, JOB_NAMES, updateSchedule } from '../services/jobScheduler.js';
import {
  getQueue as getModerationQueue,
  getPendingCount as getModerationPendingCount,
  getItemDetail as getModerationItemDetail,
  approveItem,
  rejectItem,
  bulkApprove,
  bulkReject,
  editAndPublish,
  requeueItem,
  fixDate,
  createItem,
  processItem,
  mergeItems,
  getMergeCandidates,
  addItemUrl,
  removeItemUrl
} from '../services/moderationService.js';
import { getJobStats, resetJobUsage } from '../services/newsService.js';
import {
  collectTrailStatus,
  runTrailStatusCollection,
  getJobStatus as getTrailJobStatus,
  cancelJob as cancelTrailJob,
  getLatestTrailStatus,
  getCollectionProgress as getTrailProgress,
  clearProgress as clearTrailProgress,
  getDisplaySlots as getTrailDisplaySlots
} from '../services/trailStatusService.js';
import imageServerClient from '../services/imageServerClient.js';
import { logInfo, logError, flush as flushJobLogs } from '../services/jobLogger.js';

const router = express.Router();

export function createAdminRouter(pool, invalidateMosaicCache) {
  router.put('/pois/:id/coordinates', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid coordinate values' });
    }

    if (lat < 40.5 || lat > 42.0 || lng < -82.5 || lng > -80.5) {
      return res.status(400).json({ error: 'Coordinates outside valid range for Cuyahoga Valley area' });
    }

    try {
      const poiRow = await pool.query(
        `UPDATE pois
         SET latitude = $1, longitude = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [lat, lng, id]
      );

      if (poiRow.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      console.log(`Admin ${req.user.email} updated coordinates for POI ${id}: ${lat}, ${lng}`);
      res.json(poiRow.rows[0]);
    } catch (error) {
      console.error('Error updating coordinates:', error);
      res.status(500).json({ error: 'Failed to update coordinates' });
    }
  });

  router.put('/destinations/:id/coordinates', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid coordinate values' });
    }

    if (lat < 40.5 || lat > 42.0 || lng < -82.5 || lng > -80.5) {
      return res.status(400).json({ error: 'Coordinates outside valid range for Cuyahoga Valley area' });
    }

    try {
      const destinationRow = await pool.query(
        `UPDATE pois
         SET latitude = $1, longitude = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [lat, lng, id]
      );

      if (destinationRow.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      console.log(`Admin ${req.user.email} updated coordinates for destination ${id}: ${lat}, ${lng}`);
      res.json(destinationRow.rows[0]);
    } catch (error) {
      console.error('Error updating coordinates:', error);
      res.status(500).json({ error: 'Failed to update coordinates' });
    }
  });

  router.put('/pois/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const allowedFields = [
      'name', 'poi_roles', 'latitude', 'longitude', 'geometry', 'geometry_drive_file_id',
      'navigation_latitude', 'navigation_longitude',
      'property_owner', 'owner_id', 'brief_description', 'era_id', 'historical_description',
      'primary_activities', 'surface', 'pets', 'cell_signal', 'more_info_link',
      'events_url', 'news_url', 'research_context',
      'length_miles', 'difficulty', 'boundary_type', 'boundary_color',
      'collection_tier', 'news_score_threshold', 'events_score_threshold'
    ];
    const updates = {};
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = `$${paramIndex}`;
        if (field === 'geometry' && typeof req.body[field] === 'object') {
          values.push(JSON.stringify(req.body[field]));
        } else {
          values.push(req.body[field]);
        }
        paramIndex++;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClause = Object.entries(updates)
      .map(([field, param]) => `${field} = ${param}`)
      .join(', ');

    values.push(id);

    try {
      const poiRow = await pool.query(
        `UPDATE pois
         SET ${setClause}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (poiRow.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      console.log(`Admin ${req.user.email} updated POI ${id}:`, Object.keys(updates).join(', '));
      res.json(poiRow.rows[0]);
    } catch (error) {
      console.error('Error updating POI:', error);
      res.status(500).json({ error: 'Failed to update POI' });
    }
  });

  router.put('/destinations/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const allowedFields = [
      'name', 'latitude', 'longitude', 'navigation_latitude', 'navigation_longitude',
      'property_owner', 'owner_id', 'brief_description',
      'era', 'era_id', 'historical_description', 'primary_activities', 'surface',
      'pets', 'cell_signal', 'more_info_link', 'events_url', 'news_url', 'research_context', 'status_url',
      'collection_tier', 'news_score_threshold', 'events_score_threshold'
    ];
    const updates = {};
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = `$${paramIndex}`;
        values.push(req.body[field]);
        paramIndex++;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClause = Object.entries(updates)
      .map(([field, param]) => `${field} = ${param}`)
      .join(', ');

    values.push(id);

    try {
      const destinationRow = await pool.query(
        `UPDATE pois
         SET ${setClause}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (destinationRow.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      console.log(`Admin ${req.user.email} updated destination ${id}:`, Object.keys(updates).join(', '));
      res.json(destinationRow.rows[0]);
    } catch (error) {
      console.error('Error updating destination:', error);
      res.status(500).json({ error: 'Failed to update destination' });
    }
  });

  router.post('/destinations', isAdmin, async (req, res) => {
    const { name, latitude, longitude } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid coordinate values' });
    }

    if (lat < 40.5 || lat > 42.0 || lng < -82.5 || lng > -80.5) {
      return res.status(400).json({ error: 'Coordinates outside valid range for Cuyahoga Valley area' });
    }

    const allowedFields = [
      'navigation_latitude', 'navigation_longitude',
      'property_owner', 'owner_id', 'brief_description', 'era_id', 'historical_description',
      'primary_activities', 'surface', 'pets', 'cell_signal', 'more_info_link',
      'events_url', 'news_url', 'status_url',
      'collection_tier', 'news_score_threshold', 'events_score_threshold'
    ];

    const fields = ['name', 'latitude', 'longitude'];
    const values = [name.trim(), lat, lng];
    let paramIndex = 4;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined && req.body[field] !== null && req.body[field] !== '') {
        fields.push(field);
        values.push(req.body[field]);
        paramIndex++;
      }
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

    try {
      const newDestination = await pool.query(
        `INSERT INTO pois (${fields.join(', ')}, created_at, updated_at)
         VALUES (${placeholders}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        values
      );

      console.log(`Admin ${req.user.email} created new destination: ${name}`);
      res.status(201).json(newDestination.rows[0]);
    } catch (error) {
      console.error('Error creating destination:', error);
      res.status(500).json({ error: 'Failed to create destination' });
    }
  });

  router.post('/pois', isAdmin, async (req, res) => {
    const { name, poi_roles, latitude, longitude } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const validRoles = ['point', 'mtb_trail', 'trail', 'river', 'boundary', 'organization'];
    const rolesArray = Array.isArray(poi_roles) ? poi_roles : (poi_roles ? [poi_roles] : []);
    if (rolesArray.length === 0 || !rolesArray.every(r => validRoles.includes(r))) {
      return res.status(400).json({ error: 'Invalid poi_roles. Must include at least one of: point, trail, river, boundary, organization' });
    }

    // Linear/boundary POIs use geometry instead of lat/lng — skip range check in that case
    const hasCoords = latitude !== undefined && longitude !== undefined;
    if (hasCoords) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'Invalid coordinate values' });
      }

      if (lat < 40.5 || lat > 42.0 || lng < -82.5 || lng > -80.5) {
        return res.status(400).json({ error: 'Coordinates outside valid range for Cuyahoga Valley area' });
      }
    }

    const allowedFields = [
      'poi_roles', 'navigation_latitude', 'navigation_longitude',
      'property_owner', 'owner_id', 'brief_description', 'era', 'era_id',
      'historical_description', 'primary_activities', 'surface', 'pets', 'cell_signal', 'more_info_link',
      'events_url', 'news_url', 'has_primary_image',
      'collection_tier', 'news_score_threshold', 'events_score_threshold',
      'geometry', 'status_url', 'research_context'
    ];

    const fields = ['name', 'poi_roles'];
    const values = [name.trim(), rolesArray];

    if (hasCoords) {
      fields.push('latitude', 'longitude');
      values.push(parseFloat(latitude), parseFloat(longitude));
    }

    for (const field of allowedFields) {
      if (field === 'poi_roles') continue;
      if (req.body[field] !== undefined && req.body[field] !== null && req.body[field] !== '') {
        fields.push(field);
        values.push(req.body[field]);
      }
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

    try {
      const newPoi = await pool.query(
        `INSERT INTO pois (${fields.join(', ')}, created_at, updated_at)
         VALUES (${placeholders}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        values
      );

      console.log(`Admin ${req.user.email} created new POI (${rolesArray.join(', ')}): ${name}`);
      res.status(201).json(newPoi.rows[0]);
    } catch (error) {
      console.error('Error creating POI:', error);
      res.status(500).json({ error: 'Failed to create POI' });
    }
  });

  router.delete('/destinations/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      const deletedDestination = await pool.query(
        `UPDATE pois
         SET deleted = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, name`,
        [id]
      );

      if (deletedDestination.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      console.log(`Admin ${req.user.email} deleted destination ${id}: ${deletedDestination.rows[0].name}`);
      res.json({ success: true, deleted: deletedDestination.rows[0] });
    } catch (error) {
      console.error('Error deleting destination:', error);
      res.status(500).json({ error: 'Failed to delete destination' });
    }
  });

  router.post('/news', isAdmin, async (req, res) => {
    const { poi_id, title, summary, source_url, source_name, news_type, publication_date } = req.body;

    if (!poi_id || !title || !title.trim()) {
      return res.status(400).json({ error: 'poi_id and title are required' });
    }

    try {
      const newsItem = await pool.query(
        `INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, publication_date, content_source, moderation_status, collection_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'human', 'published', CURRENT_TIMESTAMP)
         RETURNING *`,
        [poi_id, title.trim(), summary || null, source_url || null, source_name || null, news_type || 'general', publication_date || null]
      );

      console.log(`Admin ${req.user.email} created manual news item: ${title}`);
      res.status(201).json(newsItem.rows[0]);
    } catch (error) {
      console.error('Error creating news item:', error);
      res.status(500).json({ error: 'Failed to create news item' });
    }
  });

  router.post('/events', isAdmin, async (req, res) => {
    const { poi_id, title, start_date, end_date, description, event_type, location_details, source_url, publication_date } = req.body;

    if (!poi_id || !title || !title.trim() || !start_date) {
      return res.status(400).json({ error: 'poi_id, title, and start_date are required' });
    }

    try {
      const eventItem = await pool.query(
        `INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type, location_details, source_url, publication_date, content_source, moderation_status, collection_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'human', 'published', CURRENT_TIMESTAMP)
         RETURNING *`,
        [poi_id, title.trim(), description || null, start_date, end_date || null, event_type || null, location_details || null, source_url || null, publication_date || null]
      );

      console.log(`Admin ${req.user.email} created manual event: ${title}`);
      res.status(201).json(eventItem.rows[0]);
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(500).json({ error: 'Failed to create event' });
    }
  });

  router.get('/settings', isAdmin, async (req, res) => {
    try {
      const settingsRows = await pool.query('SELECT key, value, updated_at FROM admin_settings');
      const settings = {};
      for (const row of settingsRows.rows) {
        // Redact API key/token values; expose isSet flag only
        if (row.key.includes('api_key') || row.key.includes('api_token')) {
          settings[row.key] = {
            isSet: !!row.value,
            updatedAt: row.updated_at
          };
        } else {
          settings[row.key] = {
            value: row.value,
            updatedAt: row.updated_at
          };
        }
      }
      res.json(settings);
    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  router.put('/settings/:key', isAdmin, async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    const allowedKeys = [
      'gemini_api_key',
      'serper_api_key',
      'gemini_prompt_brief',
      'gemini_prompt_historical',
      'ai_search_primary',
      'ai_search_fallback',
      'ai_search_primary_limit',
      'twitter_username',
      'twitter_password',
      'seasonal_themes',
      'moderation_enabled',
      'moderation_auto_approve_threshold',
      'moderation_auto_approve_enabled',
      'photo_submissions_enabled',
      'apify_api_token',
      'news_collection_prompt',
      'trail_status_prompt',
      'results_subtabs_config',
      'buttondown_api_key',
      'buttondown_from_email',
      'max_concurrency',
      'max_search_urls',
      'page_concurrency',
      'page_delay_ms',
      'news_collection_excluded_pois',
      'blocklist_urls',
      'moderation_trusted_domains',
      'trusted_event_paths',
      'github_api_token',
      'about_story_md',
      'about_tutorial_md',
      'about_privacy_md'
    ];
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ error: 'Invalid setting key' });
    }

    try {
      await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = EXCLUDED.updated_by`,
        [key, value, req.user.id]
      );

      if (key === 'buttondown_api_key') {
        const { clearApiKeyCache } = await import('../services/buttondownClient.js');
        clearApiKeyCache();
        console.log('Buttondown API key cache cleared');
      }

      console.log(`Admin ${req.user.email} updated setting: ${key}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating setting:', error);
      res.status(500).json({ error: 'Failed to update setting' });
    }
  });

  router.post('/settings/serper-api-key/test', isAdmin, async (req, res) => {
    try {
      const { testSerperApiKey } = await import('../services/serperService.js');
      const isValid = await testSerperApiKey(pool);

      if (isValid) {
        res.json({ success: true, message: 'Serper API key is valid' });
      } else {
        res.json({ success: false, message: 'Serper API key is invalid or not configured' });
      }
    } catch (error) {
      console.error('Error testing Serper API key:', error);
      res.status(500).json({ success: false, message: 'Failed to test API key', error: error.message });
    }
  });

  router.post('/settings/apify-api-token/test', isAdmin, async (req, res) => {
    try {
      const { testApifyToken } = await import('../services/apifyService.js');
      const isValid = await testApifyToken(pool);

      if (isValid) {
        res.json({ success: true, message: 'Apify API token is valid' });
      } else {
        res.json({ success: false, message: 'Apify API token is invalid or not configured' });
      }
    } catch (error) {
      console.error('Error testing Apify API token:', error);
      res.status(500).json({ success: false, message: 'Failed to test API token', error: error.message });
    }
  });

  router.post('/settings/github-api-token/test', isAdmin, async (req, res) => {
    try {
      const tokenRow = await pool.query("SELECT value FROM admin_settings WHERE key = 'github_api_token'");
      const token = tokenRow.rows[0]?.value;
      if (!token) {
        return res.json({ success: false, message: 'GitHub token is not configured' });
      }

      const response = await fetch('https://api.github.com/repos/crunchtools/rotv', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (response.ok) {
        res.json({ success: true, message: 'GitHub token is valid' });
      } else {
        res.json({ success: false, message: `GitHub API returned ${response.status}` });
      }
    } catch (error) {
      console.error('Error testing GitHub token:', error);
      res.status(500).json({ success: false, message: 'Failed to test token', error: error.message });
    }
  });

  router.post('/ai/prompt-preview', isAdmin, async (req, res) => {
    const { destination, promptType } = req.body;

    if (!destination || !destination.name) {
      return res.status(400).json({ error: 'Destination data with name is required' });
    }

    const promptKey = promptType === 'historical' ? 'gemini_prompt_historical' : 'gemini_prompt_brief';

    try {
      const { getInterpolatedPrompt } = await import('../services/geminiService.js');
      const prompt = await getInterpolatedPrompt(pool, promptKey, destination);
      res.json({ prompt });
    } catch (error) {
      console.error('Error getting prompt preview:', error);
      res.status(500).json({ error: 'Failed to load prompt template' });
    }
  });

  router.post('/ai/generate', isAdmin, async (req, res) => {
    const { customPrompt, destination } = req.body;

    if (!customPrompt || !customPrompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    try {
      const { generateTextWithCustomPrompt } = await import('../services/geminiService.js');
      const text = await generateTextWithCustomPrompt(pool, customPrompt);

      console.log(`Admin ${req.user.email} generated content for: ${destination?.name || 'unknown'}`);
      res.json({ generated_text: text });
    } catch (error) {
      console.error('Error generating content:', error);
      if (error.message?.includes('API key')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to generate content. Please check your API key.' });
    }
  });

  router.post('/ai/test-key', isAdmin, async (req, res) => {
    try {
      const { testApiKey } = await import('../services/geminiService.js');
      const response = await testApiKey(pool);

      console.log(`Admin ${req.user.email} tested Gemini API key - success`);
      res.json({ success: true, message: 'API key is valid', response });
    } catch (error) {
      console.error('API key test failed:', error);
      res.status(400).json({
        success: false,
        error: error.message?.includes('API key')
          ? error.message
          : 'API key validation failed. Please check your key.'
      });
    }
  });

  router.post('/ai/research', isAdmin, async (req, res) => {
    const { destination } = req.body;

    if (!destination || !destination.name) {
      return res.status(400).json({ error: 'Destination with name is required' });
    }

    try {
      // Constrain AI output to existing standardized vocabularies
      const activitiesResult = await pool.query(
        'SELECT name FROM activities ORDER BY sort_order, name'
      );
      const availableActivities = activitiesResult.rows.map(row => row.name);

      const erasResult = await pool.query(
        'SELECT name FROM eras ORDER BY sort_order, name'
      );
      const availableEras = erasResult.rows.map(row => row.name);

      const surfacesResult = await pool.query(
        'SELECT name FROM surfaces ORDER BY sort_order, name'
      );
      const availableSurfaces = surfacesResult.rows.map(row => row.name);

      const { researchLocation } = await import('../services/geminiService.js');
      const researchData = await researchLocation(pool, destination, availableActivities, availableEras, availableSurfaces);

      console.log(`Admin ${req.user.email} researched location: ${destination.name}`);
      res.json(researchData);
    } catch (error) {
      console.error('Error researching location:', error);
      if (error.message?.includes('API key')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: error.message || 'Failed to research location. Please try again.' });
    }
  });

  // Multi-pass research (Issue #102) — returns draft for approval
  router.post('/ai/research-v2', isAdmin, async (req, res) => {
    const { destination, adminContext } = req.body;

    if (!destination || !destination.name) {
      return res.status(400).json({ error: 'Destination with name is required' });
    }

    try {
      const destWithContext = { ...destination, research_context: adminContext || destination.research_context || '' };

      const activitiesResult = await pool.query('SELECT name FROM activities ORDER BY sort_order, name');
      const availableActivities = activitiesResult.rows.map(row => row.name);

      const erasResult = await pool.query('SELECT id, name FROM eras ORDER BY sort_order, name');
      const availableEras = erasResult.rows.map(row => row.name);

      const surfacesResult = await pool.query('SELECT name FROM surfaces ORDER BY sort_order, name');
      const availableSurfaces = surfacesResult.rows.map(row => row.name);

      const { researchLocationMultiPass } = await import('../services/geminiService.js');
      const researchData = await researchLocationMultiPass(pool, destWithContext, availableActivities, availableEras, availableSurfaces);

      console.log(`Admin ${req.user.email} researched (v2) location: ${destination.name}`);
      res.json({ draft: true, data: researchData, destination_id: destination.id });
    } catch (error) {
      console.error('Error in multi-pass research:', error);
      if (error.message?.includes('API key')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: error.message || 'Failed to research location. Please try again.' });
    }
  });

  router.get('/activities', async (req, res) => {
    try {
      const activitiesRows = await pool.query(
        'SELECT id, name, sort_order FROM activities ORDER BY sort_order, name'
      );
      res.json(activitiesRows.rows);
    } catch (error) {
      console.error('Error fetching activities:', error);
      res.status(500).json({ error: 'Failed to fetch activities' });
    }
  });

  router.post('/activities', isAdmin, async (req, res) => {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Activity name is required' });
    }

    try {
      const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM activities');
      const sortOrder = maxOrder.rows[0].next_order;

      const newActivity = await pool.query(
        `INSERT INTO activities (name, sort_order)
         VALUES ($1, $2)
         RETURNING id, name, sort_order`,
        [name.trim(), sortOrder]
      );

      console.log(`Admin ${req.user.email} created activity: ${name}`);
      res.status(201).json(newActivity.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Activity with this name already exists' });
      }
      console.error('Error creating activity:', error);
      res.status(500).json({ error: 'Failed to create activity' });
    }
  });

  router.put('/activities/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, sort_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Activity name is required' });
    }

    try {
      const oldActivity = await pool.query('SELECT name FROM activities WHERE id = $1', [id]);
      if (oldActivity.rows.length === 0) {
        return res.status(404).json({ error: 'Activity not found' });
      }
      const oldName = oldActivity.rows[0].name;

      const updatedActivity = await pool.query(
        `UPDATE activities
         SET name = $1, sort_order = COALESCE($2, sort_order), updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING id, name, sort_order`,
        [name.trim(), sort_order, id]
      );

      const newName = name.trim();
      if (oldName !== newName) {
        // pois.primary_activities is a comma-space-separated string ("A, B, C") — handle exact / head / middle / tail positions
        const updateResult = await pool.query(
          `UPDATE pois
           SET primary_activities = CASE
             WHEN primary_activities = $1 THEN $2
             WHEN primary_activities LIKE $1 || ', %' THEN $2 || SUBSTRING(primary_activities FROM LENGTH($1) + 1)
             WHEN primary_activities LIKE '%, ' || $1 THEN SUBSTRING(primary_activities FROM 1 FOR LENGTH(primary_activities) - LENGTH($1)) || $2
             WHEN primary_activities LIKE '%, ' || $1 || ', %' THEN REPLACE(primary_activities, ', ' || $1 || ', ', ', ' || $2 || ', ')
             ELSE primary_activities
           END,
           updated_at = CURRENT_TIMESTAMP
           WHERE primary_activities LIKE '%' || $1 || '%'`,
          [oldName, newName]
        );
        if (updateResult.rowCount > 0) {
          console.log(`Updated ${updateResult.rowCount} POIs with renamed activity: ${oldName} -> ${newName}`);
        }
      }

      console.log(`Admin ${req.user.email} updated activity: ${name}`);
      res.json(updatedActivity.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Activity with this name already exists' });
      }
      console.error('Error updating activity:', error);
      res.status(500).json({ error: 'Failed to update activity' });
    }
  });

  router.delete('/activities/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      const activityData = await pool.query('SELECT * FROM activities WHERE id = $1', [id]);

      const deletedActivity = await pool.query(
        'DELETE FROM activities WHERE id = $1 RETURNING name',
        [id]
      );

      if (deletedActivity.rows.length === 0) {
        return res.status(404).json({ error: 'Activity not found' });
      }

      console.log(`Admin ${req.user.email} deleted activity: ${deletedActivity.rows[0].name}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting activity:', error);
      res.status(500).json({ error: 'Failed to delete activity' });
    }
  });

  router.put('/activities/reorder', isAdmin, async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }

    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          'UPDATE activities SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [i + 1, orderedIds[i]]
        );
      }

      console.log(`Admin ${req.user.email} reordered activities`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error reordering activities:', error);
      res.status(500).json({ error: 'Failed to reorder activities' });
    }
  });

  router.get('/eras', async (req, res) => {
    try {
      const erasRows = await pool.query(
        'SELECT id, name, year_start, year_end, description, sort_order FROM eras ORDER BY sort_order, name'
      );
      res.json(erasRows.rows);
    } catch (error) {
      console.error('Error fetching eras:', error);
      res.status(500).json({ error: 'Failed to fetch eras' });
    }
  });

  router.post('/eras', isAdmin, async (req, res) => {
    const { name, year_start, year_end, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Era name is required' });
    }

    try {
      const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM eras');
      const sortOrder = maxOrder.rows[0].next_order;

      const newEra = await pool.query(
        `INSERT INTO eras (name, year_start, year_end, description, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, year_start, year_end, description, sort_order`,
        [name.trim(), year_start || null, year_end || null, description || null, sortOrder]
      );

      console.log(`Admin ${req.user.email} created era: ${name}`);
      res.status(201).json(newEra.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Era with this name already exists' });
      }
      console.error('Error creating era:', error);
      res.status(500).json({ error: 'Failed to create era' });
    }
  });

  router.put('/eras/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, year_start, year_end, description, sort_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Era name is required' });
    }

    try {
      const oldEra = await pool.query('SELECT name FROM eras WHERE id = $1', [id]);
      if (oldEra.rows.length === 0) {
        return res.status(404).json({ error: 'Era not found' });
      }
      const oldName = oldEra.rows[0].name;

      const updatedEra = await pool.query(
        `UPDATE eras
         SET name = $1, year_start = $2, year_end = $3, description = $4,
             sort_order = COALESCE($5, sort_order), updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING id, name, year_start, year_end, description, sort_order`,
        [name.trim(), year_start || null, year_end || null, description || null, sort_order, id]
      );

      console.log(`Admin ${req.user.email} updated era: ${name}`);
      res.json(updatedEra.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Era with this name already exists' });
      }
      console.error('Error updating era:', error);
      res.status(500).json({ error: 'Failed to update era' });
    }
  });

  router.delete('/eras/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      const eraData = await pool.query('SELECT * FROM eras WHERE id = $1', [id]);

      const deletedEra = await pool.query(
        'DELETE FROM eras WHERE id = $1 RETURNING name',
        [id]
      );

      if (deletedEra.rows.length === 0) {
        return res.status(404).json({ error: 'Era not found' });
      }

      console.log(`Admin ${req.user.email} deleted era: ${deletedEra.rows[0].name}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting era:', error);
      res.status(500).json({ error: 'Failed to delete era' });
    }
  });

  router.put('/eras/reorder', isAdmin, async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }

    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          'UPDATE eras SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [i + 1, orderedIds[i]]
        );
      }

      console.log(`Admin ${req.user.email} reordered eras`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error reordering eras:', error);
      res.status(500).json({ error: 'Failed to reorder eras' });
    }
  });

  router.get('/surfaces', async (req, res) => {
    try {
      const surfacesRows = await pool.query(
        'SELECT id, name, description, sort_order FROM surfaces ORDER BY sort_order, name'
      );
      res.json(surfacesRows.rows);
    } catch (error) {
      console.error('Error fetching surfaces:', error);
      res.status(500).json({ error: 'Failed to fetch surfaces' });
    }
  });

  router.post('/surfaces', isAdmin, async (req, res) => {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Surface name is required' });
    }

    try {
      const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM surfaces');
      const sortOrder = maxOrder.rows[0].next_order;

      const newSurface = await pool.query(
        `INSERT INTO surfaces (name, description, sort_order)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, sort_order`,
        [name.trim(), description || null, sortOrder]
      );

      console.log(`Admin ${req.user.email} created surface: ${name}`);
      res.status(201).json(newSurface.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Surface with this name already exists' });
      }
      console.error('Error creating surface:', error);
      res.status(500).json({ error: 'Failed to create surface' });
    }
  });

  // MUST be defined before /surfaces/:id — otherwise Express matches "reorder" as :id
  router.put('/surfaces/reorder', isAdmin, async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }

    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          'UPDATE surfaces SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [i + 1, orderedIds[i]]
        );
      }

      console.log(`Admin ${req.user.email} reordered surfaces`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error reordering surfaces:', error);
      res.status(500).json({ error: 'Failed to reorder surfaces' });
    }
  });

  router.put('/surfaces/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, description, sort_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Surface name is required' });
    }

    try {
      const oldSurface = await pool.query('SELECT name FROM surfaces WHERE id = $1', [id]);
      if (oldSurface.rows.length === 0) {
        return res.status(404).json({ error: 'Surface not found' });
      }
      const oldName = oldSurface.rows[0].name;

      const updatedSurface = await pool.query(
        `UPDATE surfaces
         SET name = $1, description = $2,
             sort_order = COALESCE($3, sort_order), updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING id, name, description, sort_order`,
        [name.trim(), description || null, sort_order, id]
      );

      const newName = name.trim();
      if (oldName !== newName) {
        const updateResult = await pool.query(
          `UPDATE pois
           SET surface = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE surface = $1`,
          [oldName, newName]
        );
        if (updateResult.rowCount > 0) {
          console.log(`Updated ${updateResult.rowCount} POIs with renamed surface: ${oldName} -> ${newName}`);
        }
      }

      console.log(`Admin ${req.user.email} updated surface: ${name}`);
      res.json(updatedSurface.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Surface with this name already exists' });
      }
      console.error('Error updating surface:', error);
      res.status(500).json({ error: 'Failed to update surface' });
    }
  });

  router.delete('/surfaces/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      const deletedSurface = await pool.query(
        'DELETE FROM surfaces WHERE id = $1 RETURNING name',
        [id]
      );

      if (deletedSurface.rows.length === 0) {
        return res.status(404).json({ error: 'Surface not found' });
      }

      console.log(`Admin ${req.user.email} deleted surface: ${deletedSurface.rows[0].name}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting surface:', error);
      res.status(500).json({ error: 'Failed to delete surface' });
    }
  });

  router.get('/icons', async (req, res) => {
    try {
      const iconRows = await pool.query(
        'SELECT id, name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, enabled, drive_file_id FROM icons ORDER BY sort_order, name'
      );
      res.json(iconRows.rows);
    } catch (error) {
      console.error('Error fetching icons:', error);
      res.status(500).json({ error: 'Failed to fetch icons' });
    }
  });

  // svg_content + admin OAuth credentials → auto-upload to Drive (see block below)
  router.post('/icons', isAdmin, async (req, res) => {
    const { name, label, svg_filename, svg_content, title_keywords, activity_fallbacks } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Icon name is required' });
    }
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Icon label is required' });
    }

    try {
      const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM icons');
      const sortOrder = maxOrder.rows[0].next_order;

      let driveFileId = null;
      if (svg_content && req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);
          driveFileId = await uploadIconToDrive(drive, pool, name.trim(), svg_content);
          console.log(`Uploaded icon ${name} to Google Drive: ${driveFileId}`);
        } catch (driveError) {
          // Drive upload is best-effort; icon still saved to DB on failure
          console.warn(`Failed to upload icon to Drive (non-fatal):`, driveError.message);
        }
      }

      const newIcon = await pool.query(
        `INSERT INTO icons (name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, drive_file_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, enabled, drive_file_id`,
        [name.trim(), label.trim(), svg_filename || null, svg_content || null, title_keywords || null, activity_fallbacks || null, sortOrder, driveFileId]
      );

      console.log(`Admin ${req.user.email} created icon: ${name}${driveFileId ? ' (uploaded to Drive)' : ''}`);
      res.status(201).json(newIcon.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Icon with this name already exists' });
      }
      console.error('Error creating icon:', error);
      res.status(500).json({ error: 'Failed to create icon' });
    }
  });

  router.post('/icons/generate', isAdmin, async (req, res) => {
    const { description, color } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Icon description is required' });
    }
    if (!color || !color.trim()) {
      return res.status(400).json({ error: 'Icon color is required' });
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g., #0288d1)' });
    }

    try {
      const { generateIconSvg } = await import('../services/geminiService.js');
      const svgContent = await generateIconSvg(pool, description.trim(), color.trim());

      console.log(`Admin ${req.user.email} generated icon SVG for: ${description}`);
      res.json({ svg_content: svgContent });
    } catch (error) {
      console.error('Error generating icon:', error);
      if (error.message?.includes('API key')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: error.message || 'Failed to generate icon. Please try again.' });
    }
  });

  // MUST be defined before /icons/:id — otherwise Express matches "reorder" as :id
  router.put('/icons/reorder', isAdmin, async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }

    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          'UPDATE icons SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [i + 1, orderedIds[i]]
        );
      }

      console.log(`Admin ${req.user.email} reordered icons`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error reordering icons:', error);
      res.status(500).json({ error: 'Failed to reorder icons' });
    }
  });

  router.put('/icons/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, enabled } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Icon name is required' });
    }
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Icon label is required' });
    }

    try {
      const existing = await pool.query('SELECT svg_content, drive_file_id FROM icons WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Icon not found' });
      }

      const existingIcon = existing.rows[0];
      let driveFileId = existingIcon.drive_file_id;

      if (svg_content && svg_content !== existingIcon.svg_content && req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);
          driveFileId = await uploadIconToDrive(drive, pool, name.trim(), svg_content);
          console.log(`Re-uploaded icon ${name} to Google Drive: ${driveFileId}`);
        } catch (driveError) {
          // Drive re-upload is best-effort; existing drive_file_id retained on failure
          console.warn(`Failed to re-upload icon to Drive (non-fatal):`, driveError.message);
        }
      }

      const updatedIcon = await pool.query(
        `UPDATE icons
         SET name = $1, label = $2, svg_filename = $3, svg_content = $4, title_keywords = $5, activity_fallbacks = $6,
             sort_order = COALESCE($7, sort_order), enabled = COALESCE($8, enabled), drive_file_id = $9, updated_at = CURRENT_TIMESTAMP
         WHERE id = $10
         RETURNING id, name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, enabled, drive_file_id`,
        [name.trim(), label.trim(), svg_filename || null, svg_content, title_keywords || null, activity_fallbacks || null, sort_order, enabled, driveFileId, id]
      );

      console.log(`Admin ${req.user.email} updated icon: ${name}`);
      res.json(updatedIcon.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Icon with this name already exists' });
      }
      console.error('Error updating icon:', error);
      res.status(500).json({ error: 'Failed to update icon' });
    }
  });

  router.delete('/icons/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      // 'default' icon is required as the fallback in the map renderer — refuse deletion
      const checkDefault = await pool.query('SELECT name, drive_file_id FROM icons WHERE id = $1', [id]);
      if (checkDefault.rows.length === 0) {
        return res.status(404).json({ error: 'Icon not found' });
      }
      if (checkDefault.rows[0].name === 'default') {
        return res.status(400).json({ error: 'Cannot delete the default icon' });
      }

      const driveFileId = checkDefault.rows[0].drive_file_id;

      if (driveFileId && req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);
          await deleteFileFromDrive(drive, driveFileId);
          console.log(`Deleted icon from Google Drive: ${driveFileId}`);
        } catch (driveError) {
          // Drive delete is best-effort; DB delete proceeds regardless
          console.warn(`Failed to delete icon from Drive (non-fatal):`, driveError.message);
        }
      }

      const deletedIcon = await pool.query(
        'DELETE FROM icons WHERE id = $1 RETURNING name',
        [id]
      );

      if (deletedIcon.rows.length === 0) {
        return res.status(404).json({ error: 'Icon not found' });
      }

      console.log(`Admin ${req.user.email} deleted icon: ${deletedIcon.rows[0].name}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting icon:', error);
      res.status(500).json({ error: 'Failed to delete icon' });
    }
  });

  router.get('/boundaries', isAdmin, async (req, res) => {
    try {
      const boundaryRows = await pool.query(`
        SELECT id, name, boundary_type, boundary_color
        FROM pois
        WHERE 'boundary' = ANY(poi_roles) AND (deleted IS NULL OR deleted = FALSE)
        ORDER BY name
      `);
      res.json(boundaryRows.rows);
    } catch (error) {
      console.error('Error fetching boundaries:', error);
      res.status(500).json({ error: 'Failed to fetch boundaries' });
    }
  });

  router.put('/boundaries/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { boundary_type, boundary_color } = req.body;

    if (boundary_color && !/^#[0-9A-Fa-f]{6}$/.test(boundary_color)) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g., #228B22)' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (boundary_type !== undefined) {
      updates.push(`boundary_type = $${paramIndex}`);
      values.push(boundary_type);
      paramIndex++;
    }

    if (boundary_color !== undefined) {
      updates.push(`boundary_color = $${paramIndex}`);
      values.push(boundary_color);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(id);

    try {
      const updatedBoundary = await pool.query(`
        UPDATE pois
        SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex} AND 'boundary' = ANY(poi_roles)
        RETURNING id, name, boundary_type, boundary_color
      `, values);

      if (updatedBoundary.rows.length === 0) {
        return res.status(404).json({ error: 'Boundary not found' });
      }

      console.log(`Admin ${req.user.email} updated boundary ${id}: type=${boundary_type}, color=${boundary_color}`);
      res.json(updatedBoundary.rows[0]);
    } catch (error) {
      console.error('Error updating boundary:', error);
      res.status(500).json({ error: 'Failed to update boundary' });
    }
  });

  router.get('/sync/status', isAdmin, async (req, res) => {
    try {
      let credentials = req.user.oauth_credentials;
      if (typeof credentials === 'string') {
        try {
          credentials = JSON.parse(credentials);
        } catch (e) {
          credentials = null;
        }
      }

      const hasCredentials = !!(credentials && credentials.access_token);
      const status = {
        has_oauth_credentials: hasCredentials,
        drive_access_verified: false
      };

      if (!hasCredentials) {
        status.drive_access_error = 'No Drive credentials found. Please log out and log back in.';
        return res.json(status);
      }

      const drive = await createDriveServiceWithRefresh(credentials, pool, req.user.id);

      try {
        const rootFolderId = await getDriveSetting(pool, 'root_folder_id');
        const imagesFolderId = await getDriveSetting(pool, 'images_folder_id');
        const backupsFolderId = await getDriveSetting(pool, 'backups_folder_id');

        const folderLink = await getDriveFolderLink(pool);

        status.drive_access_verified = true;
        status.drive = {
          configured: !!rootFolderId,
          folder_url: folderLink,
          folders: {
            root: rootFolderId ? {
              id: rootFolderId,
              name: 'Roots of The Valley',
              url: `https://drive.google.com/drive/folders/${rootFolderId}`
            } : null,
            images: imagesFolderId ? {
              id: imagesFolderId,
              name: 'Images',
              url: `https://drive.google.com/drive/folders/${imagesFolderId}`
            } : null,
            database: backupsFolderId ? {
              id: backupsFolderId,
              name: 'Database',
              url: `https://drive.google.com/drive/folders/${backupsFolderId}`
            } : null
          }
        };

        try {
          const { getImageBackupStatus } = await import('../services/backupService.js');
          status.image_backup = await getImageBackupStatus(pool, drive);
        } catch (e) {
          status.image_backup = null;
        }
      } catch (driveInfoError) {
        console.warn('Could not get Drive folder info:', driveInfoError.message);
        status.drive = { configured: false };
      }

      try {
        const backupResult = await pool.query(
          "SELECT value FROM admin_settings WHERE key = 'last_backup'"
        );
        status.last_backup = backupResult.rows[0]?.value || null;
      } catch (e) {
        status.last_backup = null;
      }

      res.json(status);
    } catch (error) {
      console.error('Error getting sync status:', error);
      res.status(500).json({ error: 'Failed to get sync status' });
    }
  });

  router.post('/backup/trigger', isAdmin, async (req, res) => {
    try {
      let credentials = req.user.oauth_credentials;
      if (typeof credentials === 'string') {
        try { credentials = JSON.parse(credentials); } catch (e) { credentials = null; }
      }
      if (!credentials || !credentials.access_token) {
        return res.status(401).json({ error: 'Google authentication required' });
      }

      const drive = await createDriveServiceWithRefresh(credentials, pool, req.user.id);
      const { triggerBackup } = await import('../services/backupService.js');
      const backupResult = await triggerBackup(pool, drive);

      console.log(`Admin ${req.user.email} triggered backup: ${backupResult.filename}`);
      res.json(backupResult);
    } catch (error) {
      console.error('Error triggering backup:', error);
      res.status(500).json({ error: 'Failed to create backup', message: error.message });
    }
  });

  router.get('/backup/status', isAdmin, async (req, res) => {
    try {
      const { getBackupStatus } = await import('../services/backupService.js');
      const status = await getBackupStatus(pool);
      res.json(status);
    } catch (error) {
      console.error('Error getting backup status:', error);
      res.status(500).json({ error: 'Failed to get backup status' });
    }
  });

  router.get('/backup/list', isAdmin, async (req, res) => {
    try {
      let credentials = req.user.oauth_credentials;
      if (typeof credentials === 'string') {
        try { credentials = JSON.parse(credentials); } catch (e) { credentials = null; }
      }
      if (!credentials || !credentials.access_token) {
        return res.status(401).json({ error: 'Google authentication required' });
      }

      const drive = await createDriveServiceWithRefresh(credentials, pool, req.user.id);
      const { listBackups } = await import('../services/backupService.js');
      const backups = await listBackups(drive, pool);
      res.json(backups);
    } catch (error) {
      console.error('Error listing backups:', error);
      res.status(500).json({ error: 'Failed to list backups' });
    }
  });

  router.post('/backup/restore', isAdmin, async (req, res) => {
    try {
      const { fileId } = req.body;
      if (!fileId) {
        return res.status(400).json({ error: 'fileId is required' });
      }

      let credentials = req.user.oauth_credentials;
      if (typeof credentials === 'string') {
        try { credentials = JSON.parse(credentials); } catch (e) { credentials = null; }
      }
      if (!credentials || !credentials.access_token) {
        return res.status(401).json({ error: 'Google authentication required' });
      }

      const drive = await createDriveServiceWithRefresh(credentials, pool, req.user.id);
      const { restoreBackup } = await import('../services/backupService.js');
      await restoreBackup(pool, drive, fileId);

      console.log(`Admin ${req.user.email} restored database from backup ${fileId}`);
      res.json({ success: true, message: 'Database restored successfully' });
    } catch (error) {
      console.error('Error restoring backup:', error);
      res.status(500).json({ error: 'Failed to restore backup', message: error.message });
    }
  });

  router.post('/backup/images/trigger', isAdmin, async (req, res) => {
    try {
      let credentials = req.user.oauth_credentials;
      if (typeof credentials === 'string') {
        try { credentials = JSON.parse(credentials); } catch (e) { credentials = null; }
      }
      if (!credentials || !credentials.access_token) {
        return res.status(401).json({ error: 'Google authentication required' });
      }

      const drive = await createDriveServiceWithRefresh(credentials, pool, req.user.id);
      const { triggerImageBackup } = await import('../services/backupService.js');
      const imageBackupResult = await triggerImageBackup(pool, drive);

      console.log(`Admin ${req.user.email} triggered image backup: ${imageBackupResult.uploaded} uploaded`);
      res.json(imageBackupResult);
    } catch (error) {
      console.error('Error triggering image backup:', error);
      res.status(500).json({ error: 'Failed to backup images', message: error.message });
    }
  });

  router.get('/backup/images/status', isAdmin, async (req, res) => {
    try {
      let drive = null;
      let credentials = req.user.oauth_credentials;
      if (typeof credentials === 'string') {
        try { credentials = JSON.parse(credentials); } catch (e) { credentials = null; }
      }
      if (credentials?.access_token) {
        drive = await createDriveServiceWithRefresh(credentials, pool, req.user.id);
      }

      const { getImageBackupStatus } = await import('../services/backupService.js');
      const status = await getImageBackupStatus(pool, drive);
      res.json(status);
    } catch (error) {
      console.error('Error getting image backup status:', error);
      res.status(500).json({ error: 'Failed to get image backup status' });
    }
  });

  router.post('/backup/images/restore', isAdmin, async (req, res) => {
    try {
      let credentials = req.user.oauth_credentials;
      if (typeof credentials === 'string') {
        try { credentials = JSON.parse(credentials); } catch (e) { credentials = null; }
      }
      if (!credentials || !credentials.access_token) {
        return res.status(401).json({ error: 'Google authentication required' });
      }

      const drive = await createDriveServiceWithRefresh(credentials, pool, req.user.id);
      const { restoreImagesFromDrive } = await import('../services/backupService.js');
      const restoreResult = await restoreImagesFromDrive(pool, drive);

      console.log(`Admin ${req.user.email} restored images: ${restoreResult.restored} restored`);
      res.json(restoreResult);
    } catch (error) {
      console.error('Error restoring images:', error);
      res.status(500).json({ error: 'Failed to restore images', message: error.message });
    }
  });

  router.delete('/sync/wipe-database', isAdmin, async (req, res) => {
    try {
      const destResult = await pool.query('DELETE FROM pois RETURNING id');
      const destCount = destResult.rowCount;

      console.log(`Admin ${req.user.email} wiped database: ${destCount} POIs`);
      res.json({
        success: true,
        message: `Deleted ${destCount} POIs`,
        deleted: { destinations: destCount }
      });
    } catch (error) {
      console.error('Error wiping database:', error);
      res.status(500).json({ error: 'Failed to wipe database' });
    }
  });

  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
      }
    }
  });

  router.post('/pois/:id/image', isAdmin, imageUpload.single('image'), async (req, res) => {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    try {
      const poiCheck = await pool.query('SELECT id, name FROM pois WHERE id = $1', [id]);
      if (poiCheck.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      const poi = poiCheck.rows[0];

      let imageServerAssetId = null;
      if (imageServerClient.initialized) {
        try {
          const existingAsset = await imageServerClient.getPrimaryAsset(id);
          if (existingAsset) {
            await imageServerClient.deleteAsset(existingAsset.id);
            console.log(`Deleted old image server asset: ${existingAsset.id}`);
          }

          const ext = req.file.mimetype.split('/')[1];
          const sanitizedName = poi.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const filename = `${sanitizedName}-${Date.now()}.${ext}`;

          const uploadResponse = await imageServerClient.uploadImage(
            req.file.buffer, id, 'primary', filename, req.file.mimetype
          );

          if (uploadResponse.success) {
            imageServerAssetId = uploadResponse.assetId;
            console.log(`Uploaded image to image server: ${imageServerAssetId}`);
          } else {
            console.warn(`Failed to upload to image server (non-fatal):`, uploadResponse.error);
          }
        } catch (uploadError) {
          console.warn(`Failed to upload image to image server (non-fatal):`, uploadError.message);
        }
      }

      if (imageServerAssetId) {
        // Atomic swap: delete old primary + insert new (admin uploads bypass moderation)
        await pool.query('BEGIN');
        await pool.query(
          `DELETE FROM poi_media WHERE poi_id = $1 AND role = 'primary'`,
          [id]
        );

        await pool.query(`
          INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, moderation_status, moderated_at)
          VALUES ($1, 'image', $2, 'primary', 'auto_approved', CURRENT_TIMESTAMP)
        `, [id, imageServerAssetId]);
        await pool.query('COMMIT');
      }

      await pool.query(
        'UPDATE pois SET has_primary_image = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
      );

      console.log(`Admin ${req.user.email} uploaded image for POI ${id}`);
      res.json({
        success: true,
        message: 'Image uploaded successfully',
        image_server_asset_id: imageServerAssetId
      });
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => {});
      console.error('Error uploading POI image:', error);
      if (error.message?.includes('Invalid file type')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  router.post('/pois/:id/image-base64', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { imageData, mimeType } = req.body;

    if (!imageData || !mimeType) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.' });
    }

    try {
      const buffer = Buffer.from(imageData, 'base64');

      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image must be less than 10MB' });
      }

      const poiCheck = await pool.query('SELECT id, name FROM pois WHERE id = $1', [id]);
      if (poiCheck.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      const poi = poiCheck.rows[0];

      let imageServerAssetId = null;
      if (imageServerClient.initialized) {
        try {
          const existingAsset = await imageServerClient.getPrimaryAsset(id);
          if (existingAsset) {
            await imageServerClient.deleteAsset(existingAsset.id);
            console.log(`Deleted old image server asset: ${existingAsset.id}`);
          }

          const ext = mimeType.split('/')[1];
          const sanitizedName = poi.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const filename = `${sanitizedName}-${Date.now()}.${ext}`;

          const uploadResponse = await imageServerClient.uploadImage(
            buffer, id, 'primary', filename, mimeType
          );

          if (uploadResponse.success) {
            imageServerAssetId = uploadResponse.assetId;
            console.log(`Uploaded image to image server: ${imageServerAssetId}`);
          } else {
            console.warn(`Failed to upload to image server (non-fatal):`, uploadResponse.error);
          }
        } catch (uploadError) {
          console.warn('Failed to upload to image server (non-fatal):', uploadError.message);
        }
      }

      if (imageServerAssetId) {
        // Atomic swap: delete old primary + insert new (admin uploads bypass moderation)
        await pool.query('BEGIN');
        await pool.query(
          `DELETE FROM poi_media WHERE poi_id = $1 AND role = 'primary'`,
          [id]
        );

        await pool.query(`
          INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, moderation_status, moderated_at)
          VALUES ($1, 'image', $2, 'primary', 'auto_approved', CURRENT_TIMESTAMP)
        `, [id, imageServerAssetId]);
        await pool.query('COMMIT');
      }

      await pool.query(
        'UPDATE pois SET has_primary_image = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
      );

      console.log(`Admin ${req.user.email} uploaded image for POI ${id}`);
      res.json({
        success: true,
        message: 'Image uploaded successfully',
        image_server_asset_id: imageServerAssetId
      });
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => {});
      console.error('Error uploading POI image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  router.delete('/pois/:id/image', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      const poiCheck = await pool.query('SELECT id, name, has_primary_image FROM pois WHERE id = $1', [id]);
      if (poiCheck.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      const poi = poiCheck.rows[0];

      let hasImageServerAsset = false;
      if (imageServerClient.initialized) {
        const asset = await imageServerClient.getPrimaryAsset(id);
        if (asset) {
          hasImageServerAsset = true;
          try {
            await imageServerClient.deleteAsset(asset.id);
            console.log(`Deleted image from image server: ${asset.id}`);
          } catch (deleteError) {
            console.warn(`Failed to delete from image server (non-fatal):`, deleteError.message);
          }
        }
      }

      if (!hasImageServerAsset && !poi.has_primary_image) {
        return res.status(400).json({ error: 'POI has no image' });
      }

      await pool.query(
        `UPDATE pois
         SET has_primary_image = FALSE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );

      console.log(`Admin ${req.user.email} deleted image for POI ${id}`);
      res.json({
        success: true,
        message: 'Image deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting POI image:', error);
      res.status(500).json({ error: 'Failed to delete image' });
    }
  });

  router.get('/drive/status', isAdmin, async (req, res) => {
    try {
      if (!req.user.oauth_credentials) {
        return res.json({
          configured: false,
          message: 'Google authentication required'
        });
      }

      const drive = createDriveService(req.user.oauth_credentials);
      const settings = await getAllDriveSettings(pool);
      const folderLink = await getDriveFolderLink(pool);
      const fileCounts = await countDriveFiles(drive, pool);

      res.json({
        configured: !!settings.root_folder_id,
        folder_link: folderLink,
        folders: {
          root: settings.root_folder_id || null,
          icons: settings.icons_folder_id || null,
          images: settings.images_folder_id || null
        },
        file_counts: fileCounts
      });
    } catch (error) {
      console.error('Error getting Drive status:', error);
      res.status(500).json({ error: 'Failed to get Drive status' });
    }
  });

  router.post('/drive/setup', isAdmin, async (req, res) => {
    try {
      if (!req.user.oauth_credentials) {
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to setup Drive folders'
        });
      }

      const drive = createDriveService(req.user.oauth_credentials);
      const folders = await ensureDriveFolders(drive, pool);
      const folderLink = await getDriveFolderLink(pool);

      console.log(`Admin ${req.user.email} setup Drive folders`);
      res.json({
        success: true,
        message: 'Drive folders created/verified',
        folder_link: folderLink,
        folders
      });
    } catch (error) {
      console.error('Error setting up Drive folders:', error);
      res.status(500).json({ error: 'Failed to setup Drive folders' });
    }
  });

  router.put('/drive/settings/:key', isAdmin, async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;

      const allowedKeys = [
        'root_folder_id',
        'icons_folder_id',
        'images_folder_id',
        'geospatial_folder_id',
        'backups_folder_id'
      ];

      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ error: `Invalid setting key: ${key}` });
      }

      if (value === undefined || value === null) {
        return res.status(400).json({ error: 'Value is required' });
      }

      await setDriveSetting(pool, key, value);
      console.log(`Admin ${req.user.email} updated Drive setting: ${key}`);

      res.json({
        success: true,
        message: `Updated ${key}`,
        key,
        value
      });
    } catch (error) {
      console.error('Error updating Drive setting:', error);
      res.status(500).json({ error: 'Failed to update Drive setting' });
    }
  });

  router.get('/linear-features', isAdmin, async (req, res) => {
    try {
      const linearFeatureRows = await pool.query(`
        SELECT * FROM pois
        WHERE deleted IS NULL OR deleted = FALSE
        ORDER BY feature_type, name
      `);
      res.json(linearFeatureRows.rows);
    } catch (error) {
      console.error('Error fetching linear features:', error);
      res.status(500).json({ error: 'Failed to fetch linear features' });
    }
  });

  router.post('/linear-features', isAdmin, async (req, res) => {
    try {
      const {
        name, feature_type, geometry, property_owner, owner_id, brief_description,
        era_id, historical_description, primary_activities, surface, pets,
        cell_signal, more_info_link, length_miles, difficulty
      } = req.body;

      if (!name || !feature_type || !geometry) {
        return res.status(400).json({ error: 'Name, feature_type, and geometry are required' });
      }

      if (!['trail', 'river'].includes(feature_type)) {
        return res.status(400).json({ error: 'feature_type must be "trail" or "river"' });
      }

      const newLinearFeature = await pool.query(`
        INSERT INTO pois (
          name, poi_roles, geometry, property_owner, owner_id, brief_description,
          era_id, historical_description, primary_activities, surface, pets,
          cell_signal, more_info_link, length_miles, difficulty
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [
        name, [feature_type], JSON.stringify(geometry), property_owner, owner_id, brief_description,
        era_id, historical_description, primary_activities, surface, pets,
        cell_signal, more_info_link, length_miles, difficulty
      ]);

      console.log(`Admin ${req.user.email} created linear feature: ${name}`);
      res.status(201).json(newLinearFeature.rows[0]);
    } catch (error) {
      console.error('Error creating linear feature:', error);
      if (error.code === '23505') {
        res.status(409).json({ error: 'A feature with this name and type already exists' });
      } else {
        res.status(500).json({ error: 'Failed to create linear feature' });
      }
    }
  });

  router.put('/linear-features/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const allowedFields = [
        'name', 'poi_roles', 'geometry', 'property_owner', 'owner_id', 'brief_description',
        'era_id', 'historical_description', 'primary_activities', 'surface', 'pets',
        'cell_signal', 'more_info_link', 'length_miles', 'difficulty',
        'boundary_type', 'boundary_color', 'status_url', 'news_url', 'events_url',
        'collection_tier', 'news_score_threshold', 'events_score_threshold'
      ];

      const updates = [];
      const values = [];
      let paramIndex = 1;

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = $${paramIndex}`);
          values.push(field === 'geometry' ? JSON.stringify(req.body[field]) : req.body[field]);
          paramIndex++;
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      // Omit geometry from RETURNING — it's large and the client already has it
      const updatedLinearFeature = await pool.query(`
        UPDATE pois SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, name, poi_roles, latitude, longitude, property_owner,
                  brief_description, era_id, historical_description, primary_activities,
                  surface, pets, cell_signal, more_info_link, length_miles, difficulty,
                  has_primary_image, geometry_drive_file_id,
                  boundary_type, boundary_color, status_url, news_url, events_url,
                  deleted, created_at, updated_at
      `, values);

      if (updatedLinearFeature.rows.length === 0) {
        return res.status(404).json({ error: 'Linear feature not found' });
      }

      console.log(`Admin ${req.user.email} updated linear feature ${id}`);
      res.json(updatedLinearFeature.rows[0]);
    } catch (error) {
      console.error('Error updating linear feature:', error);
      res.status(500).json({ error: 'Failed to update linear feature' });
    }
  });

  router.delete('/linear-features/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const deletedLinearFeature = await pool.query(`
        UPDATE pois
        SET deleted = TRUE, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name
      `, [id]);

      if (deletedLinearFeature.rows.length === 0) {
        return res.status(404).json({ error: 'Linear feature not found' });
      }

      console.log(`Admin ${req.user.email} deleted linear feature ${id}`);
      res.json({ success: true, deleted: deletedLinearFeature.rows[0] });
    } catch (error) {
      console.error('Error deleting linear feature:', error);
      res.status(500).json({ error: 'Failed to delete linear feature' });
    }
  });

  router.post('/linear-features/import', isAdmin, async (req, res) => {
    try {
      const { feature_type } = req.body;
      const staticPath = process.env.STATIC_PATH || path.join(__dirname, '../../frontend/public');
      const dataPath = path.join(staticPath, 'data');

      const results = { trails: 0, rivers: 0, boundaries: 0, errors: [] };

      function consolidateFeatures(features) {
        const byName = {};
        for (const feature of features) {
          const name = feature.properties?.name || 'Unnamed';
          if (!byName[name]) {
            byName[name] = [];
          }
          byName[name].push(feature.geometry);
        }

        const consolidated = [];
        for (const [name, geometries] of Object.entries(byName)) {
          let geometry;
          if (geometries.length === 1) {
            geometry = geometries[0];
          } else {
            const allCoords = geometries.map(g =>
              g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
            ).flat();
            geometry = { type: 'MultiLineString', coordinates: allCoords };
          }
          consolidated.push({ name, geometry });
        }
        return consolidated;
      }

      if (feature_type === 'trail' || feature_type === 'all') {
        try {
          const trailsFile = path.join(dataPath, 'cvnp-trails.geojson');
          const trailsData = JSON.parse(await fs.readFile(trailsFile, 'utf-8'));
          const consolidatedTrails = consolidateFeatures(trailsData.features);

          for (const trail of consolidatedTrails) {
            try {
              await pool.query(`
                INSERT INTO pois (name, poi_roles, geometry)
                VALUES ($1, '{trail}', $2)
                ON CONFLICT (name) DO UPDATE SET
                  geometry = EXCLUDED.geometry,
                  poi_roles = EXCLUDED.poi_roles,
                  updated_at = CURRENT_TIMESTAMP
              `, [trail.name, JSON.stringify(trail.geometry)]);
              results.trails++;
            } catch (err) {
              results.errors.push(`Trail "${trail.name}": ${err.message}`);
            }
          }
        } catch (err) {
          results.errors.push(`Failed to read trails file: ${err.message}`);
        }
      }

      if (feature_type === 'river' || feature_type === 'all') {
        try {
          const riverFile = path.join(dataPath, 'cvnp-river.geojson');
          const riverData = JSON.parse(await fs.readFile(riverFile, 'utf-8'));
          const consolidatedRivers = consolidateFeatures(riverData.features);

          for (const river of consolidatedRivers) {
            try {
              await pool.query(`
                INSERT INTO pois (name, poi_roles, geometry)
                VALUES ($1, '{river}', $2)
                ON CONFLICT (name) DO UPDATE SET
                  geometry = EXCLUDED.geometry,
                  poi_roles = EXCLUDED.poi_roles,
                  updated_at = CURRENT_TIMESTAMP
              `, [river.name, JSON.stringify(river.geometry)]);
              results.rivers++;
            } catch (err) {
              results.errors.push(`River "${river.name}": ${err.message}`);
            }
          }
        } catch (err) {
          results.errors.push(`Failed to read river file: ${err.message}`);
        }
      }

      if (feature_type === 'boundary' || feature_type === 'all') {
        try {
          const boundaryFile = path.join(dataPath, 'cvnp-boundary.geojson');
          const boundaryData = JSON.parse(await fs.readFile(boundaryFile, 'utf-8'));

          for (const feature of boundaryData.features) {
            const name = feature.properties?.name || 'Park Boundary';
            try {
              await pool.query(`
                INSERT INTO pois (name, poi_roles, geometry)
                VALUES ($1, '{boundary}', $2)
                ON CONFLICT (name) DO UPDATE SET
                  geometry = EXCLUDED.geometry,
                  poi_roles = EXCLUDED.poi_roles,
                  updated_at = CURRENT_TIMESTAMP
              `, [name, JSON.stringify(feature.geometry)]);
              results.boundaries++;
            } catch (err) {
              results.errors.push(`Boundary "${name}": ${err.message}`);
            }
          }
        } catch (err) {
          results.errors.push(`Failed to read boundary file: ${err.message}`);
        }
      }

      console.log(`Admin ${req.user.email} imported linear features: ${results.trails} trails, ${results.rivers} rivers, ${results.boundaries} boundaries`);
      res.json({
        success: true,
        imported: {
          trails: results.trails,
          rivers: results.rivers,
          boundaries: results.boundaries
        },
        errors: results.errors.length > 0 ? results.errors : undefined
      });
    } catch (error) {
      console.error('Error importing linear features:', error);
      res.status(500).json({ error: 'Failed to import linear features' });
    }
  });

  const spatialUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.originalname.match(/\.(geojson|json)$/i)) {
        cb(null, true);
      } else {
        cb(new Error('Only GeoJSON files (.geojson, .json) are allowed'));
      }
    }
  });

  router.post('/spatial/upload', isAdmin, (req, res, next) => {
    spatialUpload.single('file')(req, res, (err) => {
      if (err) {
        console.error('Multer error:', err.message);
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  }, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { feature_type } = req.body;
      if (!['trail', 'river', 'boundary'].includes(feature_type)) {
        return res.status(400).json({ error: 'Invalid feature type. Must be trail, river, or boundary.' });
      }

      let geojsonData;
      try {
        geojsonData = JSON.parse(req.file.buffer.toString('utf-8'));
      } catch (parseErr) {
        return res.status(400).json({ error: 'Invalid JSON format in uploaded file' });
      }

      if (!geojsonData.type || !geojsonData.features) {
        return res.status(400).json({ error: 'Invalid GeoJSON: missing type or features' });
      }

      if (geojsonData.type !== 'FeatureCollection') {
        return res.status(400).json({ error: 'GeoJSON must be a FeatureCollection' });
      }

      function consolidateFeatures(features) {
        const byName = {};
        for (const feature of features) {
          const name = feature.properties?.name || 'Unnamed';
          if (!byName[name]) {
            byName[name] = [];
          }
          byName[name].push(feature.geometry);
        }

        const consolidated = [];
        for (const [name, geometries] of Object.entries(byName)) {
          let geometry;
          if (geometries.length === 1) {
            geometry = geometries[0];
          } else {
            const firstType = geometries[0]?.type;
            if (firstType === 'Polygon' || firstType === 'MultiPolygon') {
              const allCoords = geometries.map(g =>
                g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
              ).flat();
              geometry = { type: 'MultiPolygon', coordinates: allCoords };
            } else {
              const allCoords = geometries.map(g =>
                g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
              ).flat();
              geometry = { type: 'MultiLineString', coordinates: allCoords };
            }
          }
          consolidated.push({ name, geometry });
        }
        return consolidated;
      }

      const consolidatedFeatures = consolidateFeatures(geojsonData.features);
      let importedCount = 0;
      const errors = [];

      for (const feature of consolidatedFeatures) {
        try {
          await pool.query(`
            INSERT INTO pois (name, poi_roles, geometry, deleted)
            VALUES ($1, $2, $3, FALSE)
            ON CONFLICT (name) DO UPDATE SET
              geometry = EXCLUDED.geometry,
              poi_roles = EXCLUDED.poi_roles,
              deleted = FALSE,
              updated_at = CURRENT_TIMESTAMP
          `, [feature.name, [feature_type], JSON.stringify(feature.geometry)]);
          importedCount++;
        } catch (err) {
          errors.push(`"${feature.name}": ${err.message}`);
        }
      }

      console.log(`Admin ${req.user.email} uploaded spatial data: ${importedCount} ${feature_type}(s) from ${req.file.originalname}`);
      res.json({
        success: true,
        imported: importedCount,
        filename: req.file.originalname,
        feature_type,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error('Error uploading spatial data:', error);
      res.status(500).json({ error: error.message || 'Failed to upload spatial data' });
    }
  });

  // JSON-based import avoids Chrome multipart upload bug — keep parallel to /spatial/upload
  router.post('/spatial/import', isAdmin, async (req, res) => {
    try {
      const { feature_type, geojson, filename } = req.body;

      if (!geojson) {
        return res.status(400).json({ error: 'No GeoJSON data provided' });
      }

      if (!['trail', 'river', 'boundary'].includes(feature_type)) {
        return res.status(400).json({ error: 'Invalid feature type. Must be trail, river, or boundary.' });
      }

      if (!geojson.type || !geojson.features) {
        return res.status(400).json({ error: 'Invalid GeoJSON: missing type or features' });
      }

      if (geojson.type !== 'FeatureCollection') {
        return res.status(400).json({ error: 'GeoJSON must be a FeatureCollection' });
      }

      function consolidateFeatures(features) {
        const byName = {};
        for (const feature of features) {
          const name = feature.properties?.name || 'Unnamed';
          if (!byName[name]) {
            byName[name] = [];
          }
          byName[name].push(feature.geometry);
        }

        const consolidated = [];
        for (const [name, geometries] of Object.entries(byName)) {
          let geometry;
          if (geometries.length === 1) {
            geometry = geometries[0];
          } else {
            const firstType = geometries[0]?.type;
            if (firstType === 'Polygon' || firstType === 'MultiPolygon') {
              const allCoords = geometries.map(g =>
                g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
              ).flat();
              geometry = { type: 'MultiPolygon', coordinates: allCoords };
            } else {
              const allCoords = geometries.map(g =>
                g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
              ).flat();
              geometry = { type: 'MultiLineString', coordinates: allCoords };
            }
          }
          consolidated.push({ name, geometry });
        }
        return consolidated;
      }

      const consolidatedFeatures = consolidateFeatures(geojson.features);
      let importedCount = 0;
      const errors = [];

      for (const feature of consolidatedFeatures) {
        try {
          await pool.query(`
            INSERT INTO pois (name, poi_roles, geometry, deleted)
            VALUES ($1, $2, $3, FALSE)
            ON CONFLICT (name) DO UPDATE SET
              geometry = EXCLUDED.geometry,
              poi_roles = EXCLUDED.poi_roles,
              deleted = FALSE,
              updated_at = CURRENT_TIMESTAMP
          `, [feature.name, [feature_type], JSON.stringify(feature.geometry)]);
          importedCount++;
        } catch (err) {
          errors.push(`"${feature.name}": ${err.message}`);
        }
      }

      console.log(`Admin ${req.user.email} imported spatial data: ${importedCount} ${feature_type}(s) from ${filename || 'unknown'}`);
      res.json({
        success: true,
        imported: importedCount,
        filename: filename,
        feature_type,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error('Error importing spatial data:', error);
      res.status(500).json({ error: error.message || 'Failed to import spatial data' });
    }
  });

  router.post('/news/collect-batch', isAdmin, async (req, res) => {
    try {
      const { poiIds } = req.body;

      if (!Array.isArray(poiIds) || poiIds.length === 0) {
        return res.status(400).json({ error: 'poiIds array is required' });
      }

      const MAX_BATCH_SIZE = 50;
      const idsToProcess = poiIds.slice(0, MAX_BATCH_SIZE);

      console.log(`Admin ${req.user.email} triggered batch news collection for ${idsToProcess.length} POIs`);

      const { jobId, totalPois } = await createNewsCollectionJob(pool, idsToProcess, 'batch');

      // pg-boss enables crash recovery — handler registered in server.js
      await submitBatchNewsJob({ jobId, poiIds: idsToProcess });

      res.json({
        success: true,
        message: 'News & events collection started (pg-boss)',
        jobId,
        totalPois,
        truncated: poiIds.length > MAX_BATCH_SIZE
      });
    } catch (error) {
      console.error('Error starting batch news collection:', error);
      res.status(500).json({ error: 'Failed to start batch news collection' });
    }
  });

  router.post('/news/collect', isAdmin, async (req, res) => {
    try {
      const tier = req.query.tier;
      const tierLabel = tier ? `${tier} tier` : 'all POIs';
      console.log(`Admin ${req.user.email} triggered news collection for ${tierLabel}`);

      const runningJobCheck = await pool.query(`
        SELECT id FROM news_job_status
        WHERE status = 'running'
        LIMIT 1
      `);

      if (runningJobCheck.rows.length > 0) {
        return res.status(409).json({
          error: 'A news collection job is already running',
          runningJobId: runningJobCheck.rows[0].id
        });
      }

      const poiIds = tier
        ? await getPoisForTierCollection(pool, tier)
        : await getAllPoisForCollection(pool);

      if (poiIds.length === 0) {
        return res.status(400).json({ error: `No POIs found for ${tierLabel}` });
      }

      const source = tier ? `manual-${tier}` : 'manual';
      const { jobId, totalPois } = await createNewsCollectionJob(pool, poiIds, source);

      await submitBatchNewsJob({ jobId, poiIds });

      res.json({
        success: true,
        message: `News & events collection started for ${tierLabel} (${totalPois} POIs)`,
        jobId,
        totalPois
      });
    } catch (error) {
      console.error('Error starting news collection:', error);
      res.status(500).json({ error: 'Failed to start news collection' });
    }
  });

  router.get('/news/job/:jobId', isAdmin, async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await getJobStatus(pool, parseInt(jobId));

      if (!status) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Stable 10-slot display prevents UI churn as POIs cycle through workers
      const displaySlots = getNewsDisplaySlots(status.id);

      let currentPhase = null;
      let currentMessage = null;
      if (displaySlots.some(s => s.poiId)) {
        const activeSlots = displaySlots.filter(s => s.poiId && s.status === 'active');
        if (activeSlots.length > 0) {
          const renderingSlot = activeSlots.find(s => s.phase === 'rendering_events' || s.phase === 'rendering_news');
          const searchingSlot = activeSlots.find(s => s.phase === 'ai_search');
          if (renderingSlot) {
            currentPhase = 'rendering';
            currentMessage = `Processing ${renderingSlot.poiName}`;
          } else if (searchingSlot) {
            currentPhase = 'ai_search';
            currentMessage = `Searching for ${searchingSlot.poiName}`;
          } else if (activeSlots[0]) {
            currentPhase = activeSlots[0].phase;
            currentMessage = `Processing ${activeSlots[0].poiName}`;
          }
        }
      }

      res.json({
        ...status,
        phase: currentPhase,
        phase_message: currentMessage,
        displaySlots
      });
    } catch (error) {
      console.error('Error getting job status:', error);
      res.status(500).json({ error: 'Failed to get job status' });
    }
  });

  router.get('/pois/:id/collection-progress', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const progress = getCollectionProgress(parseInt(id));

      if (!progress) {
        return res.json({ phase: 'idle', message: 'No collection in progress' });
      }

      const jobStats = getJobStats();
      res.json({
        ...progress,
        aiStats: {
          activeProvider: jobStats.activeProvider,
          usage: jobStats.usage,
          errors: jobStats.errors
        }
      });
    } catch (error) {
      console.error('Error getting collection progress:', error);
      res.status(500).json({ error: 'Failed to get collection progress' });
    }
  });

  router.post('/pois/:id/collection-cancel', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const poiId = parseInt(id);

      const cancelled = requestCancellation(poiId);

      if (cancelled) {
        console.log(`Admin ${req.user.email} cancelled collection for POI ${poiId}`);
        res.json({ success: true, message: 'Cancellation requested' });
      } else {
        res.json({ success: false, message: 'No active collection job found for this POI' });
      }
    } catch (error) {
      console.error('Error cancelling collection:', error);
      res.status(500).json({ error: 'Failed to cancel collection' });
    }
  });

  router.post('/pois/:id/news/collect', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const poiResult = await pool.query(
        'SELECT id, name, poi_roles, primary_activities, more_info_link, events_url, news_url FROM pois WHERE id = $1',
        [id]
      );

      if (poiResult.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      const poi = poiResult.rows[0];

      const existingProgress = getCollectionProgress(parseInt(id));
      if (existingProgress && !existingProgress.completed) {
        console.log(`Admin ${req.user.email} attempted to start NEWS collection, but one is already running for POI: ${poi.name}`);
        return res.status(200).json({
          success: true,
          alreadyRunning: true,
          message: 'Collection already in progress',
          progress: existingProgress,
          jobId: existingProgress.runId || poi.id,
          poiId: poi.id,
          jobType: 'news_single'
        });
      }

      clearProgress(parseInt(id));
      resetJobUsage();

      console.log(`Admin ${req.user.email} triggered NEWS ONLY collection for POI: ${poi.name}`);

      const timezone = req.body.timezone || 'America/New_York';

      // Each attempt gets a fresh run_id so re-runs appear as separate history entries, not overwrites
      const runIdResult = await pool.query("SELECT nextval('single_poi_run_id_seq')");
      const runId = parseInt(runIdResult.rows[0].nextval);
      updateProgress(poi.id, { runId, jobId: runId, jobType: 'news_single' });

      const urls = [
        poi.news_url ? `news: ${poi.news_url}` : null,
        poi.events_url ? `events: ${poi.events_url}` : null,
        poi.more_info_link ? `website: ${poi.more_info_link}` : null
      ].filter(Boolean).join(', ');
      logInfo(runId, 'news_single', poi.id, poi.name, `News collection started (${urls || 'no URLs configured'})`);
      await flushJobLogs();

      // Respond immediately so the frontend can redirect to Jobs dashboard; collection runs after the response
      res.json({
        success: true,
        message: `News collection started for ${poi.name}`,
        jobId: runId,
        poiId: poi.id,
        jobType: 'news_single'
      });

      const onProgress = async (message) => {
        logInfo(runId, 'news_single', poi.id, poi.name, message);
        await flushJobLogs();
      };

      try {
        const { news, events, metadata } = await collectPoi(pool, poi, null, timezone, 'news', onProgress);

        logInfo(runId, 'news_single', poi.id, poi.name, `Saving ${news.length} news items to database...`);
        await flushJobLogs();

        const domainOwnershipMap = await buildDomainOwnershipMap(pool);
        const saveLog = (msg) => { logInfo(runId, 'news_single', poi.id, poi.name, msg); };
        const savedNews = await saveNewsItems(pool, poi.id, news, { log: saveLog, domainOwnershipMap });
        await flushJobLogs();

        updateProgress(poi.id, {
          phase: 'complete',
          message: `Complete! Found ${news.length} • Saved ${savedNews} • Skipped ${news.length - savedNews}`,
          newsFound: news.length,
          newsSaved: savedNews,
          newsDuplicate: news.length - savedNews,
          completed: true
        });

        logInfo(runId, 'news_single', poi.id, poi.name, `Complete: ${savedNews} saved, ${news.length - savedNews} skipped`, { news_found: news.length, news_saved: savedNews, completed: true });
        await flushJobLogs();
      } catch (bgError) {
        logError(runId, 'news_single', poi.id, poi.name, `Collection failed: ${bgError.message}`);
        await flushJobLogs();
        console.error('Background news collection failed for POI:', bgError);
      }
    } catch (error) {
      console.error('Error starting news collection for POI:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to start news collection for POI' });
      }
    }
  });

  router.post('/pois/:id/events/collect', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const poiResult = await pool.query(
        'SELECT id, name, poi_roles, primary_activities, more_info_link, events_url, news_url FROM pois WHERE id = $1',
        [id]
      );

      if (poiResult.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      const poi = poiResult.rows[0];

      const existingProgress = getCollectionProgress(parseInt(id));
      if (existingProgress && !existingProgress.completed) {
        console.log(`Admin ${req.user.email} attempted to start EVENTS collection, but one is already running for POI: ${poi.name}`);
        return res.status(200).json({
          success: true,
          alreadyRunning: true,
          message: 'Collection already in progress',
          progress: existingProgress,
          jobId: existingProgress.runId || poi.id,
          poiId: poi.id,
          jobType: 'events_single'
        });
      }

      clearProgress(parseInt(id));
      resetJobUsage();

      console.log(`Admin ${req.user.email} triggered EVENTS ONLY collection for POI: ${poi.name}`);

      const timezone = req.body.timezone || 'America/New_York';

      // Each attempt gets a fresh run_id so re-runs appear as separate history entries, not overwrites
      const runIdResult = await pool.query("SELECT nextval('single_poi_run_id_seq')");
      const runId = parseInt(runIdResult.rows[0].nextval);
      updateProgress(poi.id, { runId, jobId: runId, jobType: 'events_single' });

      const urls = [
        poi.events_url ? `events: ${poi.events_url}` : null,
        poi.news_url ? `news: ${poi.news_url}` : null,
        poi.more_info_link ? `website: ${poi.more_info_link}` : null
      ].filter(Boolean).join(', ');
      logInfo(runId, 'events_single', poi.id, poi.name, `Events collection started (${urls || 'no URLs configured'})`);
      await flushJobLogs();

      // Respond immediately so the frontend can redirect to Jobs dashboard; collection runs after the response
      res.json({
        success: true,
        message: `Events collection started for ${poi.name}`,
        jobId: runId,
        poiId: poi.id,
        jobType: 'events_single'
      });

      const onProgress = async (message) => {
        logInfo(runId, 'events_single', poi.id, poi.name, message);
        await flushJobLogs();
      };

      try {
        const { news, events, metadata } = await collectPoi(pool, poi, null, timezone, 'events', onProgress);

        logInfo(runId, 'events_single', poi.id, poi.name, `Saving ${events.length} event items to database...`);
        await flushJobLogs();

        const domainOwnershipMap = await buildDomainOwnershipMap(pool);
        const saveLog = (msg) => { logInfo(runId, 'events_single', poi.id, poi.name, msg); };
        const savedEvents = await saveEventItems(pool, poi.id, events, { log: saveLog, domainOwnershipMap });
        await flushJobLogs();

        updateProgress(poi.id, {
          phase: 'complete',
          message: `Complete! Found ${events.length} • Saved ${savedEvents} • Skipped ${events.length - savedEvents}`,
          eventsFound: events.length,
          eventsSaved: savedEvents,
          eventsDuplicate: events.length - savedEvents,
          completed: true
        });

        logInfo(runId, 'events_single', poi.id, poi.name, `Complete: ${savedEvents} saved, ${events.length - savedEvents} skipped`, { events_found: events.length, events_saved: savedEvents, completed: true });
        await flushJobLogs();
      } catch (bgError) {
        logError(runId, 'events_single', poi.id, poi.name, `Collection failed: ${bgError.message}`);
        await flushJobLogs();
        console.error('Background events collection failed for POI:', bgError);
      }
    } catch (error) {
      console.error('Error starting events collection for POI:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to start events collection for POI' });
      }
    }
  });

  router.get('/news/status', isAdmin, async (req, res) => {
    try {
      const status = await getLatestJobStatus(pool);
      res.json(status || { message: 'No jobs have run yet' });
    } catch (error) {
      console.error('Error getting job status:', error);
      res.status(500).json({ error: 'Failed to get job status' });
    }
  });

  router.get('/news/ai-stats', isAdmin, async (req, res) => {
    try {
      const recentJob = await pool.query(`
        SELECT ai_usage, status
        FROM news_job_status
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (recentJob.rows.length === 0) {
        return res.json({ usage: { gemini: 0 }, errors: {}, activeProvider: 'gemini' });
      }

      const job = recentJob.rows[0];

      // Live in-memory stats while running; persisted DB values once terminal
      if (job.status === 'running') {
        const liveStats = getJobStats();
        return res.json({
          usage: liveStats.usage,
          errors: liveStats.errors,
          activeProvider: liveStats.activeProvider
        });
      }

      let aiUsage = job.ai_usage;
      if (typeof aiUsage === 'string') {
        try {
          aiUsage = JSON.parse(aiUsage);
        } catch (e) {
          console.error('Error parsing ai_usage:', e);
          aiUsage = { gemini: 0 };
        }
      }
      aiUsage = aiUsage || { gemini: 0 };

      res.json({
        usage: {
          gemini: aiUsage.gemini || 0
        },
        errors: {},
        activeProvider: 'gemini'
      });
    } catch (error) {
      console.error('Error getting AI stats:', error);
      res.status(500).json({ error: 'Failed to get AI stats' });
    }
  });

  router.post('/news/job/:id/cancel', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const jobId = parseInt(id);

      // Snapshot live AI usage before cancellation so we can persist it to the cancelled row
      const currentUsage = getJobStats();

      const cancelledJob = await pool.query(`
        UPDATE news_job_status
        SET status = 'cancelled', completed_at = NOW(), ai_usage = $2
        WHERE id = $1 AND status = 'running'
        RETURNING *
      `, [jobId, JSON.stringify(currentUsage)]);

      if (cancelledJob.rows.length > 0) {
        const active = getAllActiveProgress();
        let signalled = 0;
        for (const entry of active) {
          if (entry.jobId === jobId) {
            requestCancellation(entry.poiId);
            signalled++;
          }
        }
        console.log(`Admin ${req.user.email} cancelled batch job ${jobId} (signalled ${signalled} active POIs)`);
        res.json({ success: true, message: `Job cancelled (${signalled} active POIs signalled)` });
      } else {
        res.json({ success: false, message: 'Job not found or not running' });
      }
    } catch (error) {
      console.error('Error cancelling batch job:', error);
      res.status(500).json({ error: 'Failed to cancel job' });
    }
  });

  router.get('/news/recent', isAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const news = await getRecentNews(pool, limit);
      res.json(news);
    } catch (error) {
      console.error('Error getting recent news:', error);
      res.status(500).json({ error: 'Failed to get recent news' });
    }
  });

  router.get('/events/upcoming', isAdmin, async (req, res) => {
    try {
      const daysAhead = parseInt(req.query.days) || 30;
      const events = await getUpcomingEvents(pool, daysAhead);
      res.json(events);
    } catch (error) {
      console.error('Error getting upcoming events:', error);
      res.status(500).json({ error: 'Failed to get upcoming events' });
    }
  });

  router.delete('/news/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM poi_news WHERE id = $1', [id]);
      console.log(`Admin ${req.user.email} deleted news item ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting news:', error);
      res.status(500).json({ error: 'Failed to delete news' });
    }
  });

  router.delete('/events/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM poi_events WHERE id = $1', [id]);
      console.log(`Admin ${req.user.email} deleted event ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  });

  router.post('/poi-associations', isAdmin, async (req, res) => {
    try {
      const { virtual_poi_id, physical_poi_id, association_type } = req.body;

      if (!virtual_poi_id || !physical_poi_id) {
        return res.status(400).json({ error: 'virtual_poi_id and physical_poi_id are required' });
      }

      const virtualPoi = await pool.query(
        'SELECT poi_roles FROM pois WHERE id = $1',
        [virtual_poi_id]
      );

      if (virtualPoi.rows.length === 0) {
        return res.status(400).json({ error: 'Organization POI not found' });
      }

      if (!virtualPoi.rows[0].poi_roles?.includes('organization')) {
        return res.status(400).json({ error: 'Specified virtual_poi_id does not have the organization role' });
      }

      const associationRow = await pool.query(`
        INSERT INTO poi_associations (virtual_poi_id, physical_poi_id, association_type)
        VALUES ($1, $2, $3)
        ON CONFLICT (virtual_poi_id, physical_poi_id) DO UPDATE
        SET association_type = EXCLUDED.association_type, updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [virtual_poi_id, physical_poi_id, association_type || 'manages']);

      console.log(`Admin ${req.user.email} created association between org POI ${virtual_poi_id} and POI ${physical_poi_id}`);
      res.json(associationRow.rows[0]);
    } catch (error) {
      console.error('Error creating POI association:', error);
      res.status(500).json({ error: 'Failed to create association' });
    }
  });

  router.delete('/poi-associations/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const deletedAssociation = await pool.query(
        'DELETE FROM poi_associations WHERE id = $1 RETURNING *',
        [id]
      );

      if (deletedAssociation.rows.length === 0) {
        return res.status(404).json({ error: 'Association not found' });
      }

      console.log(`Admin ${req.user.email} deleted association ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting POI association:', error);
      res.status(500).json({ error: 'Failed to delete association' });
    }
  });

  router.post('/poi-associations/batch', isAdmin, async (req, res) => {
    try {
      const { virtual_poi_id, physical_poi_ids, association_type } = req.body;

      if (!virtual_poi_id || !Array.isArray(physical_poi_ids) || physical_poi_ids.length === 0) {
        return res.status(400).json({ error: 'virtual_poi_id and physical_poi_ids array are required' });
      }

      const virtualPoi = await pool.query(
        'SELECT poi_roles FROM pois WHERE id = $1',
        [virtual_poi_id]
      );

      if (virtualPoi.rows.length === 0) {
        return res.status(400).json({ error: 'Organization POI not found' });
      }

      if (!virtualPoi.rows[0].poi_roles?.includes('organization')) {
        return res.status(400).json({ error: 'Specified virtual_poi_id does not have the organization role' });
      }

      const associationsBatch = await pool.query(`
        INSERT INTO poi_associations (virtual_poi_id, physical_poi_id, association_type)
        SELECT $1, unnest($2::int[]), $3
        ON CONFLICT (virtual_poi_id, physical_poi_id) DO UPDATE
        SET association_type = EXCLUDED.association_type, updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [virtual_poi_id, physical_poi_ids, association_type || 'manages']);

      console.log(`Admin ${req.user.email} created ${associationsBatch.rows.length} associations for virtual POI ${virtual_poi_id}`);
      res.json({ success: true, created: associationsBatch.rows });
    } catch (error) {
      console.error('Error creating batch POI associations:', error);
      res.status(500).json({ error: 'Failed to create associations' });
    }
  });

  router.post('/pois/:id/status/collect', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const poiResult = await pool.query(
        'SELECT id, name, poi_roles, status_url, location FROM pois WHERE id = $1',
        [id]
      );

      if (poiResult.rows.length === 0) {
        return res.status(404).json({ error: 'Trail not found' });
      }

      const poi = poiResult.rows[0];

      if (!poi.status_url || poi.status_url === '') {
        return res.status(400).json({ error: 'POI does not have a status URL' });
      }

      const existingProgress = getTrailProgress(parseInt(id));
      if (existingProgress && !existingProgress.completed) {
        console.log(`Admin ${req.user.email} attempted to collect trail status, but one is already running for: ${poi.name}`);
        return res.status(200).json({
          success: true,
          alreadyRunning: true,
          message: 'Collection already in progress',
          progress: existingProgress
        });
      }

      clearTrailProgress(parseInt(id));
      resetJobUsage();

      console.log(`Admin ${req.user.email} triggered trail status collection for: ${poi.name}`);

      const trailStatusResult = await collectTrailStatus(pool, poi, null, 'America/New_York');

      res.json({
        success: true,
        message: 'Trail status collected',
        statusFound: trailStatusResult.statusFound,
        statusSaved: trailStatusResult.statusSaved,
        aiUsage: getJobStats()
      });

    } catch (error) {
      console.error('Error collecting trail status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/trail-status/collect-batch', isAdmin, async (req, res) => {
    try {
      const { poiIds } = req.body;

      console.log(`Admin ${req.user.email} triggered batch trail status collection for ${poiIds?.length || 'all'} trails`);

      const runningJobCheck = await pool.query(`
        SELECT id FROM trail_status_job_status
        WHERE status = 'running'
        LIMIT 1
      `);

      if (runningJobCheck.rows.length > 0) {
        return res.status(409).json({
          error: 'A trail status collection job is already running',
          runningJobId: runningJobCheck.rows[0].id
        });
      }

      const batchJobResult = await runTrailStatusCollection(pool, req.app.get('boss'), {
        poiIds: poiIds || null,
        jobType: 'batch_collection'
      });

      // Both camelCase and snake_case to maintain backward compatibility with old frontend builds
      res.json({
        success: true,
        message: batchJobResult.message,
        jobId: batchJobResult.jobId,
        totalTrails: batchJobResult.totalTrails,
        total_trails: batchJobResult.totalTrails
      });

    } catch (error) {
      console.error('Error starting batch trail status collection:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get latest job status (MUST come before /:jobId route)
  router.get('/trail-status/job-status/latest', isAdmin, async (req, res) => {
    try {
      const latestJob = await pool.query(`
        SELECT *
        FROM trail_status_job_status
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (latestJob.rows.length === 0) {
        return res.json(null);
      }

      const job = latestJob.rows[0];
      res.json({
        jobId: job.pg_boss_job_id,
        status: job.status,
        started_at: job.started_at,
        completed_at: job.completed_at,
        total_trails: job.total_trails,
        trails_processed: job.trails_processed,
        status_found: job.status_found,
        error_message: job.error_message
      });
    } catch (error) {
      console.error('Error getting latest job status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/trail-status/job-status/:jobId', isAdmin, async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await getTrailJobStatus(pool, jobId);

      if (!status) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const displaySlots = getTrailDisplaySlots(status.jobId);

      let currentPhase = null;
      let currentMessage = null;
      if (displaySlots.some(s => s.poiId)) {
        const activeSlots = displaySlots.filter(s => s.poiId && s.status === 'active');
        if (activeSlots.length > 0) {
          const renderingSlot = activeSlots.find(s => s.phase === 'rendering');
          const searchingSlot = activeSlots.find(s => s.phase === 'ai_search');
          if (renderingSlot) {
            currentPhase = 'rendering';
            currentMessage = `Processing ${renderingSlot.poiName}`;
          } else if (searchingSlot) {
            currentPhase = 'ai_search';
            currentMessage = `Searching for ${searchingSlot.poiName}`;
          } else if (activeSlots[0]) {
            currentPhase = activeSlots[0].phase;
            currentMessage = `Processing ${activeSlots[0].poiName}`;
          }
        }
      }

      res.json({
        jobId: status.jobId,
        status: status.status,
        started_at: status.startedAt,
        completed_at: status.completedAt,
        total_trails: status.totalTrails,
        trails_processed: status.trailsProcessed,
        status_found: status.statusFound,
        error_message: status.errorMessage,
        phase: currentPhase,
        phase_message: currentMessage,
        displaySlots
      });

    } catch (error) {
      console.error('Error getting trail status job status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/trail-status/batch-collect/:jobId/cancel', isAdmin, async (req, res) => {
    try {
      const { jobId } = req.params;

      console.log(`Admin ${req.user.email} requested cancellation of trail status job ${jobId}`);

      const cancelled = await cancelTrailJob(pool, jobId);

      if (!cancelled) {
        return res.status(400).json({ error: 'Job not found or not running' });
      }

      res.json({
        success: true,
        message: 'Job cancelled'
      });

    } catch (error) {
      console.error('Error cancelling trail status job:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/trail-status/ai-stats', isAdmin, async (req, res) => {
    try {
      const recentTrailJob = await pool.query(`
        SELECT ai_usage, status
        FROM trail_status_job_status
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (recentTrailJob.rows.length === 0) {
        return res.json({ usage: { gemini: 0 }, errors: {}, activeProvider: 'gemini' });
      }

      const job = recentTrailJob.rows[0];

      // Live in-memory stats while running; persisted DB values once terminal
      if (job.status === 'running') {
        const liveStats = getJobStats();
        return res.json({
          usage: liveStats.usage,
          errors: liveStats.errors,
          activeProvider: liveStats.activeProvider
        });
      }

      let aiUsage = job.ai_usage;
      if (typeof aiUsage === 'string') {
        try {
          aiUsage = JSON.parse(aiUsage);
        } catch (e) {
          console.error('Error parsing ai_usage:', e);
          aiUsage = { gemini: 0 };
        }
      }
      aiUsage = aiUsage || { gemini: 0 };

      res.json({
        usage: {
          gemini: aiUsage.gemini || 0
        },
        errors: {},
        activeProvider: 'gemini'
      });
    } catch (error) {
      console.error('Error getting AI stats:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/twitter/login', isAdmin, async (req, res) => {
    try {
      res.json({
        success: true,
        message: 'Please log in to Twitter in your browser and export cookies using the browser extension or DevTools.',
        instructions_url: 'https://x.com/login'
      });
    } catch (error) {
      console.error('[Twitter Auth] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post('/twitter/save-cookies', isAdmin, async (req, res) => {
    try {
      const { cookies } = req.body;

      if (!cookies) {
        return res.status(400).json({
          success: false,
          error: 'No cookies provided'
        });
      }

      let cookiesArray;
      if (typeof cookies === 'string') {
        try {
          cookiesArray = JSON.parse(cookies);
        } catch (e) {
          return res.status(400).json({
            success: false,
            error: 'Invalid JSON format for cookies'
          });
        }
      } else {
        cookiesArray = cookies;
      }

      if (!Array.isArray(cookiesArray)) {
        return res.status(400).json({
          success: false,
          error: 'Cookies must be an array'
        });
      }

      const authToken = cookiesArray.find(c => c.name === 'auth_token');

      if (!authToken) {
        return res.status(400).json({
          success: false,
          error: 'No auth_token cookie found in provided cookies. Make sure you exported all cookies from x.com'
        });
      }

      // Browser exporters disagree on field name + type: Chrome extensions use expirationDate (Unix int),
      // others use expires (Unix int or ISO string). Try each in order; fall back to a 60-day estimate.
      let expiresDate = null;
      if (authToken.expirationDate) {
        expiresDate = new Date(authToken.expirationDate * 1000);
      } else if (authToken.expires) {
        if (typeof authToken.expires === 'number') {
          expiresDate = new Date(authToken.expires * 1000);
        } else if (typeof authToken.expires === 'string') {
          expiresDate = new Date(authToken.expires);
        }
      }

      if (!expiresDate || isNaN(expiresDate.getTime())) {
        expiresDate = new Date();
        expiresDate.setDate(expiresDate.getDate() + 60);
        console.log('[Twitter Auth] ⚠️ No expiration date found, estimating 60 days');
      }

      const cookieData = JSON.stringify(cookiesArray);

      await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at, updated_by)
         VALUES ('twitter_cookies', $1, NOW(), $2)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`,
        [cookieData, req.user.id]
      );

      console.log('[Twitter Auth] ✓ Cookies saved to database');
      console.log('[Twitter Auth] Auth token expires:', expiresDate.toISOString());

      res.json({
        success: true,
        message: 'Twitter cookies saved successfully!',
        auth_token_preview: authToken.value.substring(0, 20) + '...',
        expires: expiresDate.toISOString(),
        cookies_count: cookiesArray.length
      });

    } catch (error) {
      console.error('[Twitter Auth] Error saving cookies:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Test if saved Twitter cookies still work
   */
  router.post('/twitter/test-cookies', isAdmin, async (req, res) => {
    try {
      const { chromium } = await import('playwright');

      const cookiesRow = await pool.query(
        "SELECT value FROM admin_settings WHERE key = 'twitter_cookies'"
      );

      if (cookiesRow.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No saved Twitter cookies found. Please log in first.'
        });
      }

      const cookies = JSON.parse(cookiesRow.rows[0].value);
      console.log('[Twitter Auth] Testing', cookies.length, 'saved cookies...');

      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      // Playwright requires Strict/Lax/None for sameSite and 'expires' (not 'expirationDate')
      const sanitizedCookies = cookies.map(cookie => {
        const sanitized = { ...cookie };

        if (sanitized.sameSite && !['Strict', 'Lax', 'None'].includes(sanitized.sameSite)) {
          sanitized.sameSite = 'Lax';
        }

        if (!sanitized.name || !sanitized.value) {
          return null;
        }

        if (sanitized.expirationDate && !sanitized.expires) {
          sanitized.expires = sanitized.expirationDate;
        }

        return sanitized;
      }).filter(c => c !== null);

      await context.addCookies(sanitizedCookies);

      const page = await context.newPage();

      // Logged-out users get redirected to /login from /home — use that to detect auth state
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const currentUrl = page.url();
      const pageTitle = await page.title();

      console.log('[Twitter Auth] Test result - URL:', currentUrl);
      console.log('[Twitter Auth] Test result - Title:', pageTitle);

      const isLoggedIn = currentUrl.includes('/home') && !currentUrl.includes('/login');

      await browser.close();

      if (isLoggedIn) {
        res.json({
          success: true,
          message: 'Twitter cookies are valid! Authentication is working.',
          logged_in: true
        });
      } else {
        res.json({
          success: false,
          message: 'Twitter cookies have expired. Please log in again.',
          logged_in: false
        });
      }

    } catch (error) {
      console.error('[Twitter Auth] Error testing cookies:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.get('/twitter/auth-status', isAdmin, async (req, res) => {
    try {
      const authStatusRow = await pool.query(
        "SELECT value, updated_at FROM admin_settings WHERE key = 'twitter_cookies'"
      );

      if (authStatusRow.rows.length === 0) {
        return res.json({
          authenticated: false,
          message: 'No Twitter cookies saved'
        });
      }

      const cookies = JSON.parse(authStatusRow.rows[0].value);
      const authToken = cookies.find(c => c.name === 'auth_token');

      if (!authToken) {
        return res.json({
          authenticated: false,
          message: 'No auth_token found in saved cookies'
        });
      }

      // Browser exporters disagree on field name + type — see /twitter/save-cookies for details
      let expiresDate = null;
      if (authToken.expirationDate) {
        expiresDate = new Date(authToken.expirationDate * 1000);
      } else if (authToken.expires) {
        if (typeof authToken.expires === 'number') {
          expiresDate = new Date(authToken.expires * 1000);
        } else if (typeof authToken.expires === 'string') {
          expiresDate = new Date(authToken.expires);
        }
      }

      // Missing/invalid date is treated as not-expired (session cookie semantics)
      const isExpired = expiresDate && !isNaN(expiresDate.getTime()) ? expiresDate < new Date() : false;

      let consecutiveFailures = 0;
      try {
        const failResult = await pool.query(
          "SELECT value FROM admin_settings WHERE key = 'twitter_consecutive_failures'"
        );
        if (failResult.rows.length > 0) {
          consecutiveFailures = parseInt(failResult.rows[0].value) || 0;
        }
      } catch (_) { /* ignore */ }

      res.json({
        authenticated: !isExpired,
        auth_token_preview: authToken.value.substring(0, 20) + '...',
        expires: expiresDate && !isNaN(expiresDate.getTime()) ? expiresDate.toISOString() : 'Session',
        saved_at: authStatusRow.rows[0].updated_at,
        is_expired: isExpired,
        cookies_count: cookies.length,
        consecutive_failures: consecutiveFailures,
        cookies_possibly_stale: consecutiveFailures >= 3
      });

    } catch (error) {
      console.error('[Twitter Auth] Error getting auth status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/playwright/status', isAdmin, async (req, res) => {
    const startTime = Date.now();
    let browser = null;

    try {
      const { chromium } = await import('playwright');

      browser = await chromium.launch({
        headless: true,
        timeout: 15000
      });

      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto('about:blank', { timeout: 5000 });

      const version = browser.version();

      await browser.close();
      browser = null;

      const elapsed = Date.now() - startTime;

      res.json({
        status: 'working',
        message: 'Playwright is operational',
        browser_version: version,
        launch_time_ms: elapsed,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const elapsed = Date.now() - startTime;

      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          // Best-effort cleanup
        }
      }

      console.error('[Playwright Status] Error:', error.message);

      let errorType = 'unknown';
      let suggestion = 'Check server logs for details';

      if (error.message.includes('Executable doesn\'t exist')) {
        errorType = 'not_installed';
        suggestion = 'Run: npx playwright install chromium';
      } else if (error.message.includes('timeout')) {
        errorType = 'timeout';
        suggestion = 'Browser launch timed out - server may be under heavy load';
      } else if (error.message.includes('permission')) {
        errorType = 'permission';
        suggestion = 'Check file permissions on Playwright browser directory';
      }

      res.json({
        status: 'error',
        message: error.message,
        error_type: errorType,
        suggestion: suggestion,
        elapsed_ms: elapsed,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/playwright/test', isAdmin, async (req, res) => {
    const { url = 'https://example.com' } = req.body;
    const startTime = Date.now();

    try {
      const { renderJavaScriptPage } = await import('../services/jsRenderer.js');

      const renderOutcome = await renderJavaScriptPage(url, {
        timeout: 15000,
        waitTime: 2000
      });

      const elapsed = Date.now() - startTime;

      if (renderOutcome.success) {
        res.json({
          status: 'success',
          message: 'Page rendered successfully',
          url: url,
          title: renderOutcome.title,
          text_length: renderOutcome.text?.length || 0,
          links_found: renderOutcome.links?.length || 0,
          elapsed_ms: elapsed,
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          status: 'failed',
          message: renderOutcome.error || 'Failed to render page',
          url: url,
          elapsed_ms: elapsed,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error('[Playwright Test] Error:', error.message);

      res.json({
        status: 'error',
        message: error.message,
        url: url,
        elapsed_ms: elapsed,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/test-image-server', isAdmin, async (req, res) => {
    try {
      const connectionTest = await imageServerClient.testConnection();
      res.json(connectionTest);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/moderation/queue', isAdmin, async (req, res) => {
    try {
      const { page = 1, limit = 20, type, status = 'pending', source, search, id, sort } = req.query;
      const queueResult = await getModerationQueue(pool, {
        page: parseInt(page),
        limit: parseInt(limit),
        contentType: type || null,
        status,
        contentSource: source || null,
        search: search || null,
        id: id || null,
        sort: sort || 'collected_desc'
      });
      res.json(queueResult);
    } catch (error) {
      console.error('Error fetching moderation queue:', error);
      res.status(500).json({ error: 'Failed to fetch moderation queue' });
    }
  });

  router.get('/moderation/queue/count', isAdmin, async (req, res) => {
    try {
      const count = await getModerationPendingCount(pool);
      res.json({ count });
    } catch (error) {
      console.error('Error fetching moderation count:', error);
      res.status(500).json({ error: 'Failed to fetch count' });
    }
  });

  router.get('/moderation/item/:type/:id', isAdmin, async (req, res) => {
    try {
      const { type, id } = req.params;
      const item = await getModerationItemDetail(pool, type, parseInt(id));
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      res.json(item);
    } catch (error) {
      console.error('Error fetching moderation item:', error);
      res.status(500).json({ error: 'Failed to fetch item' });
    }
  });

  router.post('/moderation/approve', isAdmin, async (req, res) => {
    try {
      const { type, id } = req.body;
      if (!type || !id) {
        return res.status(400).json({ error: 'type and id are required' });
      }
      await approveItem(pool, type, id, req.user.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error approving item:', error);
      res.status(500).json({ error: 'Failed to approve item' });
    }
  });

  router.post('/moderation/reject', isAdmin, async (req, res) => {
    try {
      const { type, id, reason } = req.body;
      if (!type || !id) {
        return res.status(400).json({ error: 'type and id are required' });
      }
      await rejectItem(pool, type, id, req.user.id, reason);
      res.json({ success: true });
    } catch (error) {
      console.error('Error rejecting item:', error);
      res.status(500).json({ error: 'Failed to reject item' });
    }
  });

  router.post('/moderation/bulk-approve', isAdmin, async (req, res) => {
    try {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const bulkApproveResult = await bulkApprove(pool, items, req.user.id);
      res.json(bulkApproveResult);
    } catch (error) {
      console.error('Error bulk approving:', error);
      res.status(500).json({ error: 'Failed to bulk approve' });
    }
  });

  router.post('/moderation/bulk-reject', isAdmin, async (req, res) => {
    try {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const bulkRejectResult = await bulkReject(pool, items, req.user.id);
      res.json(bulkRejectResult);
    } catch (error) {
      console.error('Error bulk rejecting:', error);
      res.status(500).json({ error: 'Failed to bulk reject' });
    }
  });

  router.post('/moderation/edit-publish', isAdmin, async (req, res) => {
    try {
      const { type, id, edits } = req.body;
      if (!type || !id || !edits) {
        return res.status(400).json({ error: 'type, id, and edits are required' });
      }
      await editAndPublish(pool, type, id, edits, req.user.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error edit-publishing:', error);
      res.status(500).json({ error: 'Failed to edit and publish' });
    }
  });

  router.post('/moderation/save', isAdmin, async (req, res) => {
    try {
      const { type, id, edits } = req.body;
      console.log('[Moderation Save] Request:', { type, id, edits });
      if (!type || !id || !edits) {
        return res.status(400).json({ error: 'type, id, and edits are required' });
      }
      await editAndPublish(pool, type, id, edits, req.user.id, { publish: false });
      console.log('[Moderation Save] Success');
      res.json({ success: true });
    } catch (error) {
      console.error('[Moderation Save] Error:', error.message);
      console.error('[Moderation Save] Stack:', error.stack);
      res.status(500).json({ error: 'Failed to save edits' });
    }
  });

  router.post('/moderation/requeue', isAdmin, async (req, res) => {
    try {
      const { type, id } = req.body;
      if (!type || !id) {
        return res.status(400).json({ error: 'type and id are required' });
      }
      await requeueItem(pool, type, id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error requeuing item:', error);
      res.status(500).json({ error: 'Failed to requeue item' });
    }
  });

  router.get('/moderation/ia-date', isAdmin, async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ error: 'url query parameter is required' });
      }
      // CDX API expects raw URLs — encodeURIComponent escapes slashes to %2F which causes timeouts
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${url}&output=json&fl=timestamp&limit=1`;

      // IA's CDX API is flaky — retry up to 3 times on 503/network errors
      let response;
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
          response = await fetch(cdxUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (response.ok) break;
          lastError = `CDX API returned ${response.status}`;
          if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
          clearTimeout(timeoutId);
          if (err.name === 'AbortError') {
            lastError = 'request timed out';
          } else {
            lastError = err.message;
          }
          if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (!response || !response.ok) {
        console.error(`[IA Date] CDX API failed after 3 attempts for ${url}: ${lastError}`);
        return res.status(502).json({ error: `Internet Archive unavailable after 3 attempts (${lastError})` });
      }

      let cdxRows;
      try {
        cdxRows = await response.json();
      } catch {
        return res.status(502).json({ error: 'Internet Archive returned non-JSON response' });
      }
      // CDX response shape: [[header], [row]] — first row after header is earliest snapshot
      if (cdxRows.length < 2 || !Array.isArray(cdxRows[1]) || !cdxRows[1][0] || !/^\d{14}$/.test(cdxRows[1][0])) {
        return res.json({ date: null, message: 'No snapshots found' });
      }
      const timestamp = cdxRows[1][0];
      const date = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
      res.json({ date, timestamp, message: `Earliest snapshot: ${date}` });
    } catch (error) {
      console.error('Error querying Internet Archive:', error);
      res.status(500).json({ error: 'Failed to query Internet Archive' });
    }
  });

  // Fix publication date via AI web search (legacy — kept for backward compatibility)
  router.post('/moderation/fix-date', isAdmin, async (req, res) => {
    try {
      const { type, id } = req.body;
      if (!type || !id) {
        return res.status(400).json({ error: 'type and id are required' });
      }
      if (type === 'photo') {
        return res.status(400).json({ error: 'Fix Date is not available for photos' });
      }
      const fixDateResult = await fixDate(pool, type, id);
      res.json({ success: true, ...fixDateResult });
    } catch (error) {
      console.error('Error fixing date:', error);
      res.status(500).json({ error: error.message || 'Failed to fix date' });
    }
  });

  router.post('/moderation/create', isAdmin, async (req, res) => {
    try {
      const { type, fields } = req.body;
      if (!type || !fields || !fields.title || !fields.poi_id) {
        return res.status(400).json({ error: 'type, fields.title, and fields.poi_id are required' });
      }
      if (type === 'event' && !fields.start_date) {
        return res.status(400).json({ error: 'fields.start_date is required for events' });
      }
      const newId = await createItem(pool, type, fields, req.user.id);
      res.json({ success: true, id: newId });
    } catch (error) {
      console.error('Error creating content:', error);
      res.status(500).json({ error: 'Failed to create content' });
    }
  });

  router.get('/moderation/merge-candidates/:type/:id', isAdmin, async (req, res) => {
    try {
      const { type, id } = req.params;
      if (!['news', 'event'].includes(type)) {
        return res.status(400).json({ error: 'type must be news or event' });
      }
      const candidates = await getMergeCandidates(pool, type, parseInt(id));
      res.json(candidates);
    } catch (error) {
      console.error('Error fetching merge candidates:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch merge candidates' });
    }
  });

  router.post('/moderation/merge', isAdmin, async (req, res) => {
    try {
      const { type, sourceId, targetId } = req.body;
      if (!type || !sourceId || !targetId) {
        return res.status(400).json({ error: 'type, sourceId, and targetId are required' });
      }
      if (!['news', 'event'].includes(type)) {
        return res.status(400).json({ error: 'Merge is only supported for news and event items' });
      }
      const mergeResult = await mergeItems(pool, type, parseInt(sourceId), parseInt(targetId));
      res.json({ success: true, ...mergeResult });
    } catch (error) {
      console.error('Error merging items:', error);
      res.status(500).json({ error: error.message || 'Failed to merge items' });
    }
  });

  router.post('/moderation/add-url', isAdmin, async (req, res) => {
    try {
      const { type, id, url, sourceName } = req.body;
      if (!type || !id || !url) {
        return res.status(400).json({ error: 'type, id, and url are required' });
      }
      const addUrlResult = await addItemUrl(pool, type, parseInt(id), url, sourceName || null);
      res.json({ success: true, ...addUrlResult });
    } catch (error) {
      console.error('Error adding URL:', error);
      res.status(500).json({ error: error.message || 'Failed to add URL' });
    }
  });

  router.post('/moderation/remove-url', isAdmin, async (req, res) => {
    try {
      const { type, id, urlId } = req.body;
      if (!type || !id || !urlId) {
        return res.status(400).json({ error: 'type, id, and urlId are required' });
      }
      const removeUrlResult = await removeItemUrl(pool, type, parseInt(id), parseInt(urlId));
      res.json({ success: true, ...removeUrlResult });
    } catch (error) {
      console.error('Error removing URL:', error);
      res.status(500).json({ error: error.message || 'Failed to remove URL' });
    }
  });

  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    }
  });

  router.post('/photos/submit', isAuthenticated, photoUpload.single('file'), async (req, res) => {
    try {
      const enabledResult = await pool.query(
        "SELECT value FROM admin_settings WHERE key = 'photo_submissions_enabled'"
      );
      const enabled = enabledResult.rows.length && enabledResult.rows[0].value === 'true';
      if (!enabled) {
        return res.status(403).json({ error: 'Photo submissions are currently disabled' });
      }

      const { poi_id, caption } = req.body;
      if (!req.file || !poi_id) {
        return res.status(400).json({ error: 'file and poi_id are required' });
      }

      const uploadResult = await imageServerClient.uploadImage(
        req.file.buffer,
        parseInt(poi_id),
        'submission',
        req.file.originalname,
        req.file.mimetype
      );

      if (!uploadResult.success) {
        return res.status(500).json({ error: 'Failed to upload image: ' + uploadResult.error });
      }

      const submissionRow = await pool.query(
        `INSERT INTO photo_submissions (poi_id, image_server_asset_id, original_filename, submitted_by, caption)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [parseInt(poi_id), uploadResult.assetId, req.file.originalname, req.user.id, caption || null]
      );

      res.json({ success: true, submissionId: submissionRow.rows[0].id });
    } catch (error) {
      console.error('Error submitting photo:', error);
      res.status(500).json({ error: 'Failed to submit photo' });
    }
  });

  router.get('/jobs/history', isAdmin, async (req, res) => {
    try {
      const type = req.query.type || null;
      const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 100));
      const offset = Math.max(0, parseInt(req.query.offset) || 0);

      // Date-bound subqueries (perf), exclude job_id=0 from GROUP BY (prevents collapsing unrelated rows),
      // and infer 'running' from recent activity since job_logs lacks a status column. (Fix)
      let query = `
        SELECT * FROM (
          SELECT id, 'news' AS job_type, job_type AS sub_type, status,
                 started_at, completed_at, total_pois AS items_total,
                 pois_processed AS items_processed, error_message,
                 created_at
          FROM news_job_status
          WHERE created_at > NOW() - INTERVAL '90 days'
          UNION ALL
          SELECT id, 'trail_status' AS job_type, job_type AS sub_type, status,
                 started_at, completed_at, total_trails AS items_total,
                 trails_processed AS items_processed, error_message,
                 created_at
          FROM trail_status_job_status
          WHERE created_at > NOW() - INTERVAL '90 days'
          UNION ALL
          SELECT job_id AS id, job_type, job_type AS sub_type,
                 CASE
                   WHEN bool_or(level = 'error') THEN 'failed'
                   WHEN bool_or((details->>'completed')::boolean) THEN 'completed'
                   WHEN MAX(created_at) > NOW() - INTERVAL '10 minutes' THEN 'running'
                   ELSE 'stale'
                 END AS status,
                 MIN(created_at) AS started_at,
                 MAX(created_at) AS completed_at,
                 COUNT(DISTINCT poi_id) FILTER (WHERE poi_id IS NOT NULL) AS items_total,
                 COUNT(DISTINCT poi_id) FILTER (WHERE poi_id IS NOT NULL) AS items_processed,
                 MAX(CASE WHEN level = 'error' THEN message END) AS error_message,
                 MIN(created_at) AS created_at
          FROM job_logs
          WHERE job_type NOT IN ('news', 'trail_status')
            AND job_id > 0
            AND created_at > NOW() - INTERVAL '90 days'
          GROUP BY job_type, job_id
        ) AS jobs
      `;

      const params = [];
      let paramIdx = 1;

      if (type) {
        query += ` WHERE job_type = $${paramIdx}`;
        params.push(type);
        paramIdx++;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(limit, offset);

      const jobHistoryRows = await pool.query(query, params);
      res.json(jobHistoryRows.rows);
    } catch (error) {
      console.error('Error fetching job history:', error);
      res.status(500).json({ error: 'Failed to fetch job history' });
    }
  });

  router.get('/jobs/logs', isAdmin, async (req, res) => {
    try {
      const { jobType, poiId } = req.query;
      const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 100, 500));
      const offset = Math.max(0, parseInt(req.query.offset) || 0);

      if (!jobType || !poiId) {
        return res.status(400).json({
          error: 'jobType and poiId are required'
        });
      }

      const query = `
        SELECT id, level, message, details, poi_name, created_at
        FROM job_logs
        WHERE job_type = $1 AND poi_id = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
      `;

      const poiLogRows = await pool.query(query, [jobType, poiId, limit, offset]);

      res.json({
        success: true,
        data: {
          logs: poiLogRows.rows,
          pagination: {
            returned: poiLogRows.rowCount,
            limit,
            offset
          }
        }
      });
    } catch (error) {
      console.error('Error fetching single-POI job logs:', error);
      res.status(500).json({ error: 'Failed to fetch job logs' });
    }
  });

  router.get('/jobs/:jobType/:jobId/logs', isAdmin, async (req, res) => {
    try {
      const { jobType, jobId } = req.params;
      const parsedJobId = parseInt(jobId);
      if (isNaN(parsedJobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }
      const level = req.query.level || null;
      const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 200, 10000));
      const offset = Math.max(0, parseInt(req.query.offset) || 0);

      let query = 'SELECT * FROM job_logs WHERE job_type = $1 AND job_id = $2';
      const params = [jobType, parsedJobId];
      let paramIdx = 3;

      if (level) {
        query += ` AND level = $${paramIdx}`;
        params.push(level);
        paramIdx++;
      }

      query += ` ORDER BY created_at ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(limit, offset);

      const jobLogRows = await pool.query(query, params);
      res.json(jobLogRows.rows);
    } catch (error) {
      console.error('Error fetching job logs:', error);
      res.status(500).json({ error: 'Failed to fetch job logs' });
    }
  });

  router.get('/jobs/queues', isAdmin, async (req, res) => {
    try {
      const boss = getJobScheduler();

      const QUEUE_INFO = {
        [JOB_NAMES.NEWS_COLLECTION]: { label: 'Daily News & Events', description: 'Collects news and events for all POIs (6 AM daily)' },
        [JOB_NAMES.NEWS_BATCH]: { label: 'News & Events (Manual)', description: 'Admin-triggered batch collection from Data Collection tab' },
        [JOB_NAMES.TRAIL_STATUS_COLLECTION]: { label: 'Trail Status Check', description: 'Checks MTB trail conditions via status URLs (every 30 min)' },
        [JOB_NAMES.TRAIL_STATUS_BATCH]: { label: 'Trail Status (Manual)', description: 'Admin-triggered trail status collection' },
        [JOB_NAMES.CONTENT_MODERATION_SWEEP]: { label: 'Content Moderation', description: 'Scores pending content with Gemini (every 15 min)' },
        [JOB_NAMES.NEWSLETTER_PROCESS]: { label: 'Email Ingestion', description: 'Extracts news and events from inbound newsletters' },
        [JOB_NAMES.IMAGE_BACKUP]: { label: 'Image Server Backup', description: 'Syncs image server media files to Google Drive (2 AM daily)' },
        [JOB_NAMES.DATABASE_BACKUP]: { label: 'Database Backup', description: 'Uploads PostgreSQL dump to Google Drive (3 AM daily)' }
      };

      const queues = [];
      for (const [name, info] of Object.entries(QUEUE_INFO)) {
        try {
          const size = await boss.getQueueSize(name);
          queues.push({
            name,
            label: info.label,
            description: info.description,
            size: size || 0
          });
        } catch {
          queues.push({ name, label: info.label, description: info.description, size: 0 });
        }
      }

      res.json(queues);
    } catch (error) {
      console.error('Error fetching queue status:', error);
      res.status(500).json({ error: 'Failed to fetch queue status' });
    }
  });

  router.get('/jobs/scheduled', isAdmin, async (req, res) => {
    try {
      const { COLLECTION_TYPES, getDefaultPrompt } = await import('../services/collection/registry.js');
      const boss = getJobScheduler();

      const jobs = await Promise.all(COLLECTION_TYPES.map(async (type) => {
        // pg-boss is the source of truth for schedules; registry default only used if no pg-boss row exists
        let currentSchedule = type.schedule;
        if (type.scheduleJobName) {
          try {
            const pgbossResult = await pool.query(
              'SELECT cron FROM pgboss.schedule WHERE name = $1',
              [type.scheduleJobName]
            );
            if (pgbossResult.rows.length > 0) {
              currentSchedule = pgbossResult.rows[0].cron;
            }
          } catch { /* pgboss.schedule may not exist on first boot */ }
        }

        let queueSize = 0;
        try {
          queueSize = await boss.getQueueSize(type.scheduleJobName) || 0;
        } catch { /* queue may not exist yet */ }

        let lastJob = null;
        if (type.statusTable) {
          try {
            const jobResult = await pool.query(
              `SELECT id, status, started_at, completed_at FROM ${type.statusTable} ORDER BY id DESC LIMIT 1`
            );
            if (jobResult.rows.length > 0) lastJob = jobResult.rows[0];
          } catch { /* table may not exist */ }
        }

        let prompts = [];
        if (type.hasPrompt && type.promptKeys.length > 0) {
          for (const pk of type.promptKeys) {
            const currentResult = await pool.query(
              'SELECT value FROM admin_settings WHERE key = $1',
              [pk.key]
            );
            const currentValue = currentResult.rows.length > 0 ? currentResult.rows[0].value : null;
            const defaultValue = await getDefaultPrompt(pk.key);
            prompts.push({
              key: pk.key,
              label: pk.label,
              placeholders: pk.placeholders,
              currentValue: currentValue || defaultValue,
              defaultValue,
              isCustomized: currentValue !== null
            });
          }
        }

        return {
          id: type.id,
          label: type.label,
          description: type.description,
          icon: type.icon,
          scheduleJobName: type.scheduleJobName,
          currentSchedule,
          defaultSchedule: type.schedule,
          queueSize,
          lastJob,
          triggerEndpoint: type.triggerEndpoint,
          manualTriggerMethod: type.manualTriggerMethod,
          hasPrompt: type.hasPrompt,
          historyTypes: type.historyTypes || [],
          prompts
        };
      }));

      jobs.sort((a, b) => a.label.localeCompare(b.label));

      res.json(jobs);
    } catch (error) {
      console.error('Error fetching scheduled jobs:', error);
      res.status(500).json({ error: 'Failed to fetch scheduled jobs' });
    }
  });

  router.put('/jobs/:name/schedule', isAdmin, async (req, res) => {
    const { name } = req.params;
    const { cronExpression } = req.body;

    const { COLLECTION_TYPES } = await import('../services/collection/registry.js');
    const jobType = COLLECTION_TYPES.find(t => t.scheduleJobName === name);
    if (!jobType) {
      return res.status(400).json({ error: `Unknown job name: ${name}` });
    }

    if (!cronExpression || !cronExpression.trim()) {
      return res.status(400).json({ error: 'cronExpression is required' });
    }
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return res.status(400).json({ error: 'Invalid cron expression: must have exactly 5 fields (minute hour day month weekday)' });
    }

    try {
      await updateSchedule(name, cronExpression.trim());

      // Persist to admin_settings — pg-boss schedules are re-registered from this on boot
      await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = EXCLUDED.updated_by`,
        [`schedule_${name}`, cronExpression.trim(), req.user.id]
      );

      console.log(`Admin ${req.user.email} updated schedule for ${name}: ${cronExpression.trim()}`);
      res.json({ success: true, jobName: name, schedule: cronExpression.trim() });
    } catch (error) {
      console.error('Error updating job schedule:', error);
      res.status(500).json({ error: 'Failed to update schedule' });
    }
  });

  router.delete('/jobs/logs/cleanup', isAdmin, async (req, res) => {
    try {
      const days = Math.max(1, parseInt(req.query.days) || 30);
      const cleanupResult = await pool.query(
        `DELETE FROM job_logs WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
        [days]
      );
      res.json({ deleted: cleanupResult.rowCount, days });
    } catch (error) {
      console.error('Error cleaning up job logs:', error);
      res.status(500).json({ error: 'Failed to cleanup job logs' });
    }
  });

  // Must stay in sync with hardcoded tabs in frontend ResultsTab.jsx
  const DEFAULT_SUBTABS = [
    { id: 'all', label: 'Points of Interest', shortLabel: 'POIs', route: '/', filterTypes: null, protected: true },
    { id: 'mtb', label: 'MTB Trail Status', shortLabel: 'MTB Status', route: '/mtb-trail-status', filterTypes: ['mtb-trailhead'], protected: false },
    { id: 'organizations', label: 'Organizations', shortLabel: 'Orgs', route: '/organizations', filterTypes: ['organization'], protected: false }
  ];

  router.get('/collection-types', isAdmin, async (req, res) => {
    try {
      const { COLLECTION_TYPES } = await import('../services/collection/registry.js');

      const enriched = await Promise.all(COLLECTION_TYPES.map(async (type) => {
        let lastJob = null;
        try {
          const jobResult = await pool.query(
            `SELECT id, status, started_at, completed_at FROM ${type.statusTable} ORDER BY id DESC LIMIT 1`
          );
          if (jobResult.rows.length > 0) {
            lastJob = jobResult.rows[0];
          }
        } catch (err) {
          // Status table may not exist on first boot
        }
        return { ...type, lastJob };
      }));

      res.json(enriched);
    } catch (error) {
      console.error('Error fetching collection types:', error);
      res.status(500).json({ error: 'Failed to fetch collection types' });
    }
  });

  router.get('/prompts', isAdmin, async (req, res) => {
    try {
      const { COLLECTION_TYPES, getDefaultPrompt } = await import('../services/collection/registry.js');

      const prompts = [];
      for (const type of COLLECTION_TYPES) {
        for (const pk of type.promptKeys) {
          const currentResult = await pool.query(
            'SELECT value FROM admin_settings WHERE key = $1',
            [pk.key]
          );
          const currentValue = currentResult.rows.length > 0 ? currentResult.rows[0].value : null;
          const defaultValue = await getDefaultPrompt(pk.key);

          prompts.push({
            key: pk.key,
            label: pk.label,
            placeholders: pk.placeholders,
            collectionTypeId: type.id,
            collectionTypeLabel: type.label,
            currentValue: currentValue || defaultValue,
            defaultValue,
            isCustomized: currentValue !== null
          });
        }
      }

      res.json(prompts);
    } catch (error) {
      console.error('Error fetching prompts:', error);
      res.status(500).json({ error: 'Failed to fetch prompts' });
    }
  });

  router.put('/prompts/:key', isAdmin, async (req, res) => {
    const { key } = req.params;
    const { value, reset } = req.body;

    try {
      const { COLLECTION_TYPES } = await import('../services/collection/registry.js');

      const validKeys = COLLECTION_TYPES.flatMap(t => t.promptKeys.map(pk => pk.key));
      if (!validKeys.includes(key)) {
        return res.status(400).json({ error: `Invalid prompt key: ${key}` });
      }

      if (reset) {
        await pool.query('DELETE FROM admin_settings WHERE key = $1', [key]);
        console.log(`Admin ${req.user.email} reset prompt: ${key}`);
      } else {
        if (!value || !value.trim()) {
          return res.status(400).json({ error: 'Prompt value cannot be empty' });
        }
        await pool.query(
          `INSERT INTO admin_settings (key, value, updated_at, updated_by)
           VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
           ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             updated_at = CURRENT_TIMESTAMP,
             updated_by = EXCLUDED.updated_by`,
          [key, value, req.user.id]
        );
        console.log(`Admin ${req.user.email} updated prompt: ${key}`);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating prompt:', error);
      res.status(500).json({ error: 'Failed to update prompt' });
    }
  });

  router.get('/results-subtabs', isAdmin, async (req, res) => {
    try {
      const subtabsRow = await pool.query(
        "SELECT value FROM admin_settings WHERE key = 'results_subtabs_config'"
      );
      if (subtabsRow.rows.length > 0 && subtabsRow.rows[0].value) {
        res.json(JSON.parse(subtabsRow.rows[0].value));
      } else {
        res.json({ subtabs: DEFAULT_SUBTABS });
      }
    } catch (error) {
      console.error('Error fetching results subtabs:', error);
      res.status(500).json({ error: 'Failed to fetch results subtabs config' });
    }
  });

  router.put('/results-subtabs', isAdmin, async (req, res) => {
    const { subtabs } = req.body;

    if (!Array.isArray(subtabs) || subtabs.length === 0) {
      return res.status(400).json({ error: 'subtabs must be a non-empty array' });
    }

    if (subtabs[0].id !== 'all') {
      return res.status(400).json({ error: 'First sub-tab must be "all" (Points of Interest)' });
    }

    try {
      const config = JSON.stringify({ subtabs });
      await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at, updated_by)
         VALUES ('results_subtabs_config', $1, CURRENT_TIMESTAMP, $2)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = EXCLUDED.updated_by`,
        [config, req.user.id]
      );

      console.log(`Admin ${req.user.email} updated results subtabs config`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating results subtabs:', error);
      res.status(500).json({ error: 'Failed to update results subtabs config' });
    }
  });

  router.get('/users', isAdmin, async (req, res) => {
    try {
      const userRows = await pool.query(
        `SELECT id, email, name, picture_url, oauth_provider, role, is_admin, last_login_at, created_at
         FROM users ORDER BY last_login_at DESC NULLS LAST`
      );
      const users = userRows.rows.map(row => ({
        id: row.id,
        email: row.email,
        name: row.name,
        pictureUrl: row.picture_url,
        oauthProvider: row.oauth_provider,
        role: row.role || 'viewer',
        isAdmin: row.is_admin,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at
      }));
      res.json(users);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  router.put('/users/:id/role', isAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }

      const { role } = req.body;
      const validRoles = ['viewer', 'poi_admin', 'media_admin', 'admin'];

      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }

      if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot change your own role' });
      }

      const isAdminValue = role === 'admin';

      const roleUpdate = await pool.query(
        'UPDATE users SET role = $1, is_admin = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [role, isAdminValue, userId]
      );

      if (roleUpdate.rowCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      console.log(`Admin ${req.user.email} changed user ${userId} role to ${role}`);
      res.json({ success: true, role });
    } catch (error) {
      console.error('Error updating user role:', error);
      res.status(500).json({ error: 'Failed to update user role' });
    }
  });

  router.get('/poi-media', isAdmin, async (req, res) => {
    try {
      const { poi_id, status } = req.query;

      let query = `
        SELECT
          pm.id,
          pm.poi_id,
          pm.media_type,
          pm.image_server_asset_id,
          pm.youtube_url,
          pm.role,
          pm.sort_order,
          pm.likes_count,
          pm.caption,
          pm.moderation_status,
          pm.submitted_by,
          pm.created_at,
          p.name AS poi_name,
          u.email AS submitted_by_email
        FROM poi_media pm
        JOIN pois p ON pm.poi_id = p.id
        LEFT JOIN users u ON pm.submitted_by = u.id
        WHERE 1=1
      `;

      const params = [];

      if (poi_id) {
        params.push(parseInt(poi_id));
        query += ` AND pm.poi_id = $${params.length}`;
      }

      if (status) {
        params.push(status);
        query += ` AND pm.moderation_status = $${params.length}`;
      }

      query += ` ORDER BY pm.created_at DESC LIMIT 100`;

      const mediaRows = await pool.query(query, params);
      res.json(mediaRows.rows);
    } catch (error) {
      console.error('Error listing poi media:', error);
      res.status(500).json({ error: 'Failed to list media' });
    }
  });

  router.patch('/poi-media/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { role, sort_order, caption } = req.body;

      const updates = [];
      const params = [id];

      if (role !== undefined) {
        params.push(role);
        updates.push(`role = $${params.length}`);
      }

      if (sort_order !== undefined) {
        params.push(sort_order);
        updates.push(`sort_order = $${params.length}`);
      }

      if (caption !== undefined) {
        params.push(caption);
        updates.push(`caption = $${params.length}`);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
      }

      const query = `
        UPDATE poi_media
        SET ${updates.join(', ')}
        WHERE id = $1
        RETURNING *
      `;

      const mediaUpdate = await pool.query(query, params);

      if (mediaUpdate.rows.length === 0) {
        return res.status(404).json({ error: 'Media not found' });
      }

      if (invalidateMosaicCache) {
        invalidateMosaicCache(mediaUpdate.rows[0].poi_id);
      }

      res.json({ success: true, media: mediaUpdate.rows[0] });
    } catch (error) {
      console.error('Error updating poi media:', error);
      res.status(500).json({ error: 'Failed to update media' });
    }
  });

  router.delete('/poi-media/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { permanent } = req.query;

      if (permanent === 'true') {
        // Fix: image server delete BEFORE DB delete — if IS fails we throw (retryable);
        // reverse order would leak unmanageable orphaned files. (Gemini review PR #182)
        const mediaResult = await pool.query(
          'SELECT * FROM poi_media WHERE id = $1',
          [id]
        );

        if (mediaResult.rows.length === 0) {
          return res.status(404).json({ error: 'Media not found' });
        }

        const media = mediaResult.rows[0];

        if (media.image_server_asset_id) {
          const imageServerClient = (await import('../services/imageServerClient.js')).default;
          await imageServerClient.deleteAsset(media.image_server_asset_id);
        }

        await pool.query('DELETE FROM poi_media WHERE id = $1', [id]);

        if (invalidateMosaicCache) {
          invalidateMosaicCache(media.poi_id);
        }

        res.json({ success: true, message: 'Media permanently deleted' });
      } else {
        const softDelete = await pool.query(
          `UPDATE poi_media
           SET moderation_status = 'rejected'
           WHERE id = $1
           RETURNING id, poi_id`,
          [id]
        );

        if (softDelete.rows.length === 0) {
          return res.status(404).json({ error: 'Media not found' });
        }

        if (invalidateMosaicCache) {
          invalidateMosaicCache(softDelete.rows[0].poi_id);
        }

        res.json({ success: true, message: 'Media deleted' });
      }
    } catch (error) {
      console.error('Error deleting poi media:', error);
      res.status(500).json({ error: 'Failed to delete media' });
    }
  });

  router.get('/moderation/media', isAdmin, async (req, res) => {
    try {
      const pendingMediaRows = await pool.query(`
        SELECT
          pm.id,
          pm.poi_id,
          pm.media_type,
          pm.image_server_asset_id,
          pm.youtube_url,
          pm.caption,
          pm.confidence_score,
          pm.ai_reasoning,
          pm.submitted_by,
          pm.created_at,
          p.name AS poi_name,
          u.email AS submitted_by_email
        FROM poi_media pm
        JOIN pois p ON pm.poi_id = p.id
        LEFT JOIN users u ON pm.submitted_by = u.id
        WHERE pm.moderation_status = 'pending'
        ORDER BY pm.created_at DESC
      `);

      res.json(pendingMediaRows.rows);
    } catch (error) {
      console.error('Error fetching pending media:', error);
      res.status(500).json({ error: 'Failed to fetch pending media' });
    }
  });

  router.post('/moderation/media/:id/approve', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const approvedMedia = await pool.query(
        `UPDATE poi_media
         SET moderation_status = 'published',
             moderated_at = NOW(),
             moderated_by = $1
         WHERE id = $2 AND moderation_status = 'pending'
         RETURNING *`,
        [req.user.id, id]
      );

      if (approvedMedia.rows.length === 0) {
        return res.status(404).json({ error: 'Pending media not found' });
      }

      if (invalidateMosaicCache) {
        invalidateMosaicCache(approvedMedia.rows[0].poi_id);
      }

      res.json({ success: true, media: approvedMedia.rows[0] });
    } catch (error) {
      console.error('Error approving media:', error);
      res.status(500).json({ error: 'Failed to approve media' });
    }
  });

  router.post('/moderation/media/:id/reject', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const rejectedMedia = await pool.query(
        `UPDATE poi_media
         SET moderation_status = 'rejected',
             moderated_at = NOW(),
             moderated_by = $1,
             ai_reasoning = $2
         WHERE id = $3 AND moderation_status = 'pending'
         RETURNING *`,
        [req.user.id, reason || 'Rejected by moderator', id]
      );

      if (rejectedMedia.rows.length === 0) {
        return res.status(404).json({ error: 'Pending media not found' });
      }

      if (invalidateMosaicCache) {
        invalidateMosaicCache(rejectedMedia.rows[0].poi_id);
      }

      res.json({ success: true, media: rejectedMedia.rows[0] });
    } catch (error) {
      console.error('Error rejecting media:', error);
      res.status(500).json({ error: 'Failed to reject media' });
    }
  });

  router.get('/newsletter/stats', isAdmin, async (req, res) => {
    try {
      const { getSubscriberCount } = await import('../services/buttondownClient.js');

      let totalSubscribers = 0;
      let source = 'local';

      try {
        totalSubscribers = await getSubscriberCount(pool);
        source = 'buttondown';
      } catch (error) {
        if (error.message === 'BUTTONDOWN_NOT_CONFIGURED') {
          const localResult = await pool.query(
            'SELECT COUNT(DISTINCT email) as total FROM newsletter_subscriptions'
          );
          totalSubscribers = parseInt(localResult.rows[0].total);
        } else {
          throw error;
        }
      }

      const newThisWeekRow = await pool.query(
        `SELECT COUNT(*) as new_this_week
         FROM newsletter_subscriptions
         WHERE subscribed_at > NOW() - INTERVAL '7 days'`
      );

      res.json({
        total_subscribers: totalSubscribers,
        new_this_week: parseInt(newThisWeekRow.rows[0].new_this_week),
        source
      });
    } catch (error) {
      console.error('Newsletter stats error:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  router.post('/moderation/sweep', isAdmin, async (req, res) => {
    try {
      console.log(`Admin ${req.user.email} triggered manual moderation sweep`);
      // Fire-and-forget — response must return before sweep completes (can take minutes)
      const { processPendingItems } = await import('../services/moderationService.js');
      processPendingItems(pool).catch(err => {
        console.error('Background moderation sweep error:', err.message);
      });
      res.json({ message: 'Moderation sweep started' });
    } catch (error) {
      console.error('Moderation sweep error:', error);
      res.status(500).json({ error: 'Moderation sweep failed to start' });
    }
  });

  return router;
}
