import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAdmin, isAuthenticated } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  createSheetsService,
  createDriveService,
  createSheetsServiceWithRefresh,
  createDriveServiceWithRefresh,
  isFileTrashed,
  getSyncStatus,
  pushAllToSheets,
  pullAllFromSheets,
  processSyncQueue,
  queueSyncOperation,
  createAppSpreadsheet,
  getSpreadsheetId,
  getSpreadsheetInfo,
  pushActivitiesToSheets,
  pullActivitiesFromSheets,
  pushErasToSheets,
  pullErasFromSheets,
  pushSurfacesToSheets,
  pullSurfacesFromSheets,
  pushIconsToSheets,
  pullIconsFromSheets,
  pushIntegrationToSheets,
  pullIntegrationFromSheets,
  pushNewsToSheets,
  pullNewsFromSheets,
  pushEventsToSheets,
  pullEventsFromSheets,
  pushAssociationsToSheets,
  pullAssociationsFromSheets,
  SHEET_NAME
} from '../services/sheetsSync.js';
import {
  ensureDriveFolders,
  uploadIconToDrive,
  uploadImageToDrive,
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
  getNewsForPoi,
  getEventsForPoi,
  getRecentNews,
  getUpcomingEvents,
  getLatestJobStatus,
  getJobStatus,
  cleanupOldNews,
  cleanupPastEvents,
  collectNewsForPoi,
  saveNewsItems,
  saveEventItems,
  getCollectionProgress,
  clearProgress,
  updateProgress,
  requestCancellation,
  getDisplaySlots as getNewsDisplaySlots
} from '../services/newsService.js';
import { submitBatchNewsJob, queueModerationJob } from '../services/jobScheduler.js';
import {
  getQueue as getModerationQueue,
  getPendingCount as getModerationPendingCount,
  getItemDetail as getModerationItemDetail,
  approveItem,
  rejectItem,
  bulkApprove,
  editAndPublish,
  requeueItem,
  researchItem,
  fixDate,
  createItem,
  purgeRejected,
  processItem
} from '../services/moderationService.js';
import { getJobStats, resetJobUsage } from '../services/aiSearchFactory.js';
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

const router = express.Router();

export function createAdminRouter(pool) {
  // Helper to queue sync operation after a change
  async function queuePOISync(operation, recordId, data) {
    try {
      // Exclude large binary fields from sync queue data
      // These are not needed for Google Sheets sync (only Drive file IDs are synced)
      // GeoJSON/image uploads fetch fresh data from database using record_id
      const { image_data, geometry, ...syncData } = data;
      await queueSyncOperation(pool, operation, 'pois', recordId, syncData);
    } catch (error) {
      console.error('Failed to queue POI sync operation:', error.message);
    }
  }

  // Helper to queue activity sync
  async function queueActivitySync(operation, recordId, data) {
    try {
      await queueSyncOperation(pool, operation, 'activities', recordId, data);
    } catch (error) {
      console.error('Failed to queue activity sync operation:', error.message);
    }
  }

  // Helper to queue era sync
  async function queueEraSync(operation, recordId, data) {
    try {
      await queueSyncOperation(pool, operation, 'eras', recordId, data);
    } catch (error) {
      console.error('Failed to queue era sync operation:', error.message);
    }
  }

  // Helper to queue surface sync
  async function queueSurfaceSync(operation, recordId, data) {
    try {
      await queueSyncOperation(pool, operation, 'surfaces', recordId, data);
    } catch (error) {
      console.error('Failed to queue surface sync operation:', error.message);
    }
  }

  // Helper to queue icon sync
  async function queueIconSync(operation, recordId, data) {
    try {
      await queueSyncOperation(pool, operation, 'icons', recordId, data);
    } catch (error) {
      console.error('Failed to queue icon sync operation:', error.message);
    }
  }

  // Helper to queue settings sync
  async function queueSettingsSync(operation, recordId, data) {
    try {
      await queueSyncOperation(pool, operation, 'settings', recordId, data);
    } catch (error) {
      console.error('Failed to queue settings sync operation:', error.message);
    }
  }

  // Update POI coordinates (for point type POIs)
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
      const result = await pool.query(
        `UPDATE pois
         SET latitude = $1, longitude = $2, updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
         WHERE id = $3
         RETURNING *`,
        [lat, lng, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      await queuePOISync('UPDATE', id, result.rows[0]);
      console.log(`Admin ${req.user.email} updated coordinates for POI ${id}: ${lat}, ${lng}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating coordinates:', error);
      res.status(500).json({ error: 'Failed to update coordinates' });
    }
  });

  // Legacy endpoint - redirect to unified POI endpoint
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
      const result = await pool.query(
        `UPDATE pois
         SET latitude = $1, longitude = $2, updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
         WHERE id = $3
         RETURNING *`,
        [lat, lng, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      await queuePOISync('UPDATE', id, result.rows[0]);
      console.log(`Admin ${req.user.email} updated coordinates for destination ${id}: ${lat}, ${lng}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating coordinates:', error);
      res.status(500).json({ error: 'Failed to update coordinates' });
    }
  });

  // Update POI (all editable fields) - unified endpoint
  router.put('/pois/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const allowedFields = [
      'name', 'poi_type', 'latitude', 'longitude', 'geometry', 'geometry_drive_file_id',
      'property_owner', 'owner_id', 'brief_description', 'era_id', 'historical_description',
      'primary_activities', 'surface', 'pets', 'cell_signal', 'more_info_link',
      'events_url', 'news_url',
      'length_miles', 'difficulty', 'boundary_type', 'boundary_color'
    ];
    const updates = {};
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = `$${paramIndex}`;
        // Handle geometry as JSON
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
      const result = await pool.query(
        `UPDATE pois
         SET ${setClause}, updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      await queuePOISync('UPDATE', id, result.rows[0]);
      console.log(`Admin ${req.user.email} updated POI ${id}:`, Object.keys(updates).join(', '));
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating POI:', error);
      res.status(500).json({ error: 'Failed to update POI' });
    }
  });

  // Legacy: Update destination (redirect to pois)
  router.put('/destinations/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const allowedFields = [
      'name', 'latitude', 'longitude', 'property_owner', 'owner_id', 'brief_description',
      'era', 'era_id', 'historical_description', 'primary_activities', 'surface',
      'pets', 'cell_signal', 'more_info_link', 'events_url', 'news_url', 'status_url'
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
      const result = await pool.query(
        `UPDATE pois
         SET ${setClause}, updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      await queuePOISync('UPDATE', id, result.rows[0]);
      console.log(`Admin ${req.user.email} updated destination ${id}:`, Object.keys(updates).join(', '));
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating destination:', error);
      res.status(500).json({ error: 'Failed to update destination' });
    }
  });

  // Create new destination
  router.post('/destinations', isAdmin, async (req, res) => {
    const { name, latitude, longitude } = req.body;

    // Validate required fields
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
      'property_owner', 'owner_id', 'brief_description', 'era_id', 'historical_description',
      'primary_activities', 'surface', 'pets', 'cell_signal', 'more_info_link',
      'events_url', 'news_url', 'status_url'
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
      const result = await pool.query(
        `INSERT INTO pois (${fields.join(', ')}, created_at, updated_at, locally_modified, synced)
         VALUES (${placeholders}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, TRUE, FALSE)
         RETURNING *`,
        values
      );

      // Queue sync operation
      await queuePOISync('INSERT', result.rows[0].id, result.rows[0]);

      console.log(`Admin ${req.user.email} created new destination: ${name}`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating destination:', error);
      res.status(500).json({ error: 'Failed to create destination' });
    }
  });

  // Create POI (supports all types including virtual)
  router.post('/pois', isAdmin, async (req, res) => {
    const { name, poi_type, latitude, longitude } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!poi_type || !['point', 'trail', 'river', 'boundary', 'virtual'].includes(poi_type)) {
      return res.status(400).json({ error: 'Invalid poi_type. Must be: point, trail, river, boundary, or virtual' });
    }

    // Virtual POIs don't need coordinates
    if (poi_type !== 'virtual') {
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: 'Latitude and longitude are required for non-virtual POIs' });
      }

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
      'poi_type', 'property_owner', 'owner_id', 'brief_description', 'era', 'era_id', 'historical_description',
      'primary_activities', 'surface', 'pets', 'cell_signal', 'more_info_link',
      'events_url', 'news_url', 'image_drive_file_id'
    ];

    const fields = ['name'];
    const values = [name.trim()];
    let paramIndex = 2;

    // Add latitude/longitude for non-virtual POIs
    if (poi_type !== 'virtual') {
      fields.push('latitude', 'longitude');
      values.push(parseFloat(latitude), parseFloat(longitude));
      paramIndex += 2;
    }

    for (const field of allowedFields) {
      if (req.body[field] !== undefined && req.body[field] !== null && req.body[field] !== '') {
        fields.push(field);
        values.push(req.body[field]);
        paramIndex++;
      }
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

    try {
      const result = await pool.query(
        `INSERT INTO pois (${fields.join(', ')}, created_at, updated_at, locally_modified, synced)
         VALUES (${placeholders}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, TRUE, FALSE)
         RETURNING *`,
        values
      );

      // Queue sync operation
      await queuePOISync('INSERT', result.rows[0].id, result.rows[0]);

      console.log(`Admin ${req.user.email} created new POI (${poi_type}): ${name}`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating POI:', error);
      res.status(500).json({ error: 'Failed to create POI' });
    }
  });

  // Delete destination (soft delete - marks as deleted so it won't come back from Google Sheets sync)
  router.delete('/destinations/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      const result = await pool.query(
        `UPDATE pois
         SET deleted = TRUE, locally_modified = TRUE, synced = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, name`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      // Queue sync operation (delete from sheet)
      await queuePOISync('DELETE', id, { name: result.rows[0].name });

      console.log(`Admin ${req.user.email} deleted destination ${id}: ${result.rows[0].name}`);
      res.json({ success: true, deleted: result.rows[0] });
    } catch (error) {
      console.error('Error deleting destination:', error);
      res.status(500).json({ error: 'Failed to delete destination' });
    }
  });

  // Get admin settings
  router.get('/settings', isAdmin, async (req, res) => {
    try {
      const result = await pool.query('SELECT key, value, updated_at FROM admin_settings');
      const settings = {};
      for (const row of result.rows) {
        // For API keys, only indicate if set (don't expose value)
        if (row.key.includes('api_key')) {
          settings[row.key] = {
            isSet: !!row.value,
            updatedAt: row.updated_at
          };
        } else {
          // For prompts, return the actual value
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

  // Update admin setting
  router.put('/settings/:key', isAdmin, async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    const allowedKeys = [
      'gemini_api_key',
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
      'photo_submissions_enabled'
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

      console.log(`Admin ${req.user.email} updated setting: ${key}`);

      // Queue sync operation for settings
      await queueSettingsSync('UPDATE', 0, { key, value });

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating setting:', error);
      res.status(500).json({ error: 'Failed to update setting' });
    }
  });

  // ============================================
  // AI Content Generation Routes (Gemini)
  // ============================================

  // Get interpolated prompt for preview/editing before generation
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

  // Generate text using custom prompt (with last-mile customization)
  router.post('/ai/generate', isAdmin, async (req, res) => {
    const { customPrompt, destination } = req.body;

    if (!customPrompt || !customPrompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    try {
      // Create sheets client for auto-restore of API key from Integration sheet if needed
      const sheets = req.user.oauth_credentials ? createSheetsService(req.user.oauth_credentials) : null;
      const { generateTextWithCustomPrompt } = await import('../services/geminiService.js');
      const text = await generateTextWithCustomPrompt(pool, customPrompt, sheets);

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

  // Test API key validity
  router.post('/ai/test-key', isAdmin, async (req, res) => {
    try {
      // Create sheets client for auto-restore of API key from Integration sheet if needed
      const sheets = req.user.oauth_credentials ? createSheetsService(req.user.oauth_credentials) : null;
      const { testApiKey } = await import('../services/geminiService.js');
      const response = await testApiKey(pool, sheets);

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

  // Research location and fill all fields using AI with Google Search
  router.post('/ai/research', isAdmin, async (req, res) => {
    const { destination } = req.body;

    if (!destination || !destination.name) {
      return res.status(400).json({ error: 'Destination with name is required' });
    }

    try {
      // Fetch standardized activities list to constrain AI suggestions
      const activitiesResult = await pool.query(
        'SELECT name FROM activities ORDER BY sort_order, name'
      );
      const availableActivities = activitiesResult.rows.map(row => row.name);

      // Fetch standardized eras list to constrain AI suggestions
      const erasResult = await pool.query(
        'SELECT name FROM eras ORDER BY sort_order, name'
      );
      const availableEras = erasResult.rows.map(row => row.name);

      // Fetch standardized surfaces list to constrain AI suggestions
      const surfacesResult = await pool.query(
        'SELECT name FROM surfaces ORDER BY sort_order, name'
      );
      const availableSurfaces = surfacesResult.rows.map(row => row.name);

      // Create sheets client for auto-restore of API key from Integration sheet if needed
      const sheets = req.user.oauth_credentials ? createSheetsService(req.user.oauth_credentials) : null;
      const { researchLocation } = await import('../services/geminiService.js');
      const data = await researchLocation(pool, destination, availableActivities, availableEras, availableSurfaces, sheets);

      console.log(`Admin ${req.user.email} researched location: ${destination.name}`);
      res.json(data);
    } catch (error) {
      console.error('Error researching location:', error);
      if (error.message?.includes('API key')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: error.message || 'Failed to research location. Please try again.' });
    }
  });

  // ============================================
  // Activities Management Routes
  // ============================================

  // Get all activities (public endpoint for POI form)
  router.get('/activities', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, sort_order FROM activities ORDER BY sort_order, name'
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching activities:', error);
      res.status(500).json({ error: 'Failed to fetch activities' });
    }
  });

  // Create new activity (admin only)
  router.post('/activities', isAdmin, async (req, res) => {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Activity name is required' });
    }

    try {
      // Get max sort_order
      const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM activities');
      const sortOrder = maxOrder.rows[0].next_order;

      const result = await pool.query(
        `INSERT INTO activities (name, sort_order)
         VALUES ($1, $2)
         RETURNING id, name, sort_order`,
        [name.trim(), sortOrder]
      );

      console.log(`Admin ${req.user.email} created activity: ${name}`);
      await queueActivitySync('INSERT', result.rows[0].id, result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Activity with this name already exists' });
      }
      console.error('Error creating activity:', error);
      res.status(500).json({ error: 'Failed to create activity' });
    }
  });

  // Update activity (admin only)
  router.put('/activities/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, sort_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Activity name is required' });
    }

    try {
      // Get the old name first to update POIs
      const oldActivity = await pool.query('SELECT name FROM activities WHERE id = $1', [id]);
      if (oldActivity.rows.length === 0) {
        return res.status(404).json({ error: 'Activity not found' });
      }
      const oldName = oldActivity.rows[0].name;

      const result = await pool.query(
        `UPDATE activities
         SET name = $1, sort_order = COALESCE($2, sort_order), updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING id, name, sort_order`,
        [name.trim(), sort_order, id]
      );

      // If name changed, update all destinations that reference this activity
      const newName = name.trim();
      if (oldName !== newName) {
        // Update primary_activities (comma-separated field) in destinations
        // Format is "Activity1, Activity2, Activity3" (comma-space separated)
        // Need to handle: exact match, start of list, middle of list, end of list
        const updateResult = await pool.query(
          `UPDATE pois
           SET primary_activities = CASE
             WHEN primary_activities = $1 THEN $2
             WHEN primary_activities LIKE $1 || ', %' THEN $2 || SUBSTRING(primary_activities FROM LENGTH($1) + 1)
             WHEN primary_activities LIKE '%, ' || $1 THEN SUBSTRING(primary_activities FROM 1 FOR LENGTH(primary_activities) - LENGTH($1)) || $2
             WHEN primary_activities LIKE '%, ' || $1 || ', %' THEN REPLACE(primary_activities, ', ' || $1 || ', ', ', ' || $2 || ', ')
             ELSE primary_activities
           END,
           updated_at = CURRENT_TIMESTAMP,
           locally_modified = TRUE,
           synced = FALSE
           WHERE primary_activities LIKE '%' || $1 || '%'`,
          [oldName, newName]
        );
        if (updateResult.rowCount > 0) {
          console.log(`Updated ${updateResult.rowCount} POIs with renamed activity: ${oldName} -> ${newName}`);
        }
      }

      console.log(`Admin ${req.user.email} updated activity: ${name}`);
      await queueActivitySync('UPDATE', id, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Activity with this name already exists' });
      }
      console.error('Error updating activity:', error);
      res.status(500).json({ error: 'Failed to update activity' });
    }
  });

  // Delete activity (admin only)
  router.delete('/activities/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      // Get activity data before deleting for queue
      const activityData = await pool.query('SELECT * FROM activities WHERE id = $1', [id]);

      const result = await pool.query(
        'DELETE FROM activities WHERE id = $1 RETURNING name',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Activity not found' });
      }

      console.log(`Admin ${req.user.email} deleted activity: ${result.rows[0].name}`);
      await queueActivitySync('DELETE', id, activityData.rows[0] || { name: result.rows[0].name });
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting activity:', error);
      res.status(500).json({ error: 'Failed to delete activity' });
    }
  });

  // Reorder activities (admin only)
  router.put('/activities/reorder', isAdmin, async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }

    try {
      // Update sort_order for each activity
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

  // Push activities to Google Sheets
  router.post('/activities/sync/push', isAdmin, async (req, res) => {
    console.log(`Activities push requested by ${req.user.email}`);
    try {
      if (!req.user.oauth_credentials) {
        console.log('No OAuth credentials for activities push');
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to sync activities'
        });
      }

      console.log('Creating sheets service for activities push...');
      const sheets = createSheetsService(req.user.oauth_credentials);
      console.log('Calling pushActivitiesToSheets...');
      const count = await pushActivitiesToSheets(sheets, pool);

      console.log(`Admin ${req.user.email} pushed ${count} activities to Google Sheets`);
      res.json({
        success: true,
        message: `Pushed ${count} activities to Google Sheets`,
        count
      });
    } catch (error) {
      console.error('Error pushing activities to sheets:', error);
      res.status(500).json({
        error: 'Failed to push activities to Google Sheets',
        message: error.message
      });
    }
  });

  // Pull activities from Google Sheets
  router.post('/activities/sync/pull', isAdmin, async (req, res) => {
    try {
      if (!req.user.oauth_credentials) {
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to sync activities'
        });
      }

      const sheets = createSheetsService(req.user.oauth_credentials);
      const count = await pullActivitiesFromSheets(sheets, pool);

      console.log(`Admin ${req.user.email} pulled ${count} activities from Google Sheets`);
      res.json({
        success: true,
        message: `Pulled ${count} activities from Google Sheets`,
        count
      });
    } catch (error) {
      console.error('Error pulling activities from sheets:', error);
      res.status(500).json({
        error: 'Failed to pull activities from Google Sheets',
        message: error.message
      });
    }
  });

  // ============================================
  // Eras Management Routes
  // ============================================

  // Get all eras (public endpoint for POI form)
  router.get('/eras', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, year_start, year_end, description, sort_order FROM eras ORDER BY sort_order, name'
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching eras:', error);
      res.status(500).json({ error: 'Failed to fetch eras' });
    }
  });

  // Create new era (admin only)
  router.post('/eras', isAdmin, async (req, res) => {
    const { name, year_start, year_end, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Era name is required' });
    }

    try {
      // Get max sort_order
      const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM eras');
      const sortOrder = maxOrder.rows[0].next_order;

      const result = await pool.query(
        `INSERT INTO eras (name, year_start, year_end, description, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, year_start, year_end, description, sort_order`,
        [name.trim(), year_start || null, year_end || null, description || null, sortOrder]
      );

      console.log(`Admin ${req.user.email} created era: ${name}`);
      await queueEraSync('INSERT', result.rows[0].id, result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Era with this name already exists' });
      }
      console.error('Error creating era:', error);
      res.status(500).json({ error: 'Failed to create era' });
    }
  });

  // Update era (admin only)
  router.put('/eras/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, year_start, year_end, description, sort_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Era name is required' });
    }

    try {
      // Get the old name first to update POIs
      const oldEra = await pool.query('SELECT name FROM eras WHERE id = $1', [id]);
      if (oldEra.rows.length === 0) {
        return res.status(404).json({ error: 'Era not found' });
      }
      const oldName = oldEra.rows[0].name;

      const result = await pool.query(
        `UPDATE eras
         SET name = $1, year_start = $2, year_end = $3, description = $4,
             sort_order = COALESCE($5, sort_order), updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING id, name, year_start, year_end, description, sort_order`,
        [name.trim(), year_start || null, year_end || null, description || null, sort_order, id]
      );

      console.log(`Admin ${req.user.email} updated era: ${name}`);
      await queueEraSync('UPDATE', id, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Era with this name already exists' });
      }
      console.error('Error updating era:', error);
      res.status(500).json({ error: 'Failed to update era' });
    }
  });

  // Delete era (admin only)
  router.delete('/eras/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      // Get era data before deleting for queue
      const eraData = await pool.query('SELECT * FROM eras WHERE id = $1', [id]);

      const result = await pool.query(
        'DELETE FROM eras WHERE id = $1 RETURNING name',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Era not found' });
      }

      console.log(`Admin ${req.user.email} deleted era: ${result.rows[0].name}`);
      await queueEraSync('DELETE', id, eraData.rows[0] || { name: result.rows[0].name });
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting era:', error);
      res.status(500).json({ error: 'Failed to delete era' });
    }
  });

  // Reorder eras (admin only)
  router.put('/eras/reorder', isAdmin, async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }

    try {
      // Update sort_order for each era
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

  // ============================================
  // Surfaces Management Routes
  // ============================================

  // Get all surfaces (public endpoint for POI form)
  router.get('/surfaces', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, description, sort_order FROM surfaces ORDER BY sort_order, name'
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching surfaces:', error);
      res.status(500).json({ error: 'Failed to fetch surfaces' });
    }
  });

  // Create new surface (admin only)
  router.post('/surfaces', isAdmin, async (req, res) => {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Surface name is required' });
    }

    try {
      // Get max sort_order
      const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM surfaces');
      const sortOrder = maxOrder.rows[0].next_order;

      const result = await pool.query(
        `INSERT INTO surfaces (name, description, sort_order)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, sort_order`,
        [name.trim(), description || null, sortOrder]
      );

      console.log(`Admin ${req.user.email} created surface: ${name}`);

      // Queue sync to Google Sheets
      const newSurface = result.rows[0];
      await queueSurfaceSync('create', newSurface.id, { name: newSurface.name, description: newSurface.description, sort_order: newSurface.sort_order });

      res.status(201).json(newSurface);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Surface with this name already exists' });
      }
      console.error('Error creating surface:', error);
      res.status(500).json({ error: 'Failed to create surface' });
    }
  });

  // Reorder surfaces (admin only) - MUST be before :id routes
  router.put('/surfaces/reorder', isAdmin, async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }

    try {
      // Update sort_order for each surface
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          'UPDATE surfaces SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [i + 1, orderedIds[i]]
        );
      }

      console.log(`Admin ${req.user.email} reordered surfaces`);

      // Queue sync for reorder - use 'update' operation with a special marker
      await queueSurfaceSync('update', 0, { reorder: true, orderedIds });

      res.json({ success: true });
    } catch (error) {
      console.error('Error reordering surfaces:', error);
      res.status(500).json({ error: 'Failed to reorder surfaces' });
    }
  });

  // Update surface (admin only)
  router.put('/surfaces/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, description, sort_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Surface name is required' });
    }

    try {
      // Get the old name first to update POIs
      const oldSurface = await pool.query('SELECT name FROM surfaces WHERE id = $1', [id]);
      if (oldSurface.rows.length === 0) {
        return res.status(404).json({ error: 'Surface not found' });
      }
      const oldName = oldSurface.rows[0].name;

      const result = await pool.query(
        `UPDATE surfaces
         SET name = $1, description = $2,
             sort_order = COALESCE($3, sort_order), updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING id, name, description, sort_order`,
        [name.trim(), description || null, sort_order, id]
      );

      // If name changed, update all destinations that reference this surface
      const newName = name.trim();
      if (oldName !== newName) {
        const updateResult = await pool.query(
          `UPDATE pois
           SET surface = $2,
               updated_at = CURRENT_TIMESTAMP,
               locally_modified = TRUE,
               synced = FALSE
           WHERE surface = $1`,
          [oldName, newName]
        );
        if (updateResult.rowCount > 0) {
          console.log(`Updated ${updateResult.rowCount} POIs with renamed surface: ${oldName} -> ${newName}`);
        }
      }

      console.log(`Admin ${req.user.email} updated surface: ${name}`);

      // Queue sync to Google Sheets
      const updatedSurface = result.rows[0];
      await queueSurfaceSync('update', updatedSurface.id, { name: updatedSurface.name, description: updatedSurface.description, sort_order: updatedSurface.sort_order });

      res.json(updatedSurface);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Surface with this name already exists' });
      }
      console.error('Error updating surface:', error);
      res.status(500).json({ error: 'Failed to update surface' });
    }
  });

  // Delete surface (admin only)
  router.delete('/surfaces/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      const result = await pool.query(
        'DELETE FROM surfaces WHERE id = $1 RETURNING name',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Surface not found' });
      }

      console.log(`Admin ${req.user.email} deleted surface: ${result.rows[0].name}`);

      // Queue sync to Google Sheets
      await queueSurfaceSync('delete', parseInt(id), { name: result.rows[0].name });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting surface:', error);
      res.status(500).json({ error: 'Failed to delete surface' });
    }
  });

  // ============================================
  // Icons Management Routes
  // ============================================

  // Get all icons (public endpoint for map)
  router.get('/icons', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, enabled, drive_file_id FROM icons ORDER BY sort_order, name'
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching icons:', error);
      res.status(500).json({ error: 'Failed to fetch icons' });
    }
  });

  // Create new icon (admin only)
  // If svg_content is provided and user has OAuth credentials, auto-uploads to Google Drive
  router.post('/icons', isAdmin, async (req, res) => {
    const { name, label, svg_filename, svg_content, title_keywords, activity_fallbacks } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Icon name is required' });
    }
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Icon label is required' });
    }

    try {
      // Get max sort_order
      const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM icons');
      const sortOrder = maxOrder.rows[0].next_order;

      // Auto-upload to Google Drive if svg_content is provided and user has OAuth
      let driveFileId = null;
      if (svg_content && req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);
          driveFileId = await uploadIconToDrive(drive, pool, name.trim(), svg_content);
          console.log(`Uploaded icon ${name} to Google Drive: ${driveFileId}`);
        } catch (driveError) {
          console.warn(`Failed to upload icon to Drive (non-fatal):`, driveError.message);
          // Continue without Drive upload - icon will still be saved to database
        }
      }

      const result = await pool.query(
        `INSERT INTO icons (name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, drive_file_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, enabled, drive_file_id`,
        [name.trim(), label.trim(), svg_filename || null, svg_content || null, title_keywords || null, activity_fallbacks || null, sortOrder, driveFileId]
      );

      console.log(`Admin ${req.user.email} created icon: ${name}${driveFileId ? ' (uploaded to Drive)' : ''}`);

      // Queue sync to Google Sheets
      const newIcon = result.rows[0];
      await queueIconSync('create', newIcon.id, { name: newIcon.name, label: newIcon.label });

      res.status(201).json(newIcon);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Icon with this name already exists' });
      }
      console.error('Error creating icon:', error);
      res.status(500).json({ error: 'Failed to create icon' });
    }
  });

  // Generate icon SVG using AI (admin only)
  router.post('/icons/generate', isAdmin, async (req, res) => {
    const { description, color } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Icon description is required' });
    }
    if (!color || !color.trim()) {
      return res.status(400).json({ error: 'Icon color is required' });
    }

    // Validate color is a hex color
    if (!/^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g., #0288d1)' });
    }

    try {
      // Create sheets client for auto-restore of API key from Integration sheet if needed
      const sheets = req.user.oauth_credentials ? createSheetsService(req.user.oauth_credentials) : null;
      const { generateIconSvg } = await import('../services/geminiService.js');
      const svgContent = await generateIconSvg(pool, description.trim(), color.trim(), sheets);

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

  // Reorder icons (admin only) - MUST be before :id routes
  router.put('/icons/reorder', isAdmin, async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }

    try {
      // Update sort_order for each icon
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          'UPDATE icons SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [i + 1, orderedIds[i]]
        );
      }

      console.log(`Admin ${req.user.email} reordered icons`);

      // Queue sync for reorder
      await queueIconSync('update', 0, { reorder: true, orderedIds });

      res.json({ success: true });
    } catch (error) {
      console.error('Error reordering icons:', error);
      res.status(500).json({ error: 'Failed to reorder icons' });
    }
  });

  // Update icon (admin only)
  // If svg_content changed and user has OAuth credentials, re-uploads to Google Drive
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
      // Get existing icon to check if svg_content changed
      const existing = await pool.query('SELECT svg_content, drive_file_id FROM icons WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Icon not found' });
      }

      const existingIcon = existing.rows[0];
      let driveFileId = existingIcon.drive_file_id;

      // Re-upload to Drive if svg_content changed and user has OAuth
      if (svg_content && svg_content !== existingIcon.svg_content && req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);
          driveFileId = await uploadIconToDrive(drive, pool, name.trim(), svg_content);
          console.log(`Re-uploaded icon ${name} to Google Drive: ${driveFileId}`);
        } catch (driveError) {
          console.warn(`Failed to re-upload icon to Drive (non-fatal):`, driveError.message);
          // Keep existing drive_file_id if upload failed
        }
      }

      const result = await pool.query(
        `UPDATE icons
         SET name = $1, label = $2, svg_filename = $3, svg_content = $4, title_keywords = $5, activity_fallbacks = $6,
             sort_order = COALESCE($7, sort_order), enabled = COALESCE($8, enabled), drive_file_id = $9, updated_at = CURRENT_TIMESTAMP
         WHERE id = $10
         RETURNING id, name, label, svg_filename, svg_content, title_keywords, activity_fallbacks, sort_order, enabled, drive_file_id`,
        [name.trim(), label.trim(), svg_filename || null, svg_content, title_keywords || null, activity_fallbacks || null, sort_order, enabled, driveFileId, id]
      );

      console.log(`Admin ${req.user.email} updated icon: ${name}`);

      // Queue sync to Google Sheets
      const updatedIcon = result.rows[0];
      await queueIconSync('update', updatedIcon.id, { name: updatedIcon.name, label: updatedIcon.label });

      res.json(updatedIcon);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Icon with this name already exists' });
      }
      console.error('Error updating icon:', error);
      res.status(500).json({ error: 'Failed to update icon' });
    }
  });

  // Delete icon (admin only)
  // Also deletes from Google Drive if icon was stored there
  router.delete('/icons/:id', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      // Don't allow deleting the default icon
      const checkDefault = await pool.query('SELECT name, drive_file_id FROM icons WHERE id = $1', [id]);
      if (checkDefault.rows.length === 0) {
        return res.status(404).json({ error: 'Icon not found' });
      }
      if (checkDefault.rows[0].name === 'default') {
        return res.status(400).json({ error: 'Cannot delete the default icon' });
      }

      const driveFileId = checkDefault.rows[0].drive_file_id;

      // Delete from Drive if file exists and user has OAuth
      if (driveFileId && req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);
          await deleteFileFromDrive(drive, driveFileId);
          console.log(`Deleted icon from Google Drive: ${driveFileId}`);
        } catch (driveError) {
          console.warn(`Failed to delete icon from Drive (non-fatal):`, driveError.message);
          // Continue with database deletion even if Drive delete fails
        }
      }

      const result = await pool.query(
        'DELETE FROM icons WHERE id = $1 RETURNING name',
        [id]
      );

      console.log(`Admin ${req.user.email} deleted icon: ${result.rows[0].name}`);

      // Queue sync to Google Sheets
      await queueIconSync('delete', parseInt(id), { name: result.rows[0].name });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting icon:', error);
      res.status(500).json({ error: 'Failed to delete icon' });
    }
  });

  // Push icons to Google Sheets
  router.post('/icons/sync/push', isAdmin, async (req, res) => {
    console.log(`Icons push requested by ${req.user.email}`);
    try {
      if (!req.user.oauth_credentials) {
        console.log('No OAuth credentials for icons push');
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to sync icons'
        });
      }

      console.log('Creating sheets service for icons push...');
      const sheets = createSheetsService(req.user.oauth_credentials);
      console.log('Calling pushIconsToSheets...');
      const count = await pushIconsToSheets(sheets, pool);

      console.log(`Admin ${req.user.email} pushed ${count} icons to Google Sheets`);
      res.json({
        success: true,
        message: `Pushed ${count} icons to Google Sheets`,
        count
      });
    } catch (error) {
      console.error('Error pushing icons to sheets:', error);
      res.status(500).json({
        error: 'Failed to push icons to Google Sheets',
        message: error.message
      });
    }
  });

  // Pull icons from Google Sheets (includes downloading SVGs from Drive)
  router.post('/icons/sync/pull', isAdmin, async (req, res) => {
    try {
      if (!req.user.oauth_credentials) {
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to sync icons'
        });
      }

      const sheets = createSheetsService(req.user.oauth_credentials);
      const drive = createDriveService(req.user.oauth_credentials);
      const count = await pullIconsFromSheets(sheets, pool, drive);

      console.log(`Admin ${req.user.email} pulled ${count} icons from Google Sheets (including Drive SVGs)`);
      res.json({
        success: true,
        message: `Pulled ${count} icons from Google Sheets`,
        count
      });
    } catch (error) {
      console.error('Error pulling icons from sheets:', error);
      res.status(500).json({
        error: 'Failed to pull icons from Google Sheets',
        message: error.message
      });
    }
  });

  // ============================================
  // Boundaries Management Routes
  // ============================================

  // Get all boundaries (for admin settings)
  router.get('/boundaries', isAdmin, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, name, boundary_type, boundary_color
        FROM pois
        WHERE poi_type = 'boundary' AND (deleted IS NULL OR deleted = FALSE)
        ORDER BY name
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching boundaries:', error);
      res.status(500).json({ error: 'Failed to fetch boundaries' });
    }
  });

  // Update boundary color/type
  router.put('/boundaries/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { boundary_type, boundary_color } = req.body;

    // Validate hex color format
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
      const result = await pool.query(`
        UPDATE pois
        SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
        WHERE id = $${paramIndex} AND poi_type = 'boundary'
        RETURNING id, name, boundary_type, boundary_color
      `, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Boundary not found' });
      }

      // Queue sync operation
      await queuePOISync('UPDATE', id, { boundary_type, boundary_color });

      console.log(`Admin ${req.user.email} updated boundary ${id}: type=${boundary_type}, color=${boundary_color}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating boundary:', error);
      res.status(500).json({ error: 'Failed to update boundary' });
    }
  });

  // ============================================
  // Google Sheets Sync Routes
  // ============================================

  // Get sync status
  router.get('/sync/status', isAdmin, async (req, res) => {
    try {
      const status = await getSyncStatus(pool);

      // Add spreadsheet configuration
      const spreadsheetInfo = await getSpreadsheetInfo(pool);
      status.spreadsheet = spreadsheetInfo;

      // Parse credentials if stored as string (handle both formats)
      let credentials = req.user.oauth_credentials;
      if (typeof credentials === 'string') {
        try {
          credentials = JSON.parse(credentials);
        } catch (e) {
          credentials = null;
        }
      }

      // Check if user has OAuth credentials for sync
      const hasCredentials = !!(credentials && credentials.access_token);
      status.has_oauth_credentials = hasCredentials;
      status.drive_access_verified = false;

      if (!hasCredentials) {
        status.drive_access_error = 'No Drive credentials found. Please log out and log back in.';
        return res.json(status);
      }

      // Verify credentials by trying to use them (with auto-refresh)
      const drive = await createDriveServiceWithRefresh(credentials, pool, req.user.id);

      if (spreadsheetInfo.configured) {
        // Try to access the configured spreadsheet
        try {
          const sheets = await createSheetsServiceWithRefresh(credentials, pool, req.user.id);
          await sheets.spreadsheets.get({
            spreadsheetId: spreadsheetInfo.id,
            fields: 'spreadsheetId'
          });

          // Check if the spreadsheet is in the trash
          try {
            const trashed = await isFileTrashed(drive, spreadsheetInfo.id);
            if (trashed === true) {
              status.spreadsheet_trashed = true;
              status.drive_access_error = 'Spreadsheet is in Google Drive trash. Please disconnect or restore it.';
            } else if (trashed === null) {
              status.spreadsheet_deleted = true;
              status.drive_access_error = 'Spreadsheet has been permanently deleted. Please disconnect.';
            } else {
              status.drive_access_verified = true;
            }
          } catch (driveError) {
            console.log('Could not check trash status:', driveError.message);
            // If we can't check, assume it's fine since Sheets API worked
            status.drive_access_verified = true;
          }
        } catch (verifyError) {
          console.log('Drive access verification failed:', verifyError.message);
          if (verifyError.message?.includes('invalid_grant') || verifyError.message?.includes('Token has been expired')) {
            status.drive_access_error = 'Access token expired. Please log out and log back in.';
          } else if (verifyError.message?.includes('not found') || verifyError.code === 404) {
            status.spreadsheet_deleted = true;
            status.drive_access_error = 'Spreadsheet not found. It may have been permanently deleted. Please disconnect.';
          } else {
            status.drive_access_error = 'Cannot access spreadsheet. Please log out and log back in.';
          }
        }
      } else {
        // No spreadsheet configured - assume it's ready if we have credentials
        status.drive_access_verified = true;
      }

      // Get Drive folder information
      try {
        const rootFolderId = await getDriveSetting(pool, 'root_folder_id');
        const iconsFolderId = await getDriveSetting(pool, 'icons_folder_id');
        const imagesFolderId = await getDriveSetting(pool, 'images_folder_id');
        const geospatialFolderId = await getDriveSetting(pool, 'geospatial_folder_id');

        const folderLink = await getDriveFolderLink(pool);
        const fileCounts = await countDriveFiles(drive, pool);

        status.drive = {
          configured: !!rootFolderId,
          folder_url: folderLink,
          folders: {
            root: rootFolderId ? {
              id: rootFolderId,
              name: 'Roots of The Valley',
              url: `https://drive.google.com/drive/folders/${rootFolderId}`
            } : null,
            icons: iconsFolderId ? {
              id: iconsFolderId,
              name: 'Icons',
              file_count: fileCounts.iconsCount,
              url: `https://drive.google.com/drive/folders/${iconsFolderId}`
            } : null,
            images: imagesFolderId ? {
              id: imagesFolderId,
              name: 'Images',
              file_count: fileCounts.imagesCount,
              url: `https://drive.google.com/drive/folders/${imagesFolderId}`
            } : null,
            geospatial: geospatialFolderId ? {
              id: geospatialFolderId,
              name: 'Geospatial',
              file_count: fileCounts.geospatialCount,
              url: `https://drive.google.com/drive/folders/${geospatialFolderId}`
            } : null
          }
        };
      } catch (driveInfoError) {
        console.warn('Could not get Drive folder info:', driveInfoError.message);
        status.drive = { configured: false };
      }

      // Get sync queue details
      try {
        const queueResult = await pool.query(`
          SELECT id, operation, table_name, record_id,
                 COALESCE(data->>'name', data->>'key') as item_name,
                 data as item_data,
                 created_at
          FROM sync_queue
          ORDER BY created_at ASC
          LIMIT 50
        `);
        status.sync_queue = queueResult.rows;
      } catch (queueError) {
        console.warn('Could not get sync queue:', queueError.message);
        status.sync_queue = [];
      }

      res.json(status);
    } catch (error) {
      console.error('Error getting sync status:', error);
      res.status(500).json({ error: 'Failed to get sync status' });
    }
  });

  // Disconnect from spreadsheet
  router.delete('/sync/disconnect-spreadsheet', isAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM admin_settings WHERE key = 'sync_spreadsheet_id'");

      console.log(`Admin ${req.user.email} disconnected from spreadsheet`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error disconnecting spreadsheet:', error);
      res.status(500).json({ error: 'Failed to disconnect spreadsheet' });
    }
  });

  // Connect to an existing spreadsheet by ID
  router.post('/sync/connect-spreadsheet', isAdmin, async (req, res) => {
    try {
      const { spreadsheetId } = req.body;

      if (!spreadsheetId || !spreadsheetId.trim()) {
        return res.status(400).json({
          error: 'Spreadsheet ID is required'
        });
      }

      // Check if user has Google OAuth credentials
      if (!req.user.oauth_credentials) {
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please authorize Google Drive access first'
        });
      }

      // Verify we can access the spreadsheet
      const sheets = createSheetsService(req.user.oauth_credentials);
      try {
        const response = await sheets.spreadsheets.get({
          spreadsheetId: spreadsheetId.trim()
        });

        // Save the spreadsheet ID
        const { setSpreadsheetId } = await import('../services/sheetsSync.js');
        await setSpreadsheetId(pool, spreadsheetId.trim(), req.user.id);

        console.log(`Admin ${req.user.email} connected to spreadsheet: ${spreadsheetId}`);
        res.json({
          success: true,
          message: `Connected to spreadsheet: ${response.data.properties.title}`,
          spreadsheet: {
            id: spreadsheetId.trim(),
            name: response.data.properties.title,
            url: response.data.spreadsheetUrl
          }
        });
      } catch (sheetsError) {
        console.error('Failed to access spreadsheet:', sheetsError.message);
        res.status(400).json({
          error: 'Cannot access spreadsheet',
          message: 'Make sure the spreadsheet was created by this app or you have access to it.'
        });
      }
    } catch (error) {
      console.error('Error connecting spreadsheet:', error);
      res.status(500).json({
        error: 'Failed to connect spreadsheet',
        message: error.message
      });
    }
  });

  // Create a new app-owned spreadsheet
  router.post('/sync/create-spreadsheet', isAdmin, async (req, res) => {
    try {
      // Check if user has Google OAuth credentials
      if (!req.user.oauth_credentials) {
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to create a spreadsheet'
        });
      }

      // Check if a spreadsheet already exists
      const existingId = await getSpreadsheetId(pool);
      if (existingId) {
        return res.status(400).json({
          error: 'Spreadsheet already exists',
          message: 'A spreadsheet is already configured. Use Push to update it.'
        });
      }

      const sheets = createSheetsService(req.user.oauth_credentials);
      const drive = createDriveService(req.user.oauth_credentials);
      const result = await createAppSpreadsheet(sheets, pool, req.user.id, drive);

      // Automatically push all data to the new spreadsheet (including GeoJSON upload)
      const destCount = await pushAllToSheets(sheets, pool, drive);
      const actCount = await pushActivitiesToSheets(sheets, pool);
      const erasCount = await pushErasToSheets(sheets, pool);
      const surfacesCount = await pushSurfacesToSheets(sheets, pool);
      const iconsCount = await pushIconsToSheets(sheets, pool);
      const integrationCount = await pushIntegrationToSheets(sheets, pool);
      const newsCount = await pushNewsToSheets(sheets, pool);
      const eventsCount = await pushEventsToSheets(sheets, pool);

      console.log(`Admin ${req.user.email} created spreadsheet: ${result.id} and pushed ${destCount} destinations, ${actCount} activities, ${erasCount} eras, ${surfacesCount} surfaces, ${iconsCount} icons, ${integrationCount} settings, ${newsCount} news, ${eventsCount} events`);
      res.json({
        success: true,
        message: `Spreadsheet created and populated with ${destCount} destinations, ${actCount} activities, ${erasCount} eras, ${surfacesCount} surfaces, ${iconsCount} icons, ${integrationCount} settings, ${newsCount} news, ${eventsCount} events`,
        spreadsheet: result,
        pushed: {
          destinations: destCount,
          activities: actCount,
          eras: erasCount,
          surfaces: surfacesCount,
          icons: iconsCount,
          integration: integrationCount,
          news: newsCount,
          events: eventsCount
        }
      });
    } catch (error) {
      console.error('Error creating spreadsheet:', error);
      res.status(500).json({
        error: 'Failed to create spreadsheet',
        message: error.message
      });
    }
  });

  // Push all data from database to Google Sheets (Destinations + Activities + Eras + Surfaces + Icons + Integration)
  // Also uploads GeoJSON geometry to Drive for linear features
  router.post('/sync/push', isAdmin, async (req, res) => {
    try {
      // Check if user has Google OAuth credentials
      if (!req.user.oauth_credentials) {
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to sync data'
        });
      }

      // Use refresh-enabled services to auto-refresh expired tokens
      const sheets = await createSheetsServiceWithRefresh(req.user.oauth_credentials, pool, req.user.id);
      const drive = await createDriveServiceWithRefresh(req.user.oauth_credentials, pool, req.user.id);

      // Push Destinations (including GeoJSON upload for linear features)
      const destCount = await pushAllToSheets(sheets, pool, drive);

      // Push Activities
      const actCount = await pushActivitiesToSheets(sheets, pool);

      // Push Eras
      const erasCount = await pushErasToSheets(sheets, pool);

      // Push Surfaces
      const surfacesCount = await pushSurfacesToSheets(sheets, pool);

      // Push Icons
      const iconsCount = await pushIconsToSheets(sheets, pool);

      // Push Integration settings
      const integrationCount = await pushIntegrationToSheets(sheets, pool);

      // Push News
      const newsCount = await pushNewsToSheets(sheets, pool);

      // Push Events
      const eventsCount = await pushEventsToSheets(sheets, pool);

      console.log(`Admin ${req.user.email} pushed ${destCount} destinations, ${actCount} activities, ${erasCount} eras, ${surfacesCount} surfaces, ${iconsCount} icons, ${integrationCount} integration settings, ${newsCount} news, and ${eventsCount} events to Google Sheets`);
      res.json({
        success: true,
        message: `Pushed ${destCount} destinations, ${actCount} activities, ${erasCount} eras, ${surfacesCount} surfaces, ${iconsCount} icons, ${newsCount} news, ${eventsCount} events to Google Sheets`,
        destinations: destCount,
        activities: actCount,
        eras: erasCount,
        surfaces: surfacesCount,
        icons: iconsCount,
        integration: integrationCount,
        news: newsCount,
        events: eventsCount
      });
    } catch (error) {
      console.error('Error pushing to sheets:', error);
      res.status(500).json({
        error: 'Failed to push to Google Sheets',
        message: error.message
      });
    }
  });

  // Pull all data from Google Sheets to database (Destinations + Activities + Eras + Surfaces + Icons)
  // Also downloads icon SVGs from Google Drive if they have drive_file_id
  router.post('/sync/pull', isAdmin, async (req, res) => {
    try {
      // Check if user has Google OAuth credentials
      if (!req.user.oauth_credentials) {
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to sync data'
        });
      }

      // Use refresh-enabled services to auto-refresh expired tokens
      const sheets = await createSheetsServiceWithRefresh(req.user.oauth_credentials, pool, req.user.id);
      const drive = await createDriveServiceWithRefresh(req.user.oauth_credentials, pool, req.user.id);

      // Pull Integration settings first (includes Drive folder IDs needed for icon downloads)
      const integrationCount = await pullIntegrationFromSheets(sheets, pool);

      // Pull Destinations (includes downloading images from Drive to database)
      const destCount = await pullAllFromSheets(sheets, pool, drive);

      // Pull Activities
      const actCount = await pullActivitiesFromSheets(sheets, pool);

      // Pull Eras
      const erasCount = await pullErasFromSheets(sheets, pool);

      // Pull Surfaces
      const surfacesCount = await pullSurfacesFromSheets(sheets, pool);

      // Pull Icons (includes downloading SVG content from Drive)
      const iconsCount = await pullIconsFromSheets(sheets, pool, drive);

      // Pull News
      const newsCount = await pullNewsFromSheets(sheets, pool);

      // Pull Events
      const eventsCount = await pullEventsFromSheets(sheets, pool);

      // Clear any pending sync queue items since we just pulled fresh data from sheets
      // These queued writes are now stale and would overwrite the fresh data
      const queueResult = await pool.query('DELETE FROM sync_queue RETURNING id');
      const clearedQueueCount = queueResult.rowCount;
      if (clearedQueueCount > 0) {
        console.log(`Cleared ${clearedQueueCount} stale items from sync queue after pull`);
      }

      console.log(`Admin ${req.user.email} pulled ${destCount} destinations, ${actCount} activities, ${erasCount} eras, ${surfacesCount} surfaces, ${iconsCount} icons, ${integrationCount} settings, ${newsCount} news, and ${eventsCount} events from Google Sheets`);
      res.json({
        success: true,
        message: `Pulled ${destCount} destinations, ${actCount} activities, ${erasCount} eras, ${surfacesCount} surfaces, ${iconsCount} icons, ${integrationCount} settings, ${newsCount} news, ${eventsCount} events from Google Sheets`,
        destinations: destCount,
        activities: actCount,
        eras: erasCount,
        surfaces: surfacesCount,
        icons: iconsCount,
        integration: integrationCount,
        news: newsCount,
        events: eventsCount
      });
    } catch (error) {
      console.error('Error pulling from sheets:', error);
      res.status(500).json({
        error: 'Failed to pull from Google Sheets',
        message: error.message
      });
    }
  });

  // Process pending sync queue (push changes to sheets)
  // Also adds any unsynced POIs to the queue before processing
  router.post('/sync/process', isAdmin, async (req, res) => {
    try {
      // Check if user has Google OAuth credentials
      if (!req.user.oauth_credentials) {
        return res.status(401).json({
          error: 'Google authentication required',
          message: 'Please sign in with Google to sync data'
        });
      }

      // First, add any unsynced or locally modified POIs to the queue that aren't already queued
      const unsyncedPOIs = await pool.query(`
        SELECT p.* FROM pois p
        WHERE (p.synced = FALSE OR p.locally_modified = TRUE) AND (p.deleted IS NULL OR p.deleted = FALSE)
        AND NOT EXISTS (
          SELECT 1 FROM sync_queue sq
          WHERE sq.table_name IN ('pois', 'destinations')
          AND sq.record_id = p.id
        )
      `);

      let queuedCount = 0;
      for (const poi of unsyncedPOIs.rows) {
        await queueSyncOperation(pool, 'UPDATE', 'pois', poi.id, {
          name: poi.name,
          latitude: poi.latitude,
          longitude: poi.longitude,
          poi_type: poi.poi_type,
          brief_description: poi.brief_description,
          historical_description: poi.historical_description,
          era: poi.era,
          property_owner: poi.property_owner,
          primary_activities: poi.primary_activities,
          surface: poi.surface,
          pets: poi.pets,
          difficulty: poi.difficulty,
          length_miles: poi.length_miles,
          image_url: poi.image_url,
          image_drive_file_id: poi.image_drive_file_id,
          geometry_drive_file_id: poi.geometry_drive_file_id
        });
        queuedCount++;
      }

      if (queuedCount > 0) {
        console.log(`Added ${queuedCount} unsynced POIs to sync queue`);
      }

      const sheets = await createSheetsServiceWithRefresh(req.user.oauth_credentials, pool, req.user.id);
      const drive = await createDriveServiceWithRefresh(req.user.oauth_credentials, pool, req.user.id);
      const result = await processSyncQueue(sheets, pool, drive);

      console.log(`Admin ${req.user.email} processed sync queue: ${result.processed} operations`);
      res.json({
        success: true,
        message: `Processed ${result.processed} sync operations${queuedCount > 0 ? ` (including ${queuedCount} unsynced POIs)` : ''}`,
        processed: result.processed,
        errors: result.errors
      });
    } catch (error) {
      console.error('Error processing sync queue:', error);
      res.status(500).json({
        error: 'Failed to process sync queue',
        message: error.message
      });
    }
  });

  // Wipe the local database (delete all POIs)
  router.delete('/sync/wipe-database', isAdmin, async (req, res) => {
    try {
      // Delete all POIs
      const destResult = await pool.query('DELETE FROM pois RETURNING id');
      const destCount = destResult.rowCount;

      // Clear sync queue
      const queueResult = await pool.query('DELETE FROM sync_queue RETURNING id');
      const queueCount = queueResult.rowCount;

      // Clear sync status (except spreadsheet ID)
      await pool.query("DELETE FROM sync_status WHERE key != 'sync_spreadsheet_id'");

      console.log(`Admin ${req.user.email} wiped database: ${destCount} destinations, ${queueCount} queue items`);
      res.json({
        success: true,
        message: `Deleted ${destCount} destinations and ${queueCount} pending sync operations`,
        deleted: {
          destinations: destCount,
          queueItems: queueCount
        }
      });
    } catch (error) {
      console.error('Error wiping database:', error);
      res.status(500).json({ error: 'Failed to wipe database' });
    }
  });

  // Clear sync queue (discard pending changes)
  router.delete('/sync/queue', isAdmin, async (req, res) => {
    try {
      const result = await pool.query('DELETE FROM sync_queue RETURNING id');
      const count = result.rowCount;

      console.log(`Admin ${req.user.email} cleared sync queue: ${count} operations discarded`);
      res.json({
        success: true,
        message: `Cleared ${count} pending sync operations`,
        count
      });
    } catch (error) {
      console.error('Error clearing sync queue:', error);
      res.status(500).json({ error: 'Failed to clear sync queue' });
    }
  });

  // ============================================
  // Destination Image Management Routes
  // ============================================

  // Configure multer for memory storage (images stored in Drive, not filesystem)
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max
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

  // Upload image for a destination
  // Uploads to image server (primary) AND Drive (backup)
  router.post('/destinations/:id/image', isAdmin, imageUpload.single('image'), async (req, res) => {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    try {
      // Check if destination exists
      const destCheck = await pool.query('SELECT id, name, image_drive_file_id FROM pois WHERE id = $1', [id]);
      if (destCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      const destination = destCheck.rows[0];

      // Upload to image server (primary storage)
      let imageServerAssetId = null;
      if (imageServerClient.initialized) {
        try {
          // Delete existing primary asset from image server
          const existingAsset = await imageServerClient.getPrimaryAsset(id);
          if (existingAsset) {
            await imageServerClient.deleteAsset(existingAsset.id);
            console.log(`Deleted old image server asset: ${existingAsset.id}`);
          }

          const ext = req.file.mimetype.split('/')[1];
          const sanitizedName = destination.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const filename = `${sanitizedName}-${Date.now()}.${ext}`;

          const result = await imageServerClient.uploadImage(
            req.file.buffer, id, 'primary', filename, req.file.mimetype
          );

          if (result.success) {
            imageServerAssetId = result.assetId;
            console.log(`Uploaded image to image server: ${imageServerAssetId}`);
          } else {
            console.warn(`Failed to upload to image server (non-fatal):`, result.error);
          }
        } catch (uploadError) {
          console.warn(`Failed to upload image to image server (non-fatal):`, uploadError.message);
        }
      }

      // Track mime type in ROTV DB so frontend knows this POI has an image
      await pool.query(
        `UPDATE pois
         SET image_mime_type = $1,
             updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
         WHERE id = $2`,
        [req.file.mimetype, id]
      );

      // Also upload to Drive for backup (if user has OAuth credentials)
      let driveFileId = null;
      if (req.user.oauth_credentials) {
        try {
          if (destination.image_drive_file_id) {
            const drive = createDriveService(req.user.oauth_credentials);
            await deleteFileFromDrive(drive, destination.image_drive_file_id);
            console.log(`Deleted old image from Drive: ${destination.image_drive_file_id}`);
          }

          const ext = req.file.mimetype.split('/')[1];
          const sanitizedName = destination.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const filename = `${sanitizedName}-${Date.now()}.${ext}`;

          const drive = createDriveService(req.user.oauth_credentials);
          driveFileId = await uploadImageToDrive(drive, pool, filename, req.file.buffer, req.file.mimetype);

          await pool.query(
            'UPDATE pois SET image_drive_file_id = $1 WHERE id = $2',
            [driveFileId, id]
          );

          console.log(`Backed up image to Drive: ${driveFileId}`);
        } catch (driveError) {
          console.warn(`Failed to backup image to Drive (non-fatal):`, driveError.message);
        }
      }

      console.log(`Admin ${req.user.email} uploaded image for destination ${id}`);
      res.json({
        success: true,
        message: 'Image uploaded successfully',
        image_url: `/api/destinations/${id}/image`,
        image_server_asset_id: imageServerAssetId,
        drive_file_id: driveFileId
      });
    } catch (error) {
      console.error('Error uploading destination image:', error);
      if (error.message?.includes('Invalid file type')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  // Upload image for a destination (base64 JSON variant - for dev server issues)
  router.post('/destinations/:id/image-base64', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { imageData, mimeType } = req.body;

    if (!imageData || !mimeType) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Validate mime type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.' });
    }

    try {
      // Decode base64
      const buffer = Buffer.from(imageData, 'base64');

      // Validate size (10MB max)
      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image must be less than 10MB' });
      }

      // Check if destination exists
      const destCheck = await pool.query('SELECT id, name, image_drive_file_id FROM pois WHERE id = $1', [id]);
      if (destCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      const destination = destCheck.rows[0];

      // Upload to image server (primary storage)
      let imageServerAssetId = null;
      if (imageServerClient.initialized) {
        try {
          // Delete existing primary asset from image server
          const existingAsset = await imageServerClient.getPrimaryAsset(id);
          if (existingAsset) {
            await imageServerClient.deleteAsset(existingAsset.id);
            console.log(`Deleted old image server asset: ${existingAsset.id}`);
          }

          const ext = mimeType.split('/')[1];
          const sanitizedName = destination.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const filename = `${sanitizedName}-${Date.now()}.${ext}`;

          const result = await imageServerClient.uploadImage(
            buffer, id, 'primary', filename, mimeType
          );

          if (result.success) {
            imageServerAssetId = result.assetId;
            console.log(`Uploaded image to image server: ${imageServerAssetId}`);
          } else {
            console.warn(`Failed to upload to image server (non-fatal):`, result.error);
          }
        } catch (uploadError) {
          console.warn('Failed to upload to image server (non-fatal):', uploadError.message);
        }
      }

      // Track mime type in ROTV DB so frontend knows this POI has an image
      await pool.query(
        `UPDATE pois
         SET image_mime_type = $1,
             updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
         WHERE id = $2`,
        [mimeType, id]
      );

      // Also upload to Drive as backup if user has OAuth
      let driveFileId = null;
      if (req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);

          if (destination.image_drive_file_id) {
            try {
              await deleteFileFromDrive(drive, destination.image_drive_file_id);
              console.log(`Deleted old image from Drive: ${destination.image_drive_file_id}`);
            } catch (deleteError) {
              console.warn('Failed to delete old image from Drive (non-fatal):', deleteError.message);
            }
          }

          driveFileId = await uploadImageToDrive(drive, pool, buffer, mimeType, destination.name);

          await pool.query(
            'UPDATE pois SET image_drive_file_id = $1 WHERE id = $2',
            [driveFileId, id]
          );

          console.log(`Backed up image to Drive: ${driveFileId}`);
        } catch (driveError) {
          console.warn('Failed to backup to Drive (non-fatal):', driveError.message);
        }
      }

      console.log(`Admin ${req.user.email} uploaded image for destination ${id}`);
      res.json({
        success: true,
        message: 'Image uploaded successfully',
        image_server_asset_id: imageServerAssetId,
        drive_file_id: driveFileId
      });
    } catch (error) {
      console.error('Error uploading destination image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  // Delete image from a destination
  // Deletes from image server AND Drive backup
  router.delete('/destinations/:id/image', isAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      // Check if destination exists and has an image
      const destCheck = await pool.query('SELECT id, name, image_drive_file_id, image_mime_type FROM pois WHERE id = $1', [id]);
      if (destCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      const destination = destCheck.rows[0];

      // Check image server for assets
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

      if (!hasImageServerAsset && !destination.image_drive_file_id && !destination.image_mime_type) {
        return res.status(400).json({ error: 'Destination has no image' });
      }

      // Delete from Drive if present and user has OAuth
      if (destination.image_drive_file_id && req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);
          await deleteFileFromDrive(drive, destination.image_drive_file_id);
          console.log(`Deleted image from Drive: ${destination.image_drive_file_id}`);
        } catch (driveError) {
          console.warn(`Failed to delete from Drive (non-fatal):`, driveError.message);
        }
      }

      // Clear image references from database
      await pool.query(
        `UPDATE pois
         SET image_data = NULL, image_mime_type = NULL, image_drive_file_id = NULL, immich_primary_asset_id = NULL,
             updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
         WHERE id = $1`,
        [id]
      );

      console.log(`Admin ${req.user.email} deleted image for destination ${id}`);
      res.json({
        success: true,
        message: 'Image deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting destination image:', error);
      res.status(500).json({ error: 'Failed to delete image' });
    }
  });

  // ============================================
  // Google Drive Status Routes
  // ============================================

  // Get Drive storage status
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

  // Setup Drive folders (creates if not exists)
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

  // Update individual Drive setting (folder ID or spreadsheet ID)
  router.put('/drive/settings/:key', isAdmin, async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;

      // Validate key - only allow specific Drive-related settings
      const allowedKeys = [
        'root_folder_id',
        'icons_folder_id',
        'images_folder_id',
        'geospatial_folder_id'
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

  // Update spreadsheet ID
  router.put('/sync/spreadsheet-id', isAdmin, async (req, res) => {
    try {
      const { value } = req.body;

      if (!value || !value.trim()) {
        return res.status(400).json({ error: 'Spreadsheet ID is required' });
      }

      await pool.query(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES ('sync_spreadsheet_id', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = CURRENT_TIMESTAMP
      `, [value.trim()]);

      console.log(`Admin ${req.user.email} updated spreadsheet ID`);

      res.json({
        success: true,
        message: 'Updated spreadsheet ID',
        value: value.trim()
      });
    } catch (error) {
      console.error('Error updating spreadsheet ID:', error);
      res.status(500).json({ error: 'Failed to update spreadsheet ID' });
    }
  });

  // ============================================
  // LINEAR FEATURES (Trails & Rivers) ENDPOINTS
  // ============================================

  // Get all linear features (admin view includes all fields)
  router.get('/linear-features', isAdmin, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT * FROM pois
        WHERE deleted IS NULL OR deleted = FALSE
        ORDER BY feature_type, name
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching linear features:', error);
      res.status(500).json({ error: 'Failed to fetch linear features' });
    }
  });

  // Create linear feature
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

      const result = await pool.query(`
        INSERT INTO pois (
          name, poi_type, geometry, property_owner, owner_id, brief_description,
          era_id, historical_description, primary_activities, surface, pets,
          cell_signal, more_info_link, length_miles, difficulty, locally_modified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, TRUE)
        RETURNING *
      `, [
        name, feature_type, JSON.stringify(geometry), property_owner, owner_id, brief_description,
        era_id, historical_description, primary_activities, surface, pets,
        cell_signal, more_info_link, length_miles, difficulty
      ]);

      console.log(`Admin ${req.user.email} created linear feature: ${name}`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating linear feature:', error);
      if (error.code === '23505') {
        res.status(409).json({ error: 'A feature with this name and type already exists' });
      } else {
        res.status(500).json({ error: 'Failed to create linear feature' });
      }
    }
  });

  // Update linear feature
  router.put('/linear-features/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const allowedFields = [
        'name', 'poi_type', 'geometry', 'property_owner', 'owner_id', 'brief_description',
        'era', 'era_id', 'historical_description', 'primary_activities', 'surface', 'pets',
        'cell_signal', 'more_info_link', 'length_miles', 'difficulty',
        'boundary_type', 'boundary_color', 'status_url', 'news_url', 'events_url'
      ];

      // Map feature_type to poi_type for backward compatibility
      if (req.body.feature_type && !req.body.poi_type) {
        req.body.poi_type = req.body.feature_type;
      }

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
      updates.push(`locally_modified = TRUE`);
      updates.push(`synced = FALSE`);
      values.push(id);

      // Return all columns except geometry (which can be very large)
      const result = await pool.query(`
        UPDATE pois SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, name, poi_type, latitude, longitude, property_owner,
                  brief_description, era, historical_description, primary_activities,
                  surface, pets, cell_signal, more_info_link, length_miles, difficulty,
                  image_mime_type, image_drive_file_id, geometry_drive_file_id,
                  boundary_type, boundary_color, status_url, news_url, events_url,
                  locally_modified, deleted, synced, created_at, updated_at
      `, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Linear feature not found' });
      }

      // Queue sync operation (only store essential data, not full geometry)
      await queuePOISync('UPDATE', id, { id, name: result.rows[0].name, poi_type: result.rows[0].poi_type });

      console.log(`Admin ${req.user.email} updated linear feature ${id}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating linear feature:', error);
      res.status(500).json({ error: 'Failed to update linear feature' });
    }
  });

  // Delete linear feature (soft delete)
  router.delete('/linear-features/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(`
        UPDATE pois
        SET deleted = TRUE, updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
        WHERE id = $1
        RETURNING id, name
      `, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Linear feature not found' });
      }

      // Queue sync operation
      await queuePOISync('DELETE', id, result.rows[0]);

      console.log(`Admin ${req.user.email} deleted linear feature ${id}`);
      res.json({ success: true, deleted: result.rows[0] });
    } catch (error) {
      console.error('Error deleting linear feature:', error);
      res.status(500).json({ error: 'Failed to delete linear feature' });
    }
  });

  // Upload image for linear feature
  router.post('/linear-features/:id/image', isAdmin, imageUpload.single('image'), async (req, res) => {
    try {
      const { id } = req.params;

      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const result = await pool.query(`
        UPDATE pois
        SET image_data = $1, image_mime_type = $2, updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE
        WHERE id = $3
        RETURNING id, name, image_mime_type
      `, [req.file.buffer, req.file.mimetype, id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Linear feature not found' });
      }

      console.log(`Admin ${req.user.email} uploaded image for linear feature ${id}`);
      res.json({
        success: true,
        feature: result.rows[0]
      });
    } catch (error) {
      console.error('Error uploading linear feature image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  // Upload image for linear feature (base64 JSON variant - for dev server issues)
  router.post('/linear-features/:id/image-base64', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { imageData, mimeType } = req.body;

    if (!imageData || !mimeType) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Validate mime type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.' });
    }

    try {
      // Decode base64
      const buffer = Buffer.from(imageData, 'base64');

      // Validate size (10MB max)
      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image must be less than 10MB' });
      }

      // Check if linear feature exists
      const featureCheck = await pool.query('SELECT id, name, image_drive_file_id FROM pois WHERE id = $1', [id]);
      if (featureCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Linear feature not found' });
      }

      const feature = featureCheck.rows[0];

      // Store image in database
      await pool.query(
        `UPDATE pois
         SET image_data = $1, image_mime_type = $2,
             updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE, synced = FALSE
         WHERE id = $3`,
        [buffer, mimeType, id]
      );

      // Also upload to Drive as backup if user has OAuth
      let driveFileId = null;
      if (req.user.oauth_credentials) {
        try {
          const drive = createDriveService(req.user.oauth_credentials);

          // Delete old image from Drive if it exists
          if (feature.image_drive_file_id) {
            try {
              await deleteFileFromDrive(drive, feature.image_drive_file_id);
              console.log(`Deleted old image from Drive: ${feature.image_drive_file_id}`);
            } catch (deleteError) {
              console.warn('Failed to delete old image from Drive (non-fatal):', deleteError.message);
            }
          }

          // Upload new image to Drive
          driveFileId = await uploadImageToDrive(drive, pool, buffer, mimeType, feature.name);

          // Update database with Drive file ID
          await pool.query(
            'UPDATE pois SET image_drive_file_id = $1 WHERE id = $2',
            [driveFileId, id]
          );

          console.log(`Backed up image to Drive: ${driveFileId}`);
        } catch (driveError) {
          console.warn('Failed to backup to Drive (non-fatal):', driveError.message);
        }
      }

      console.log(`Admin ${req.user.email} uploaded image for linear feature ${id}`);
      res.json({
        success: true,
        message: 'Image uploaded successfully',
        drive_file_id: driveFileId
      });
    } catch (error) {
      console.error('Error uploading linear feature image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  // Delete image for linear feature
  router.delete('/linear-features/:id/image', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(`
        UPDATE pois
        SET image_data = NULL, image_mime_type = NULL, image_drive_file_id = NULL,
            updated_at = CURRENT_TIMESTAMP, locally_modified = TRUE
        WHERE id = $1
        RETURNING id, name
      `, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Linear feature not found' });
      }

      console.log(`Admin ${req.user.email} deleted image for linear feature ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting linear feature image:', error);
      res.status(500).json({ error: 'Failed to delete image' });
    }
  });

  // Import trails and rivers from GeoJSON files
  router.post('/linear-features/import', isAdmin, async (req, res) => {
    try {
      const { feature_type } = req.body; // 'trail', 'river', or 'all'
      // Use STATIC_PATH in container, fall back to dev path
      const staticPath = process.env.STATIC_PATH || path.join(__dirname, '../../frontend/public');
      const dataPath = path.join(staticPath, 'data');

      const results = { trails: 0, rivers: 0, boundaries: 0, errors: [] };

      // Helper function to consolidate features by name
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
            // Merge into MultiLineString
            const allCoords = geometries.map(g =>
              g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
            ).flat();
            geometry = { type: 'MultiLineString', coordinates: allCoords };
          }
          consolidated.push({ name, geometry });
        }
        return consolidated;
      }

      // Import trails
      if (feature_type === 'trail' || feature_type === 'all') {
        try {
          const trailsFile = path.join(dataPath, 'cvnp-trails.geojson');
          const trailsData = JSON.parse(await fs.readFile(trailsFile, 'utf-8'));
          const consolidatedTrails = consolidateFeatures(trailsData.features);

          for (const trail of consolidatedTrails) {
            try {
              await pool.query(`
                INSERT INTO pois (name, poi_type, geometry)
                VALUES ($1, 'trail', $2)
                ON CONFLICT (name) DO UPDATE SET
                  geometry = EXCLUDED.geometry,
                  poi_type = EXCLUDED.poi_type,
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

      // Import rivers
      if (feature_type === 'river' || feature_type === 'all') {
        try {
          const riverFile = path.join(dataPath, 'cvnp-river.geojson');
          const riverData = JSON.parse(await fs.readFile(riverFile, 'utf-8'));
          const consolidatedRivers = consolidateFeatures(riverData.features);

          for (const river of consolidatedRivers) {
            try {
              await pool.query(`
                INSERT INTO pois (name, poi_type, geometry)
                VALUES ($1, 'river', $2)
                ON CONFLICT (name) DO UPDATE SET
                  geometry = EXCLUDED.geometry,
                  poi_type = EXCLUDED.poi_type,
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

      // Import boundaries
      if (feature_type === 'boundary' || feature_type === 'all') {
        try {
          const boundaryFile = path.join(dataPath, 'cvnp-boundary.geojson');
          const boundaryData = JSON.parse(await fs.readFile(boundaryFile, 'utf-8'));

          for (const feature of boundaryData.features) {
            const name = feature.properties?.name || 'Park Boundary';
            try {
              await pool.query(`
                INSERT INTO pois (name, poi_type, geometry)
                VALUES ($1, 'boundary', $2)
                ON CONFLICT (name) DO UPDATE SET
                  geometry = EXCLUDED.geometry,
                  poi_type = EXCLUDED.poi_type,
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

  // Configure multer for spatial data file upload
  const spatialUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for GeoJSON files
    fileFilter: (req, file, cb) => {
      // Accept .geojson and .json files
      if (file.originalname.match(/\.(geojson|json)$/i)) {
        cb(null, true);
      } else {
        cb(new Error('Only GeoJSON files (.geojson, .json) are allowed'));
      }
    }
  });

  // Upload and import spatial data from GeoJSON file
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

      const { feature_type } = req.body; // 'trail', 'river', or 'boundary'
      if (!['trail', 'river', 'boundary'].includes(feature_type)) {
        return res.status(400).json({ error: 'Invalid feature type. Must be trail, river, or boundary.' });
      }

      // Parse the GeoJSON file
      let geojsonData;
      try {
        geojsonData = JSON.parse(req.file.buffer.toString('utf-8'));
      } catch (parseErr) {
        return res.status(400).json({ error: 'Invalid JSON format in uploaded file' });
      }

      // Validate GeoJSON structure
      if (!geojsonData.type || !geojsonData.features) {
        return res.status(400).json({ error: 'Invalid GeoJSON: missing type or features' });
      }

      if (geojsonData.type !== 'FeatureCollection') {
        return res.status(400).json({ error: 'GeoJSON must be a FeatureCollection' });
      }

      // Helper function to consolidate features by name
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
            // Merge into MultiLineString or MultiPolygon based on type
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
            INSERT INTO pois (name, poi_type, geometry, deleted)
            VALUES ($1, $2, $3, FALSE)
            ON CONFLICT (name, poi_type) DO UPDATE SET
              geometry = EXCLUDED.geometry,
              deleted = FALSE,
              updated_at = CURRENT_TIMESTAMP
          `, [feature.name, feature_type, JSON.stringify(feature.geometry)]);
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

  // JSON-based spatial import (no file upload, avoids Chrome issues)
  router.post('/spatial/import', isAdmin, async (req, res) => {
    try {
      const { feature_type, geojson, filename } = req.body;

      if (!geojson) {
        return res.status(400).json({ error: 'No GeoJSON data provided' });
      }

      if (!['trail', 'river', 'boundary'].includes(feature_type)) {
        return res.status(400).json({ error: 'Invalid feature type. Must be trail, river, or boundary.' });
      }

      // Validate GeoJSON structure
      if (!geojson.type || !geojson.features) {
        return res.status(400).json({ error: 'Invalid GeoJSON: missing type or features' });
      }

      if (geojson.type !== 'FeatureCollection') {
        return res.status(400).json({ error: 'GeoJSON must be a FeatureCollection' });
      }

      // Helper function to consolidate features by name
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
            INSERT INTO pois (name, poi_type, geometry, deleted)
            VALUES ($1, $2, $3, FALSE)
            ON CONFLICT (name, poi_type) DO UPDATE SET
              geometry = EXCLUDED.geometry,
              deleted = FALSE,
              updated_at = CURRENT_TIMESTAMP
          `, [feature.name, feature_type, JSON.stringify(feature.geometry)]);
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

  // ============================================
  // NEWS & EVENTS ENDPOINTS
  // ============================================

  // Collect news for a batch of POIs (by IDs) - starts job and returns immediately
  router.post('/news/collect-batch', isAdmin, async (req, res) => {
    try {
      const { poiIds } = req.body;

      if (!Array.isArray(poiIds) || poiIds.length === 0) {
        return res.status(400).json({ error: 'poiIds array is required' });
      }

      // Limit batch size to prevent overload
      const MAX_BATCH_SIZE = 50;
      const idsToProcess = poiIds.slice(0, MAX_BATCH_SIZE);

      console.log(`Admin ${req.user.email} triggered batch news collection for ${idsToProcess.length} POIs`);

      // Create the job record first
      const { jobId, totalPois } = await createNewsCollectionJob(pool, idsToProcess, 'batch');

      // Submit to pg-boss for crash-recoverable processing
      // The handler will be registered in server.js and has access to pool and sheets
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

  // Trigger news collection job manually (all POIs) - starts job and returns immediately
  router.post('/news/collect', isAdmin, async (req, res) => {
    try {
      console.log(`Admin ${req.user.email} triggered full news collection`);

      // Check if a job is already running
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

      // Get all active POI IDs
      const poisResult = await pool.query(`
        SELECT id FROM pois
        WHERE (deleted IS NULL OR deleted = FALSE)
        ORDER BY
          CASE poi_type
            WHEN 'point' THEN 1
            WHEN 'boundary' THEN 2
            ELSE 3
          END,
          name
      `);
      const poiIds = poisResult.rows.map(p => p.id);

      if (poiIds.length === 0) {
        return res.status(400).json({ error: 'No POIs found to process' });
      }

      // Create the job record first
      const { jobId, totalPois } = await createNewsCollectionJob(pool, poiIds, 'manual');

      // Submit to pg-boss for crash-recoverable processing
      await submitBatchNewsJob({ jobId, poiIds });

      res.json({
        success: true,
        message: 'News & events collection started for all POIs (pg-boss)',
        jobId,
        totalPois
      });
    } catch (error) {
      console.error('Error starting news collection:', error);
      res.status(500).json({ error: 'Failed to start news collection' });
    }
  });

  // Get job status by ID (for polling progress)
  router.get('/news/job/:jobId', isAdmin, async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await getJobStatus(pool, parseInt(jobId));

      if (!status) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Get display slots (exactly 10 slots with stable assignments)
      const displaySlots = getNewsDisplaySlots(status.id);

      // Determine current phase from display slots
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
        displaySlots  // Send exactly 10 slots instead of unbounded activeJobs
      });
    } catch (error) {
      console.error('Error getting job status:', error);
      res.status(500).json({ error: 'Failed to get job status' });
    }
  });

  // Get collection progress for a POI
  router.get('/pois/:id/collection-progress', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const progress = getCollectionProgress(parseInt(id));

      if (!progress) {
        return res.json({ phase: 'idle', message: 'No collection in progress' });
      }

      // Include AI provider stats
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

  // Cancel an ongoing collection job
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

  // Collect news for a single POI (NEWS ONLY)
  router.post('/pois/:id/news/collect', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // Get POI details
      const poiResult = await pool.query(
        'SELECT id, name, poi_type, primary_activities, more_info_link, events_url, news_url FROM pois WHERE id = $1',
        [id]
      );

      if (poiResult.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      const poi = poiResult.rows[0];

      // Check if collection is already running for this POI
      const existingProgress = getCollectionProgress(parseInt(id));
      if (existingProgress && !existingProgress.completed) {
        console.log(`Admin ${req.user.email} attempted to start NEWS collection, but one is already running for POI: ${poi.name}`);
        return res.status(200).json({
          success: true,
          alreadyRunning: true,
          message: 'Collection already in progress',
          progress: existingProgress
        });
      }

      // Clear any old completed progress before starting new collection
      clearProgress(parseInt(id));

      // Reset AI usage counter for this single-POI collection
      resetJobUsage();

      console.log(`Admin ${req.user.email} triggered NEWS ONLY collection for POI: ${poi.name}`);

      // Get timezone from request body (defaults to America/New_York)
      const timezone = req.body.timezone || 'America/New_York';
      console.log(`Using timezone: ${timezone}`);

      // Collect news and events for this POI
      const { news, events, metadata } = await collectNewsForPoi(pool, poi, null, timezone, 'news');

      // Save ONLY NEWS to database
      const savedNews = await saveNewsItems(pool, poi.id, news, { skipDateFilter: metadata.usedDedicatedNewsUrl });

      // Update final progress with save statistics
      updateProgress(poi.id, {
        phase: 'complete',
        message: `Complete! Found ${news.length} • Saved ${savedNews} • Skipped ${news.length - savedNews}`,
        newsFound: news.length,
        newsSaved: savedNews,
        newsDuplicate: news.length - savedNews,
        completed: true
      });

      res.json({
        success: true,
        message: `News collection completed for ${poi.name}`,
        newsFound: news.length,
        newsSaved: savedNews,
        newsDuplicate: news.length - savedNews
      });
    } catch (error) {
      console.error('Error collecting news for POI:', error);
      res.status(500).json({ error: 'Failed to collect news for POI' });
    }
  });

  // Collect events for a single POI (EVENTS ONLY)
  router.post('/pois/:id/events/collect', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // Get POI details
      const poiResult = await pool.query(
        'SELECT id, name, poi_type, primary_activities, more_info_link, events_url, news_url FROM pois WHERE id = $1',
        [id]
      );

      if (poiResult.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }

      const poi = poiResult.rows[0];

      // Check if collection is already running for this POI
      const existingProgress = getCollectionProgress(parseInt(id));
      if (existingProgress && !existingProgress.completed) {
        console.log(`Admin ${req.user.email} attempted to start EVENTS collection, but one is already running for POI: ${poi.name}`);
        return res.status(200).json({
          success: true,
          alreadyRunning: true,
          message: 'Collection already in progress',
          progress: existingProgress
        });
      }

      // Clear any old completed progress before starting new collection
      clearProgress(parseInt(id));

      // Reset AI usage counter for this single-POI collection
      resetJobUsage();

      console.log(`Admin ${req.user.email} triggered EVENTS ONLY collection for POI: ${poi.name}`);

      // Get timezone from request body (defaults to America/New_York)
      const timezone = req.body.timezone || 'America/New_York';
      console.log(`Using timezone: ${timezone}`);

      // Collect news and events for this POI
      const { news, events, metadata } = await collectNewsForPoi(pool, poi, null, timezone, 'events');

      // Save ONLY EVENTS to database
      const savedEvents = await saveEventItems(pool, poi.id, events);

      // Update final progress with save statistics
      updateProgress(poi.id, {
        phase: 'complete',
        message: `Complete! Found ${events.length} • Saved ${savedEvents} • Skipped ${events.length - savedEvents}`,
        eventsFound: events.length,
        eventsSaved: savedEvents,
        eventsDuplicate: events.length - savedEvents,
        completed: true
      });

      res.json({
        success: true,
        message: `Events collection completed for ${poi.name}`,
        eventsFound: events.length,
        eventsSaved: savedEvents,
        eventsDuplicate: events.length - savedEvents
      });
    } catch (error) {
      console.error('Error collecting events for POI:', error);
      res.status(500).json({ error: 'Failed to collect events for POI' });
    }
  });

  // Get news collection job status
  router.get('/news/status', isAdmin, async (req, res) => {
    try {
      const status = await getLatestJobStatus(pool);
      res.json(status || { message: 'No jobs have run yet' });
    } catch (error) {
      console.error('Error getting job status:', error);
      res.status(500).json({ error: 'Failed to get job status' });
    }
  });

  // Get AI stats for current/most recent job (per-job tracking)
  router.get('/news/ai-stats', isAdmin, async (req, res) => {
    try {
      // Get the most recent job status
      const result = await pool.query(`
        SELECT ai_usage, status
        FROM news_job_status
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return res.json({ usage: { gemini: 0, perplexity: 0 }, errors: { gemini429: 0, perplexity429: 0 }, activeProvider: null });
      }

      const job = result.rows[0];

      // If job is running, use real-time in-memory stats
      if (job.status === 'running') {
        const liveStats = getJobStats();
        return res.json({
          usage: liveStats.usage,
          errors: liveStats.errors,
          activeProvider: liveStats.activeProvider
        });
      }

      // For completed/cancelled jobs, use database values
      // Parse ai_usage if it's a string
      let aiUsage = job.ai_usage;
      if (typeof aiUsage === 'string') {
        try {
          aiUsage = JSON.parse(aiUsage);
        } catch (e) {
          console.error('Error parsing ai_usage:', e);
          aiUsage = { gemini: 0, perplexity: 0, gemini429: 0, perplexity429: 0 };
        }
      }
      aiUsage = aiUsage || { gemini: 0, perplexity: 0, gemini429: 0, perplexity429: 0 };

      res.json({
        usage: {
          gemini: aiUsage.gemini || 0,
          perplexity: aiUsage.perplexity || 0
        },
        errors: {
          gemini429: aiUsage.gemini429 || 0,
          perplexity429: aiUsage.perplexity429 || 0
        },
        activeProvider: null
      });
    } catch (error) {
      console.error('Error getting AI stats:', error);
      res.status(500).json({ error: 'Failed to get AI stats' });
    }
  });

  // Cancel a running batch job
  router.post('/news/job/:id/cancel', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const jobId = parseInt(id);

      // Get current AI usage before cancelling
      const currentUsage = getJobStats();

      // Update job status in database to 'cancelled' (preserve AI usage)
      const result = await pool.query(`
        UPDATE news_job_status
        SET status = 'cancelled', completed_at = NOW(), ai_usage = $2
        WHERE id = $1 AND status = 'running'
        RETURNING *
      `, [jobId, JSON.stringify(currentUsage)]);

      if (result.rows.length > 0) {
        console.log(`Admin ${req.user.email} cancelled batch job ${jobId}`);
        res.json({ success: true, message: 'Job cancelled' });
      } else {
        res.json({ success: false, message: 'Job not found or not running' });
      }
    } catch (error) {
      console.error('Error cancelling batch job:', error);
      res.status(500).json({ error: 'Failed to cancel job' });
    }
  });

  // Get all recent news (admin view)
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

  // Get all upcoming events (admin view)
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

  // Delete a news item
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

  // Delete an event
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

  // Cleanup old news and past events
  router.post('/news/cleanup', isAdmin, async (req, res) => {
    try {
      const newsDeleted = await cleanupOldNews(pool, 90);
      const eventsDeleted = await cleanupPastEvents(pool, 30);
      console.log(`Admin ${req.user.email} cleaned up ${newsDeleted} old news items and ${eventsDeleted} past events`);
      res.json({
        success: true,
        newsDeleted,
        eventsDeleted
      });
    } catch (error) {
      console.error('Error cleaning up news/events:', error);
      res.status(500).json({ error: 'Failed to cleanup' });
    }
  });

  // POI Associations CRUD endpoints (admin only)
  router.post('/poi-associations', isAdmin, async (req, res) => {
    try {
      const { virtual_poi_id, physical_poi_id, association_type } = req.body;

      if (!virtual_poi_id || !physical_poi_id) {
        return res.status(400).json({ error: 'virtual_poi_id and physical_poi_id are required' });
      }

      // Validate that virtual_poi_id is actually a virtual POI
      const virtualPoi = await pool.query(
        'SELECT poi_type FROM pois WHERE id = $1',
        [virtual_poi_id]
      );

      if (virtualPoi.rows.length === 0) {
        return res.status(400).json({ error: 'Virtual POI not found' });
      }

      if (virtualPoi.rows[0].poi_type !== 'virtual') {
        return res.status(400).json({ error: 'Specified virtual_poi_id is not a virtual POI' });
      }

      // Create association
      const result = await pool.query(`
        INSERT INTO poi_associations (virtual_poi_id, physical_poi_id, association_type)
        VALUES ($1, $2, $3)
        ON CONFLICT (virtual_poi_id, physical_poi_id) DO UPDATE
        SET association_type = EXCLUDED.association_type, updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [virtual_poi_id, physical_poi_id, association_type || 'manages']);

      console.log(`Admin ${req.user.email} created association between virtual POI ${virtual_poi_id} and physical POI ${physical_poi_id}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error creating POI association:', error);
      res.status(500).json({ error: 'Failed to create association' });
    }
  });

  router.delete('/poi-associations/:id', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        'DELETE FROM poi_associations WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Association not found' });
      }

      console.log(`Admin ${req.user.email} deleted association ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting POI association:', error);
      res.status(500).json({ error: 'Failed to delete association' });
    }
  });

  // Batch create associations (for drawing UI workflow)
  router.post('/poi-associations/batch', isAdmin, async (req, res) => {
    try {
      const { virtual_poi_id, physical_poi_ids, association_type } = req.body;

      if (!virtual_poi_id || !Array.isArray(physical_poi_ids) || physical_poi_ids.length === 0) {
        return res.status(400).json({ error: 'virtual_poi_id and physical_poi_ids array are required' });
      }

      // Validate virtual POI
      const virtualPoi = await pool.query(
        'SELECT poi_type FROM pois WHERE id = $1',
        [virtual_poi_id]
      );

      if (virtualPoi.rows.length === 0) {
        return res.status(400).json({ error: 'Virtual POI not found' });
      }

      if (virtualPoi.rows[0].poi_type !== 'virtual') {
        return res.status(400).json({ error: 'Specified virtual_poi_id is not a virtual POI' });
      }

      // Create all associations
      const created = [];
      for (const physical_poi_id of physical_poi_ids) {
        const result = await pool.query(`
          INSERT INTO poi_associations (virtual_poi_id, physical_poi_id, association_type)
          VALUES ($1, $2, $3)
          ON CONFLICT (virtual_poi_id, physical_poi_id) DO UPDATE
          SET association_type = EXCLUDED.association_type, updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `, [virtual_poi_id, physical_poi_id, association_type || 'manages']);

        created.push(result.rows[0]);
      }

      console.log(`Admin ${req.user.email} created ${created.length} associations for virtual POI ${virtual_poi_id}`);
      res.json({ success: true, created });
    } catch (error) {
      console.error('Error creating batch POI associations:', error);
      res.status(500).json({ error: 'Failed to create associations' });
    }
  });

  // ===== TRAIL STATUS ENDPOINTS =====

  // Collect status for a single MTB trail
  router.post('/pois/:id/status/collect', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // Get trail details
      const poiResult = await pool.query(
        'SELECT id, name, poi_type, status_url, location FROM pois WHERE id = $1',
        [id]
      );

      if (poiResult.rows.length === 0) {
        return res.status(404).json({ error: 'Trail not found' });
      }

      const poi = poiResult.rows[0];

      if (!poi.status_url || poi.status_url === '') {
        return res.status(400).json({ error: 'POI does not have a status URL' });
      }

      // Check if collection is already running for this trail
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

      // Clear any old completed progress
      clearTrailProgress(parseInt(id));

      // Reset AI usage counter
      resetJobUsage();

      console.log(`Admin ${req.user.email} triggered trail status collection for: ${poi.name}`);

      // Collect trail status
      const result = await collectTrailStatus(pool, poi, null, 'America/New_York');

      res.json({
        success: true,
        message: 'Trail status collected',
        statusFound: result.statusFound,
        statusSaved: result.statusSaved,
        aiUsage: getJobStats()
      });

    } catch (error) {
      console.error('Error collecting trail status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Batch collection for multiple trails
  router.post('/trail-status/collect-batch', isAdmin, async (req, res) => {
    try {
      const { poiIds } = req.body;

      console.log(`Admin ${req.user.email} triggered batch trail status collection for ${poiIds?.length || 'all'} trails`);

      // Check if a job is already running
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

      const result = await runTrailStatusCollection(pool, req.app.get('boss'), {
        poiIds: poiIds || null,
        jobType: 'batch_collection'
      });

      res.json({
        success: true,
        message: result.message,
        jobId: result.jobId,
        totalTrails: result.totalTrails,  // Keep camelCase for backward compatibility
        total_trails: result.totalTrails  // Add snake_case for frontend
      });

    } catch (error) {
      console.error('Error starting batch trail status collection:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get latest job status (MUST come before /:jobId route)
  router.get('/trail-status/job-status/latest', isAdmin, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT *
        FROM trail_status_job_status
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return res.json(null);
      }

      const job = result.rows[0];
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

  // Get job status by ID
  router.get('/trail-status/job-status/:jobId', isAdmin, async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await getTrailJobStatus(pool, jobId);

      if (!status) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Get display slots (exactly 10 slots with stable assignments)
      const displaySlots = getTrailDisplaySlots(status.jobId);

      // Determine current phase from display slots
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

      // Convert camelCase to snake_case for frontend consistency
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
        displaySlots  // Send exactly 10 slots instead of unbounded activeJobs
      });

    } catch (error) {
      console.error('Error getting trail status job status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel batch job
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

  // Get AI statistics for current/most recent job (per-job tracking)
  router.get('/trail-status/ai-stats', isAdmin, async (req, res) => {
    try {
      // Get the most recent job status
      const result = await pool.query(`
        SELECT ai_usage, status
        FROM trail_status_job_status
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return res.json({ usage: { gemini: 0, perplexity: 0 }, errors: { gemini429: 0, perplexity429: 0 }, activeProvider: null });
      }

      const job = result.rows[0];

      // If job is running, use real-time in-memory stats
      if (job.status === 'running') {
        const liveStats = getJobStats();
        return res.json({
          usage: liveStats.usage,
          errors: liveStats.errors,
          activeProvider: liveStats.activeProvider
        });
      }

      // For completed/cancelled jobs, use database values
      // Parse ai_usage if it's a string
      let aiUsage = job.ai_usage;
      if (typeof aiUsage === 'string') {
        try {
          aiUsage = JSON.parse(aiUsage);
        } catch (e) {
          console.error('Error parsing ai_usage:', e);
          aiUsage = { gemini: 0, perplexity: 0, gemini429: 0, perplexity429: 0 };
        }
      }
      aiUsage = aiUsage || { gemini: 0, perplexity: 0, gemini429: 0, perplexity429: 0 };

      res.json({
        usage: {
          gemini: aiUsage.gemini || 0,
          perplexity: aiUsage.perplexity || 0
        },
        errors: {
          gemini429: aiUsage.gemini429 || 0,
          perplexity429: aiUsage.perplexity429 || 0
        },
        activeProvider: null
      });
    } catch (error) {
      console.error('Error getting AI stats:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // Twitter Cookie Authentication
  // ============================================================================

  /**
   * Launch browser for manual Twitter login (opens on host machine)
   */
  router.post('/twitter/login', isAdmin, async (req, res) => {
    try {
      // Just return instructions - user will log in via their regular browser
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

  /**
   * Save manually exported cookies
   */
  router.post('/twitter/save-cookies', isAdmin, async (req, res) => {
    try {
      const { cookies } = req.body;

      if (!cookies) {
        return res.status(400).json({
          success: false,
          error: 'No cookies provided'
        });
      }

      // Parse cookies (could be JSON array or string)
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

      // Validate it's an array
      if (!Array.isArray(cookiesArray)) {
        return res.status(400).json({
          success: false,
          error: 'Cookies must be an array'
        });
      }

      // Find the auth_token cookie
      const authToken = cookiesArray.find(c => c.name === 'auth_token');

      if (!authToken) {
        return res.status(400).json({
          success: false,
          error: 'No auth_token cookie found in provided cookies. Make sure you exported all cookies from x.com'
        });
      }

      // Parse expiration date (could be Unix timestamp, ISO string, or missing)
      let expiresDate = null;
      if (authToken.expirationDate) {
        // Chrome extension format uses expirationDate (Unix timestamp)
        expiresDate = new Date(authToken.expirationDate * 1000);
      } else if (authToken.expires) {
        // Could be Unix timestamp or ISO string
        if (typeof authToken.expires === 'number') {
          expiresDate = new Date(authToken.expires * 1000);
        } else if (typeof authToken.expires === 'string') {
          expiresDate = new Date(authToken.expires);
        }
      }

      // If still no valid date, estimate 60 days from now
      if (!expiresDate || isNaN(expiresDate.getTime())) {
        expiresDate = new Date();
        expiresDate.setDate(expiresDate.getDate() + 60);
        console.log('[Twitter Auth] ⚠️ No expiration date found, estimating 60 days');
      }

      // Save cookies to database
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

      // Get saved cookies from database
      const result = await pool.query(
        "SELECT value FROM admin_settings WHERE key = 'twitter_cookies'"
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No saved Twitter cookies found. Please log in first.'
        });
      }

      const cookies = JSON.parse(result.rows[0].value);
      console.log('[Twitter Auth] Testing', cookies.length, 'saved cookies...');

      // Launch browser and load cookies
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

      // Sanitize cookies for Playwright compatibility
      const sanitizedCookies = cookies.map(cookie => {
        const sanitized = { ...cookie };

        // Fix sameSite - Playwright only accepts Strict, Lax, or None
        if (sanitized.sameSite && !['Strict', 'Lax', 'None'].includes(sanitized.sameSite)) {
          sanitized.sameSite = 'Lax';
        }

        // Ensure required fields exist
        if (!sanitized.name || !sanitized.value) {
          return null;
        }

        // Convert expirationDate to expires if needed
        if (sanitized.expirationDate && !sanitized.expires) {
          sanitized.expires = sanitized.expirationDate;
        }

        return sanitized;
      }).filter(c => c !== null);

      // Add cookies to context
      await context.addCookies(sanitizedCookies);

      const page = await context.newPage();

      // Try to access Twitter home (should redirect if not logged in)
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const currentUrl = page.url();
      const pageTitle = await page.title();

      console.log('[Twitter Auth] Test result - URL:', currentUrl);
      console.log('[Twitter Auth] Test result - Title:', pageTitle);

      // Check if still logged in
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

  /**
   * Get Twitter authentication status
   */
  router.get('/twitter/auth-status', isAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT value, updated_at FROM admin_settings WHERE key = 'twitter_cookies'"
      );

      if (result.rows.length === 0) {
        return res.json({
          authenticated: false,
          message: 'No Twitter cookies saved'
        });
      }

      const cookies = JSON.parse(result.rows[0].value);
      const authToken = cookies.find(c => c.name === 'auth_token');

      if (!authToken) {
        return res.json({
          authenticated: false,
          message: 'No auth_token found in saved cookies'
        });
      }

      // Parse expiration date (could be Unix timestamp, ISO string, or missing)
      let expiresDate = null;
      if (authToken.expirationDate) {
        // Chrome extension format uses expirationDate (Unix timestamp)
        expiresDate = new Date(authToken.expirationDate * 1000);
      } else if (authToken.expires) {
        // Could be Unix timestamp or ISO string
        if (typeof authToken.expires === 'number') {
          expiresDate = new Date(authToken.expires * 1000);
        } else if (typeof authToken.expires === 'string') {
          expiresDate = new Date(authToken.expires);
        }
      }

      // If no valid date, assume it's valid (session cookie or long-lived)
      const isExpired = expiresDate && !isNaN(expiresDate.getTime()) ? expiresDate < new Date() : false;

      res.json({
        authenticated: !isExpired,
        auth_token_preview: authToken.value.substring(0, 20) + '...',
        expires: expiresDate && !isNaN(expiresDate.getTime()) ? expiresDate.toISOString() : 'Session',
        saved_at: result.rows[0].updated_at,
        is_expired: isExpired,
        cookies_count: cookies.length
      });

    } catch (error) {
      console.error('[Twitter Auth] Error getting auth status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Playwright status endpoint - check if browser can be launched
  router.get('/playwright/status', isAdmin, async (req, res) => {
    const startTime = Date.now();
    let browser = null;

    try {
      const { chromium } = await import('playwright');

      // Try to launch browser
      browser = await chromium.launch({
        headless: true,
        timeout: 15000
      });

      const context = await browser.newContext();
      const page = await context.newPage();

      // Navigate to a simple test page
      await page.goto('about:blank', { timeout: 5000 });

      // Get browser version
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

      // Clean up browser if it was partially launched
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          // Ignore close errors
        }
      }

      console.error('[Playwright Status] Error:', error.message);

      // Determine the type of error
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

  // Playwright test endpoint - actually render a page and verify content extraction
  router.post('/playwright/test', isAdmin, async (req, res) => {
    const { url = 'https://example.com' } = req.body;
    const startTime = Date.now();

    try {
      const { renderJavaScriptPage } = await import('../services/jsRenderer.js');

      const result = await renderJavaScriptPage(url, {
        timeout: 15000,
        waitTime: 2000
      });

      const elapsed = Date.now() - startTime;

      if (result.success) {
        res.json({
          status: 'success',
          message: 'Page rendered successfully',
          url: url,
          title: result.title,
          text_length: result.text?.length || 0,
          links_found: result.links?.length || 0,
          elapsed_ms: elapsed,
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          status: 'failed',
          message: result.error || 'Failed to render page',
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

  // Test image server connection
  router.post('/test-image-server', isAdmin, async (req, res) => {
    try {
      const result = await imageServerClient.testConnection();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Moderation Queue Routes (#106)
  // ============================================

  // Get paginated moderation queue
  router.get('/moderation/queue', isAdmin, async (req, res) => {
    try {
      const { page = 1, limit = 20, type, status = 'pending', source } = req.query;
      const result = await getModerationQueue(pool, {
        page: parseInt(page),
        limit: parseInt(limit),
        contentType: type || null,
        status,
        contentSource: source || null
      });
      res.json(result);
    } catch (error) {
      console.error('Error fetching moderation queue:', error);
      res.status(500).json({ error: 'Failed to fetch moderation queue' });
    }
  });

  // Get pending count for badge
  router.get('/moderation/queue/count', isAdmin, async (req, res) => {
    try {
      const count = await getModerationPendingCount(pool);
      res.json({ count });
    } catch (error) {
      console.error('Error fetching moderation count:', error);
      res.status(500).json({ error: 'Failed to fetch count' });
    }
  });

  // Get full item detail with AI reasoning
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

  // Approve a single item
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

  // Reject a single item
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

  // Bulk approve
  router.post('/moderation/bulk-approve', isAdmin, async (req, res) => {
    try {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const result = await bulkApprove(pool, items, req.user.id);
      res.json(result);
    } catch (error) {
      console.error('Error bulk approving:', error);
      res.status(500).json({ error: 'Failed to bulk approve' });
    }
  });

  // Edit and publish
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

  // Requeue for re-review
  router.post('/moderation/requeue', isAdmin, async (req, res) => {
    try {
      const { type, id } = req.body;
      if (!type || !id) {
        return res.status(400).json({ error: 'type and id are required' });
      }
      await requeueItem(pool, type, id);
      // Queue a new moderation job
      await queueModerationJob(type, id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error requeuing item:', error);
      res.status(500).json({ error: 'Failed to requeue item' });
    }
  });

  // Fix URL via AI web search, then requeue for moderation
  router.post('/moderation/research', isAdmin, async (req, res) => {
    try {
      const { type, id } = req.body;
      if (!type || !id) {
        return res.status(400).json({ error: 'type and id are required' });
      }
      if (type === 'photo') {
        return res.status(400).json({ error: 'Fix URL is not available for photos' });
      }
      const result = await researchItem(pool, type, id);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Error fixing URL:', error);
      res.status(500).json({ error: error.message || 'Failed to fix URL' });
    }
  });

  // Fix publication date via AI web search
  router.post('/moderation/fix-date', isAdmin, async (req, res) => {
    try {
      const { type, id } = req.body;
      if (!type || !id) {
        return res.status(400).json({ error: 'type and id are required' });
      }
      if (type === 'photo') {
        return res.status(400).json({ error: 'Fix Date is not available for photos' });
      }
      const result = await fixDate(pool, type, id);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Error fixing date:', error);
      res.status(500).json({ error: error.message || 'Failed to fix date' });
    }
  });

  // Purge all rejected items
  router.post('/moderation/purge-rejected', isAdmin, async (req, res) => {
    try {
      const { type } = req.body;
      const result = await purgeRejected(pool, type || null);
      res.json(result);
    } catch (error) {
      console.error('Error purging rejected items:', error);
      res.status(500).json({ error: 'Failed to purge rejected items' });
    }
  });

  // Create new content item (admin)
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

  // ============================================
  // Photo Submission Route (public, authenticated)
  // ============================================

  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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
      // Check if photo submissions are enabled
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

      // Upload to image server
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

      // Create photo_submissions record
      const result = await pool.query(
        `INSERT INTO photo_submissions (poi_id, image_server_asset_id, original_filename, submitted_by, caption)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [parseInt(poi_id), uploadResult.assetId, req.file.originalname, req.user.id, caption || null]
      );

      // Queue moderation job
      await queueModerationJob('photo', result.rows[0].id);

      res.json({ success: true, submissionId: result.rows[0].id });
    } catch (error) {
      console.error('Error submitting photo:', error);
      res.status(500).json({ error: 'Failed to submit photo' });
    }
  });

  return router;
}
