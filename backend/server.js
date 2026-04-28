import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { Readable } from 'node:stream';
import { configurePassport } from './config/passport.js';
import authRoutes from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { createNewsletterRouter } from './routes/newsletter.js';
import { isAuthenticated } from './middleware/auth.js';
import {
  initJobScheduler,
  scheduleNewsCollection,
  registerNewsCollectionHandler,
  registerBatchNewsHandler,
  submitBatchNewsJob,
  scheduleTrailStatusCollection,
  registerTrailStatusHandler,
  registerBatchTrailStatusHandler,
  registerModerationHandler,
  registerModerationSweepHandler,
  scheduleModerationSweep,
  registerNewsletterHandler,
  registerDigestHandler,
  scheduleDigest,
  triggerDigestManually,
  registerImageBackupHandler,
  scheduleImageBackup,
  registerDatabaseBackupHandler,
  scheduleDatabaseBackup,
  stopJobScheduler,
  withJitter
} from './services/jobScheduler.js';
import { processItem, processPendingItems } from './services/moderationService.js';
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
import imageServerClient from './services/imageServerClient.js';
import { startSmtpServer, processNewsletterById } from './services/newsletterService.js';
import { sendWeeklyDigest } from './services/newsletterDigestService.js';
import { startMcpServer } from './services/mcpServer.js';
import { initJobLogger, stopJobLogger } from './services/jobLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

const app = express();

// Configure multer for memory storage (media uploaded to image server)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  }
});

// Rate limiter for asset proxy endpoints (DoS mitigation)
// Fix: Prevent bandwidth exhaustion attacks on image/video proxy (Gemini review)
const assetProxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: { error: 'Too many asset requests, please try again later' }
});

// In-memory cache for mosaic data (performance optimization)
// Fix: Reduce database queries for frequently accessed mosaic data (Gemini review)
const mosaicCache = new Map();
const MOSAIC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getMosaicFromCache(poiId) {
  const cacheKey = `poi:${poiId}`;
  const cached = mosaicCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }
  return null;
}

function setMosaicCache(poiId, data) {
  const cacheKey = `poi:${poiId}`;
  mosaicCache.set(cacheKey, {
    data,
    expires: Date.now() + MOSAIC_CACHE_TTL
  });
}

function invalidateMosaicCache(poiId) {
  const cacheKey = `poi:${poiId}`;
  mosaicCache.delete(cacheKey);
}

// Trust reverse proxy (for secure cookies behind CloudFlare/Apache)
app.set('trust proxy', 1);

// Return date/timestamp columns as ISO strings, not JavaScript Date objects.
// Date objects lose the year when passed through String().slice(0,10) because
// their .toString() format is locale-dependent ("Sat May 31 2025 ...").
// OID 1082 = date, 1114 = timestamp without tz, 1184 = timestamp with tz
const { types } = pg;
types.setTypeParser(1082, (val) => val);   // date → 'YYYY-MM-DD' string
types.setTypeParser(1114, (val) => val);   // timestamp → string
types.setTypeParser(1184, (val) => val);   // timestamptz → string

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv',
  user: process.env.PGUSER || 'postgres',  // Use standard PostgreSQL superuser
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
app.use('/api/admin', createAdminRouter(pool, invalidateMosaicCache));

// Mount newsletter routes
app.use('/api/newsletter', createNewsletterRouter(pool));

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
        `INSERT INTO pois (name, poi_roles, geometry)
         VALUES ($1, '{trail}', $2)
         ON CONFLICT (name) DO UPDATE SET geometry = EXCLUDED.geometry`,
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
        `INSERT INTO pois (name, poi_roles, geometry)
         VALUES ($1, '{river}', $2)
         ON CONFLICT (name) DO UPDATE SET geometry = EXCLUDED.geometry`,
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
        `INSERT INTO pois (name, poi_roles, geometry)
         VALUES ($1, '{boundary}', $2)
         ON CONFLICT (name) DO UPDATE SET geometry = EXCLUDED.geometry`,
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
        has_primary_image BOOLEAN DEFAULT FALSE,

        poi_roles TEXT[] DEFAULT '{}',

        deleted BOOLEAN DEFAULT FALSE,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS poi_roles TEXT[] DEFAULT '{}'
    `);

    // Create index for faster lookups by role (GIN index on array)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pois_roles ON pois USING GIN(poi_roles)
    `);

    // Create index for owner lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pois_owner_id ON pois(owner_id)
    `);

    // Drop old poi_type-based constraints/indexes if they exist (cleanup only, no replacement)
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pois_name_poi_type_key') THEN
          ALTER TABLE pois DROP CONSTRAINT pois_name_poi_type_key;
        END IF;
        ALTER TABLE pois DROP CONSTRAINT IF EXISTS pois_name_poi_type_active_key;
        ALTER TABLE pois DROP CONSTRAINT IF EXISTS pois_name_key;
        DROP INDEX IF EXISTS pois_name_key;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE UNIQUE INDEX pois_name_key ON pois(name);
      EXCEPTION WHEN unique_violation OR duplicate_table THEN
        NULL;
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
        INSERT INTO pois (name, poi_roles, latitude, longitude, property_owner, brief_description,
                          era, historical_description, primary_activities, surface, pets,
                          cell_signal, more_info_link, has_primary_image,
                          deleted, created_at, updated_at)
        SELECT name, '{point}', latitude, longitude, property_owner, brief_description,
               era, historical_description, primary_activities, surface, pets,
               cell_signal, more_info_link, has_primary_image,
               COALESCE(deleted, FALSE),
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
        INSERT INTO pois (name, poi_roles, geometry, property_owner, brief_description,
                          era, historical_description, primary_activities, surface, pets,
                          cell_signal, more_info_link, length_miles, difficulty,
                          has_primary_image,
                          deleted, created_at, updated_at)
        SELECT name, ARRAY[feature_type]::text[], geometry, property_owner, brief_description,
               era, historical_description, primary_activities, surface, pets,
               cell_signal, more_info_link, length_miles, difficulty,
               has_primary_image,
               COALESCE(deleted, FALSE),
               created_at, updated_at
        FROM linear_features
        ON CONFLICT (name) DO UPDATE SET
          geometry = EXCLUDED.geometry,
          poi_roles = EXCLUDED.poi_roles
        RETURNING id
      `);
      if (migrated.rowCount > 0) {
        console.log(`Migrated ${migrated.rowCount} linear features to pois table`);
      }
    }

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
        role VARCHAR(20) DEFAULT 'viewer',
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
        content_source VARCHAR(20) DEFAULT 'ai',
        collection_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_news_poi_id ON poi_news(poi_id)`);

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
        content_source VARCHAR(20) DEFAULT 'ai',
        collection_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_events_poi_id ON poi_events(poi_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_events_start_date ON poi_events(start_date)`);

    // Junction tables for multiple URLs per news/event item
    // Schema managed by migration 007_news_multi_url.sql

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

    // Add boundary_type and boundary_color columns for multiple boundary support
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS boundary_type TEXT
    `);
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS boundary_color TEXT DEFAULT '#228B22'
    `);
    // Set default boundary_type for existing boundaries
    await client.query(`
      UPDATE pois SET boundary_type = 'cvnp' WHERE 'boundary' = ANY(poi_roles) AND boundary_type IS NULL
    `);

    // Add events_url and news_url columns for targeted AI Research
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS events_url TEXT
    `);
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS news_url TEXT
    `);

    // Add research_context column for multi-pass AI research
    await client.query(`
      ALTER TABLE pois ADD COLUMN IF NOT EXISTS research_context TEXT
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

    // ============================================================
    // Moderation Queue (#106) — columns, table, views, indexes
    // ============================================================

    // Moderation columns on poi_news
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'published'`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2)`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS ai_reasoning TEXT`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS ai_issues TEXT`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS moderated_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS weekly_newsletter BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS publication_date DATE`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS date_consensus_score INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS moderation_processed BOOLEAN DEFAULT FALSE`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_news_moderation ON poi_news(moderation_status)`);

    // Moderation columns on poi_events
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'published'`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2)`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS ai_reasoning TEXT`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS ai_issues TEXT`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderated_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS weekly_newsletter BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS publication_date DATE`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS date_consensus_score INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderation_processed BOOLEAN DEFAULT FALSE`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poi_events_moderation ON poi_events(moderation_status)`);

    // Photo submissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS photo_submissions (
        id SERIAL PRIMARY KEY,
        poi_id INTEGER REFERENCES pois(id) ON DELETE CASCADE,
        image_server_asset_id VARCHAR(255),
        original_filename VARCHAR(500),
        submitted_by INTEGER REFERENCES users(id),
        caption TEXT,
        moderation_status VARCHAR(20) DEFAULT 'pending',
        confidence_score DECIMAL(3,2),
        ai_reasoning TEXT,
        moderated_by INTEGER REFERENCES users(id),
        moderated_at TIMESTAMP,
        moderation_processed BOOLEAN DEFAULT FALSE,
        weekly_newsletter BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_photo_submissions_status ON photo_submissions(moderation_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_photo_submissions_poi ON photo_submissions(poi_id)`);

    // Unified moderation queue view (DROP first to allow column changes)
    await client.query(`DROP VIEW IF EXISTS moderation_queue CASCADE`);
    await client.query(`
      CREATE VIEW moderation_queue AS
        SELECT id, 'news' AS content_type, poi_id, title, summary AS description,
               moderation_status, confidence_score, ai_reasoning,
               submitted_by, moderated_by, moderated_at, collection_date AS created_at,
               content_source, publication_date, date_consensus_score
        FROM poi_news WHERE moderation_status = 'pending'
        UNION ALL
        SELECT id, 'event' AS content_type, poi_id, title, description,
               moderation_status, confidence_score, ai_reasoning,
               submitted_by, moderated_by, moderated_at, collection_date AS created_at,
               content_source, publication_date, date_consensus_score
        FROM poi_events WHERE moderation_status = 'pending'
        UNION ALL
        SELECT id, 'photo' AS content_type, poi_id, original_filename AS title, caption AS description,
               moderation_status, confidence_score, ai_reasoning,
               submitted_by, moderated_by, moderated_at, created_at,
               NULL AS content_source, NULL::DATE AS publication_date, 0 AS date_consensus_score
        FROM photo_submissions WHERE moderation_status = 'pending'
        ORDER BY created_at DESC
    `);

    // Newsletter digest view (DROP first to allow column changes)
    await client.query(`DROP VIEW IF EXISTS newsletter_digest CASCADE`);
    await client.query(`
      CREATE VIEW newsletter_digest AS
        SELECT id, 'news' AS content_type, poi_id, title, summary AS description,
               collection_date AS created_at, moderated_at, content_source
        FROM poi_news
        WHERE moderation_status IN ('published', 'auto_approved')
          AND weekly_newsletter = TRUE
          AND collection_date >= NOW() - INTERVAL '7 days'
        UNION ALL
        SELECT id, 'event' AS content_type, poi_id, title, description,
               collection_date AS created_at, moderated_at, content_source
        FROM poi_events
        WHERE moderation_status IN ('published', 'auto_approved')
          AND weekly_newsletter = TRUE
          AND collection_date >= NOW() - INTERVAL '7 days'
        UNION ALL
        SELECT id, 'photo' AS content_type, poi_id, original_filename AS title, caption AS description,
               created_at, moderated_at, NULL AS content_source
        FROM photo_submissions
        WHERE moderation_status IN ('approved', 'auto_approved')
          AND weekly_newsletter = TRUE
          AND created_at >= NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
    `);

    // Default moderation settings
    await client.query(`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES
        ('moderation_enabled', 'true', CURRENT_TIMESTAMP),
        ('moderation_auto_approve_threshold', '0.9', CURRENT_TIMESTAMP),
        ('moderation_auto_approve_enabled', 'true', CURRENT_TIMESTAMP),
        ('photo_submissions_enabled', 'false', CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO NOTHING
    `);

    // job_logs table is created by migration 010_add_job_logs.sql

    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// API Routes - Unified POIs
app.get('/api/pois', async (req, res) => {
  try {
    const { type, role } = req.query;

    let query = `
      SELECT p.id, p.name, p.poi_roles, p.latitude, p.longitude, p.geometry, p.geometry_drive_file_id,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.length_miles, p.difficulty, p.has_primary_image,
             p.boundary_type, p.boundary_color, p.news_url, p.events_url,
             p.deleted, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE (p.deleted IS NULL OR p.deleted = FALSE)
    `;

    const params = [];
    if (role) {
      params.push(role);
      query += ` AND $${params.length} = ANY(p.poi_roles)`;
    } else if (type) {
      params.push(type);
      query += ` AND $${params.length} = ANY(p.poi_roles)`;
    }

    query += ` ORDER BY p.poi_roles, p.name`;

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
      SELECT p.id, p.name, p.poi_roles, p.latitude, p.longitude, p.geometry, p.geometry_drive_file_id,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.length_miles, p.difficulty, p.has_primary_image,
             p.boundary_type, p.boundary_color, p.news_url, p.events_url,
             p.deleted, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id
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

// Serve POI images from image server
app.get('/api/pois/:id/image', async (req, res) => {
  try {
    const { id } = req.params;

    if (!imageServerClient.initialized) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Get primary asset from image server
    const asset = await imageServerClient.getPrimaryAsset(id);
    if (!asset) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const result = await imageServerClient.fetchAssetData(asset.id);
    if (!result.success) {
      console.error(`[POI Image] Fetch failed for POI ${id}:`, result.error);
      return res.status(404).json({ error: 'Image not found' });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(result.data);
  } catch (error) {
    console.error('Error serving POI image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// Serve thumbnails from image server (pre-generated, no caching needed on ROTV side)
app.get('/api/pois/:id/thumbnail', async (req, res) => {
  try {
    const { id } = req.params;
    const size = req.query.size; // small, medium, large — passed through to image server

    // Fix: Query poi_media table for primary image (Gatehouse finding)
    const result = await pool.query(`
      SELECT image_server_asset_id
      FROM poi_media
      WHERE poi_id = $1
        AND role = 'primary'
        AND media_type IN ('image', 'video')
        AND moderation_status IN ('published', 'auto_approved')
      ORDER BY created_at DESC
      LIMIT 1
    `, [id]);

    let assetId;
    if (result.rows.length > 0) {
      assetId = result.rows[0].image_server_asset_id;
    } else if (imageServerClient.initialized) {
      // Fallback: query image server directly for POIs without poi_media records
      const asset = await imageServerClient.getPrimaryAsset(id);
      if (asset) {
        assetId = asset.id;
      } else {
        return res.status(404).json({ error: 'Image not found' });
      }
    } else {
      return res.status(404).json({ error: 'Image not found' });
    }

    const sizeParam = size && ['small', 'medium', 'large'].includes(size) ? `?size=${size}` : '';

    if (!imageServerClient.initialized) {
      // Development fallback: proxy from production asset endpoint when IMAGE_SERVER_URL not configured
      if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
        try {
          const productionUrl = `https://rootsofthevalley.org/api/assets/${assetId}/thumbnail${sizeParam}`;
          const productionResponse = await fetch(productionUrl);

          if (!productionResponse.ok) {
            return res.status(404).json({ error: 'Image not found' });
          }

          const contentType = productionResponse.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }
          res.setHeader('Cache-Control', 'public, max-age=604800');
          res.setHeader('Access-Control-Allow-Origin', '*');

          // Stream response to avoid memory exhaustion (DoS prevention)
          return Readable.fromWeb(productionResponse.body).pipe(res);
        } catch (fallbackError) {
          console.error(`[Thumbnail] Production fallback failed for POI ${id}, asset ${assetId}:`, fallbackError.message);
          return res.status(404).json({ error: 'Image not found' });
        }
      }
      return res.status(404).json({ error: 'Image not found' });
    }

    const thumbnailResult = await imageServerClient.fetchThumbnailData(assetId, size);
    if (!thumbnailResult.success) {
      console.error(`[Thumbnail] Fetch failed for POI ${id}:`, thumbnailResult.error);
      return res.status(404).json({ error: 'Image not found' });
    }

    res.setHeader('Content-Type', thumbnailResult.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(thumbnailResult.data);
  } catch (error) {
    console.error('Error serving POI thumbnail:', error);
    res.status(500).json({ error: 'Failed to serve thumbnail' });
  }
});

// ============================================================
// Multi-Media API Endpoints (Issue #181)
// ============================================================

/**
 * GET /api/pois/:id/media
 * Get all approved media for a POI (images, videos, YouTube embeds)
 * Returns mosaic array (primary + 2 most liked/recent) and all_media for lightbox
 */
app.get('/api/pois/:id/media', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null; // Optional authentication

    // Skip cache if authenticated (user might have pending uploads)
    if (!userId) {
      const cached = getMosaicFromCache(id);
      if (cached) {
        return res.json(cached);
      }
    }

    // Query media: published for everyone, pending only for uploader
    const result = await pool.query(`
      SELECT
        id,
        media_type,
        image_server_asset_id,
        youtube_url,
        role,
        sort_order,
        likes_count,
        caption,
        created_at,
        moderation_status,
        submitted_by
      FROM poi_media
      WHERE poi_id = $1
        AND (
          moderation_status IN ('published', 'auto_approved')
          OR (moderation_status = 'pending' AND submitted_by = $2)
        )
      ORDER BY
        CASE WHEN role = 'primary' THEN 0 ELSE 1 END,
        likes_count DESC,
        created_at DESC
    `, [id, userId]);

    const allMedia = [];

    // Enrich media with URLs
    for (const media of result.rows) {
      const item = {
        id: media.id,
        media_type: media.media_type,
        role: media.role,
        likes_count: media.likes_count,
        caption: media.caption,
        created_at: media.created_at,
        moderation_status: media.moderation_status,
        uploaded_by_user: userId && media.submitted_by === userId
      };

      if (media.media_type === 'youtube') {
        // Extract video ID and construct URLs
        const videoId = extractYouTubeId(media.youtube_url);
        item.youtube_url = media.youtube_url;
        item.youtube_id = videoId;
        item.thumbnail_url = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        item.embed_url = `https://www.youtube-nocookie.com/embed/${videoId}`;
      } else {
        // Image or video from image server
        item.asset_id = media.image_server_asset_id;
        item.thumbnail_url = `/api/assets/${media.image_server_asset_id}/thumbnail?size=small`;
        item.medium_url = `/api/assets/${media.image_server_asset_id}/thumbnail?size=medium`;
        item.full_url = `/api/assets/${media.image_server_asset_id}/original`;
      }

      allMedia.push(item);
    }

    // Mosaic: primary image as hero, plus gallery items if there are enough to form a mosaic
    // If only 1 gallery item exists alongside primary, it's likely a migration duplicate — show hero only
    const primaryItems = allMedia.filter(m => m.role === 'primary');
    const galleryItems = allMedia.filter(m => m.role !== 'primary');
    let mosaic;
    if (primaryItems.length > 0 && galleryItems.length <= 1) {
      // Single hero — show primary only (gallery items available in lightbox)
      mosaic = primaryItems.slice(0, 1);
    } else {
      // Enough items for a real mosaic
      mosaic = allMedia.slice(0, 3);
    }

    const response = {
      mosaic,
      all_media: allMedia,
      total_count: allMedia.length
    };

    // Only cache for anonymous users (authenticated users see their pending uploads)
    if (!userId) {
      setMosaicCache(id, response);
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching POI media:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

/**
 * POST /api/pois/:id/media
 * Upload media (image/video/YouTube URL)
 * Regular users → moderation queue
 * Media admins → auto-approved
 */
app.post('/api/pois/:id/media', isAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { media_type, youtube_url, caption } = req.body;
    const user = req.user;

    // Validate media_type
    if (!['image', 'video', 'youtube'].includes(media_type)) {
      return res.status(400).json({ error: 'Invalid media_type' });
    }

    // Check if multi_media is enabled
    const settingResult = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'multi_media_enabled'"
    );
    if (settingResult.rows.length && settingResult.rows[0].value !== 'true') {
      return res.status(403).json({ error: 'Multi-media uploads are currently disabled' });
    }

    let assetId = null;
    let youtubeUrlValue = null;

    if (media_type === 'youtube') {
      // Validate YouTube URL
      if (!youtube_url) {
        return res.status(400).json({ error: 'YouTube URL required' });
      }
      const videoId = extractYouTubeId(youtube_url);
      if (!videoId) {
        return res.status(400).json({ error: 'Invalid YouTube URL' });
      }
      youtubeUrlValue = youtube_url;
    } else {
      // Image or video upload
      if (!req.file) {
        return res.status(400).json({ error: 'File required' });
      }

      // Video size validation
      if (media_type === 'video') {
        const maxSizeMB = 10;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (req.file.size > maxSizeBytes) {
          return res.status(400).json({
            error: `Video too large (max ${maxSizeMB}MB). Please upload to YouTube instead.`
          });
        }
      }

      // Fix: Sanitize filename to prevent path traversal (Gatehouse finding)
      const sanitizedFilename = req.file.originalname
        .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace unsafe chars with underscore
        .replace(/^\.+/, '') // Remove leading dots
        .substring(0, 255); // Limit length

      // Upload to image server
      let uploadResult;
      if (media_type === 'image') {
        // uploadImage(imageBuffer, poiId, role, filename, mimeType, options)
        uploadResult = await imageServerClient.uploadImage(
          req.file.buffer,
          parseInt(id),
          'gallery',
          sanitizedFilename,
          req.file.mimetype
        );
      } else {
        // uploadVideo(videoBuffer, poiId, filename, mimeType, role)
        uploadResult = await imageServerClient.uploadVideo(
          req.file.buffer,
          parseInt(id),
          sanitizedFilename,
          req.file.mimetype,
          'gallery'
        );
      }

      if (!uploadResult.success) {
        return res.status(500).json({ error: 'Failed to upload: ' + uploadResult.error });
      }

      assetId = uploadResult.assetId;
    }

    // All uploads via this interface go to moderation queue
    // (Admin panel uploads can still bypass queue)
    const moderationStatus = 'pending';
    const moderatedAt = null;
    const moderatedBy = null; // Set during approval, not upload

    // Create poi_media record
    const insertResult = await pool.query(`
      INSERT INTO poi_media (
        poi_id,
        media_type,
        image_server_asset_id,
        youtube_url,
        caption,
        role,
        moderation_status,
        submitted_by,
        moderated_at,
        moderated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      parseInt(id),
      media_type,
      assetId,
      youtubeUrlValue,
      caption || null,
      'gallery',
      moderationStatus,
      user.id,
      moderatedAt,
      moderatedBy
    ]);

    const mediaId = insertResult.rows[0].id;

    // All uploads go to moderation queue
    const message = 'Media submitted for review';

    // Invalidate mosaic cache for this POI (new media uploaded)
    invalidateMosaicCache(id);

    res.json({
      success: true,
      message,
      media_id: mediaId,
      moderation_status: moderationStatus
    });
  } catch (error) {
    console.error('Error uploading media:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

/**
 * DELETE /api/pois/:poiId/media/:mediaId
 * Delete media (only allowed for uploader or admin)
 */
app.delete('/api/pois/:poiId/media/:mediaId', isAuthenticated, async (req, res) => {
  try {
    const { poiId, mediaId } = req.params;
    const user = req.user;

    // Check if media exists and get ownership info
    const mediaResult = await pool.query(
      'SELECT submitted_by, image_server_asset_id FROM poi_media WHERE id = $1 AND poi_id = $2',
      [mediaId, poiId]
    );

    if (mediaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const media = mediaResult.rows[0];

    // Check permission: user must be the uploader or an admin
    const isOwner = media.submitted_by === user.id;
    const isAdmin = user.role === 'admin' || user.role === 'media_admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own media' });
    }

    // Transaction: delete media and update POI flag atomically
    await pool.query('BEGIN');

    // Delete from database
    await pool.query('DELETE FROM poi_media WHERE id = $1', [mediaId]);

    // Update POI's has_primary_image flag based on remaining media
    const remainingPrimary = await pool.query(
      `SELECT id FROM poi_media
       WHERE poi_id = $1
         AND role = 'primary'
         AND moderation_status IN ('published', 'auto_approved')
       LIMIT 1`,
      [poiId]
    );

    await pool.query(
      'UPDATE pois SET has_primary_image = $1 WHERE id = $2',
      [remainingPrimary.rows.length > 0, poiId]
    );

    await pool.query('COMMIT');

    // Delete from image server (if it's an image/video, not YouTube)
    // NOTE: Eventual consistency - DB transaction already committed
    // If image server delete fails, orphaned assets logged for cleanup (see #186)
    let imageServerDeleted = true;
    if (media.image_server_asset_id) {
      try {
        await imageServerClient.deleteAsset(media.image_server_asset_id);
      } catch (err) {
        console.error('Failed to delete asset from image server:', err);
        console.error('Orphaned asset (manual cleanup required):', media.image_server_asset_id);
        imageServerDeleted = false;
      }
    }

    // Invalidate mosaic cache
    invalidateMosaicCache(poiId);

    // Return honest status about partial success
    if (!imageServerDeleted) {
      return res.status(202).json({
        success: true,
        warning: 'Media deleted from database, image cleanup pending',
        message: 'Media deleted'
      });
    }

    res.json({ success: true, message: 'Media deleted' });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error deleting media:', error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

/**
 * PATCH /api/pois/:poiId/media/:mediaId/set-primary
 * Set media as primary (admins only)
 */
app.patch('/api/pois/:poiId/media/:mediaId/set-primary', isAuthenticated, async (req, res) => {
  try {
    const { poiId, mediaId } = req.params;
    const user = req.user;

    // Check admin permission
    const isAdmin = user.role === 'admin' || user.role === 'media_admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins can set primary images' });
    }

    // Check if media exists and is published
    const mediaResult = await pool.query(
      'SELECT id, role, moderation_status FROM poi_media WHERE id = $1 AND poi_id = $2',
      [mediaId, poiId]
    );

    if (mediaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const media = mediaResult.rows[0];

    // Only published/auto-approved media can be primary
    if (!['published', 'auto_approved'].includes(media.moderation_status)) {
      return res.status(400).json({ error: 'Only approved media can be set as primary' });
    }

    // Already primary
    if (media.role === 'primary') {
      return res.json({ success: true, message: 'Already primary' });
    }

    // Transaction: demote old primary to gallery, promote new to primary
    await pool.query('BEGIN');

    // Demote old primary to gallery
    await pool.query(
      `UPDATE poi_media SET role = 'gallery'
       WHERE poi_id = $1 AND role = 'primary'
       AND moderation_status IN ('published', 'auto_approved')`,
      [poiId]
    );

    // Promote new media to primary
    await pool.query(
      `UPDATE poi_media SET role = 'primary' WHERE id = $1`,
      [mediaId]
    );

    // Update POI's has_primary_image flag
    await pool.query(
      'UPDATE pois SET has_primary_image = true WHERE id = $1',
      [poiId]
    );

    await pool.query('COMMIT');

    // Invalidate mosaic cache
    invalidateMosaicCache(poiId);

    res.json({ success: true, message: 'Primary image updated' });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error setting primary media:', error);
    res.status(500).json({ error: 'Failed to set primary media' });
  }
});

/**
 * GET /api/assets/:assetId/thumbnail
 * Proxy thumbnail from image server
 */
app.get('/api/assets/:assetId/thumbnail', assetProxyLimiter, async (req, res) => {
  try {
    const { assetId } = req.params;
    const size = req.query.size; // small, medium, large — passed through to image server
    const sizeParam = size && ['small', 'medium', 'large'].includes(size) ? `?size=${size}` : '';

    // Fix: Validate assetId format to prevent SSRF (Gatehouse finding)
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(assetId)) {
      return res.status(400).json({ error: 'Invalid asset ID' });
    }

    if (!imageServerClient.initialized) {
      // Development fallback: proxy from production when IMAGE_SERVER_URL not configured
      if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
        try {
          const productionUrl = `https://rootsofthevalley.org/api/assets/${assetId}/thumbnail${sizeParam}`;
          const productionResponse = await fetch(productionUrl);

          if (!productionResponse.ok) {
            const statusCode = productionResponse.status;
            const message = statusCode === 404 ? 'Asset not found' :
                            statusCode >= 500 ? 'Image service error' :
                            'Failed to fetch asset';
            return res.status(statusCode).json({ error: message });
          }

          const contentType = productionResponse.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }
          res.setHeader('Cache-Control', 'public, max-age=604800');
          res.setHeader('Access-Control-Allow-Origin', '*');

          // Stream response to avoid memory exhaustion (DoS prevention)
          return Readable.fromWeb(productionResponse.body).pipe(res);
        } catch (fallbackError) {
          console.error(`[Asset Thumbnail] Production fallback failed for asset ${assetId}:`, fallbackError.message);
          return res.status(503).json({ error: 'Image service unavailable' });
        }
      }
      return res.status(503).json({ error: 'Image service unavailable' });
    }

    const result = await imageServerClient.fetchThumbnailData(assetId, size);
    if (!result.success) {
      // Fix: Map upstream errors correctly (Gemini review - proxy error handling)
      // 404 = asset doesn't exist, 502/503 = image server down
      const statusCode = result.statusCode || 500;
      const message = statusCode === 404 ? 'Asset not found' :
                      statusCode >= 500 ? 'Image service error' :
                      'Failed to fetch asset';
      return res.status(statusCode).json({ error: message });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(result.data);
  } catch (error) {
    console.error('Error serving asset thumbnail:', error);
    res.status(500).json({ error: 'Failed to serve thumbnail' });
  }
});

/**
 * GET /api/assets/:assetId/original
 * Proxy original image/video from image server
 */
app.get('/api/assets/:assetId/original', assetProxyLimiter, async (req, res) => {
  try {
    const { assetId } = req.params;

    // Fix: Validate assetId format to prevent SSRF (Gatehouse finding)
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(assetId)) {
      return res.status(400).json({ error: 'Invalid asset ID' });
    }

    if (!imageServerClient.initialized) {
      // Development fallback: proxy from production when IMAGE_SERVER_URL not configured
      if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
        try {
          const productionUrl = `https://rootsofthevalley.org/api/assets/${assetId}/original`;
          const productionResponse = await fetch(productionUrl);

          if (!productionResponse.ok) {
            const statusCode = productionResponse.status;
            const message = statusCode === 404 ? 'Asset not found' :
                            statusCode >= 500 ? 'Image service error' :
                            'Failed to fetch asset';
            return res.status(statusCode).json({ error: message });
          }

          const contentType = productionResponse.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.setHeader('Access-Control-Allow-Origin', '*');

          // Stream response to avoid memory exhaustion (DoS prevention)
          return Readable.fromWeb(productionResponse.body).pipe(res);
        } catch (fallbackError) {
          console.error(`[Asset Original] Production fallback failed for asset ${assetId}:`, fallbackError.message);
          return res.status(503).json({ error: 'Image service unavailable' });
        }
      }
      return res.status(503).json({ error: 'Image service unavailable' });
    }

    const result = await imageServerClient.fetchAssetData(assetId);
    if (!result.success) {
      // Fix: Map upstream errors correctly (Gemini review - proxy error handling)
      // 404 = asset doesn't exist, 502/503 = image server down
      const statusCode = result.statusCode || 500;
      const message = statusCode === 404 ? 'Asset not found' :
                      statusCode >= 500 ? 'Image service error' :
                      'Failed to fetch asset';
      return res.status(statusCode).json({ error: message });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(result.data);
  } catch (error) {
    console.error('Error serving asset:', error);
    res.status(500).json({ error: 'Failed to serve asset' });
  }
});

/**
 * Helper: Extract YouTube video ID from URL
 */
function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

// End of Multi-Media API Endpoints
// ============================================================

app.get('/api/filters', async (req, res) => {
  try {
    // Get owners from organizations (virtual POIs that are used as owners)
    const owners = await pool.query(`
      SELECT DISTINCT o.id, o.name
      FROM pois o
      WHERE 'organization' = ANY(o.poi_roles)
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
      WHERE 'organization' = ANY(poi_roles)
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
             vp.name as virtual_poi_name, vp.poi_roles as virtual_poi_roles,
             pp.name as physical_poi_name, pp.poi_roles as physical_poi_roles,
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
      SELECT DISTINCT vp.id, vp.name, vp.poi_roles, vp.property_owner,
             vp.brief_description, vp.era_id, e.name as era_name, vp.era, vp.historical_description,
             vp.primary_activities, vp.surface, vp.pets, vp.cell_signal,
             vp.more_info_link, vp.has_primary_image,
             vp.deleted,
             vp.created_at, vp.updated_at
      FROM pois vp
      JOIN poi_associations a ON vp.id = a.virtual_poi_id
      JOIN pois pp ON a.physical_poi_id = pp.id
      LEFT JOIN eras e ON vp.era_id = e.id
      WHERE 'organization' = ANY(vp.poi_roles)
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
      SELECT p.id, p.name, p.poi_roles, p.latitude, p.longitude,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.has_primary_image, p.news_url, p.events_url, p.research_context, p.status_url,
             p.deleted, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND 'organization' = ANY(o.poi_roles)
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE 'point' = ANY(p.poi_roles)
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
      SELECT p.id, p.name, p.poi_roles, p.latitude, p.longitude,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.has_primary_image, p.news_url, p.events_url, p.research_context, p.status_url,
             p.deleted, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND 'organization' = ANY(o.poi_roles)
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

// Legacy linear-features endpoints for backward compatibility
app.get('/api/linear-features', async (req, res) => {
  try {
    const linearFeaturesQuery = await pool.query(`
      SELECT p.id, p.name, p.poi_roles, p.geometry,
             p.poi_roles[1] as feature_type,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.length_miles, p.difficulty, p.has_primary_image,
             p.boundary_type, p.boundary_color, p.news_url, p.events_url, p.status_url,
             p.deleted, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND 'organization' = ANY(o.poi_roles)
      LEFT JOIN eras e ON p.era_id = e.id
      WHERE p.poi_roles && ARRAY['trail','river','boundary']::text[]
        AND (p.deleted IS NULL OR p.deleted = FALSE)
      ORDER BY p.poi_roles, p.name
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
      SELECT p.id, p.name, p.poi_roles, p.geometry,
             p.poi_roles[1] as feature_type,
             p.owner_id, o.name as owner_name, p.property_owner,
             p.brief_description, p.era_id, e.name as era_name, p.historical_description,
             p.primary_activities, p.surface, p.pets, p.cell_signal, p.more_info_link,
             p.length_miles, p.difficulty, p.has_primary_image,
             p.boundary_type, p.boundary_color, p.news_url, p.events_url, p.status_url,
             p.deleted, p.created_at, p.updated_at
      FROM pois p
      LEFT JOIN pois o ON p.owner_id = o.id AND 'organization' = ANY(o.poi_roles)
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

      // Generate proxy URLs for theme videos via image server
      const themes = config.themes || [];
      const videoUrls = {};

      if (imageServerClient.initialized) {
        for (const theme of themes) {
          if (theme.enabled) {
            videoUrls[theme.id] = `/api/theme-video/${theme.id}`;
          }
        }

        // Also add night video if night mode is enabled
        if (config.nightMode?.enabled) {
          videoUrls['night'] = `/api/theme-video/night`;
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

// Theme video proxy endpoint - serves videos from image server
app.get('/api/theme-video/:theme', async (req, res) => {
  try {
    const { theme } = req.params;

    // Validate theme name (prevent path traversal)
    const validThemes = ['christmas', 'newyears', 'halloween', 'winter', 'spring', 'summer', 'fall', 'night'];
    if (!validThemes.includes(theme)) {
      return res.status(404).json({ error: 'Theme not found' });
    }

    if (!imageServerClient.initialized) {
      return res.status(404).json({ error: 'Theme video not available' });
    }

    // Fetch video data from image server
    const result = await imageServerClient.fetchThemeVideoData(theme);
    if (!result.success) {
      return res.status(404).json({ error: 'Theme video not available' });
    }

    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Content-Length', String(result.data.length));
    res.send(result.data);
  } catch (error) {
    console.error(`[Theme Video] Error serving video:`, error);
    res.status(500).json({ error: 'Failed to serve video' });
  }
});

// Public news and events endpoints
app.get('/api/pois/:id/news', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const newsQuery = await pool.query(`
      SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
             n.publication_date, n.date_consensus_score, n.collection_date,
             COALESCE(json_agg(json_build_object('url', u.url, 'source_name', u.source_name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS additional_urls
      FROM poi_news n
      LEFT JOIN poi_news_urls u ON u.news_id = n.id
      WHERE n.poi_id = $1
        AND n.moderation_status IN ('published', 'auto_approved')
      GROUP BY n.id
      ORDER BY
        COALESCE(n.publication_date, n.collection_date) DESC,
        n.collection_date DESC
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
    const tz = req.query.tz || 'America/New_York';
    let query = `
      SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type, e.location_details, e.source_url, e.collection_date,
             COALESCE(json_agg(json_build_object('url', u.url, 'source_name', u.source_name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS additional_urls
      FROM poi_events e
      LEFT JOIN poi_event_urls u ON u.event_id = e.id
      WHERE e.poi_id = $1
        AND e.moderation_status IN ('published', 'auto_approved')
    `;
    if (upcomingOnly) {
      query += ` AND e.start_date >= (CURRENT_TIMESTAMP AT TIME ZONE $3)::date`;
    }
    query += ` GROUP BY e.id ORDER BY e.start_date ASC LIMIT $2`;

    const eventsQuery = await pool.query(query, upcomingOnly ? [id, limit, tz] : [id, limit]);
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
      SELECT id, name, brief_description, poi_roles, status_url,
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

// Get results sub-tab configuration (public, for ResultsTab.jsx)
app.get('/api/results-subtabs', async (req, res) => {
  const DEFAULT_SUBTABS = [
    { id: 'all', label: 'Points of Interest', shortLabel: 'POIs', route: '/', filterTypes: null, protected: true },
    { id: 'mtb', label: 'MTB Trail Status', shortLabel: 'MTB Status', route: '/mtb-trail-status', filterTypes: ['mtb-trailhead'], protected: false },
    { id: 'organizations', label: 'Organizations', shortLabel: 'Orgs', route: '/organizations', filterTypes: ['organization'], protected: false }
  ];
  try {
    const result = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'results_subtabs_config'"
    );
    if (result.rows.length > 0 && result.rows[0].value) {
      res.json(JSON.parse(result.rows[0].value));
    } else {
      res.json({ subtabs: DEFAULT_SUBTABS });
    }
  } catch (error) {
    console.error('Error fetching results subtabs:', error);
    res.json({ subtabs: DEFAULT_SUBTABS });
  }
});

// Get all MTB trails with status data for Status Tab (public)
app.get('/api/trail-status/mtb-trails', async (req, res) => {
  try {
    const trailStatusQuery = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.poi_roles,
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
        AND 'point' = ANY(p.poi_roles)
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
    const limit = parseInt(req.query.limit) || 500;
    const recentNewsQuery = await pool.query(`
      SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
             n.publication_date, n.date_consensus_score, n.collection_date,
             p.id as poi_id, p.name as poi_name, p.poi_roles,
             COALESCE(json_agg(json_build_object('url', u.url, 'source_name', u.source_name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS additional_urls
      FROM poi_news n
      JOIN pois p ON n.poi_id = p.id
      LEFT JOIN poi_news_urls u ON u.news_id = n.id
      WHERE n.moderation_status IN ('published', 'auto_approved')
        AND (p.deleted IS NULL OR p.deleted = FALSE)
      GROUP BY n.id, p.id, p.name, p.poi_roles
      ORDER BY COALESCE(n.publication_date, n.collection_date) DESC, n.collection_date DESC
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
    // Use client timezone for "today" calculation (defaults to America/New_York)
    const tz = req.query.tz || 'America/New_York';
    const upcomingEventsQuery = await pool.query(`
      SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
             e.location_details, e.source_url, p.id as poi_id, p.name as poi_name, p.poi_roles,
             COALESCE(json_agg(json_build_object('url', u.url, 'source_name', u.source_name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS additional_urls
      FROM poi_events e
      JOIN pois p ON e.poi_id = p.id
      LEFT JOIN poi_event_urls u ON u.event_id = e.id
      WHERE e.moderation_status IN ('published', 'auto_approved')
        AND e.start_date >= (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
        AND (p.deleted IS NULL OR p.deleted = FALSE)
      GROUP BY e.id, p.id, p.name, p.poi_roles
      ORDER BY e.start_date ASC
    `, [tz]);
    res.json(upcomingEventsQuery.rows);
  } catch (error) {
    console.error('Error fetching upcoming events:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming events' });
  }
});

// All past events across the park (public)
app.get('/api/events/past', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const tz = req.query.tz || 'America/New_York';
    const pastEventsQuery = await pool.query(`
      SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
             e.location_details, e.source_url, p.id as poi_id, p.name as poi_name, p.poi_roles,
             COALESCE(json_agg(json_build_object('url', u.url, 'source_name', u.source_name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS additional_urls
      FROM poi_events e
      JOIN pois p ON e.poi_id = p.id
      LEFT JOIN poi_event_urls u ON u.event_id = e.id
      WHERE e.moderation_status IN ('published', 'auto_approved')
        AND e.start_date < (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
        AND (p.deleted IS NULL OR p.deleted = FALSE)
      GROUP BY e.id, p.id, p.name, p.poi_roles
      ORDER BY e.start_date DESC
      LIMIT $1
    `, [limit, tz]);
    res.json(pastEventsQuery.rows);
  } catch (error) {
    console.error('Error fetching past events:', error);
    res.status(500).json({ error: 'Failed to fetch past events' });
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
      `SELECT id, name, brief_description FROM pois WHERE id = $1`,
      [id]
    );

    if (poiQuery.rows.length === 0) {
      return res.redirect('/');
    }

    const poi = poiQuery.rows[0];
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const appUrl = `${baseUrl}/?poi=${encodeURIComponent(poi.name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'))}`;
    const imageUrl = `${baseUrl}/api/pois/${poi.id}/thumbnail`;
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
      `SELECT id, name, poi_roles, brief_description FROM pois WHERE id = $1`,
      [id]
    );

    if (featureQuery.rows.length === 0) {
      return res.redirect('/');
    }

    const feature = featureQuery.rows[0];
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const appUrl = `${baseUrl}/?feature=${encodeURIComponent(feature.name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'))}`;
    const imageUrl = `${baseUrl}/api/pois/${feature.id}/thumbnail`;
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
        SELECT id, name, poi_roles, brief_description
        FROM pois
        WHERE (deleted IS NULL OR deleted = FALSE)
      `);

      // Find matching POI by slug
      const poi = poisQuery.rows.find(p => generateSlug(p.name) === poiSlug);

      if (poi) {
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const appUrl = `${baseUrl}/?poi=${poiSlug}`;
        const imageUrl = `${baseUrl}/api/pois/${poi.id}/thumbnail`;
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
let activeSmtpServer = null;

/**
 * Set up AI search provider defaults
 */
async function setupAiSearchDefaults() {
  try {
    // Set default AI search config if not already set
    const defaults = [
      { key: 'ai_search_primary', value: 'gemini' },
      { key: 'ai_search_fallback', value: 'none' },
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

    console.log('[AI Search] Default configuration verified');
  } catch (error) {
    console.error('[AI Search] Error setting up defaults:', error.message);
  }
}

async function start() {
  await initDatabase();
  initJobLogger(pool);

  // Normalize any non-canonical content types (e.g., from seed data or legacy AI output).
  // Checks first so it's a no-op on clean databases — no UPDATE queries run unless needed.
  try {
    const CANONICAL_EVENT_TYPES = ['hike', 'race', 'concert', 'festival', 'program', 'volunteer', 'arts', 'community', 'alert'];
    const CANONICAL_NEWS_TYPES = ['general', 'alert', 'wildlife', 'infrastructure', 'community'];
    const { rows: nonCanonical } = await pool.query(`
      SELECT 'events' AS src, COUNT(*) AS cnt FROM poi_events WHERE event_type NOT IN (${CANONICAL_EVENT_TYPES.map((_, i) => `$${i + 1}`).join(',')})
      UNION ALL
      SELECT 'news', COUNT(*) FROM poi_news WHERE news_type NOT IN (${CANONICAL_NEWS_TYPES.map((_, i) => `$${i + CANONICAL_EVENT_TYPES.length + 1}`).join(',')})
    `, [...CANONICAL_EVENT_TYPES, ...CANONICAL_NEWS_TYPES]);
    const needsNormalization = nonCanonical.some(r => parseInt(r.cnt) > 0);
    if (needsNormalization) {
      console.log('Non-canonical content types detected, normalizing...');
      await pool.query(`
        UPDATE poi_events SET event_type = 'hike' WHERE LOWER(event_type) IN ('guided-tour', 'hiking', 'hikes & outdoor adventures', 'trail', 'recreation', 'scenic-drive', 'wildlife viewing', 'tour') AND event_type != 'hike';
        UPDATE poi_events SET event_type = 'race' WHERE LOWER(event_type) IN ('sports', 'sporting', 'sport', 'sporting event', 'trail-race', 'trail run', 'trail-run', 'trail running', 'marathon', 'running', 'run/walk', 'fun-run', 'athletics', 'fitness', 'tournament') AND event_type != 'race';
        UPDATE poi_events SET event_type = 'concert' WHERE LOWER(event_type) IN ('music', 'tribute', 'comedy', 'performance', 'dance') AND event_type != 'concert';
        UPDATE poi_events SET event_type = 'festival' WHERE LOWER(event_type) IN ('fair', 'expo', 'celebration', 'special events', 'special', 'special-events', 'family-friendly') AND event_type != 'festival';
        UPDATE poi_events SET event_type = 'volunteer' WHERE LOWER(event_type) IN ('trail work & volunteer opportunities', 'charity') AND event_type != 'volunteer';
        UPDATE poi_events SET event_type = 'arts' WHERE LOWER(event_type) IN ('theater', 'arts & theatre', 'film', 'exhibition', 'exhibits', 'on exhibit', 'visual arts') AND event_type != 'arts';
        UPDATE poi_events SET event_type = 'community' WHERE LOWER(event_type) IN ('meeting', 'networking', 'meetup', 'meetups', 'social', 'dining', 'conference', 'convention', 'rally', 'government', 'management/planning', 'hobbies', 'trivia', 'religious', 'worship', 'pilgrimage', 'ceremony', 'wellness', 'seminar', 'workshop', 'retreat', 'day camps') AND event_type != 'community';
        UPDATE poi_events SET event_type = 'alert' WHERE LOWER(event_type) IN ('closure', 'maintenance', 'seasonal') AND event_type != 'alert';
        UPDATE poi_events SET event_type = 'program' WHERE LOWER(event_type) IN ('educational', 'nature education') AND event_type != 'program';
        UPDATE poi_events SET event_type = 'program' WHERE event_type NOT IN ('hike', 'race', 'concert', 'festival', 'program', 'volunteer', 'arts', 'community', 'alert');
        UPDATE poi_news SET news_type = 'alert' WHERE LOWER(news_type) IN ('closure', 'maintenance', 'seasonal') AND news_type != 'alert';
        UPDATE poi_news SET news_type = 'general' WHERE news_type NOT IN ('general', 'alert', 'wildlife', 'infrastructure', 'community');
      `);
      console.log('Content types normalized');
    }
  } catch (err) {
    console.error('Content type normalization failed:', err.message);
  }

  imageServerClient.initialize();

  // Ensure news job checkpoint columns exist for resumability
  await ensureNewsJobCheckpointColumns(pool);

  // Set up AI search provider defaults
  await setupAiSearchDefaults();

  // Initialize job scheduler for news collection
  const connectionString = `postgresql://${process.env.PGUSER || 'rotv'}:${process.env.PGPASSWORD || 'rotv'}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'rotv'}`;

  try {
    await initJobScheduler(connectionString);

    // Register scheduled news collection handler (daily job for all POIs)
    await registerNewsCollectionHandler(withJitter(async () => {
      console.log('Running scheduled news collection for all POIs...');
      const newsCollectionResult = await runNewsCollection(pool, null);
      if (newsCollectionResult.totalPois > 0) {
        console.log(`News collection completed: ${newsCollectionResult.newsFound} news items, ${newsCollectionResult.eventsFound} events found`);
      } else {
        console.log('No POIs to collect');
      }
    }, 'news-collection'));

    // Register batch news collection handler (for admin-triggered jobs via pg-boss)
    await registerBatchNewsHandler(async (pgBossJobId, jobData) => {
      console.log(`[pg-boss] Processing batch news job: ${pgBossJobId}`);
      await processNewsCollectionJob(pool, null, pgBossJobId, jobData);
    });

    // Schedule daily news collection at 6 AM Eastern
    await scheduleNewsCollection('0 6 * * *');

    // Register scheduled trail status collection handler
    await registerTrailStatusHandler(withJitter(async () => {
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
    }, 'trail-status'));

    // Register batch trail status collection handler
    await registerBatchTrailStatusHandler(async (jobId, poiIds) => {
      console.log(`[pg-boss] Processing batch trail status job: ${jobId}`);
      await processTrailStatusCollectionJob(pool, jobId, poiIds);
    });

    // Schedule trail status collection every 30 minutes (Gemini Flash is essentially free)
    const trailStatusInterval = '*/30 * * * *';
    await scheduleTrailStatusCollection(trailStatusInterval);

    // Register content moderation handler (processes individual items)
    await registerModerationHandler(async (contentType, contentId) => {
      await processItem(pool, contentType, contentId);
    });

    // Register moderation sweep handler (catches unprocessed items)
    await registerModerationSweepHandler(withJitter(async () => {
      await processPendingItems(pool);
      // Retention: purge job logs older than 30 days
      try {
        const deleted = await pool.query(`DELETE FROM job_logs WHERE created_at < NOW() - INTERVAL '30 days'`);
        if (deleted.rowCount > 0) {
          console.log(`[JobLogger] Purged ${deleted.rowCount} log entries older than 30 days`);
        }
      } catch (err) {
        console.error('[JobLogger] Retention cleanup failed:', err.message);
      }
    }, 'moderation-sweep'));

    // Schedule moderation sweep every 15 minutes — relevance voting + promotion
    await scheduleModerationSweep('*/15 * * * *');

    // Register newsletter email processing handler
    await registerNewsletterHandler(async (emailId) => {
      await processNewsletterById(pool, emailId);
    });

    // Register weekly digest handler
    await registerDigestHandler(async (pgBossJobId, data) => {
      await sendWeeklyDigest(pool, pgBossJobId);
    });

    // Schedule digest for Fridays at 8 AM EST
    await scheduleDigest('0 8 * * 5');

    // Register image backup handler (nightly backup of image server to Drive)
    // Shared helper: get authenticated Drive service from admin OAuth credentials
    const getAdminDriveService = async () => {
      const { createDriveServiceWithRefresh } = await import('./services/driveImageService.js');
      const adminResult = await pool.query(
        'SELECT id, oauth_credentials FROM users WHERE is_admin = TRUE LIMIT 1'
      );
      if (!adminResult.rows[0]?.oauth_credentials) {
        throw new Error('No admin with OAuth credentials found — cannot access Drive');
      }
      let credentials = adminResult.rows[0].oauth_credentials;
      if (typeof credentials === 'string') {
        credentials = JSON.parse(credentials);
      }
      if (!credentials.refresh_token) {
        throw new Error('Admin OAuth credentials missing refresh_token');
      }
      return createDriveServiceWithRefresh(credentials, pool, adminResult.rows[0].id);
    };

    await registerImageBackupHandler(withJitter(async () => {
      console.log('Running scheduled image backup...');
      const { triggerImageBackup } = await import('./services/backupService.js');
      const drive = await getAdminDriveService();
      const result = await triggerImageBackup(pool, drive);
      console.log(`Image backup completed: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.failed} failed`);
    }, 'image-backup'));

    // Schedule nightly image backup at 2 AM Eastern
    await scheduleImageBackup('0 2 * * *');

    // Register database backup handler (nightly pg_dump to Drive)
    await registerDatabaseBackupHandler(withJitter(async () => {
      console.log('Running scheduled database backup...');
      const { triggerBackup } = await import('./services/backupService.js');
      const drive = await getAdminDriveService();
      const result = await triggerBackup(pool, drive);
      console.log(`Database backup completed: ${result.filename} (${result.driveFileId})`);
    }, 'database-backup'));

    // Schedule nightly database backup at 3 AM Eastern
    await scheduleDatabaseBackup('0 3 * * *');

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

  // Start SMTP server for inbound newsletter emails
  activeSmtpServer = startSmtpServer(pool);

  // Start MCP admin server (only if token is configured)
  if (process.env.MCP_ADMIN_TOKEN) {
    startMcpServer(pool, app.get('boss'), parseInt(process.env.MCP_PORT || '3001'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Roots of The Valley API running on port ${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (activeSmtpServer) activeSmtpServer.close();
  await stopJobLogger();
  await stopJobScheduler();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (activeSmtpServer) activeSmtpServer.close();
  await stopJobLogger();
  await stopJobScheduler();
  process.exit(0);
});

start().catch(console.error);
