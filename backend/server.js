import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

import { configurePassport } from './config/passport.js';
import authRoutes from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import {
  initJobScheduler,
  scheduleNewsCollection,
  registerNewsCollectionHandler,
  registerBatchNewsHandler,
  submitBatchNewsJob,
  scheduleTrailStatusCollection,
  registerTrailStatusHandler,
  registerBatchTrailStatusHandler,
  stopJobScheduler
} from './services/jobScheduler.js';
import {
  runNewsCollection,
  processNewsCollectionJob,
  ensureNewsJobCheckpointColumns,
  findIncompleteJobs
} from './services/newsService.js';
import {
  getLatestTrailStatus,
  processTrailStatusCollectionJob
} from './services/trailStatusService.js';
import { createSheetsService } from './services/sheetsSync.js';
import immichService from './services/immichService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

const app = express();

// Trust reverse proxy (for secure cookies behind CloudFlare/Apache)
app.set('trust proxy', 1);

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD || 'rotv',
  // Background jobs use up to 10 concurrent connections
  // Reserve extra for API requests to prevent blocking
  max: 20,
  // Timeout after 10 seconds if no connection available (fail fast vs hang)
  connectionTimeoutMillis: 10000,
});

// CORS configuration - allow credentials for session cookies
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:5173'],
  credentials: true
}));

// Increase JSON body limit for large GeoJSON geometry in linear features
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Session configuration with PostgreSQL store
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: 'sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Initialize Passport
configurePassport(pool);
app.use(passport.initialize());
app.use(passport.session());

// Mount auth routes
app.use('/auth', authRoutes);

// Mount admin routes
app.use('/api/admin', createAdminRouter(pool, clearThumbnailCacheForPoi));

// Import trails and rivers from GeoJSON files into unified pois table
async function importGeoJSONFeatures(client) {
  const staticPath = process.env.STATIC_PATH || path.join(__dirname, '../frontend/public');
  const dataPath = path.join(staticPath, 'data');

  // Helper to consolidate features by name
  function consolidateFeatures(features) {
    const byName = {};
    for (const feature of features) {
      const name = feature.properties?.name || 'Unnamed';
      if (!byName[name]) byName[name] = [];
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

  try {
    // Import trails
    const trailsFile = path.join(dataPath, 'cvnp-trails.geojson');
    const trailsData = JSON.parse(await fs.readFile(trailsFile, 'utf-8'));
    const consolidatedTrails = consolidateFeatures(trailsData.features);

    for (const trail of consolidatedTrails) {
      await client.query(
        `INSERT INTO pois (name, poi_type, geometry)
         VALUES ($1, 'trail', $2)
         ON CONFLICT (name) DO UPDATE SET geometry = EXCLUDED.geometry WHERE pois.poi_type = 'trail'`,
        [trail.name, JSON.stringify(trail.geometry)]
      );
    }
    console.log(`Imported ${consolidatedTrails.length} trails`);

    // Import rivers
    const riverFile = path.join(dataPath, 'cvnp-river.geojson');
    const riverData = JSON.parse(await fs.readFile(riverFile, 'utf-8'));
    const consolidatedRivers = consolidateFeatures(riverData.features);

    for (const river of consolidatedRivers) {
      await client.query(
        `INSERT INTO pois (name, poi_type, geometry)
         VALUES ($1, 'river', $2)
         ON CONFLICT (name) DO UPDATE SET geometry = EXCLUDED.geometry WHERE pois.poi_type = 'river'`,
        [river.name, JSON.stringify(river.geometry)]
      );
    }
    console.log(`Imported ${consolidatedRivers.length} rivers`);

    // Import boundaries
    const boundaryFile = path.join(dataPath, 'cvnp-boundary.geojson');
    const boundaryData = JSON.parse(await fs.readFile(boundaryFile, 'utf-8'));

    for (const feature of boundaryData.features) {
      const name = feature.properties?.name || 'Park Boundary';
      await client.query(
        `INSERT INTO pois (name, poi_type, geometry)
         VALUES ($1, 'boundary', $2)
         ON CONFLICT (name) DO UPDATE SET geometry = EXCLUDED.geometry WHERE pois.poi_type = 'boundary'`,
        [name, JSON.stringify(feature.geometry)]
      );
    }
    console.log(`Imported ${boundaryData.features.length} boundaries`);

  } catch (err) {
    console.error('Error importing GeoJSON features:', err.message);
  }
}

// Create tables if not exists
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Standardized eras table (must be created before pois for FK constraint)
    await client.query(`
      CREATE TABLE IF NOT EXISTS eras (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        year_start INTEGER,
        year_end INTEGER,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default eras if table is empty
    const eraCount = await client.query('SELECT COUNT(*) FROM eras');
    if (parseInt(eraCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO eras (name, year_start, year_end, description, sort_order) VALUES
        ('Pre-Colonial', NULL, 1750, 'Native American settlement and early history', 1),
        ('Early Settlement', 1750, 1827, 'European settlement and early farming communities', 2),
        ('Canal Era', 1827, 1913, 'Ohio & Erie Canal construction and operation', 3),
        ('Railroad Era', 1880, 1950, 'Valley Railroad and industrial transportation', 4),
        ('Industrial Era', 1870, 1970, 'Manufacturing, quarrying, and industrial development', 5),
        ('Conservation Era', 1970, 2000, 'Park establishment and early preservation efforts', 6),
        ('Modern Era', 2000, NULL, 'National Park status and current stewardship', 7)
        ON CONFLICT (name) DO NOTHING
      `);
    }

    // Unified POIs table (replaces destinations and linear_features)
    await client.query(`
      CREATE TABLE IF NOT EXISTS pois (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,

        -- POI type: 'point', 'trail', 'river', or 'boundary'
        poi_type VARCHAR(50) NOT NULL DEFAULT 'point',

        -- Point geometry (for point POIs)
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),

        -- Linear geometry (for trail/river POIs)
        geometry JSONB,
        geometry_drive_file_id VARCHAR(255),

        -- Shared metadata fields
        property_owner VARCHAR(255),
        owner_id INTEGER REFERENCES pois(id),
        brief_description TEXT,
        era_id INTEGER REFERENCES eras(id),
        historical_description TEXT,
        primary_activities TEXT,
        surface VARCHAR(255),
        pets VARCHAR(50),
        cell_signal INTEGER,
        more_info_link TEXT,

        -- Trail-specific fields
        length_miles DECIMAL(6, 2),
        difficulty VARCHAR(50),

        -- Image storage
        image_data BYTEA,
        image_mime_type VARCHAR(50),
        image_drive_file_id VARCHAR(255),

        -- Sync fields
        locally_modified BOOLEAN DEFAULT FALSE,
        deleted BOOLEAN DEFAULT FALSE,
        synced BOOLEAN DEFAULT FALSE,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index for faster lookups by type
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pois_type ON pois(poi_type)
    `);

    // Create index for owner lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pois_owner_id ON pois(owner_id)
    `);

    // Create unique constraint on (name, poi_type) to allow same-named features of different types
    // Only applies to non-deleted POIs (partial index) to allow reusing names after deletion
    await client.query(`
      DO $$ BEGIN
        -- Drop old constraint if it exists
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pois_name_poi_type_key') THEN
          ALTER TABLE pois DROP CONSTRAINT pois_name_poi_type_key;
        END IF;
        -- Drop old name-only constraint if it exists
        ALTER TABLE pois DROP CONSTRAINT IF EXISTS pois_name_key;
        -- Create partial unique index that excludes deleted POIs
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'pois_name_poi_type_active_key') THEN
          CREATE UNIQUE INDEX pois_name_poi_type_active_key ON pois(name, poi_type)
          WHERE (deleted IS NULL OR deleted = FALSE);
        END IF;
      END $$;
    `);

    // Migrate data from old tables if they exist
    const destTableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'destinations'
      )
    `);

    if (destTableExists.rows[0].exists) {
      // Migrate destinations to pois table
      const migrated = await client.query(`
        INSERT INTO pois (name, poi_type, latitude, longitude, property_owner, brief_description,
                          era, historical_description, primary_activities, surface, pets,
                          cell_signal, more_info_link, image_data, image_mime_type, image_drive_file_id,
                          locally_modified, deleted, synced, created_at, updated_at)
        SELECT name, 'point', latitude, longitude, property_owner, brief_description,
               era, historical_description, primary_activities, surface, pets,
               cell_signal, more_info_link, image_data, image_mime_type, image_drive_file_id,
               COALESCE(locally_modified, FALSE), COALESCE(deleted, FALSE), COALESCE(synced, FALSE),
               created_at, updated_at
        FROM destinations
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ON CONFLICT (name) DO NOTHING
        RETURNING id
      `);
      if (migrated.rowCount > 0) {
        console.log(`Migrated ${migrated.rowCount} destinations to pois table`);
      }
    }

    const linearTableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'linear_features'
      )
    `);

    if (linearTableExists.rows[0].exists) {
      // Migrate linear_features to pois table
      const migrated = await client.query(`
        INSERT INTO pois (name, poi_type, geometry, property_owner, brief_description,
                          era, historical_description, primary_activities, surface, pets,
                          cell_signal, more_info_link, length_miles, difficulty,
                          image_data, image_mime_type, image_drive_file_id,
                          locally_modified, deleted, synced, created_at, updated_at)
        SELECT name, feature_type, geometry, property_owner, brief_description,
               era, historical_description, primary_activities, surface, pets,
               cell_signal, more_info_link, length_miles, difficulty,
               image_data, image_mime_type, image_drive_file_id,
               COALESCE(locally_modified, FALSE), COALESCE(deleted, FALSE), COALESCE(synced, FALSE),
               created_at, updated_at
        FROM linear_features
        ON CONFLICT (name) DO UPDATE SET
          geometry = EXCLUDED.geometry,
          poi_type = EXCLUDED.poi_type
        WHERE pois.poi_type IN ('trail', 'river', 'boundary')
        RETURNING id
      `);
      if (migrated.rowCount > 0) {
        console.log(`Migrated ${migrated.rowCount} linear features to pois table`);
      }
    }

    // Sync queue table for async operations
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id SERIAL PRIMARY KEY,
        operation VARCHAR(20) NOT NULL,
        table_name VARCHAR(50) NOT NULL,
        record_id INTEGER NOT NULL,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sync status table for tracking sync state
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_status (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE,
        name VARCHAR(255),
        picture_url TEXT,
        oauth_provider VARCHAR(50) NOT NULL,
        oauth_provider_id VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        preferences JSONB DEFAULT '{}',
        favorite_destinations INTEGER[] DEFAULT '{}',
        oauth_credentials JSONB DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP,
        UNIQUE(oauth_provider, oauth_provider_id)
      )
    `);

    // Add oauth_credentials column if it doesn't exist (for existing databases)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'oauth_credentials'
        ) THEN
          ALTER TABLE users ADD COLUMN oauth_credentials JSONB DEFAULT NULL;
        END IF;
      END $$;
    `);

    // Admin settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id)
      )
    `);

    // Standardized activities table
    await client.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default activities if table is empty
    const activityCount = await client.query('SELECT COUNT(*) FROM activities');
    if (parseInt(activityCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO activities (name, sort_order) VALUES
        ('Hiking', 1),
        ('Biking', 2),
        ('Photography', 3),
        ('Bird Watching', 4),
        ('Fishing', 5),
        ('Picnicking', 6),
        ('Camping', 7),
        ('Cross-Country Skiing', 8),
        ('Snowshoeing', 9),
        ('Kayaking', 10),
        ('Wildlife Viewing', 11),
        ('Historical Tours', 12),
        ('Train Rides', 13),
        ('Nature Study', 14),
        ('Scenic Drives', 15)
        ON CONFLICT (name) DO NOTHING
      `);
    }

    // Standardized surfaces table
    await client.query(`
      CREATE TABLE IF NOT EXISTS surfaces (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default surfaces if table is empty
    const surfaceCount = await client.query('SELECT COUNT(*) FROM surfaces');
    if (parseInt(surfaceCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO surfaces (name, description, sort_order) VALUES
        ('Paved', 'Asphalt or concrete surface, suitable for all users', 1),
        ('Gravel', 'Gravel or crushed stone surface', 2),
        ('Boardwalk', 'Wooden planks, often over wetlands', 3),
        ('Dirt', 'Dirt or earth trail, varies with weather', 4),
        ('Grass', 'Mowed grass paths through fields', 5),
        ('Sand', 'Sandy surface, common near waterways', 6),
        ('Rocky', 'Natural rock outcroppings, uneven terrain', 7),
        ('Water', 'River or lake', 8),
        ('Rail', 'Historic railroad bed', 9),
        ('Mixed', 'Combination of multiple surface types', 10)
        ON CONFLICT (name) DO NOTHING
      `);
    }

    // Icons table for map icon configuration
    await client.query(`
      CREATE TABLE IF NOT EXISTS icons (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        label VARCHAR(100) NOT NULL,
        svg_filename VARCHAR(255),
        title_keywords TEXT,
        activity_fallbacks TEXT,
        sort_order INTEGER DEFAULT 0,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add svg_content column if it doesn't exist (for AI-generated icons)
    await client.query(`
      ALTER TABLE icons ADD COLUMN IF NOT EXISTS svg_content TEXT
    `);

    // Add drive_file_id column for Google Drive storage
    await client.query(`
      ALTER TABLE icons ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(255)
    `);

    // Drive settings table for folder IDs
    await client.query(`
      CREATE TABLE IF NOT EXISTS drive_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // News table for POI-related news items
    await client.query(`
      CREATE TABLE IF NOT EXISTS poi_news (
        id SERIAL PRIMARY KEY,
        poi_id INTEGER REFERENCES pois(id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        summary TEXT,
        source_url TEXT,
        source_name VARCHAR(255),
        news_type VARCHAR(50) DEFAULT 'general',
        published_at DATE,
        ai_generated BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_news_poi_id ON poi_news(poi_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_news_published_at ON poi_news(published_at)`);

    // Events table for POI-related events
    await client.query(`
      CREATE TABLE IF NOT EXISTS poi_events (
        id SERIAL PRIMARY KEY,
        poi_id INTEGER REFERENCES pois(id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        start_date DATE NOT NULL,
        end_date DATE,
        event_type VARCHAR(100),
        location_details TEXT,
        source_url TEXT,
        calendar_event_id VARCHAR(255),
        ai_generated BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_events_poi_id ON poi_events(poi_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_events_start_date ON poi_events(start_date)`);

    // News job status tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_job_status (
        id SERIAL PRIMARY KEY,
        job_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        total_pois INTEGER DEFAULT 0,
        pois_processed INTEGER DEFAULT 0,
        news_found INTEGER DEFAULT 0,
        events_found INTEGER DEFAULT 0,
        error_message TEXT,
        ai_usage TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add columns if they don't exist (migration for existing tables)
    await client.query(`
      ALTER TABLE news_job_status ADD COLUMN IF NOT EXISTS total_pois INTEGER DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE news_job_status ADD COLUMN IF NOT EXISTS ai_usage TEXT
    `);

    // Thumbnail cache table - persists across server restarts
    // This is a cache table that can be safely truncated/dropped without data loss
    await client.query(`
      CREATE TABLE IF NOT EXISTS thumbnail_cache (
        id SERIAL PRIMARY KEY,
        poi_id INTEGER NOT NULL,
        size VARCHAR(20) NOT NULL DEFAULT 'default',
        image_data BYTEA NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(poi_id, size)
      )
    `);
    // Index for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_lookup ON thumbnail_cache(poi_id, size)
    `);

    // Add boundary_type and boundary_color columns for multiple boundary support
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS boundary_type TEXT
    `);
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS boundary_color TEXT DEFAULT '#228B22'
    `);
    // Set default boundary_type for existing boundaries
    await client.query(`
      UPDATE pois SET boundary_type = 'cvnp' WHERE poi_type = 'boundary' AND boundary_type IS NULL
    `);

    // Add events_url and news_url columns for targeted AI Research
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS events_url TEXT
    `);
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS news_url TEXT
    `);

    // Add status_url column for MTB Trail Status feature
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS status_url VARCHAR(500)
    `);

    // Create trail_status table for storing trail condition updates
    await client.query(`
      CREATE TABLE IF NOT EXISTS trail_status (
        id SERIAL PRIMARY KEY,
        poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        conditions TEXT,
        last_updated TIMESTAMP,
        source_name VARCHAR(200),
        source_url VARCHAR(1000),
        weather_impact TEXT,
        seasonal_closure BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for trail_status
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trail_status_poi_id ON trail_status(poi_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trail_status_updated ON trail_status(last_updated DESC)`);

    // Create trail_status_job_status table for job tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS trail_status_job_status (
        id SERIAL PRIMARY KEY,
        job_type VARCHAR(50),
        status VARCHAR(20),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        total_trails INTEGER,
        trails_processed INTEGER,
        status_found INTEGER,
        error_message TEXT,
        poi_ids TEXT,
        processed_poi_ids TEXT,
        pg_boss_job_id VARCHAR(100),
        ai_usage JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add ai_usage column if missing (for existing tables)
    await client.query(`
      ALTER TABLE trail_status_job_status ADD COLUMN IF NOT EXISTS ai_usage JSONB
    `);

    // Create indexes for job status queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trail_status_job_status_created ON trail_status_job_status(created_at DESC)`);

    // Ensure default icons exist (adds any missing defaults to existing databases)
    // ON CONFLICT DO NOTHING means existing icons won't be overwritten
    await client.query(`
      INSERT INTO icons (name, label, svg_filename, title_keywords, activity_fallbacks, sort_order) VALUES
      ('visitor-center', 'Visitor Center', 'visitor-center.svg', 'visitor center,info,information', 'Info', 1),
      ('waterfall', 'Waterfall', 'waterfall.svg', 'falls,waterfall,cascade', NULL, 2),
      ('trail', 'Trail', 'trail.svg', 'trail,path,towpath', 'Hiking', 3),
      ('historic', 'Historic Site', 'historic.svg', 'historic,history,museum,house,mill,lock', 'Historical Tours', 4),
      ('bridge', 'Bridge', 'bridge.svg', 'bridge,covered bridge', NULL, 5),
      ('train', 'Train Station', 'train.svg', 'train,station,depot,railroad', 'Train Rides', 6),
      ('nature', 'Nature Area', 'nature.svg', 'nature,preserve,wetland,marsh,ledges', 'Nature Study,Wildlife Viewing', 7),
      ('skiing', 'Skiing', 'skiing.svg', 'ski,winter', 'Cross-Country Skiing,Snowshoeing', 8),
      ('biking', 'Biking', 'biking.svg', 'bike,cycling', 'Biking', 9),
      ('picnic', 'Picnic Area', 'picnic.svg', 'picnic,shelter', 'Picnicking', 10),
      ('camping', 'Camping', 'camping.svg', 'camp,campground', 'Camping', 11),
      ('music', 'Music Venue', 'music.svg', 'music,blossom,concert', 'Music', 12),
      ('mtb-trailhead', 'MTB Trailheads', 'mtb-trailhead.svg', NULL, 'Mountain Biking', 13),
      ('default', 'Other', 'default.svg', NULL, NULL, 14)
      ON CONFLICT (name) DO NOTHING
    `);

    // Remove icon column from activities if it exists (moved to icons table)
    await client.query(`
      ALTER TABLE activities DROP COLUMN IF EXISTS icon
    `);

    // POI Associations table - for virtual POIs linking to physical POIs
    await client.query(`
      CREATE TABLE IF NOT EXISTS poi_associations (
        id SERIAL PRIMARY KEY,
        virtual_poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
        physical_poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
        association_type VARCHAR(50) DEFAULT 'manages',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(virtual_poi_id, physical_poi_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_poi_assoc_virtual ON poi_associations(virtual_poi_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_poi_assoc_physical ON poi_associations(physical_poi_id)
    `);

    // NOTE: Trails and rivers should only be imported via Google Sheets sync
    // The importGeoJSONFeatures function is available via admin route for manual import if needed

    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// API Routes - Unified POIs
app.get('/api/pois', async (req, res) => {
  try {
    const { type } = req.query;

    let query = `
      SELECT p.id, p.name, p.poi_type, p.latitude, p.longitude, p.geometry, p.geometry_drive_file_id,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.length_miles, p.difficulty, p.image_mime_type, p.image_drive_file_id,
             p.boundary_type, p.boundary_color, p.news_url, p.events_url,
             p.locally_modified, p.deleted, p.synced, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND o.poi_type = 'virtual'
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE (p.deleted IS NULL OR p.deleted = FALSE)
    `;

    const params = [];
    if (type) {
      params.push(type);
      query += ` AND p.poi_type = $1`;
    }

    query += ` ORDER BY p.poi_type, p.name`;

    const poisQuery = await pool.query(query, params);
    res.json(poisQuery.rows);
  } catch (error) {
    console.error('Error fetching POIs:', error);
    res.status(500).json({ error: 'Failed to fetch POIs' });
  }
});

app.get('/api/pois/:id', async (req, res) => {
  try {
    const poiQuery = await pool.query(`
      SELECT p.id, p.name, p.poi_type, p.latitude, p.longitude, p.geometry, p.geometry_drive_file_id,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.length_miles, p.difficulty, p.image_mime_type, p.image_drive_file_id,
             p.boundary_type, p.boundary_color, p.news_url, p.events_url,
             p.locally_modified, p.deleted, p.synced, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND o.poi_type = 'virtual'
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE p.id = $1`,
      [req.params.id]
    );
    if (poiQuery.rows.length === 0) {
      return res.status(404).json({ error: 'POI not found' });
    }
    res.json(poiQuery.rows[0]);
  } catch (error) {
    console.error('Error fetching POI:', error);
    res.status(500).json({ error: 'Failed to fetch POI' });
  }
});

// Serve POI images from database (public endpoint)
app.get('/api/pois/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const imageQuery = await pool.query(
      'SELECT image_data, image_mime_type FROM pois WHERE id = $1 AND image_data IS NOT NULL',
      [id]
    );

    if (imageQuery.rows.length === 0 || !imageQuery.rows[0].image_data) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const { image_data, image_mime_type } = imageQuery.rows[0];
    res.setHeader('Content-Type', image_mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(image_data);
  } catch (error) {
    console.error('Error serving POI image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// Two-tier thumbnail cache:
// L1: In-memory Map (fastest, cleared on restart)
// L2: Database table (persistent, unlimited size)
const thumbnailMemoryCache = new Map();
const MEMORY_CACHE_MAX_SIZE = 500; // Max in-memory thumbnails (LRU eviction)

// Helper to send thumbnail response
function sendThumbnail(res, imageData) {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week browser cache
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(imageData);
}

// Helper to add to memory cache with LRU eviction
function addToMemoryCache(key, thumbnailImageData) {
  if (thumbnailMemoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
    // Remove oldest entry (first key in Map)
    const firstKey = thumbnailMemoryCache.keys().next().value;
    thumbnailMemoryCache.delete(firstKey);
  }
  thumbnailMemoryCache.set(key, thumbnailImageData);
}

// Helper to clear all thumbnail cache entries for a specific POI
function clearThumbnailCacheForPoi(poiId) {
  const sizes = ['small', 'medium', 'default'];
  sizes.forEach(size => {
    const cacheKey = `${poiId}-${size}`;
    thumbnailMemoryCache.delete(cacheKey);
  });
  console.log(`Cleared memory cache for POI ${poiId}`);
}

// Serve optimized thumbnails with configurable size
// Two-tier cache: Memory (L1) -> Database (L2) -> Generate
// Sizes: small (200x200), medium (400x300), default (1200x630)
app.get('/api/pois/:id/thumbnail', async (req, res) => {
  try {
    const { id } = req.params;
    const sizeParam = req.query.size || 'default';
    const cacheKey = `${id}-${sizeParam}`;

    // L1: Check memory cache first (fastest)
    if (thumbnailMemoryCache.has(cacheKey)) {
      return sendThumbnail(res, thumbnailMemoryCache.get(cacheKey));
    }

    // L2: Check database cache
    const dbCache = await pool.query(
      'SELECT image_data FROM thumbnail_cache WHERE poi_id = $1 AND size = $2',
      [id, sizeParam]
    );

    if (dbCache.rows.length > 0) {
      const cachedData = dbCache.rows[0].image_data;
      // Promote to memory cache
      addToMemoryCache(cacheKey, cachedData);
      return sendThumbnail(res, cachedData);
    }

    // Cache miss - need to generate thumbnail
    // Determine dimensions based on size param
    let width, height, quality;
    if (sizeParam === 'small') {
      width = 200; height = 200; quality = 70;
    } else if (sizeParam === 'medium') {
      width = 400; height = 300; quality = 75;
    } else {
      width = 1200; height = 630; quality = 80;
    }

    // Fetch original image and POI type
    const imageQuery = await pool.query(
      'SELECT image_data, poi_type FROM pois WHERE id = $1 AND image_data IS NOT NULL',
      [id]
    );

    if (imageQuery.rows.length === 0 || !imageQuery.rows[0].image_data) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const isVirtualPoi = imageQuery.rows[0].poi_type === 'virtual';

    // Generate thumbnail
    // Use 'contain' for organization logos (virtual POIs) to show full logo without cropping
    // Use 'cover' for photos (destinations, trails) to fill the frame
    const resizeOptions = isVirtualPoi
      ? {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 } // White background for logos
        }
      : {
          fit: 'cover',
          position: 'center'
        };

    const thumbnail = await sharp(imageQuery.rows[0].image_data)
      .resize(width, height, resizeOptions)
      .jpeg({
        quality: quality,
        progressive: true
      })
      .toBuffer();

    // Store in L2 (database) - persistent cache
    await pool.query(
      `INSERT INTO thumbnail_cache (poi_id, size, image_data)
       VALUES ($1, $2, $3)
       ON CONFLICT (poi_id, size) DO UPDATE SET image_data = $3, created_at = CURRENT_TIMESTAMP`,
      [id, sizeParam, thumbnail]
    );

    // Store in L1 (memory)
    addToMemoryCache(cacheKey, thumbnail);

    sendThumbnail(res, thumbnail);
  } catch (error) {
    console.error('Error serving POI thumbnail:', error);
    res.status(500).json({ error: 'Failed to serve thumbnail' });
  }
});

app.get('/api/filters', async (req, res) => {
  try {
    // Get owners from organizations (virtual POIs that are used as owners)
    const owners = await pool.query(`
      SELECT DISTINCT o.id, o.name
      FROM pois o
      WHERE o.poi_type = 'virtual'
        AND (o.deleted IS NULL OR o.deleted = FALSE)
        AND EXISTS (SELECT 1 FROM pois p WHERE p.owner_id = o.id)
      ORDER BY o.name
    `);
    const eras = await pool.query('SELECT id, name FROM eras ORDER BY sort_order, id');
    const surfaces = await pool.query('SELECT DISTINCT surface FROM pois WHERE surface IS NOT NULL ORDER BY surface');

    res.json({
      owners: owners.rows.map(r => r.name),
      ownerOrganizations: owners.rows, // Include id and name for new UI
      eras: eras.rows.map(r => r.name), // Keep backward compatibility
      erasList: eras.rows, // Include id and name for new UI
      surfaces: surfaces.rows.map(r => r.surface)
    });
  } catch (error) {
    console.error('Error fetching filters:', error);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

// Get all organizations that can be used as property owners
app.get('/api/owner-organizations', async (req, res) => {
  try {
    const organizationsQuery = await pool.query(`
      SELECT id, name, brief_description
      FROM pois
      WHERE poi_type = 'virtual'
        AND (deleted IS NULL OR deleted = FALSE)
      ORDER BY name
    `);
    res.json(organizationsQuery.rows);
  } catch (error) {
    console.error('Error fetching owner organizations:', error);
    res.status(500).json({ error: 'Failed to fetch owner organizations' });
  }
});

// POI Associations endpoints
app.get('/api/pois/:id/associations', async (req, res) => {
  try {
    const { id } = req.params;
    const associationsQuery = await pool.query(`
      SELECT a.id, a.virtual_poi_id, a.physical_poi_id, a.association_type,
             vp.name as virtual_poi_name, vp.poi_type as virtual_poi_type,
             pp.name as physical_poi_name, pp.poi_type as physical_poi_type,
             a.created_at, a.updated_at
      FROM poi_associations a
      LEFT JOIN pois vp ON a.virtual_poi_id = vp.id
      LEFT JOIN pois pp ON a.physical_poi_id = pp.id
      WHERE (a.virtual_poi_id = $1 OR a.physical_poi_id = $1)
        AND (vp.deleted IS NULL OR vp.deleted = FALSE)
        AND (pp.deleted IS NULL OR pp.deleted = FALSE)
      ORDER BY a.created_at DESC
    `, [id]);
    res.json(associationsQuery.rows);
  } catch (error) {
    console.error('Error fetching POI associations:', error);
    res.status(500).json({ error: 'Failed to fetch associations' });
  }
});

// Get all associations (for frontend state management)
app.get('/api/associations', async (req, res) => {
  try {
    const associationsQuery = await pool.query(`
      SELECT a.id, a.virtual_poi_id, a.physical_poi_id, a.association_type,
             a.created_at, a.updated_at
      FROM poi_associations a
      JOIN pois vp ON a.virtual_poi_id = vp.id
      JOIN pois pp ON a.physical_poi_id = pp.id
      WHERE (vp.deleted IS NULL OR vp.deleted = FALSE)
        AND (pp.deleted IS NULL OR pp.deleted = FALSE)
      ORDER BY a.virtual_poi_id, a.physical_poi_id
    `);
    res.json(associationsQuery.rows);
  } catch (error) {
    console.error('Error fetching all associations:', error);
    res.status(500).json({ error: 'Failed to fetch associations' });
  }
});

// Get virtual POIs that have associated physical POIs within viewport bounds
app.get('/api/pois/virtual-in-viewport', async (req, res) => {
  try {
    const { bounds } = req.query;

    if (!bounds) {
      return res.status(400).json({ error: 'bounds parameter required (format: s,w,n,e)' });
    }

    const [south, west, north, east] = bounds.split(',').map(parseFloat);

    if ([south, west, north, east].some(isNaN)) {
      return res.status(400).json({ error: 'Invalid bounds format' });
    }

    // Find virtual POIs that have at least one associated physical POI within bounds
    const virtualPoisQuery = await pool.query(`
      SELECT DISTINCT vp.id, vp.name, vp.poi_type, vp.property_owner,
             vp.brief_description, vp.era_id, e.name as era_name, vp.era, vp.historical_description,
             vp.primary_activities, vp.surface, vp.pets, vp.cell_signal,
             vp.more_info_link, vp.image_mime_type, vp.image_drive_file_id,
             vp.locally_modified, vp.deleted, vp.synced,
             vp.created_at, vp.updated_at
      FROM pois vp
      JOIN poi_associations a ON vp.id = a.virtual_poi_id
      JOIN pois pp ON a.physical_poi_id = pp.id
      LEFT JOIN eras e ON vp.era_id = e.id
      WHERE vp.poi_type = 'virtual'
        AND (vp.deleted IS NULL OR vp.deleted = FALSE)
        AND (pp.deleted IS NULL OR pp.deleted = FALSE)
        AND pp.latitude IS NOT NULL
        AND pp.longitude IS NOT NULL
        AND pp.latitude BETWEEN $1 AND $3
        AND pp.longitude BETWEEN $2 AND $4
      ORDER BY vp.name
    `, [south, west, north, east]);

    res.json(virtualPoisQuery.rows);
  } catch (error) {
    console.error('Error fetching virtual POIs in viewport:', error);
    res.status(500).json({ error: 'Failed to fetch virtual POIs' });
  }
});

// Legacy API endpoints for backward compatibility during transition
app.get('/api/destinations', async (req, res) => {
  try {
    const destinationsQuery = await pool.query(`
      SELECT p.id, p.name, p.poi_type, p.latitude, p.longitude,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.image_mime_type, p.image_drive_file_id, p.news_url, p.events_url, p.status_url,
             p.locally_modified, p.deleted, p.synced, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND o.poi_type = 'virtual'
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE p.poi_type = 'point'
        AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
        AND (p.deleted IS NULL OR p.deleted = FALSE)
      ORDER BY p.name
    `);
    res.json(destinationsQuery.rows);
  } catch (error) {
    console.error('Error fetching destinations:', error);
    res.status(500).json({ error: 'Failed to fetch destinations' });
  }
});

app.get('/api/destinations/:id', async (req, res) => {
  try {
    const destinationQuery = await pool.query(`
      SELECT p.id, p.name, p.poi_type, p.latitude, p.longitude,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.image_mime_type, p.image_drive_file_id, p.news_url, p.events_url, p.status_url,
             p.locally_modified, p.deleted, p.synced, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND o.poi_type = 'virtual'
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE p.id = $1`,
      [req.params.id]
    );
    if (destinationQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Destination not found' });
    }
    res.json(destinationQuery.rows[0]);
  } catch (error) {
    console.error('Error fetching destination:', error);
    res.status(500).json({ error: 'Failed to fetch destination' });
  }
});

// Legacy destination image endpoint - redirect to unified pois endpoint
app.get('/api/destinations/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const imageQuery = await pool.query(
      'SELECT image_data, image_mime_type FROM pois WHERE id = $1 AND image_data IS NOT NULL',
      [id]
    );

    if (imageQuery.rows.length === 0 || !imageQuery.rows[0].image_data) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const { image_data, image_mime_type } = imageQuery.rows[0];
    res.setHeader('Content-Type', image_mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(image_data);
  } catch (error) {
    console.error('Error serving destination image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// Legacy linear-features endpoints for backward compatibility
app.get('/api/linear-features', async (req, res) => {
  try {
    const linearFeaturesQuery = await pool.query(`
      SELECT p.id, p.name, p.poi_type as feature_type, p.geometry,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.length_miles, p.difficulty, p.image_mime_type, p.image_drive_file_id,
             p.boundary_type, p.boundary_color, p.news_url, p.events_url, p.status_url,
             p.locally_modified, p.deleted, p.synced, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND o.poi_type = 'virtual'
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE p.poi_type IN ('trail', 'river', 'boundary')
        AND (p.deleted IS NULL OR p.deleted = FALSE)
      ORDER BY p.poi_type, p.name
    `);
    res.json(linearFeaturesQuery.rows);
  } catch (error) {
    console.error('Error fetching linear features:', error);
    res.status(500).json({ error: 'Failed to fetch linear features' });
  }
});

app.get('/api/linear-features/:id', async (req, res) => {
  try {
    const linearFeatureQuery = await pool.query(`
      SELECT p.id, p.name, p.poi_type as feature_type, p.geometry,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.length_miles, p.difficulty, p.image_mime_type, p.image_drive_file_id,
             p.boundary_type, p.boundary_color, p.news_url, p.events_url, p.status_url,
             p.locally_modified, p.deleted, p.synced, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND o.poi_type = 'virtual'
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE p.id = $1`,
      [req.params.id]
    );
    if (linearFeatureQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Linear feature not found' });
    }
    res.json(linearFeatureQuery.rows[0]);
  } catch (error) {
    console.error('Error fetching linear feature:', error);
    res.status(500).json({ error: 'Failed to fetch linear feature' });
  }
});

app.get('/api/linear-features/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const imageQuery = await pool.query(
      'SELECT image_data, image_mime_type FROM pois WHERE id = $1 AND image_data IS NOT NULL',
      [id]
    );

    if (imageQuery.rows.length === 0 || !imageQuery.rows[0].image_data) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const { image_data, image_mime_type } = imageQuery.rows[0];
    res.setHeader('Content-Type', image_mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(image_data);
  } catch (error) {
    console.error('Error serving linear feature image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public theme configuration endpoint (no auth required)
app.get('/api/theme-config', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'seasonal_themes'"
    );

    if (result.rows.length > 0) {
      const config = typeof result.rows[0].value === 'string'
        ? JSON.parse(result.rows[0].value)
        : result.rows[0].value;

      // Generate proxy URLs for theme videos (use Immich if configured, else static fallback)
      const themes = config.themes || [];
      const videoUrls = {};

      for (const theme of themes) {
        if (theme.enabled) {
          // Check if Immich has this video
          const immichUrl = await immichService.getThemeVideoUrl(theme.id);
          if (immichUrl) {
            // Return proxy URL that fetches from Immich
            videoUrls[theme.id] = `/api/theme-video/${theme.id}`;
          }
          // If no Immich URL, frontend will use static fallback path
        }
      }

      res.json({
        seasonal_themes: result.rows[0].value,
        video_urls: videoUrls
      });
    } else {
      // Return empty config if not set
      res.json({ seasonal_themes: null, video_urls: {} });
    }
  } catch (error) {
    console.error('Error fetching theme config:', error);
    res.status(500).json({ error: 'Failed to fetch theme configuration' });
  }
});

// Theme video proxy endpoint - streams videos from Immich
app.get('/api/theme-video/:theme', async (req, res) => {
  try {
    const { theme } = req.params;

    // Validate theme name (prevent path traversal)
    const validThemes = ['christmas', 'newyears', 'halloween', 'winter', 'spring', 'summer', 'fall', 'night'];
    if (!validThemes.includes(theme)) {
      return res.status(404).json({ error: 'Theme not found' });
    }

    // Get the Immich URL for this theme
    const immichUrl = await immichService.getThemeVideoUrl(theme);
    if (!immichUrl) {
      // Fallback to static video
      const staticPath = path.join(__dirname, '..', 'frontend', 'public', 'theme-videos', `${theme}.mp4`);
      return res.sendFile(staticPath);
    }

    // Parse the URL to extract asset ID
    const urlParts = immichUrl.match(/\/api\/assets\/([^/]+)\/original/);
    if (!urlParts) {
      return res.status(500).json({ error: 'Invalid Immich URL format' });
    }

    // Fetch from Immich with API key in header
    const immichResponse = await fetch(`${immichService.serverUrl}/api/assets/${urlParts[1]}/original`, {
      headers: {
        'x-api-key': immichService.apiKey
      }
    });

    if (!immichResponse.ok) {
      console.error(`[Immich] Failed to fetch video: ${immichResponse.status}`);
      // Fallback to static video
      const staticPath = path.join(__dirname, '..', 'frontend', 'public', 'theme-videos', `${theme}.mp4`);
      return res.sendFile(staticPath);
    }

    // Set response headers
    res.set('Content-Type', immichResponse.headers.get('content-type') || 'video/mp4');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    const contentLength = immichResponse.headers.get('content-length');
    if (contentLength) {
      res.set('Content-Length', contentLength);
    }

    // Stream the response
    const reader = immichResponse.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    await pump();

  } catch (error) {
    console.error(`[Theme Video] Error streaming video:`, error);
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

// Public news and events endpoints
app.get('/api/pois/:id/news', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const newsQuery = await pool.query(`
      SELECT id, title, summary, source_url, source_name, news_type, published_at, created_at
      FROM poi_news
      WHERE poi_id = $1
      ORDER BY
        CASE WHEN published_at IS NULL THEN 1 ELSE 0 END,
        published_at DESC NULLS LAST,
        created_at DESC
      LIMIT $2
    `, [id, limit]);
    res.json(newsQuery.rows);
  } catch (error) {
    console.error('Error fetching POI news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

app.get('/api/pois/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const upcomingOnly = req.query.upcoming !== 'false';
    const limit = parseInt(req.query.limit) || 50;
    let query = `
      SELECT id, title, description, start_date, end_date, event_type, location_details, source_url, created_at
      FROM poi_events
      WHERE poi_id = $1
    `;
    if (upcomingOnly) {
      query += ` AND start_date >= CURRENT_DATE`;
    }
    query += ` ORDER BY start_date ASC LIMIT $2`;

    const eventsQuery = await pool.query(query, [id, limit]);
    res.json(eventsQuery.rows);
  } catch (error) {
    console.error('Error fetching POI events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get trail status for a specific trail (public)
app.get('/api/pois/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const status = await getLatestTrailStatus(pool, id);

    if (!status) {
      return res.json({
        status: 'unknown',
        conditions: null,
        last_updated: null,
        source_name: null,
        source_url: null,
        weather_impact: null,
        seasonal_closure: false
      });
    }

    res.json({
      status: status.status,
      conditions: status.conditions,
      last_updated: status.last_updated,
      source_name: status.source_name,
      source_url: status.source_url,
      weather_impact: status.weather_impact,
      seasonal_closure: status.seasonal_closure
    });
  } catch (error) {
    console.error('Error fetching trail status:', error);
    res.status(500).json({ error: 'Failed to fetch trail status' });
  }
});

// Get all MTB trails with optional status (public)
app.get('/api/trails/mtb', async (req, res) => {
  try {
    const includeStatus = req.query.includeStatus === 'true';

    let query = `
      SELECT id, name, brief_description, poi_type, status_url,
             latitude, longitude,
             length_miles, difficulty, surface, primary_activities,
             geometry
      FROM pois
      WHERE status_url IS NOT NULL
      AND status_url != ''
      AND (deleted IS NULL OR deleted = FALSE)
      ORDER BY name
    `;

    const trailsQuery = await pool.query(query);
    const trails = trailsQuery.rows;

    // Optionally fetch latest status for each trail
    if (includeStatus) {
      for (const trail of trails) {
        const status = await getLatestTrailStatus(pool, trail.id);
        trail.status = status ? {
          status: status.status,
          conditions: status.conditions,
          last_updated: status.last_updated,
          weather_impact: status.weather_impact,
          seasonal_closure: status.seasonal_closure,
          source_name: status.source_name,
          source_url: status.source_url
        } : null;
      }
    }

    res.json(trails);
  } catch (error) {
    console.error('Error fetching MTB trails:', error);
    res.status(500).json({ error: 'Failed to fetch MTB trails' });
  }
});

// Get all MTB trails with status data for Status Tab (public)
app.get('/api/trail-status/mtb-trails', async (req, res) => {
  try {
    const trailStatusQuery = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.poi_type,
        p.latitude,
        p.longitude,
        p.geometry,
        p.status_url,
        ts.status,
        ts.conditions,
        COALESCE(ts.last_updated, p.updated_at, p.created_at) as last_updated,
        ts.source_name
      FROM pois p
      LEFT JOIN LATERAL (
        SELECT status, conditions,
               COALESCE(last_updated, created_at) as last_updated,
               source_name
        FROM trail_status
        WHERE poi_id = p.id
        ORDER BY last_updated DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1
      ) ts ON true
      WHERE p.status_url IS NOT NULL
        AND p.status_url != ''
        AND p.poi_type = 'point'
        AND (p.deleted IS NULL OR p.deleted = FALSE)
      ORDER BY p.name
    `);

    res.json(trailStatusQuery.rows);
  } catch (error) {
    console.error('Error fetching MTB trail status:', error);
    res.status(500).json({ error: 'Failed to fetch MTB trail status' });
  }
});

// All recent news across the park (public)
app.get('/api/news/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const recentNewsQuery = await pool.query(`
      SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
             n.published_at, n.created_at, p.id as poi_id, p.name as poi_name, p.poi_type
      FROM poi_news n
      JOIN pois p ON n.poi_id = p.id
      WHERE (p.deleted IS NULL OR p.deleted = FALSE)
      ORDER BY COALESCE(n.published_at, n.created_at) DESC
      LIMIT $1
    `, [limit]);
    res.json(recentNewsQuery.rows);
  } catch (error) {
    console.error('Error fetching recent news:', error);
    res.status(500).json({ error: 'Failed to fetch recent news' });
  }
});

// All upcoming events across the park (public)
app.get('/api/events/upcoming', async (req, res) => {
  try {
    const daysAhead = parseInt(req.query.days) || 30;
    const upcomingEventsQuery = await pool.query(`
      SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
             e.location_details, e.source_url, p.id as poi_id, p.name as poi_name, p.poi_type
      FROM poi_events e
      JOIN pois p ON e.poi_id = p.id
      WHERE e.start_date >= CURRENT_DATE
        AND e.start_date <= CURRENT_DATE + INTERVAL '1 day' * $1
        AND (p.deleted IS NULL OR p.deleted = FALSE)
      ORDER BY e.start_date ASC
    `, [daysAhead]);
    res.json(upcomingEventsQuery.rows);
  } catch (error) {
    console.error('Error fetching upcoming events:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming events' });
  }
});

// Serve generated icons from database (public endpoint)
app.get('/api/icons/:name.svg', async (req, res) => {
  try {
    const iconName = req.params.name;
    const iconQuery = await pool.query(
      'SELECT svg_content FROM icons WHERE name = $1 AND svg_content IS NOT NULL',
      [iconName]
    );

    if (iconQuery.rows.length === 0 || !iconQuery.rows[0].svg_content) {
      return res.status(404).json({ error: 'Icon not found' });
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(iconQuery.rows[0].svg_content);
  } catch (error) {
    console.error('Error serving icon:', error);
    res.status(500).json({ error: 'Failed to serve icon' });
  }
});

// Social share endpoints - serve HTML with OpenGraph meta tags for social media
// These endpoints are scraped by social platforms to get preview info
app.get('/share/destination/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const poiQuery = await pool.query(
      `SELECT id, name, brief_description, image_mime_type FROM pois WHERE id = $1`,
      [id]
    );

    if (poiQuery.rows.length === 0) {
      return res.redirect('/');
    }

    const poi = poiQuery.rows[0];
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const appUrl = `${baseUrl}/?poi=${encodeURIComponent(poi.name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'))}`;
    const imageUrl = poi.image_mime_type ? `${baseUrl}/api/pois/${poi.id}/thumbnail` : `${baseUrl}/icons/default.svg`;
    const description = poi.brief_description || `Explore ${poi.name} at Cuyahoga Valley National Park`;

    // Generate HTML with OpenGraph meta tags
    // Note: No instant redirect - let crawlers read the tags, users click to continue
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${poi.name} | Roots of The Valley</title>
  <meta name="description" content="${description.replace(/"/g, '&quot;')}">

  <!-- OpenGraph Meta Tags -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${poi.name} | Roots of The Valley">
  <meta property="og:description" content="${description.replace(/"/g, '&quot;')}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${appUrl}">
  <meta property="og:site_name" content="Roots of The Valley">

  <!-- Twitter Card Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${poi.name} | Roots of The Valley">
  <meta name="twitter:description" content="${description.replace(/"/g, '&quot;')}">
  <meta name="twitter:image" content="${imageUrl}">

  <!-- Delayed redirect for human users (crawlers don't execute JS or follow meta refresh quickly) -->
  <meta http-equiv="refresh" content="3;url=${appUrl}">
</head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5;">
  <div style="text-align: center; padding: 2rem;">
    <h1 style="color: #2d5016; margin-bottom: 1rem;">${poi.name}</h1>
    <p style="color: #666; margin-bottom: 1.5rem;">${description.replace(/"/g, '&quot;')}</p>
    <p>Redirecting to <a href="${appUrl}" style="color: #4a7c23;">Roots of The Valley</a>...</p>
    <p style="font-size: 0.9rem; color: #999;">Click the link if you're not redirected automatically.</p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error generating share page:', error);
    res.redirect('/');
  }
});

app.get('/share/linear-feature/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const featureQuery = await pool.query(
      `SELECT id, name, poi_type, brief_description, image_mime_type FROM pois WHERE id = $1`,
      [id]
    );

    if (featureQuery.rows.length === 0) {
      return res.redirect('/');
    }

    const feature = featureQuery.rows[0];
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const appUrl = `${baseUrl}/?feature=${encodeURIComponent(feature.name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'))}`;
    const imageUrl = feature.image_mime_type ? `${baseUrl}/api/pois/${feature.id}/thumbnail` : `${baseUrl}/icons/layers/${feature.poi_type === 'trail' ? 'trails' : 'rivers'}.svg`;
    const description = feature.brief_description || `Explore the ${feature.name} at Cuyahoga Valley National Park`;

    // Generate HTML with OpenGraph meta tags
    // Note: No instant redirect - let crawlers read the tags, users click to continue
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${feature.name} | Roots of The Valley</title>
  <meta name="description" content="${description.replace(/"/g, '&quot;')}">

  <!-- OpenGraph Meta Tags -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${feature.name} | Roots of The Valley">
  <meta property="og:description" content="${description.replace(/"/g, '&quot;')}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${appUrl}">
  <meta property="og:site_name" content="Roots of The Valley">

  <!-- Twitter Card Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${feature.name} | Roots of The Valley">
  <meta name="twitter:description" content="${description.replace(/"/g, '&quot;')}">
  <meta name="twitter:image" content="${imageUrl}">

  <!-- Delayed redirect for human users (crawlers don't execute JS or follow meta refresh quickly) -->
  <meta http-equiv="refresh" content="3;url=${appUrl}">
</head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5;">
  <div style="text-align: center; padding: 2rem;">
    <h1 style="color: #2d5016; margin-bottom: 1rem;">${feature.name}</h1>
    <p style="color: #666; margin-bottom: 1.5rem;">${description.replace(/"/g, '&quot;')}</p>
    <p>Redirecting to <a href="${appUrl}" style="color: #4a7c23;">Roots of The Valley</a>...</p>
    <p style="font-size: 0.9rem; color: #999;">Click the link if you're not redirected automatically.</p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error generating share page:', error);
    res.redirect('/');
  }
});

// Serve static frontend files in production
const staticPath = process.env.STATIC_PATH || path.join(__dirname, '../frontend/dist');

// Helper function to generate slug from POI name (matches frontend logic)
function generateSlug(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Middleware to inject OpenGraph tags for POI deep links (MUST be before express.static)
// This allows social media crawlers to get proper previews when users share ?poi= URLs
app.use(async (req, res, next) => {
  // Only handle root path with ?poi= parameter
  if (req.path === '/' && req.query.poi) {
    const poiSlug = req.query.poi;
    try {
      // Look up POI by matching slug against name
      const poisQuery = await pool.query(`
        SELECT id, name, poi_type, brief_description, image_mime_type
        FROM pois
        WHERE (deleted IS NULL OR deleted = FALSE)
      `);

      // Find matching POI by slug
      const poi = poisQuery.rows.find(p => generateSlug(p.name) === poiSlug);

      if (poi) {
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const appUrl = `${baseUrl}/?poi=${poiSlug}`;
        const imageUrl = poi.image_mime_type
          ? `${baseUrl}/api/pois/${poi.id}/thumbnail`
          : `${baseUrl}/icons/default.svg`;
        const description = poi.brief_description || `Explore ${poi.name} at Cuyahoga Valley National Park`;

        // Read index.html and inject POI-specific OG tags
        const indexPath = path.join(staticPath, 'index.html');
        let html = await fs.readFile(indexPath, 'utf-8');

        // Replace title
        html = html.replace(
          /<title>.*?<\/title>/,
          `<title>${poi.name} | Roots of The Valley</title>`
        );

        // Replace OpenGraph tags
        html = html.replace(
          /<meta property="og:title" content="[^"]*" \/>/,
          `<meta property="og:title" content="${poi.name} | Roots of The Valley" />`
        );
        html = html.replace(
          /<meta property="og:description" content="[^"]*" \/>/,
          `<meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />`
        );
        html = html.replace(
          /<meta property="og:url" content="[^"]*" \/>/,
          `<meta property="og:url" content="${appUrl}" />`
        );

        // Add og:image tag (insert after og:url)
        html = html.replace(
          /(<meta property="og:url" content="[^"]*" \/>)/,
          `$1\n    <meta property="og:image" content="${imageUrl}" />\n    <meta property="og:image:type" content="image/jpeg" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />`
        );

        // Replace Twitter tags
        html = html.replace(
          /<meta name="twitter:title" content="[^"]*" \/>/,
          `<meta name="twitter:title" content="${poi.name} | Roots of The Valley" />`
        );
        html = html.replace(
          /<meta name="twitter:description" content="[^"]*" \/>/,
          `<meta name="twitter:description" content="${description.replace(/"/g, '&quot;')}" />`
        );
        // Add twitter:image tag (insert after twitter:description)
        html = html.replace(
          /(<meta name="twitter:description" content="[^"]*" \/>)/,
          `$1\n    <meta name="twitter:image" content="${imageUrl}" />`
        );

        // Replace meta description
        html = html.replace(
          /<meta name="description" content="[^"]*" \/>/,
          `<meta name="description" content="${description.replace(/"/g, '&quot;')}" />`
        );

        res.setHeader('Content-Type', 'text/html');
        return res.send(html);
      }
    } catch (error) {
      console.error('Error injecting OG tags:', error);
      // Fall through to default handling
    }
  }
  next();
});

// Serve static files (after POI middleware)
app.use(express.static(staticPath));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/auth') && !req.path.startsWith('/share')) {
    res.sendFile(path.join(staticPath, 'index.html'));
  }
});

// Start server
const PORT = process.env.PORT || 3001;

/**
 * Set up AI search provider defaults
 */
async function setupAiSearchDefaults() {
  try {
    // Set default AI search config if not already set
    const defaults = [
      { key: 'ai_search_primary', value: 'gemini' },
      { key: 'ai_search_fallback', value: 'perplexity' },
      { key: 'ai_search_primary_limit', value: '0' } // 0 = unlimited
    ];

    for (const { key, value } of defaults) {
      await pool.query(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO NOTHING
      `, [key, value]);
    }

    // Initialize seasonal themes configuration
    const themeCheck = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'seasonal_themes'"
    );
    if (themeCheck.rows.length === 0) {
      const defaultConfig = {
        themes: [
          { id: 'christmas', name: 'Christmas', enabled: true, startDate: '12/01', endDate: '12/26', priority: 1 },
          { id: 'newyears', name: "New Year's", enabled: true, startDate: '12/27', endDate: '01/02', priority: 2 },
          { id: 'halloween', name: 'Halloween', enabled: true, startDate: '10/25', endDate: '10/31', priority: 3 },
          { id: 'winter', name: 'Winter', enabled: true, startDate: '01/03', endDate: '03/19', priority: 4 },
          { id: 'spring', name: 'Spring', enabled: true, startDate: '03/20', endDate: '06/20', priority: 5 },
          { id: 'summer', name: 'Summer', enabled: true, startDate: '06/21', endDate: '09/22', priority: 6 },
          { id: 'fall', name: 'Fall', enabled: true, startDate: '09/23', endDate: '11/30', priority: 7 }
        ],
        nightMode: { enabled: true, startHour: 23, endHour: 5 }
      };

      await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at)
         VALUES ('seasonal_themes', $1, CURRENT_TIMESTAMP)`,
        [JSON.stringify(defaultConfig)]
      );
    }

    // Ensure last_news_collection column exists for tracking
    await pool.query(`
      ALTER TABLE pois
      ADD COLUMN IF NOT EXISTS last_news_collection TIMESTAMP
    `);

    // Initialize Immich settings if not present
    const immichDefaults = [
      { key: 'immich_server_url', value: process.env.IMMICH_SERVER_URL || '' },
      { key: 'immich_api_key', value: process.env.IMMICH_API_KEY || '' },
      { key: 'immich_album_id', value: process.env.IMMICH_ALBUM_ID || '' }
    ];

    for (const { key, value } of immichDefaults) {
      await pool.query(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO NOTHING
      `, [key, value]);
    }

    console.log('[AI Search] Default configuration verified');
  } catch (error) {
    console.error('[AI Search] Error setting up defaults:', error.message);
  }
}

async function start() {
  await initDatabase();

  // Initialize Immich service for theme video delivery
  await immichService.initialize(pool);

  // Ensure news job checkpoint columns exist for resumability
  await ensureNewsJobCheckpointColumns(pool);

  // Set up AI search provider defaults
  await setupAiSearchDefaults();

  // Initialize job scheduler for news collection
  const connectionString = `postgresql://${process.env.PGUSER || 'rotv'}:${process.env.PGPASSWORD || 'rotv'}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'rotv'}`;

  try {
    await initJobScheduler(connectionString);

    // Register scheduled news collection handler (daily job for all POIs)
    await registerNewsCollectionHandler(async () => {
      console.log('Running scheduled news collection for all POIs...');
      const newsCollectionResult = await runNewsCollection(pool, null);
      if (newsCollectionResult.totalPois > 0) {
        console.log(`News collection completed: ${newsCollectionResult.newsFound} news items, ${newsCollectionResult.eventsFound} events found`);
      } else {
        console.log('No POIs to collect');
      }
    });

    // Register batch news collection handler (for admin-triggered jobs via pg-boss)
    await registerBatchNewsHandler(async (pgBossJobId, jobData) => {
      console.log(`[pg-boss] Processing batch news job: ${pgBossJobId}`);
      await processNewsCollectionJob(pool, null, pgBossJobId, jobData);
    });

    // Schedule daily news collection at 6 AM Eastern
    await scheduleNewsCollection('0 6 * * *');

    // Register scheduled trail status collection handler
    await registerTrailStatusHandler(async () => {
      console.log('Running scheduled trail status collection for all MTB trails...');
      const { runTrailStatusCollection } = await import('./services/trailStatusService.js');
      const boss = app.get('boss');
      const trailStatusResult = await runTrailStatusCollection(pool, boss, {
        jobType: 'scheduled_collection'
      });
      if (trailStatusResult.totalTrails > 0) {
        console.log(`Trail status collection started for ${trailStatusResult.totalTrails} trails`);
      } else {
        console.log('No MTB trails to collect');
      }
    });

    // Register batch trail status collection handler
    await registerBatchTrailStatusHandler(async (jobId, poiIds) => {
      console.log(`[pg-boss] Processing batch trail status job: ${jobId}`);
      await processTrailStatusCollectionJob(pool, jobId, poiIds);
    });

    // Schedule trail status collection once daily at 6 AM Eastern (same as news collection)
    const trailStatusInterval = '0 6 * * *';  // Daily at 6 AM
    await scheduleTrailStatusCollection(trailStatusInterval);

    // Make boss available to routes
    app.set('boss', await import('./services/jobScheduler.js').then(m => m.getJobScheduler()));

    // Resume any incomplete jobs from before restart
    const incompleteJobs = await findIncompleteJobs(pool);
    if (incompleteJobs.length > 0) {
      console.log(`[pg-boss] Found ${incompleteJobs.length} incomplete job(s) to resume`);
      for (const job of incompleteJobs) {
        // Parse POI IDs if needed
        let poiIds = job.poi_ids;
        if (typeof poiIds === 'string') {
          poiIds = JSON.parse(poiIds);
        }
        if (poiIds && poiIds.length > 0) {
          console.log(`[pg-boss] Resuming job ${job.id} with ${poiIds.length} POIs`);
          await submitBatchNewsJob({ jobId: job.id, poiIds });
        }
      }
    }
  } catch (error) {
    console.error('Failed to initialize job scheduler:', error.message);
    // Continue without scheduler - manual triggers still work via admin route
  }

  app.listen(PORT, '::', () => {
    console.log(`Roots of The Valley API running on port ${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await stopJobScheduler();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await stopJobScheduler();
  process.exit(0);
});

start().catch(console.error);
