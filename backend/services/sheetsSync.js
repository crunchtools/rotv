import { google } from 'googleapis';
import {
  ensureDriveFolders,
  moveFileToFolder,
  getDriveSetting,
  setDriveSetting,
  getAllDriveSettings,
  uploadIconToDrive,
  uploadImageToDrive,
  downloadFileFromDrive,
  deleteFileFromDrive,
  uploadGeoJSONToDrive,
  downloadGeoJSONFromDrive
} from './driveImageService.js';

// Default source spreadsheet (read-only, for initial import via CSV)
const SOURCE_SPREADSHEET_ID = '1uSrTrLadkvfy8eeKlhJD0V-F79sOTYC06qOw6Z4YUiw';
const SOURCE_SHEET_NAME = 'CVNP Discovery Dataset Table Export';

// The app's own spreadsheet sheet names
const APP_SHEET_NAME = 'Destinations';
const ACTIVITIES_SHEET_NAME = 'Activities';
const ERAS_SHEET_NAME = 'Eras';
const SURFACES_SHEET_NAME = 'Surfaces';
const ICONS_SHEET_NAME = 'Icons';
const INTEGRATION_SHEET_NAME = 'Google Integration';
const NEWS_SHEET_NAME = 'News';
const EVENTS_SHEET_NAME = 'Events';
const POI_ASSOCIATIONS_SHEET_NAME = 'Associations';

// Concurrency limit for parallel Google API calls (Google allows ~10/sec per user)
const PARALLEL_BATCH_SIZE = 5;

/**
 * Process items in parallel batches to avoid rate limiting
 * @param {Array} items - Array of items to process
 * @param {Function} processor - Async function to process each item
 * @param {number} batchSize - Number of concurrent operations (default: PARALLEL_BATCH_SIZE)
 * @returns {Array} Results from all processed items
 */
async function processInParallelBatches(items, processor, batchSize = PARALLEL_BATCH_SIZE) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

// Column mapping for the unified POIs spreadsheet
// Supports point POIs (lat/long) and linear POIs (trails/rivers with geometry)
const COLUMNS = {
  name: 0,
  poi_type: 1,
  latitude: 2,
  longitude: 3,
  property_owner: 4,
  brief_description: 5,
  era: 6,
  historical_description: 7,
  primary_activities: 8,
  surface: 9,
  pets: 10,
  cell_signal: 11,
  more_info_link: 12,
  events_url: 13,
  news_url: 14,
  length_miles: 15,
  difficulty: 16,
  image_drive_file_id: 17,
  geometry_drive_file_id: 18,
  boundary_color: 19
};

// Headers for the unified POIs spreadsheet
const HEADERS = [
  'Name', 'POI Type', 'Latitude', 'Longitude', 'Property Owner', 'Brief Description',
  'Era', 'Historical Description', 'Primary Activities', 'Surface',
  'Pets', 'Cell Signal', 'More Info Link', 'Events URL', 'News URL', 'Length (miles)', 'Difficulty',
  'Image Drive File ID', 'Geometry Drive File ID', 'Boundary Color'
];

// Column mapping for the activities spreadsheet (icon removed - now in icons table)
const ACTIVITIES_COLUMNS = {
  name: 0,
  sort_order: 1
};

// Headers for the activities spreadsheet
const ACTIVITIES_HEADERS = ['Name', 'Sort Order'];

// Column mapping for the eras spreadsheet
const ERAS_COLUMNS = {
  name: 0,
  year_start: 1,
  year_end: 2,
  description: 3,
  sort_order: 4
};

// Headers for the eras spreadsheet
const ERAS_HEADERS = ['Name', 'Year Start', 'Year End', 'Description', 'Sort Order'];

// Column mapping for the surfaces spreadsheet
const SURFACES_COLUMNS = {
  name: 0,
  description: 1,
  sort_order: 2
};

// Headers for the surfaces spreadsheet
const SURFACES_HEADERS = ['Name', 'Description', 'Sort Order'];

// Column mapping for the icons spreadsheet
const ICONS_COLUMNS = {
  name: 0,
  label: 1,
  svg_filename: 2,
  title_keywords: 3,
  activity_fallbacks: 4,
  sort_order: 5,
  enabled: 6,
  drive_file_id: 7
};

// Headers for the icons spreadsheet
const ICONS_HEADERS = ['Name', 'Label', 'SVG Filename', 'Title Keywords', 'Activity Fallbacks', 'Sort Order', 'Enabled', 'Drive File ID'];

// Column mapping for the news spreadsheet
const NEWS_COLUMNS = {
  id: 0,
  poi_id: 1,
  poi_name: 2,
  title: 3,
  summary: 4,
  source_url: 5,
  source_name: 6,
  news_type: 7,
  published_at: 8
};

// Headers for the news spreadsheet
const NEWS_HEADERS = ['ID', 'POI ID', 'POI Name', 'Title', 'Summary', 'Source URL', 'Source Name', 'News Type', 'Published At'];

// Column mapping for the events spreadsheet
const EVENTS_COLUMNS = {
  id: 0,
  poi_id: 1,
  poi_name: 2,
  title: 3,
  description: 4,
  start_date: 5,
  end_date: 6,
  event_type: 7,
  location_details: 8,
  source_url: 9
};

// Headers for the events spreadsheet
const EVENTS_HEADERS = ['ID', 'POI ID', 'POI Name', 'Title', 'Description', 'Start Date', 'End Date', 'Event Type', 'Location Details', 'Source URL'];

// Column mapping for the POI associations spreadsheet
const POI_ASSOCIATIONS_COLUMNS = {
  id: 0,
  virtual_poi_name: 1,
  physical_poi_name: 2,
  association_type: 3
};

// Headers for the POI associations spreadsheet
const POI_ASSOCIATIONS_HEADERS = ['ID', 'Organization Name', 'Associated Location Name', 'Association Type'];

// Column mapping for the integration settings spreadsheet
const INTEGRATION_COLUMNS = {
  setting: 0,
  value: 1,
  updated_at: 2
};

// Headers for the integration settings spreadsheet
const INTEGRATION_HEADERS = ['Setting', 'Value', 'Updated At'];

/**
 * Create an OAuth2 client with proper credentials
 * If refresh_token is present, tries to refresh the access token
 */
async function createOAuth2Client(credentials, pool, userId) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(credentials);

  // If we have a refresh token, try to refresh the access token
  if (credentials.refresh_token) {
    try {
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCredentials);

      // Save the new credentials to the database if pool and userId provided
      if (pool && userId) {
        const updatedCreds = {
          access_token: newCredentials.access_token,
          refresh_token: newCredentials.refresh_token || credentials.refresh_token,
          expiry_date: newCredentials.expiry_date
        };
        await pool.query(
          'UPDATE users SET oauth_credentials = $1 WHERE id = $2',
          [JSON.stringify(updatedCreds), userId]
        );
      }
    } catch (refreshError) {
      console.warn('Token refresh failed:', refreshError.message);
      // Continue with existing credentials - they might still work
    }
  }

  return oauth2Client;
}

/**
 * Create Google Sheets service using OAuth credentials from session
 */
export function createSheetsService(credentials) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(credentials);
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

/**
 * Create Google Sheets service with token refresh
 */
export async function createSheetsServiceWithRefresh(credentials, pool, userId) {
  const oauth2Client = await createOAuth2Client(credentials, pool, userId);
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

/**
 * Create Google Drive service using OAuth credentials
 */
export function createDriveService(credentials) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(credentials);
  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Create Google Drive service with token refresh
 */
export async function createDriveServiceWithRefresh(credentials, pool, userId) {
  const oauth2Client = await createOAuth2Client(credentials, pool, userId);
  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Check if a file is in the trash
 */
export async function isFileTrashed(drive, fileId) {
  try {
    const response = await drive.files.get({
      fileId,
      fields: 'trashed'
    });
    return response.data.trashed === true;
  } catch (error) {
    // If we can't access the file, it might be permanently deleted
    if (error.code === 404) {
      return null; // File not found (permanently deleted)
    }
    throw error;
  }
}

/**
 * Get the configured spreadsheet ID from the database
 */
export async function getSpreadsheetId(pool) {
  const result = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'sync_spreadsheet_id'"
  );
  return result.rows[0]?.value || null;
}

/**
 * Save the spreadsheet ID to the database
 */
export async function setSpreadsheetId(pool, spreadsheetId, userId = null) {
  await pool.query(`
    INSERT INTO admin_settings (key, value, updated_at, updated_by)
    VALUES ('sync_spreadsheet_id', $1, CURRENT_TIMESTAMP, $2)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = CURRENT_TIMESTAMP,
      updated_by = EXCLUDED.updated_by
  `, [spreadsheetId, userId]);
}

/**
 * Create a new spreadsheet for the app with proper headers
 * If drive is provided, the spreadsheet will be moved into the Roots of The Valley folder
 */
export async function createAppSpreadsheet(sheets, pool, userId = null, drive = null) {
  // Ensure the ROTV folder structure exists if drive is provided
  let rootFolderId = null;
  if (drive) {
    const folders = await ensureDriveFolders(drive, pool);
    rootFolderId = folders.rootFolderId;
  }

  // Create the spreadsheet with all sheets: Destinations, Activities, Eras, Surfaces, Icons, Google Integration
  const response = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: 'Roots of The Valley - Destinations'
      },
      sheets: [
        {
          properties: {
            title: APP_SHEET_NAME,
            gridProperties: {
              frozenRowCount: 1 // Freeze header row
            }
          }
        },
        {
          properties: {
            title: ACTIVITIES_SHEET_NAME,
            gridProperties: {
              frozenRowCount: 1 // Freeze header row
            }
          }
        },
        {
          properties: {
            title: ERAS_SHEET_NAME,
            gridProperties: {
              frozenRowCount: 1 // Freeze header row
            }
          }
        },
        {
          properties: {
            title: SURFACES_SHEET_NAME,
            gridProperties: {
              frozenRowCount: 1 // Freeze header row
            }
          }
        },
        {
          properties: {
            title: ICONS_SHEET_NAME,
            gridProperties: {
              frozenRowCount: 1 // Freeze header row
            }
          }
        },
        {
          properties: {
            title: INTEGRATION_SHEET_NAME,
            gridProperties: {
              frozenRowCount: 1 // Freeze header row
            }
          }
        }
      ]
    }
  });

  const spreadsheetId = response.data.spreadsheetId;
  const spreadsheetUrl = response.data.spreadsheetUrl;

  // Add headers to the Destinations sheet (unified POI schema)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${APP_SHEET_NAME}'!A1:R1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [HEADERS]
    }
  });

  // Add headers to the Activities sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${ACTIVITIES_SHEET_NAME}'!A1:B1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [ACTIVITIES_HEADERS]
    }
  });

  // Add headers to the Eras sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${ERAS_SHEET_NAME}'!A1:E1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [ERAS_HEADERS]
    }
  });

  // Add headers to the Surfaces sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SURFACES_SHEET_NAME}'!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [SURFACES_HEADERS]
    }
  });

  // Add headers to the Icons sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${ICONS_SHEET_NAME}'!A1:H1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [ICONS_HEADERS]
    }
  });

  // Add headers to the Google Integration sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${INTEGRATION_SHEET_NAME}'!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [INTEGRATION_HEADERS]
    }
  });

  // Format header rows (bold, background color) for all sheets
  const destinationsSheetId = response.data.sheets[0].properties.sheetId;
  const activitiesSheetId = response.data.sheets[1].properties.sheetId;
  const erasSheetId = response.data.sheets[2].properties.sheetId;
  const surfacesSheetId = response.data.sheets[3].properties.sheetId;
  const iconsSheetId = response.data.sheets[4].properties.sheetId;
  const integrationSheetId = response.data.sheets[5].properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Format Destinations header
        {
          repeatCell: {
            range: {
              sheetId: destinationsSheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.4, blue: 0.1 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: destinationsSheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 17  // 17 columns (A-Q) for unified POI schema
            }
          }
        },
        // Format Activities header
        {
          repeatCell: {
            range: {
              sheetId: activitiesSheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.3, green: 0.2, blue: 0.5 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: activitiesSheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 3
            }
          }
        },
        // Format Eras header
        {
          repeatCell: {
            range: {
              sheetId: erasSheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.6, green: 0.4, blue: 0.2 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: erasSheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 5
            }
          }
        },
        // Format Surfaces header
        {
          repeatCell: {
            range: {
              sheetId: surfacesSheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.5, blue: 0.5 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: surfacesSheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 3
            }
          }
        },
        // Format Icons header
        {
          repeatCell: {
            range: {
              sheetId: iconsSheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.5, green: 0.3, blue: 0.6 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: iconsSheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 8
            }
          }
        },
        // Format Google Integration header
        {
          repeatCell: {
            range: {
              sheetId: integrationSheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.1, green: 0.3, blue: 0.6 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: integrationSheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 3
            }
          }
        }
      ]
    }
  });

  // Save the spreadsheet ID to the database
  await setSpreadsheetId(pool, spreadsheetId, userId);

  // Record creation in sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('spreadsheet_created', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  // Move the spreadsheet into the ROTV folder if drive is available
  if (drive && rootFolderId) {
    try {
      await moveFileToFolder(drive, spreadsheetId, rootFolderId);
      console.log('Spreadsheet moved to Roots of The Valley folder');
    } catch (error) {
      console.error('Failed to move spreadsheet to folder:', error.message);
      // Non-fatal error - spreadsheet is still usable at root level
    }
  }

  return {
    id: spreadsheetId,
    url: spreadsheetUrl,
    name: 'Roots of The Valley - Destinations'
  };
}

/**
 * Parse coordinate - accepts decimal degrees (41.2626) or legacy format (41.2626° N)
 */
function parseCoordinate(coordStr, type) {
  if (!coordStr) return null;
  const str = coordStr.toString().trim();

  // Try to parse as plain decimal degrees first
  const plainNum = parseFloat(str);
  if (!isNaN(plainNum)) return plainNum;

  // Fall back to parsing legacy format with direction indicators
  const numMatch = str.match(/[-]?[\d.]+/);
  if (!numMatch) return null;
  let value = parseFloat(numMatch[0]);
  if (isNaN(value)) return null;
  const upperStr = str.toUpperCase();
  if (type === 'lat' && upperStr.includes('S')) {
    value = -Math.abs(value);
  } else if (type === 'lng' && upperStr.includes('W')) {
    value = -Math.abs(value);
  }
  return value;
}

/**
 * Parse cell signal (could be "4/5" or just "4")
 */
function parseCellSignal(cellStr) {
  if (!cellStr) return null;
  const match = cellStr.toString().match(/(\d)/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Format coordinate for spreadsheet - decimal degrees (e.g., 41.2626 or -81.4193)
 */
function formatCoordinate(value, type) {
  if (value === null || value === undefined) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return '';
  return num.toString();
}

/**
 * Format cell signal for spreadsheet (e.g., "4/5")
 */
function formatCellSignal(level) {
  if (level === null || level === undefined) return '';
  return `${level}/5`;
}

/**
 * Convert a spreadsheet row to a unified POI object
 * Supports both point POIs (lat/long) and linear POIs (trails/rivers)
 */
function rowToPOI(row) {
  // Map user-friendly "organization" back to internal "virtual" type
  const rawType = row[COLUMNS.poi_type] || 'point';
  const internalType = rawType.toLowerCase() === 'organization' ? 'virtual' : rawType;

  return {
    name: row[COLUMNS.name] || '',
    poi_type: internalType,
    latitude: parseCoordinate(row[COLUMNS.latitude], 'lat'),
    longitude: parseCoordinate(row[COLUMNS.longitude], 'lng'),
    property_owner: row[COLUMNS.property_owner] || null,
    brief_description: row[COLUMNS.brief_description] || null,
    era: row[COLUMNS.era] || null,
    historical_description: row[COLUMNS.historical_description] || null,
    primary_activities: row[COLUMNS.primary_activities] || null,
    surface: row[COLUMNS.surface] || null,
    pets: row[COLUMNS.pets] || null,
    cell_signal: parseCellSignal(row[COLUMNS.cell_signal]),
    more_info_link: row[COLUMNS.more_info_link] || null,
    events_url: row[COLUMNS.events_url] || null,
    news_url: row[COLUMNS.news_url] || null,
    length_miles: row[COLUMNS.length_miles] ? parseFloat(row[COLUMNS.length_miles]) : null,
    difficulty: row[COLUMNS.difficulty] || null,
    image_drive_file_id: row[COLUMNS.image_drive_file_id] || null,
    geometry_drive_file_id: row[COLUMNS.geometry_drive_file_id] || null,
    boundary_color: row[COLUMNS.boundary_color] || null
  };
}

/**
 * Convert a unified POI object to a spreadsheet row
 * Supports both point POIs (lat/long) and linear POIs (trails/rivers)
 */
function poiToRow(poi) {
  // Map internal "virtual" type to user-friendly "organization" for spreadsheet
  const displayType = poi.poi_type === 'virtual' ? 'organization' : (poi.poi_type || 'point');

  return [
    poi.name || '',
    displayType,
    formatCoordinate(poi.latitude, 'lat'),
    formatCoordinate(poi.longitude, 'lng'),
    poi.property_owner || '',
    poi.brief_description || '',
    poi.era || '',
    poi.historical_description || '',
    poi.primary_activities || '',
    poi.surface || '',
    poi.pets || '',
    formatCellSignal(poi.cell_signal),
    poi.more_info_link || '',
    poi.events_url || '',
    poi.news_url || '',
    poi.length_miles || '',
    poi.difficulty || '',
    poi.image_drive_file_id || '',
    poi.geometry_drive_file_id || '',
    poi.boundary_color || ''
  ];
}

/**
 * Read all POIs from a Google Sheet
 */
export async function readPOIs(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A2:T`,  // Extended range for events_url and news_url columns
  });

  const rows = response.data.values || [];
  return rows
    .map(rowToPOI)
    .filter(d => d.name && d.name !== 'Name');
}

/**
 * Find the row number for a destination by name
 */
async function findRowByName(sheets, spreadsheetId, sheetName, name) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:A`,
  });

  const values = response.data.values || [];
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === name) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Append a new POI to the spreadsheet (checks for duplicates first)
 */
export async function appendPOI(sheets, spreadsheetId, poi) {
  // Check if POI already exists to prevent duplicates
  const existingRow = await findRowByName(sheets, spreadsheetId, APP_SHEET_NAME, poi.name);
  if (existingRow) {
    // POI already exists - skip INSERT since UPDATE operations handle updates
    // (UPDATE runs before INSERT in the sync queue, so data is already current)
    console.log(`POI "${poi.name}" already exists in sheet at row ${existingRow}, skipping INSERT`);
    return;
  }

  const row = poiToRow(poi);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${APP_SHEET_NAME}'!A:R`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row]
    }
  });
}

/**
 * Update an existing POI in the spreadsheet
 */
export async function updatePOI(sheets, spreadsheetId, name, poi) {
  const rowNum = await findRowByName(sheets, spreadsheetId, APP_SHEET_NAME, name);
  if (!rowNum) {
    await appendPOI(sheets, spreadsheetId, poi);
    return;
  }

  const row = poiToRow(poi);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${APP_SHEET_NAME}'!A${rowNum}:R${rowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row]
    }
  });
}

/**
 * Delete a POI from the spreadsheet
 */
export async function deletePOI(sheets, spreadsheetId, name) {
  const rowNum = await findRowByName(sheets, spreadsheetId, APP_SHEET_NAME, name);
  if (!rowNum || rowNum === 1) return;

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets.find(
    s => s.properties.title === APP_SHEET_NAME
  );

  if (!sheet) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowNum - 1,
            endIndex: rowNum
          }
        }
      }]
    }
  });
}

/**
 * Push all POIs from database to the app's spreadsheet
 * Includes both point POIs and linear features (trails/rivers)
 * For linear features with geometry, uploads GeoJSON to Drive
 */
export async function pushAllToSheets(sheets, pool, drive = null) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  const result = await pool.query(`
    SELECT * FROM pois
    WHERE (deleted IS NULL OR deleted = FALSE)
    ORDER BY poi_type, name
  `);

  const pois = result.rows;

  // Upload GeoJSON to Drive for linear features (parallelized)
  if (drive) {
    const linearFeatures = pois.filter(poi =>
      poi.geometry && (poi.poi_type === 'trail' || poi.poi_type === 'river' || poi.poi_type === 'boundary')
    );

    if (linearFeatures.length > 0) {
      console.log(`Uploading ${linearFeatures.length} GeoJSON files in parallel batches of ${PARALLEL_BATCH_SIZE}...`);

      await processInParallelBatches(linearFeatures, async (poi) => {
        // Create a sanitized filename from the POI name
        const safeName = poi.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const filename = `${poi.poi_type}-${safeName}`;

        // Create a GeoJSON Feature for this POI
        const geojsonFeature = {
          type: 'Feature',
          properties: {
            name: poi.name,
            poi_type: poi.poi_type,
            brief_description: poi.brief_description,
            length_miles: poi.length_miles,
            difficulty: poi.difficulty
          },
          geometry: poi.geometry
        };

        // Upload to Drive
        const driveFileId = await uploadGeoJSONToDrive(drive, pool, filename, geojsonFeature);

        // Update database with Drive file ID if it changed
        if (driveFileId !== poi.geometry_drive_file_id) {
          await pool.query(
            'UPDATE pois SET geometry_drive_file_id = $1 WHERE id = $2',
            [driveFileId, poi.id]
          );
          poi.geometry_drive_file_id = driveFileId;
        }

        console.log(`Uploaded GeoJSON for ${poi.name} to Drive: ${driveFileId}`);
      });
    }

    // Upload images to Drive for POIs that have local image data but no Drive file ID
    const poisWithLocalImages = pois.filter(poi =>
      poi.image_data && !poi.image_drive_file_id
    );

    if (poisWithLocalImages.length > 0) {
      console.log(`Uploading ${poisWithLocalImages.length} images to Drive...`);

      await processInParallelBatches(poisWithLocalImages, async (poi) => {
        const safeName = poi.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const ext = poi.image_mime_type === 'image/png' ? 'png' :
                    poi.image_mime_type === 'image/gif' ? 'gif' :
                    poi.image_mime_type === 'image/webp' ? 'webp' : 'jpg';
        const filename = `${poi.poi_type}-${safeName}.${ext}`;

        const driveFileId = await uploadImageToDrive(drive, pool, filename, poi.image_data, poi.image_mime_type);

        // Update database with Drive file ID
        await pool.query(
          'UPDATE pois SET image_drive_file_id = $1 WHERE id = $2',
          [driveFileId, poi.id]
        );
        poi.image_drive_file_id = driveFileId;

        console.log(`Uploaded image for ${poi.name} to Drive: ${driveFileId}`);
      });
    }
  }

  // Clear existing data (keep header)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${APP_SHEET_NAME}'!A2:T`,
  });

  // Write all POIs
  if (pois.length > 0) {
    const rows = pois.map(poiToRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${APP_SHEET_NAME}'!A2:T`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  // Mark all as synced
  await pool.query(`
    UPDATE pois SET synced = TRUE
    WHERE (deleted IS NULL OR deleted = FALSE)
  `);

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_push', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  // Also push News, Events, and Associations sheets
  await pushNewsToSheets(sheets, pool);
  await pushEventsToSheets(sheets, pool);
  await pushAssociationsToSheets(sheets, pool);

  // Clear the sync queue since all data has been pushed
  await pool.query('DELETE FROM sync_queue');

  return pois.length;
}

/**
 * Pull all POIs from the app's spreadsheet to database
 * Point POIs: replaced entirely from sheet
 * Linear POIs (trails/rivers): metadata updated only (geometry preserved)
 */
export async function pullAllFromSheets(sheets, pool, drive = null) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  const pois = await readPOIs(sheets, spreadsheetId, APP_SHEET_NAME);

  // Separate point POIs from linear POIs and virtual POIs
  const pointPOIs = pois.filter(p => p.poi_type === 'point' || !p.poi_type);
  const linearPOIs = pois.filter(p => p.poi_type === 'trail' || p.poi_type === 'river' || p.poi_type === 'boundary');
  const virtualPOIs = pois.filter(p => p.poi_type === 'virtual');

  // Clear local point-type and virtual-type POIs (preserve trails and rivers with geometry)
  await pool.query(`DELETE FROM pois WHERE poi_type = 'point'`);
  await pool.query(`DELETE FROM pois WHERE poi_type = 'virtual'`);

  // Insert point POIs from sheets (DB inserts are fast, do sequentially for data integrity)
  const insertedPointPOIs = [];
  for (const poi of pointPOIs) {
    if (!poi.name) continue;

    const result = await pool.query(`
      INSERT INTO pois (
        name, poi_type, latitude, longitude, property_owner, brief_description,
        era, historical_description, primary_activities, surface,
        pets, cell_signal, more_info_link, events_url, news_url, image_drive_file_id,
        synced, locally_modified, deleted, created_at, updated_at
      ) VALUES ($1, 'point', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, TRUE, FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (name, poi_type) DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        property_owner = EXCLUDED.property_owner,
        brief_description = EXCLUDED.brief_description,
        era = EXCLUDED.era,
        historical_description = EXCLUDED.historical_description,
        primary_activities = EXCLUDED.primary_activities,
        surface = EXCLUDED.surface,
        pets = EXCLUDED.pets,
        cell_signal = EXCLUDED.cell_signal,
        more_info_link = EXCLUDED.more_info_link,
        events_url = EXCLUDED.events_url,
        news_url = EXCLUDED.news_url,
        image_drive_file_id = EXCLUDED.image_drive_file_id,
        synced = TRUE,
        locally_modified = FALSE,
        deleted = FALSE,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [
      poi.name, poi.latitude, poi.longitude, poi.property_owner,
      poi.brief_description, poi.era, poi.historical_description,
      poi.primary_activities, poi.surface, poi.pets, poi.cell_signal,
      poi.more_info_link, poi.events_url, poi.news_url, poi.image_drive_file_id
    ]);

    if (poi.image_drive_file_id) {
      insertedPointPOIs.push({ id: result.rows[0].id, name: poi.name, image_drive_file_id: poi.image_drive_file_id });
    }
  }

  // Download images for point POIs in parallel batches
  if (drive && insertedPointPOIs.length > 0) {
    console.log(`Downloading ${insertedPointPOIs.length} point POI images in parallel batches of ${PARALLEL_BATCH_SIZE}...`);

    await processInParallelBatches(insertedPointPOIs, async (poi) => {
      const imageBuffer = await downloadFileFromDrive(drive, poi.image_drive_file_id);
      if (imageBuffer) {
        let mimeType = 'image/jpeg';
        if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) mimeType = 'image/png';
        else if (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49) mimeType = 'image/gif';
        else if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49) mimeType = 'image/webp';

        await pool.query(`
          UPDATE pois SET image_data = $1, image_mime_type = $2 WHERE id = $3
        `, [imageBuffer, mimeType, poi.id]);

        // Invalidate thumbnail cache
        await pool.query('DELETE FROM thumbnail_cache WHERE poi_id = $1', [poi.id]);

        console.log(`Downloaded image for POI: ${poi.name}`);
      }
    });
  }

  // Insert virtual POIs from sheets
  const insertedVirtualPOIs = [];
  for (const poi of virtualPOIs) {
    if (!poi.name) continue;

    const result = await pool.query(`
      INSERT INTO pois (
        name, poi_type, property_owner, brief_description,
        era, historical_description, more_info_link, events_url, news_url, image_drive_file_id,
        synced, locally_modified, deleted, created_at, updated_at
      ) VALUES ($1, 'virtual', $2, $3, $4, $5, $6, $7, $8, $9, TRUE, FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (name, poi_type) DO UPDATE SET
        property_owner = EXCLUDED.property_owner,
        brief_description = EXCLUDED.brief_description,
        era = EXCLUDED.era,
        historical_description = EXCLUDED.historical_description,
        more_info_link = EXCLUDED.more_info_link,
        events_url = EXCLUDED.events_url,
        news_url = EXCLUDED.news_url,
        image_drive_file_id = EXCLUDED.image_drive_file_id,
        synced = TRUE,
        locally_modified = FALSE,
        deleted = FALSE,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [
      poi.name, poi.property_owner, poi.brief_description, poi.era,
      poi.historical_description, poi.more_info_link, poi.events_url, poi.news_url, poi.image_drive_file_id
    ]);

    if (poi.image_drive_file_id) {
      insertedVirtualPOIs.push({ id: result.rows[0].id, name: poi.name, image_drive_file_id: poi.image_drive_file_id });
    }
  }

  // Download images for virtual POIs in parallel batches
  if (drive && insertedVirtualPOIs.length > 0) {
    console.log(`Downloading ${insertedVirtualPOIs.length} virtual POI images in parallel batches of ${PARALLEL_BATCH_SIZE}...`);

    await processInParallelBatches(insertedVirtualPOIs, async (poi) => {
      const imageBuffer = await downloadFileFromDrive(drive, poi.image_drive_file_id);
      if (imageBuffer) {
        let mimeType = 'image/jpeg';
        if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) mimeType = 'image/png';
        else if (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49) mimeType = 'image/gif';
        else if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49) mimeType = 'image/webp';

        await pool.query(`
          UPDATE pois SET image_data = $1, image_mime_type = $2 WHERE id = $3
        `, [imageBuffer, mimeType, poi.id]);

        // Invalidate thumbnail cache
        await pool.query('DELETE FROM thumbnail_cache WHERE poi_id = $1', [poi.id]);

        console.log(`Downloaded image for virtual POI: ${poi.name}`);
      }
    });
  }

  // Update or create linear POIs (parallelized Drive downloads)
  if (linearPOIs.length > 0 && drive) {
    console.log(`Processing ${linearPOIs.length} linear POIs with parallel Drive downloads...`);

    // Collect all download tasks for GeoJSON and images
    const geoJsonDownloads = [];
    const imageDownloads = [];
    const newLinearPOIs = [];

    // First pass: update metadata and identify what needs downloading
    for (const poi of linearPOIs) {
      if (!poi.name) continue;

      const existing = await pool.query(
        'SELECT id, image_drive_file_id, geometry_drive_file_id FROM pois WHERE name = $1 AND poi_type = $2',
        [poi.name, poi.poi_type]
      );

      if (existing.rows.length > 0) {
        const existingId = existing.rows[0].id;
        const existingGeoDriveId = existing.rows[0].geometry_drive_file_id;
        const existingImgDriveId = existing.rows[0].image_drive_file_id;

        // Queue GeoJSON download if file ID changed
        if (poi.geometry_drive_file_id && poi.geometry_drive_file_id !== existingGeoDriveId) {
          geoJsonDownloads.push({ id: existingId, name: poi.name, geometry_drive_file_id: poi.geometry_drive_file_id, poi });
        } else {
          // Update metadata without geometry
          await pool.query(`
            UPDATE pois SET
              property_owner = $1, brief_description = $2, era = $3,
              historical_description = $4, primary_activities = $5, surface = $6,
              pets = $7, cell_signal = $8, more_info_link = $9,
              events_url = $10, news_url = $11,
              length_miles = $12, difficulty = $13, image_drive_file_id = $14,
              geometry_drive_file_id = $15, boundary_color = $16, updated_at = CURRENT_TIMESTAMP,
              synced = TRUE, locally_modified = FALSE
            WHERE id = $17
          `, [
            poi.property_owner, poi.brief_description, poi.era,
            poi.historical_description, poi.primary_activities, poi.surface,
            poi.pets, poi.cell_signal, poi.more_info_link,
            poi.events_url, poi.news_url,
            poi.length_miles, poi.difficulty, poi.image_drive_file_id,
            poi.geometry_drive_file_id, poi.boundary_color, existingId
          ]);
        }

        // Queue image download if file ID changed
        if (poi.image_drive_file_id && poi.image_drive_file_id !== existingImgDriveId) {
          imageDownloads.push({ id: existingId, name: poi.name, image_drive_file_id: poi.image_drive_file_id });
        }
      } else if (poi.geometry_drive_file_id) {
        // New linear feature - queue for creation
        newLinearPOIs.push(poi);
      }
    }

    // Download GeoJSON files in parallel batches
    if (geoJsonDownloads.length > 0) {
      console.log(`Downloading ${geoJsonDownloads.length} GeoJSON files in parallel batches of ${PARALLEL_BATCH_SIZE}...`);

      await processInParallelBatches(geoJsonDownloads, async (item) => {
        const geojson = await downloadGeoJSONFromDrive(drive, item.geometry_drive_file_id);
        if (geojson && geojson.geometry) {
          await pool.query(`
            UPDATE pois SET
              property_owner = $1, brief_description = $2, era = $3,
              historical_description = $4, primary_activities = $5, surface = $6,
              pets = $7, cell_signal = $8, more_info_link = $9,
              events_url = $10, news_url = $11,
              length_miles = $12, difficulty = $13, image_drive_file_id = $14,
              geometry_drive_file_id = $15, geometry = $16, boundary_color = $17,
              updated_at = CURRENT_TIMESTAMP, synced = TRUE, locally_modified = FALSE
            WHERE id = $18
          `, [
            item.poi.property_owner, item.poi.brief_description, item.poi.era,
            item.poi.historical_description, item.poi.primary_activities, item.poi.surface,
            item.poi.pets, item.poi.cell_signal, item.poi.more_info_link,
            item.poi.events_url, item.poi.news_url,
            item.poi.length_miles, item.poi.difficulty, item.poi.image_drive_file_id,
            item.poi.geometry_drive_file_id, JSON.stringify(geojson.geometry), item.poi.boundary_color, item.id
          ]);
          console.log(`Downloaded GeoJSON for linear feature: ${item.name}`);
        }
      });
    }

    // Create new linear features with parallel GeoJSON downloads
    if (newLinearPOIs.length > 0) {
      console.log(`Creating ${newLinearPOIs.length} new linear features with parallel downloads...`);

      await processInParallelBatches(newLinearPOIs, async (poi) => {
        const geojson = await downloadGeoJSONFromDrive(drive, poi.geometry_drive_file_id);
        if (geojson && geojson.geometry) {
          const result = await pool.query(`
            INSERT INTO pois (
              name, poi_type, geometry, geometry_drive_file_id, property_owner, brief_description,
              era, historical_description, primary_activities, surface,
              pets, cell_signal, more_info_link, events_url, news_url, length_miles, difficulty,
              image_drive_file_id, boundary_color, synced, locally_modified, deleted,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, TRUE, FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id
          `, [
            poi.name, poi.poi_type, JSON.stringify(geojson.geometry), poi.geometry_drive_file_id,
            poi.property_owner, poi.brief_description, poi.era, poi.historical_description,
            poi.primary_activities, poi.surface, poi.pets, poi.cell_signal,
            poi.more_info_link, poi.events_url, poi.news_url, poi.length_miles, poi.difficulty, poi.image_drive_file_id,
            poi.boundary_color
          ]);

          console.log(`Created linear feature from Drive: ${poi.name}`);

          // Queue image download for new feature
          if (poi.image_drive_file_id) {
            imageDownloads.push({ id: result.rows[0].id, name: poi.name, image_drive_file_id: poi.image_drive_file_id });
          }
        }
      });
    }

    // Download all images in parallel batches
    if (imageDownloads.length > 0) {
      console.log(`Downloading ${imageDownloads.length} linear POI images in parallel batches of ${PARALLEL_BATCH_SIZE}...`);

      await processInParallelBatches(imageDownloads, async (item) => {
        const imageBuffer = await downloadFileFromDrive(drive, item.image_drive_file_id);
        if (imageBuffer) {
          let mimeType = 'image/jpeg';
          if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) mimeType = 'image/png';
          else if (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49) mimeType = 'image/gif';
          else if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49) mimeType = 'image/webp';

          await pool.query(`
            UPDATE pois SET image_data = $1, image_mime_type = $2 WHERE id = $3
          `, [imageBuffer, mimeType, item.id]);

          // Invalidate thumbnail cache
          await pool.query('DELETE FROM thumbnail_cache WHERE poi_id = $1', [item.id]);

          console.log(`Downloaded image for linear feature: ${item.name}`);
        }
      });
    }
  } else if (linearPOIs.length > 0) {
    // No drive - just update metadata sequentially
    for (const poi of linearPOIs) {
      if (!poi.name) continue;

      const existing = await pool.query(
        'SELECT id FROM pois WHERE name = $1 AND poi_type = $2',
        [poi.name, poi.poi_type]
      );

      if (existing.rows.length > 0) {
        await pool.query(`
          UPDATE pois SET
            property_owner = $1, brief_description = $2, era = $3,
            historical_description = $4, primary_activities = $5, surface = $6,
            pets = $7, cell_signal = $8, more_info_link = $9,
            events_url = $10, news_url = $11,
            length_miles = $12, difficulty = $13, image_drive_file_id = $14,
            geometry_drive_file_id = $15, updated_at = CURRENT_TIMESTAMP,
            synced = TRUE, locally_modified = FALSE
          WHERE id = $16
        `, [
          poi.property_owner, poi.brief_description, poi.era,
          poi.historical_description, poi.primary_activities, poi.surface,
          poi.pets, poi.cell_signal, poi.more_info_link,
          poi.events_url, poi.news_url,
          poi.length_miles, poi.difficulty, poi.image_drive_file_id,
          poi.geometry_drive_file_id, existing.rows[0].id
        ]);
      }
    }
  }

  // Pull associations from sheets
  await pullAssociationsFromSheets(sheets, pool);

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_pull', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return pois.length;
}

/**
 * Process the sync queue - push pending changes to sheets
 * Also uploads GeoJSON to Drive for linear features (trails/rivers)
 * Parallelized for better performance with large queues
 */
export async function processSyncQueue(sheets, pool, drive = null) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  const result = await pool.query(`
    SELECT * FROM sync_queue ORDER BY created_at ASC
  `);

  const queue = result.rows;
  let processed = 0;
  const errors = [];

  if (queue.length === 0) {
    return { processed, errors };
  }

  console.log(`Processing ${queue.length} sync queue items...`);

  // Phase 1: Upload GeoJSON files for linear features in parallel batches
  if (drive) {
    const geoJsonUploads = [];

    for (const item of queue) {
      if (item.operation === 'DELETE') continue;
      if (item.table_name !== 'destinations' && item.table_name !== 'pois') continue;

      const poiResult = await pool.query('SELECT * FROM pois WHERE id = $1', [item.record_id]);
      if (poiResult.rows.length > 0) {
        const poi = poiResult.rows[0];
        if (poi.geometry && (poi.poi_type === 'trail' || poi.poi_type === 'river' || poi.poi_type === 'boundary')) {
          geoJsonUploads.push({ item, poi });
        }
      }
    }

    if (geoJsonUploads.length > 0) {
      console.log(`Uploading ${geoJsonUploads.length} GeoJSON files in parallel batches of ${PARALLEL_BATCH_SIZE}...`);

      await processInParallelBatches(geoJsonUploads, async ({ item, poi }) => {
        const safeName = poi.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const filename = `${poi.poi_type}-${safeName}`;

        const geojsonFeature = {
          type: 'Feature',
          properties: {
            name: poi.name,
            poi_type: poi.poi_type,
            brief_description: poi.brief_description,
            length_miles: poi.length_miles,
            difficulty: poi.difficulty
          },
          geometry: poi.geometry
        };

        const driveFileId = await uploadGeoJSONToDrive(drive, pool, filename, geojsonFeature);

        // Update database with Drive file ID if changed
        if (driveFileId !== poi.geometry_drive_file_id) {
          await pool.query(
            'UPDATE pois SET geometry_drive_file_id = $1 WHERE id = $2',
            [driveFileId, poi.id]
          );
          // Update data for sheet sync
          item.data.geometry_drive_file_id = driveFileId;
        }

        console.log(`Uploaded GeoJSON for ${poi.name} to Drive: ${driveFileId}`);
      });
    }

    // Phase 1b: Upload images for POIs that have local image data but no Drive file ID
    const imageUploads = [];

    for (const item of queue) {
      if (item.operation === 'DELETE') continue;
      if (item.table_name !== 'destinations' && item.table_name !== 'pois') continue;

      const poiResult = await pool.query('SELECT * FROM pois WHERE id = $1', [item.record_id]);
      if (poiResult.rows.length > 0) {
        const poi = poiResult.rows[0];
        if (poi.image_data && !poi.image_drive_file_id) {
          imageUploads.push({ item, poi });
        }
      }
    }

    if (imageUploads.length > 0) {
      console.log(`Uploading ${imageUploads.length} images to Drive...`);

      await processInParallelBatches(imageUploads, async ({ item, poi }) => {
        const safeName = poi.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const ext = poi.image_mime_type === 'image/png' ? 'png' :
                    poi.image_mime_type === 'image/gif' ? 'gif' :
                    poi.image_mime_type === 'image/webp' ? 'webp' : 'jpg';
        const filename = `${poi.poi_type}-${safeName}.${ext}`;

        const driveFileId = await uploadImageToDrive(drive, pool, filename, poi.image_data, poi.image_mime_type);

        // Update database with Drive file ID
        await pool.query(
          'UPDATE pois SET image_drive_file_id = $1 WHERE id = $2',
          [driveFileId, poi.id]
        );
        item.data.image_drive_file_id = driveFileId;

        console.log(`Uploaded image for ${poi.name} to Drive: ${driveFileId}`);
      });
    }
  }

  // Phase 2: Process Sheets operations in parallel batches
  // Group by operation type for better ordering (deletes first, then updates, then inserts)
  const deleteOps = queue.filter(i => i.operation === 'DELETE');
  const updateOps = queue.filter(i => i.operation === 'UPDATE');
  const insertOps = queue.filter(i => i.operation === 'INSERT');

  // Track which table types we've already synced (to avoid redundant pushes)
  const syncedTables = new Set();

  const processSheetOp = async (item) => {
    const data = item.data;

    if (item.table_name === 'destinations' || item.table_name === 'pois') {
      if (item.operation === 'INSERT') {
        await appendPOI(sheets, spreadsheetId, data);
      } else if (item.operation === 'UPDATE') {
        await updatePOI(sheets, spreadsheetId, data.name, data);
      } else if (item.operation === 'DELETE') {
        await deletePOI(sheets, spreadsheetId, data.name);
      }
      await pool.query(`
        UPDATE pois SET synced = TRUE, locally_modified = FALSE WHERE id = $1
      `, [item.record_id]);
    } else if (item.table_name === 'activities' && !syncedTables.has('activities')) {
      // For small reference tables, do a full push (more reliable than row-level updates)
      // Add to set BEFORE awaiting to prevent race conditions in parallel processing
      syncedTables.add('activities');
      await pushActivitiesToSheets(sheets, pool);
      console.log('Synced activities table to Google Sheets');
    } else if (item.table_name === 'eras' && !syncedTables.has('eras')) {
      syncedTables.add('eras');
      await pushErasToSheets(sheets, pool);
      console.log('Synced eras table to Google Sheets');
    } else if (item.table_name === 'surfaces' && !syncedTables.has('surfaces')) {
      syncedTables.add('surfaces');
      await pushSurfacesToSheets(sheets, pool);
      console.log('Synced surfaces table to Google Sheets');
    } else if (item.table_name === 'icons' && !syncedTables.has('icons')) {
      syncedTables.add('icons');
      await pushIconsToSheets(sheets, pool);
      console.log('Synced icons table to Google Sheets');
    } else if (item.table_name === 'settings' && !syncedTables.has('settings')) {
      syncedTables.add('settings');
      await pushIntegrationToSheets(sheets, pool);
      console.log('Synced settings (Integration) table to Google Sheets');
    }

    await pool.query('DELETE FROM sync_queue WHERE id = $1', [item.id]);
    return item.id;
  };

  // Process in order: deletes -> updates -> inserts, each in parallel batches
  for (const [opName, opQueue] of [['DELETE', deleteOps], ['UPDATE', updateOps], ['INSERT', insertOps]]) {
    if (opQueue.length > 0) {
      console.log(`Processing ${opQueue.length} ${opName} operations in parallel batches of ${PARALLEL_BATCH_SIZE}...`);

      const results = await processInParallelBatches(opQueue, async (item) => {
        try {
          await processSheetOp(item);
          return { success: true, id: item.id };
        } catch (error) {
          console.error(`Sync error for queue item ${item.id}:`, error.message);
          return { success: false, id: item.id, error: error.message };
        }
      });

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          processed++;
        } else if (result.status === 'fulfilled' && !result.value.success) {
          errors.push({ id: result.value.id, error: result.value.error });
        } else if (result.status === 'rejected') {
          errors.push({ id: 'unknown', error: result.reason?.message || 'Unknown error' });
        }
      }
    }
  }

  if (processed > 0) {
    await pool.query(`
      INSERT INTO sync_status (key, value, updated_at)
      VALUES ('last_sync', $1, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `, [new Date().toISOString()]);
  }

  return { processed, errors };
}

/**
 * Queue a sync operation for background processing
 */
export async function queueSyncOperation(pool, operation, tableName, recordId, data) {
  await pool.query(`
    INSERT INTO sync_queue (operation, table_name, record_id, data, created_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
  `, [operation, tableName, recordId, JSON.stringify(data)]);
}

/**
 * Get sync status information
 */
export async function getSyncStatus(pool) {
  const statusResult = await pool.query('SELECT * FROM sync_status');
  const queueResult = await pool.query('SELECT COUNT(*) as count FROM sync_queue');
  const unsyncedResult = await pool.query(`
    SELECT COUNT(*) as count FROM pois
    WHERE (synced IS NULL OR synced = FALSE)
    AND (deleted IS NULL OR deleted = FALSE)
  `);

  const status = {};
  for (const row of statusResult.rows) {
    status[row.key] = row.value;
  }

  return {
    last_sync: status.last_sync || null,
    last_push: status.last_push || null,
    last_pull: status.last_pull || null,
    spreadsheet_created: status.spreadsheet_created || null,
    pending_operations: parseInt(queueResult.rows[0].count),
    unsynced_destinations: parseInt(unsyncedResult.rows[0].count)
  };
}

/**
 * Check if database has any destinations
 */
export async function isDatabaseEmpty(pool) {
  const result = await pool.query('SELECT COUNT(*) as count FROM pois');
  return parseInt(result.rows[0].count) === 0;
}

/**
 * Get spreadsheet info for display
 */
export async function getSpreadsheetInfo(pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    return {
      configured: false,
      source: {
        id: SOURCE_SPREADSHEET_ID,
        name: SOURCE_SHEET_NAME,
        url: `https://docs.google.com/spreadsheets/d/${SOURCE_SPREADSHEET_ID}`
      }
    };
  }

  return {
    configured: true,
    id: spreadsheetId,
    name: 'Roots of The Valley - Destinations',
    sheetName: APP_SHEET_NAME,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    source: {
      id: SOURCE_SPREADSHEET_ID,
      name: SOURCE_SHEET_NAME,
      url: `https://docs.google.com/spreadsheets/d/${SOURCE_SPREADSHEET_ID}`
    }
  };
}

// ============================================
// Activities Sync Functions
// ============================================

/**
 * Convert a spreadsheet row to an activity object
 */
function rowToActivity(row) {
  return {
    name: row[ACTIVITIES_COLUMNS.name] || '',
    sort_order: parseInt(row[ACTIVITIES_COLUMNS.sort_order]) || 0
  };
}

/**
 * Convert an activity object to a spreadsheet row
 */
function activityToRow(activity) {
  return [
    activity.name || '',
    activity.sort_order || 0
  ];
}

/**
 * Read all activities from the Activities sheet
 */
export async function readActivities(sheets, spreadsheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${ACTIVITIES_SHEET_NAME}'!A2:B`,
    });

    const rows = response.data.values || [];
    return rows
      .map(rowToActivity)
      .filter(a => a.name && a.name !== 'Name');
  } catch (error) {
    // If sheet doesn't exist, return empty array
    if (error.message?.includes('Unable to parse range')) {
      return [];
    }
    throw error;
  }
}

/**
 * Push all activities from database to the spreadsheet
 */
export async function pushActivitiesToSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  // Ensure Activities sheet exists
  await ensureActivitiesSheet(sheets, spreadsheetId);

  const result = await pool.query(`
    SELECT name, sort_order FROM activities
    ORDER BY sort_order, name
  `);

  const activities = result.rows;

  // Clear existing data (keep header)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${ACTIVITIES_SHEET_NAME}'!A2:B`,
    });
  } catch (error) {
    // Ignore if sheet is empty
  }

  // Write all activities
  if (activities.length > 0) {
    const rows = activities.map(activityToRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${ACTIVITIES_SHEET_NAME}'!A2:B`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_activities_push', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return activities.length;
}

/**
 * Pull all activities from the spreadsheet to database
 */
export async function pullActivitiesFromSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  const activities = await readActivities(sheets, spreadsheetId);

  // Clear local activities
  await pool.query('DELETE FROM activities');

  // Insert all from sheets
  for (const activity of activities) {
    if (!activity.name) continue;

    await pool.query(`
      INSERT INTO activities (name, sort_order, created_at, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP
    `, [activity.name, activity.sort_order]);
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_activities_pull', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return activities.length;
}

/**
 * Ensure the Activities sheet exists in the spreadsheet
 */
async function ensureActivitiesSheet(sheets, spreadsheetId) {
  console.log(`Ensuring Activities sheet exists in spreadsheet ${spreadsheetId}`);
  try {
    // Check if Activities sheet exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
    console.log('Existing sheets:', sheetNames);

    const activitiesSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === ACTIVITIES_SHEET_NAME
    );

    if (!activitiesSheet) {
      console.log(`Activities sheet "${ACTIVITIES_SHEET_NAME}" not found, creating...`);
      // Create the Activities sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: ACTIVITIES_SHEET_NAME,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      console.log('Activities sheet created successfully');

      // Add headers
      console.log('Adding headers to Activities sheet...');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${ACTIVITIES_SHEET_NAME}'!A1:B1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [ACTIVITIES_HEADERS]
        }
      });
      console.log('Headers added');

      // Format header
      const updatedSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const newSheet = updatedSpreadsheet.data.sheets.find(
        s => s.properties.title === ACTIVITIES_SHEET_NAME
      );

      if (newSheet) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              repeatCell: {
                range: {
                  sheetId: newSheet.properties.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.3, green: 0.2, blue: 0.5 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }]
          }
        });
      }
      console.log('Activities sheet setup complete');
    } else {
      console.log('Activities sheet already exists');
    }
  } catch (error) {
    console.error('Error ensuring Activities sheet:', error.message);
    throw error;
  }
}

// ============================================
// Eras Sync Functions
// ============================================

/**
 * Convert a spreadsheet row to an era object
 */
function rowToEra(row) {
  return {
    name: row[ERAS_COLUMNS.name] || '',
    year_start: row[ERAS_COLUMNS.year_start] ? parseInt(row[ERAS_COLUMNS.year_start]) : null,
    year_end: row[ERAS_COLUMNS.year_end] ? parseInt(row[ERAS_COLUMNS.year_end]) : null,
    description: row[ERAS_COLUMNS.description] || null,
    sort_order: parseInt(row[ERAS_COLUMNS.sort_order]) || 0
  };
}

/**
 * Convert an era object to a spreadsheet row
 */
function eraToRow(era) {
  return [
    era.name || '',
    era.year_start || '',
    era.year_end || '',
    era.description || '',
    era.sort_order || 0
  ];
}

/**
 * Read all eras from the Eras sheet
 */
export async function readEras(sheets, spreadsheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${ERAS_SHEET_NAME}'!A2:E`,
    });

    const rows = response.data.values || [];
    return rows
      .map(rowToEra)
      .filter(e => e.name && e.name !== 'Name');
  } catch (error) {
    // If sheet doesn't exist, return empty array
    if (error.message?.includes('Unable to parse range')) {
      return [];
    }
    throw error;
  }
}

/**
 * Push all eras from database to the spreadsheet
 */
export async function pushErasToSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  // Ensure Eras sheet exists
  await ensureErasSheet(sheets, spreadsheetId);

  const result = await pool.query(`
    SELECT name, year_start, year_end, description, sort_order FROM eras
    ORDER BY sort_order, name
  `);

  const eras = result.rows;

  // Clear existing data (keep header)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${ERAS_SHEET_NAME}'!A2:E`,
    });
  } catch (error) {
    // Ignore if sheet is empty
  }

  // Write all eras
  if (eras.length > 0) {
    const rows = eras.map(eraToRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${ERAS_SHEET_NAME}'!A2:E`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_eras_push', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return eras.length;
}

/**
 * Pull all eras from the spreadsheet to database
 */
export async function pullErasFromSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  const eras = await readEras(sheets, spreadsheetId);

  // Clear local eras
  await pool.query('DELETE FROM eras');

  // Insert all from sheets
  for (const era of eras) {
    if (!era.name) continue;

    await pool.query(`
      INSERT INTO eras (name, year_start, year_end, description, sort_order, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET
        year_start = EXCLUDED.year_start,
        year_end = EXCLUDED.year_end,
        description = EXCLUDED.description,
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP
    `, [era.name, era.year_start, era.year_end, era.description, era.sort_order]);
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_eras_pull', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return eras.length;
}

/**
 * Ensure the Eras sheet exists in the spreadsheet
 */
async function ensureErasSheet(sheets, spreadsheetId) {
  console.log(`Ensuring Eras sheet exists in spreadsheet ${spreadsheetId}`);
  try {
    // Check if Eras sheet exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
    console.log('Existing sheets:', sheetNames);

    const erasSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === ERAS_SHEET_NAME
    );

    if (!erasSheet) {
      console.log(`Eras sheet "${ERAS_SHEET_NAME}" not found, creating...`);
      // Create the Eras sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: ERAS_SHEET_NAME,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      console.log('Eras sheet created successfully');

      // Add headers
      console.log('Adding headers to Eras sheet...');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${ERAS_SHEET_NAME}'!A1:E1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [ERAS_HEADERS]
        }
      });
      console.log('Headers added');

      // Format header
      const updatedSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const newSheet = updatedSpreadsheet.data.sheets.find(
        s => s.properties.title === ERAS_SHEET_NAME
      );

      if (newSheet) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              repeatCell: {
                range: {
                  sheetId: newSheet.properties.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.6, green: 0.4, blue: 0.2 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }]
          }
        });
      }
      console.log('Eras sheet setup complete');
    } else {
      console.log('Eras sheet already exists');
    }
  } catch (error) {
    console.error('Error ensuring Eras sheet:', error.message);
    throw error;
  }
}

// ============================================
// Surfaces Sync Functions
// ============================================

/**
 * Convert a spreadsheet row to a surface object
 */
function rowToSurface(row) {
  return {
    name: row[SURFACES_COLUMNS.name] || '',
    description: row[SURFACES_COLUMNS.description] || null,
    sort_order: parseInt(row[SURFACES_COLUMNS.sort_order]) || 0
  };
}

/**
 * Convert a surface object to a spreadsheet row
 */
function surfaceToRow(surface) {
  return [
    surface.name || '',
    surface.description || '',
    surface.sort_order || 0
  ];
}

/**
 * Read all surfaces from the Surfaces sheet
 */
export async function readSurfaces(sheets, spreadsheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SURFACES_SHEET_NAME}'!A2:C`,
    });

    const rows = response.data.values || [];
    return rows
      .map(rowToSurface)
      .filter(s => s.name && s.name !== 'Name');
  } catch (error) {
    // If sheet doesn't exist, return empty array
    if (error.message?.includes('Unable to parse range')) {
      return [];
    }
    throw error;
  }
}

/**
 * Push all surfaces from database to the spreadsheet
 */
export async function pushSurfacesToSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  // Ensure Surfaces sheet exists
  await ensureSurfacesSheet(sheets, spreadsheetId);

  const result = await pool.query(`
    SELECT name, description, sort_order FROM surfaces
    ORDER BY sort_order, name
  `);

  const surfaces = result.rows;

  // Clear existing data (keep header)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${SURFACES_SHEET_NAME}'!A2:C`,
    });
  } catch (error) {
    // Ignore if sheet is empty
  }

  // Write all surfaces
  if (surfaces.length > 0) {
    const rows = surfaces.map(surfaceToRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SURFACES_SHEET_NAME}'!A2:C`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_surfaces_push', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return surfaces.length;
}

/**
 * Pull all surfaces from the spreadsheet to database
 */
export async function pullSurfacesFromSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  const surfaces = await readSurfaces(sheets, spreadsheetId);

  // Clear local surfaces
  await pool.query('DELETE FROM surfaces');

  // Insert all from sheets
  for (const surface of surfaces) {
    if (!surface.name) continue;

    await pool.query(`
      INSERT INTO surfaces (name, description, sort_order, created_at, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP
    `, [surface.name, surface.description, surface.sort_order]);
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_surfaces_pull', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return surfaces.length;
}

/**
 * Ensure the Surfaces sheet exists in the spreadsheet
 */
async function ensureSurfacesSheet(sheets, spreadsheetId) {
  console.log(`Ensuring Surfaces sheet exists in spreadsheet ${spreadsheetId}`);
  try {
    // Check if Surfaces sheet exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
    console.log('Existing sheets:', sheetNames);

    const surfacesSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === SURFACES_SHEET_NAME
    );

    if (!surfacesSheet) {
      console.log(`Surfaces sheet "${SURFACES_SHEET_NAME}" not found, creating...`);
      // Create the Surfaces sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: SURFACES_SHEET_NAME,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      console.log('Surfaces sheet created successfully');

      // Add headers
      console.log('Adding headers to Surfaces sheet...');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SURFACES_SHEET_NAME}'!A1:C1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [SURFACES_HEADERS]
        }
      });
      console.log('Headers added');

      // Format header
      const updatedSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const newSheet = updatedSpreadsheet.data.sheets.find(
        s => s.properties.title === SURFACES_SHEET_NAME
      );

      if (newSheet) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              repeatCell: {
                range: {
                  sheetId: newSheet.properties.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.5, blue: 0.5 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }]
          }
        });
      }
      console.log('Surfaces sheet setup complete');
    } else {
      console.log('Surfaces sheet already exists');
    }
  } catch (error) {
    console.error('Error ensuring Surfaces sheet:', error.message);
    throw error;
  }
}

// ============================================
// Icons Sync Functions
// ============================================

/**
 * Convert a spreadsheet row to an icon object
 */
function rowToIcon(row) {
  return {
    name: row[ICONS_COLUMNS.name] || '',
    label: row[ICONS_COLUMNS.label] || '',
    svg_filename: row[ICONS_COLUMNS.svg_filename] || null,
    title_keywords: row[ICONS_COLUMNS.title_keywords] || null,
    activity_fallbacks: row[ICONS_COLUMNS.activity_fallbacks] || null,
    sort_order: parseInt(row[ICONS_COLUMNS.sort_order]) || 0,
    enabled: row[ICONS_COLUMNS.enabled] !== 'FALSE' && row[ICONS_COLUMNS.enabled] !== 'false',
    drive_file_id: row[ICONS_COLUMNS.drive_file_id] || null
  };
}

/**
 * Convert an icon object to a spreadsheet row
 */
function iconToRow(icon) {
  return [
    icon.name || '',
    icon.label || '',
    icon.svg_filename || '',
    icon.title_keywords || '',
    icon.activity_fallbacks || '',
    icon.sort_order || 0,
    icon.enabled ? 'TRUE' : 'FALSE',
    icon.drive_file_id || ''
  ];
}

/**
 * Read all icons from the Icons sheet
 */
export async function readIcons(sheets, spreadsheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${ICONS_SHEET_NAME}'!A2:H`,
    });

    const rows = response.data.values || [];
    return rows
      .map(rowToIcon)
      .filter(i => i.name && i.name !== 'Name');
  } catch (error) {
    // If sheet doesn't exist, return empty array
    if (error.message?.includes('Unable to parse range')) {
      return [];
    }
    throw error;
  }
}

/**
 * Push all icons from database to the spreadsheet
 */
export async function pushIconsToSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  // Ensure Icons sheet exists
  await ensureIconsSheet(sheets, spreadsheetId);

  const result = await pool.query(`
    SELECT name, label, svg_filename, title_keywords, activity_fallbacks, sort_order, enabled, drive_file_id FROM icons
    ORDER BY sort_order, name
  `);

  const icons = result.rows;

  // Clear existing data (keep header)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${ICONS_SHEET_NAME}'!A2:H`,
    });
  } catch (error) {
    // Ignore if sheet is empty
  }

  // Write all icons
  if (icons.length > 0) {
    const rows = icons.map(iconToRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${ICONS_SHEET_NAME}'!A2:H`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_icons_push', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return icons.length;
}

/**
 * Pull all icons from the spreadsheet to database
 * If drive is provided, downloads SVG content from Google Drive for icons with drive_file_id
 */
export async function pullIconsFromSheets(sheets, pool, drive = null) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  const icons = await readIcons(sheets, spreadsheetId);

  // Clear local icons
  await pool.query('DELETE FROM icons');

  // Insert all from sheets
  for (const icon of icons) {
    if (!icon.name) continue;

    // If drive_file_id exists and drive is available, download SVG content
    let svgContent = null;
    if (icon.drive_file_id && drive) {
      try {
        const buffer = await downloadFileFromDrive(drive, icon.drive_file_id);
        if (buffer) {
          svgContent = buffer.toString('utf-8');
          console.log(`Downloaded SVG for icon: ${icon.name}`);
        }
      } catch (error) {
        console.warn(`Failed to download icon ${icon.name} from Drive:`, error.message);
      }
    }

    await pool.query(`
      INSERT INTO icons (name, label, svg_filename, title_keywords, activity_fallbacks, sort_order, enabled, drive_file_id, svg_content, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET
        label = EXCLUDED.label,
        svg_filename = EXCLUDED.svg_filename,
        title_keywords = EXCLUDED.title_keywords,
        activity_fallbacks = EXCLUDED.activity_fallbacks,
        sort_order = EXCLUDED.sort_order,
        enabled = EXCLUDED.enabled,
        drive_file_id = EXCLUDED.drive_file_id,
        svg_content = EXCLUDED.svg_content,
        updated_at = CURRENT_TIMESTAMP
    `, [icon.name, icon.label, icon.svg_filename, icon.title_keywords, icon.activity_fallbacks, icon.sort_order, icon.enabled, icon.drive_file_id, svgContent]);
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_icons_pull', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return icons.length;
}

/**
 * Ensure the Icons sheet exists with proper headers
 */
export async function ensureIconsSheet(sheets, spreadsheetId) {
  try {
    // Get existing sheets
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    console.log('Existing sheets:', existingSheets);

    // Create Icons sheet if it doesn't exist
    if (!existingSheets.includes(ICONS_SHEET_NAME)) {
      console.log('Creating Icons sheet...');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: ICONS_SHEET_NAME,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      console.log('Icons sheet created successfully');

      // Add headers
      console.log('Adding headers to Icons sheet...');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${ICONS_SHEET_NAME}'!A1:G1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [ICONS_HEADERS]
        }
      });
      console.log('Headers added');

      // Format header
      const updatedSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const newSheet = updatedSpreadsheet.data.sheets.find(
        s => s.properties.title === ICONS_SHEET_NAME
      );

      if (newSheet) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              repeatCell: {
                range: {
                  sheetId: newSheet.properties.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.4, blue: 0.6 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }]
          }
        });
      }
      console.log('Icons sheet setup complete');
    } else {
      console.log('Icons sheet already exists');
    }
  } catch (error) {
    console.error('Error ensuring Icons sheet:', error.message);
    throw error;
  }
}

// ============================================
// Integration Settings Sync Functions
// ============================================

/**
 * Push integration settings (API keys, Drive folder IDs, etc.) to the spreadsheet
 */
export async function pushIntegrationToSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  // Ensure Integration sheet exists
  await ensureIntegrationSheet(sheets, spreadsheetId);

  // Get settings from admin_settings table
  const adminResult = await pool.query(`
    SELECT key, value, updated_at FROM admin_settings
    WHERE key IN ('gemini_api_key', 'gemini_prompt_brief', 'gemini_prompt_historical')
    ORDER BY key
  `);

  // Get Drive settings (folder IDs)
  const driveResult = await pool.query(`
    SELECT key, value, updated_at FROM drive_settings
    ORDER BY key
  `);

  // Combine both settings
  const settings = [...adminResult.rows, ...driveResult.rows];

  // Clear existing data (keep header)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${INTEGRATION_SHEET_NAME}'!A2:C`,
    });
  } catch (error) {
    // Ignore if sheet is empty
  }

  // Write all settings (including API keys - this is the user's private spreadsheet)
  if (settings.length > 0) {
    const rows = settings.map(s => [
      s.key,
      s.value || '',
      s.updated_at ? new Date(s.updated_at).toISOString() : ''
    ]);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${INTEGRATION_SHEET_NAME}'!A2:C`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  return settings.length;
}

/**
 * Pull integration settings (API keys, etc.) from the spreadsheet
 */
export async function pullIntegrationFromSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${INTEGRATION_SHEET_NAME}'!A2:C`,
    });

    const rows = response.data.values || [];
    let restored = 0;

    for (const row of rows) {
      const key = row[INTEGRATION_COLUMNS.setting];
      const value = row[INTEGRATION_COLUMNS.value];

      if (!key || !value) continue;

      // Restore admin settings
      if (['gemini_api_key', 'gemini_prompt_brief', 'gemini_prompt_historical'].includes(key)) {
        await pool.query(`
          INSERT INTO admin_settings (key, value, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = CURRENT_TIMESTAMP
        `, [key, value]);
        restored++;
        console.log(`Restored setting: ${key}`);
      }

      // Restore Drive settings (folder IDs)
      if (['root_folder_id', 'icons_folder_id', 'images_folder_id', 'geospatial_folder_id'].includes(key)) {
        await setDriveSetting(pool, key, value);
        restored++;
        console.log(`Restored Drive setting: ${key}`);
      }
    }

    // Update sync status
    await pool.query(`
      INSERT INTO sync_status (key, value, updated_at)
      VALUES ('last_integration_pull', $1, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `, [new Date().toISOString()]);

    return restored;
  } catch (error) {
    // If sheet doesn't exist, return 0
    if (error.message?.includes('Unable to parse range')) {
      return 0;
    }
    throw error;
  }
}

/**
 * Ensure the Integration sheet exists with proper headers
 */
export async function ensureIntegrationSheet(sheets, spreadsheetId) {
  try {
    // Get existing sheets
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    // Create Integration sheet if it doesn't exist
    if (!existingSheets.includes(INTEGRATION_SHEET_NAME)) {
      console.log('Creating Integration sheet...');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: INTEGRATION_SHEET_NAME,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      console.log('Integration sheet created successfully');

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${INTEGRATION_SHEET_NAME}'!A1:C1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [INTEGRATION_HEADERS]
        }
      });

      // Format header
      const updatedSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const newSheet = updatedSpreadsheet.data.sheets.find(
        s => s.properties.title === INTEGRATION_SHEET_NAME
      );

      if (newSheet) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              repeatCell: {
                range: {
                  sheetId: newSheet.properties.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.5, green: 0.5, blue: 0.5 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }]
          }
        });
      }
      console.log('Integration sheet setup complete');
    }
  } catch (error) {
    console.error('Error ensuring Integration sheet:', error.message);
    throw error;
  }
}

// ============================================
// NEWS SHEET SYNC FUNCTIONS
// ============================================

/**
 * Convert a news row from the spreadsheet to an object
 */
function rowToNews(row) {
  return {
    id: row[NEWS_COLUMNS.id] ? parseInt(row[NEWS_COLUMNS.id]) : null,
    poi_id: row[NEWS_COLUMNS.poi_id] ? parseInt(row[NEWS_COLUMNS.poi_id]) : null,
    poi_name: row[NEWS_COLUMNS.poi_name] || '',
    title: row[NEWS_COLUMNS.title] || '',
    summary: row[NEWS_COLUMNS.summary] || null,
    source_url: row[NEWS_COLUMNS.source_url] || null,
    source_name: row[NEWS_COLUMNS.source_name] || null,
    news_type: row[NEWS_COLUMNS.news_type] || 'general',
    published_at: row[NEWS_COLUMNS.published_at] || null
  };
}

/**
 * Convert a news object to a spreadsheet row
 */
function newsToRow(news) {
  return [
    news.id || '',
    news.poi_id || '',
    news.poi_name || '',
    news.title || '',
    news.summary || '',
    news.source_url || '',
    news.source_name || '',
    news.news_type || 'general',
    news.published_at ? new Date(news.published_at).toISOString().split('T')[0] : ''
  ];
}

/**
 * Ensure the News sheet exists in the spreadsheet
 */
async function ensureNewsSheet(sheets, spreadsheetId) {
  console.log(`Ensuring News sheet exists in spreadsheet ${spreadsheetId}`);
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);

    const newsSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === NEWS_SHEET_NAME
    );

    if (!newsSheet) {
      console.log(`News sheet "${NEWS_SHEET_NAME}" not found, creating...`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: NEWS_SHEET_NAME,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${NEWS_SHEET_NAME}'!A1:I1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [NEWS_HEADERS]
        }
      });
      console.log('News sheet created with headers');
    }
  } catch (error) {
    console.error('Error ensuring News sheet:', error.message);
    throw error;
  }
}

/**
 * Push all news to the spreadsheet
 */
export async function pushNewsToSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  await ensureNewsSheet(sheets, spreadsheetId);

  const result = await pool.query(`
    SELECT n.id, n.poi_id, p.name as poi_name, n.title, n.summary,
           n.source_url, n.source_name, n.news_type, n.published_at
    FROM poi_news n
    JOIN pois p ON n.poi_id = p.id
    ORDER BY n.published_at DESC NULLS LAST, n.created_at DESC
  `);

  const news = result.rows;

  // Clear existing data (keep header)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${NEWS_SHEET_NAME}'!A2:I`,
    });
  } catch (error) {
    // Ignore if sheet is empty
  }

  // Write all news
  if (news.length > 0) {
    const rows = news.map(newsToRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${NEWS_SHEET_NAME}'!A2:I`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_news_push', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return news.length;
}

/**
 * Pull all news from the spreadsheet to database
 */
export async function pullNewsFromSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  // Read news from sheet
  let rows = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${NEWS_SHEET_NAME}'!A2:I`,
    });
    rows = response.data.values || [];
  } catch (error) {
    console.log('News sheet may not exist yet:', error.message);
    return 0;
  }

  const newsItems = rows.map(rowToNews).filter(n => n.title && n.poi_id);

  // Upsert news items - update if exists, insert if not
  // IMPORTANT: Look up POI by name since IDs differ between environments
  let count = 0;
  for (const news of newsItems) {
    if (!news.title) continue;

    // Look up the local POI ID by name (IDs from sheet may be from different environment)
    let localPoiId = null;
    if (news.poi_name) {
      const poiResult = await pool.query('SELECT id FROM pois WHERE name = $1', [news.poi_name]);
      if (poiResult.rows.length > 0) {
        localPoiId = poiResult.rows[0].id;
      }
    }

    // Skip if we can't find the POI locally
    if (!localPoiId) {
      console.log(`Skipping news "${news.title}" - POI "${news.poi_name}" not found locally`);
      continue;
    }

    // Check for existing record by title and local POI ID
    let existingId = null;
    const byKey = await pool.query(
      'SELECT id FROM poi_news WHERE poi_id = $1 AND title = $2',
      [localPoiId, news.title]
    );
    if (byKey.rows.length > 0) {
      existingId = byKey.rows[0].id;
    }

    if (existingId) {
      // Update existing
      await pool.query(`
        UPDATE poi_news SET
          title = $1, summary = $2, source_url = $3, source_name = $4,
          news_type = $5, published_at = $6
        WHERE id = $7
      `, [news.title, news.summary, news.source_url, news.source_name,
          news.news_type, news.published_at, existingId]);
    } else {
      // Insert new
      await pool.query(`
        INSERT INTO poi_news (poi_id, title, summary, source_url, source_name, news_type, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [localPoiId, news.title, news.summary, news.source_url,
          news.source_name, news.news_type, news.published_at]);
    }
    count++;
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_news_pull', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return count;
}

// ============================================
// EVENTS SHEET SYNC FUNCTIONS
// ============================================

/**
 * Convert an event row from the spreadsheet to an object
 */
function rowToEvent(row) {
  return {
    id: row[EVENTS_COLUMNS.id] ? parseInt(row[EVENTS_COLUMNS.id]) : null,
    poi_id: row[EVENTS_COLUMNS.poi_id] ? parseInt(row[EVENTS_COLUMNS.poi_id]) : null,
    poi_name: row[EVENTS_COLUMNS.poi_name] || '',
    title: row[EVENTS_COLUMNS.title] || '',
    description: row[EVENTS_COLUMNS.description] || null,
    start_date: row[EVENTS_COLUMNS.start_date] || null,
    end_date: row[EVENTS_COLUMNS.end_date] || null,
    event_type: row[EVENTS_COLUMNS.event_type] || 'program',
    location_details: row[EVENTS_COLUMNS.location_details] || null,
    source_url: row[EVENTS_COLUMNS.source_url] || null
  };
}

/**
 * Convert an event object to a spreadsheet row
 */
function eventToRow(event) {
  return [
    event.id || '',
    event.poi_id || '',
    event.poi_name || '',
    event.title || '',
    event.description || '',
    event.start_date ? new Date(event.start_date).toISOString().split('T')[0] : '',
    event.end_date ? new Date(event.end_date).toISOString().split('T')[0] : '',
    event.event_type || 'program',
    event.location_details || '',
    event.source_url || ''
  ];
}

/**
 * Ensure the Events sheet exists in the spreadsheet
 */
async function ensureEventsSheet(sheets, spreadsheetId) {
  console.log(`Ensuring Events sheet exists in spreadsheet ${spreadsheetId}`);
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);

    const eventsSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === EVENTS_SHEET_NAME
    );

    if (!eventsSheet) {
      console.log(`Events sheet "${EVENTS_SHEET_NAME}" not found, creating...`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: EVENTS_SHEET_NAME,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${EVENTS_SHEET_NAME}'!A1:J1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [EVENTS_HEADERS]
        }
      });
      console.log('Events sheet created with headers');
    }
  } catch (error) {
    console.error('Error ensuring Events sheet:', error.message);
    throw error;
  }
}

/**
 * Push all events to the spreadsheet
 */
export async function pushEventsToSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  await ensureEventsSheet(sheets, spreadsheetId);

  const result = await pool.query(`
    SELECT e.id, e.poi_id, p.name as poi_name, e.title, e.description,
           e.start_date, e.end_date, e.event_type, e.location_details, e.source_url
    FROM poi_events e
    JOIN pois p ON e.poi_id = p.id
    ORDER BY e.start_date ASC NULLS LAST
  `);

  const events = result.rows;

  // Clear existing data (keep header)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${EVENTS_SHEET_NAME}'!A2:J`,
    });
  } catch (error) {
    // Ignore if sheet is empty
  }

  // Write all events
  if (events.length > 0) {
    const rows = events.map(eventToRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${EVENTS_SHEET_NAME}'!A2:J`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_events_push', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return events.length;
}

/**
 * Pull all events from the spreadsheet to database
 */
export async function pullEventsFromSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  // Read events from sheet
  let rows = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${EVENTS_SHEET_NAME}'!A2:J`,
    });
    rows = response.data.values || [];
  } catch (error) {
    console.log('Events sheet may not exist yet:', error.message);
    return 0;
  }

  const eventItems = rows.map(rowToEvent).filter(e => e.title && e.poi_id);

  // Upsert events - update if exists, insert if not
  // IMPORTANT: Look up POI by name since IDs differ between environments
  let count = 0;
  for (const event of eventItems) {
    if (!event.title || !event.start_date) continue;

    // Look up the local POI ID by name (IDs from sheet may be from different environment)
    let localPoiId = null;
    if (event.poi_name) {
      const poiResult = await pool.query('SELECT id FROM pois WHERE name = $1', [event.poi_name]);
      if (poiResult.rows.length > 0) {
        localPoiId = poiResult.rows[0].id;
      }
    }

    // Skip if we can't find the POI locally
    if (!localPoiId) {
      console.log(`Skipping event "${event.title}" - POI "${event.poi_name}" not found locally`);
      continue;
    }

    // Check for existing record by title, local POI ID, and start_date
    let existingId = null;
    const byKey = await pool.query(
      'SELECT id FROM poi_events WHERE poi_id = $1 AND title = $2 AND start_date = $3',
      [localPoiId, event.title, event.start_date]
    );
    if (byKey.rows.length > 0) {
      existingId = byKey.rows[0].id;
    }

    if (existingId) {
      // Update existing
      await pool.query(`
        UPDATE poi_events SET
          title = $1, description = $2, start_date = $3, end_date = $4,
          event_type = $5, location_details = $6, source_url = $7
        WHERE id = $8
      `, [event.title, event.description, event.start_date, event.end_date,
          event.event_type, event.location_details, event.source_url, existingId]);
    } else {
      // Insert new
      await pool.query(`
        INSERT INTO poi_events (poi_id, title, description, start_date, end_date, event_type, location_details, source_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [localPoiId, event.title, event.description, event.start_date,
          event.end_date, event.event_type, event.location_details, event.source_url]);
    }
    count++;
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_events_pull', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return count;
}

/**
 * Convert a spreadsheet row to a POI association object
 */
function rowToAssociation(row) {
  return {
    id: row[POI_ASSOCIATIONS_COLUMNS.id] ? parseInt(row[POI_ASSOCIATIONS_COLUMNS.id]) : null,
    virtual_poi_name: row[POI_ASSOCIATIONS_COLUMNS.virtual_poi_name] || '',
    physical_poi_name: row[POI_ASSOCIATIONS_COLUMNS.physical_poi_name] || '',
    association_type: row[POI_ASSOCIATIONS_COLUMNS.association_type] || 'manages'
  };
}

/**
 * Convert a POI association object to a spreadsheet row
 */
function associationToRow(assoc) {
  return [
    assoc.id || '',
    assoc.virtual_poi_name || '',
    assoc.physical_poi_name || '',
    assoc.association_type || 'manages'
  ];
}

/**
 * Ensure POI Associations sheet exists with proper headers
 */
async function ensureAssociationsSheet(sheets, spreadsheetId) {
  console.log(`Ensuring POI Associations sheet exists in spreadsheet ${spreadsheetId}`);
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

    const associationsSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === POI_ASSOCIATIONS_SHEET_NAME
    );

    if (!associationsSheet) {
      console.log(`POI Associations sheet "${POI_ASSOCIATIONS_SHEET_NAME}" not found, creating...`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: POI_ASSOCIATIONS_SHEET_NAME,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${POI_ASSOCIATIONS_SHEET_NAME}'!A1:D1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [POI_ASSOCIATIONS_HEADERS]
        }
      });
      console.log('POI Associations sheet created with headers');
    }
  } catch (error) {
    console.error('Error ensuring POI Associations sheet:', error.message);
    throw error;
  }
}

/**
 * Push all POI associations to the spreadsheet
 */
export async function pushAssociationsToSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  await ensureAssociationsSheet(sheets, spreadsheetId);

  const result = await pool.query(`
    SELECT a.id, a.association_type,
           vp.name as virtual_poi_name,
           pp.name as physical_poi_name
    FROM poi_associations a
    JOIN pois vp ON a.virtual_poi_id = vp.id
    JOIN pois pp ON a.physical_poi_id = pp.id
    WHERE (vp.deleted IS NULL OR vp.deleted = FALSE)
      AND (pp.deleted IS NULL OR pp.deleted = FALSE)
    ORDER BY vp.name, pp.name
  `);

  const associations = result.rows;

  // Clear existing data (keep header)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${POI_ASSOCIATIONS_SHEET_NAME}'!A2:D`,
    });
  } catch (error) {
    // Ignore if sheet is empty
  }

  // Write all associations
  if (associations.length > 0) {
    const rows = associations.map(associationToRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${POI_ASSOCIATIONS_SHEET_NAME}'!A2:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows
      }
    });
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_associations_push', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return associations.length;
}

/**
 * Pull all POI associations from the spreadsheet to database
 */
export async function pullAssociationsFromSheets(sheets, pool) {
  const spreadsheetId = await getSpreadsheetId(pool);
  if (!spreadsheetId) {
    throw new Error('No spreadsheet configured. Please create a spreadsheet first.');
  }

  // Read associations from sheet
  let rows = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${POI_ASSOCIATIONS_SHEET_NAME}'!A2:D`,
    });
    rows = response.data.values || [];
  } catch (error) {
    console.log('POI Associations sheet may not exist yet:', error.message);
    return 0;
  }

  const associations = rows.map(rowToAssociation).filter(a => a.virtual_poi_name && a.physical_poi_name);

  // Clear existing associations
  await pool.query('DELETE FROM poi_associations');

  // Insert associations from sheets
  // IMPORTANT: Look up POI IDs by name since IDs differ between environments
  let count = 0;
  for (const assoc of associations) {
    if (!assoc.virtual_poi_name || !assoc.physical_poi_name) continue;

    // Look up virtual POI by name
    const virtualPoiResult = await pool.query(
      'SELECT id FROM pois WHERE name = $1 AND poi_type = $2 AND (deleted IS NULL OR deleted = FALSE)',
      [assoc.virtual_poi_name, 'virtual']
    );

    if (virtualPoiResult.rows.length === 0) {
      console.warn(`Virtual POI not found: ${assoc.virtual_poi_name}`);
      continue;
    }

    const virtualPoiId = virtualPoiResult.rows[0].id;

    // Look up physical POI by name
    const physicalPoiResult = await pool.query(
      'SELECT id FROM pois WHERE name = $1 AND (deleted IS NULL OR deleted = FALSE)',
      [assoc.physical_poi_name]
    );

    if (physicalPoiResult.rows.length === 0) {
      console.warn(`Physical POI not found: ${assoc.physical_poi_name}`);
      continue;
    }

    const physicalPoiId = physicalPoiResult.rows[0].id;

    // Insert association
    await pool.query(`
      INSERT INTO poi_associations (virtual_poi_id, physical_poi_id, association_type)
      VALUES ($1, $2, $3)
      ON CONFLICT (virtual_poi_id, physical_poi_id) DO UPDATE
      SET association_type = EXCLUDED.association_type, updated_at = CURRENT_TIMESTAMP
    `, [virtualPoiId, physicalPoiId, assoc.association_type || 'manages']);

    count++;
  }

  // Update sync status
  await pool.query(`
    INSERT INTO sync_status (key, value, updated_at)
    VALUES ('last_associations_pull', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  return count;
}

// Export constants for admin routes
export const SHEET_NAME = APP_SHEET_NAME;
export const ACTIVITIES_SHEET = ACTIVITIES_SHEET_NAME;
export const ERAS_SHEET = ERAS_SHEET_NAME;
export const SURFACES_SHEET = SURFACES_SHEET_NAME;
export const NEWS_SHEET = NEWS_SHEET_NAME;
export const EVENTS_SHEET = EVENTS_SHEET_NAME;
