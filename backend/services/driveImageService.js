import { Readable } from 'stream';

const ROOT_FOLDER_NAME = 'Roots of The Valley';
const ICONS_FOLDER_NAME = 'Icons';
const IMAGES_FOLDER_NAME = 'Images';
const GEOSPATIAL_FOLDER_NAME = 'Geospatial';

/**
 * Get a Drive setting from the database
 */
export async function getDriveSetting(pool, key) {
  const settingQuery = await pool.query(
    'SELECT value FROM drive_settings WHERE key = $1',
    [key]
  );
  return settingQuery.rows[0]?.value || null;
}

/**
 * Set a Drive setting in the database
 */
export async function setDriveSetting(pool, key, value) {
  await pool.query(`
    INSERT INTO drive_settings (key, value, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = CURRENT_TIMESTAMP
  `, [key, value]);
}

/**
 * Get all Drive settings as an object
 */
export async function getAllDriveSettings(pool) {
  const settingsQuery = await pool.query('SELECT key, value FROM drive_settings');
  const settings = {};
  for (const row of settingsQuery.rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

/**
 * Check if a folder exists and is accessible
 */
async function folderExists(drive, folderId) {
  if (!folderId) return false;
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id,trashed'
    });
    return response.data.trashed !== true;
  } catch (error) {
    if (error.code === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Create a folder in Google Drive
 */
async function createFolder(drive, name, parentId = null) {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const response = await drive.files.create({
    requestBody: metadata,
    fields: 'id'
  });

  return response.data.id;
}

/**
 * Ensure the ROTV folder structure exists in Google Drive
 * Creates: Roots of The Valley / Icons, Images, Geospatial
 * Returns folder IDs
 */
export async function ensureDriveFolders(drive, pool) {
  // Check if root folder exists
  let rootFolderId = await getDriveSetting(pool, 'root_folder_id');
  if (!rootFolderId || !(await folderExists(drive, rootFolderId))) {
    console.log('Creating Roots of The Valley folder...');
    rootFolderId = await createFolder(drive, ROOT_FOLDER_NAME);
    await setDriveSetting(pool, 'root_folder_id', rootFolderId);
  }

  // Check if Icons folder exists
  let iconsFolderId = await getDriveSetting(pool, 'icons_folder_id');
  if (!iconsFolderId || !(await folderExists(drive, iconsFolderId))) {
    console.log('Creating Icons folder...');
    iconsFolderId = await createFolder(drive, ICONS_FOLDER_NAME, rootFolderId);
    await setDriveSetting(pool, 'icons_folder_id', iconsFolderId);
  }

  // Check if Images folder exists
  let imagesFolderId = await getDriveSetting(pool, 'images_folder_id');
  if (!imagesFolderId || !(await folderExists(drive, imagesFolderId))) {
    console.log('Creating Images folder...');
    imagesFolderId = await createFolder(drive, IMAGES_FOLDER_NAME, rootFolderId);
    await setDriveSetting(pool, 'images_folder_id', imagesFolderId);
  }

  // Check if Geospatial folder exists
  let geospatialFolderId = await getDriveSetting(pool, 'geospatial_folder_id');
  if (!geospatialFolderId || !(await folderExists(drive, geospatialFolderId))) {
    console.log('Creating Geospatial folder...');
    geospatialFolderId = await createFolder(drive, GEOSPATIAL_FOLDER_NAME, rootFolderId);
    await setDriveSetting(pool, 'geospatial_folder_id', geospatialFolderId);
  }

  return { rootFolderId, iconsFolderId, imagesFolderId, geospatialFolderId };
}

/**
 * Move an existing file into the ROTV folder
 */
export async function moveFileToFolder(drive, fileId, folderId) {
  // Get current parents
  const file = await drive.files.get({
    fileId,
    fields: 'parents'
  });

  const previousParents = file.data.parents?.join(',') || '';

  // Move to new folder
  await drive.files.update({
    fileId,
    addParents: folderId,
    removeParents: previousParents,
    fields: 'id,parents'
  });
}

/**
 * Upload an SVG icon to the Icons folder in Drive
 * Returns the Drive file ID
 */
export async function uploadIconToDrive(drive, pool, iconName, svgContent) {
  const { iconsFolderId } = await ensureDriveFolders(drive, pool);

  const filename = `${iconName}.svg`;

  // Check if file already exists (update instead of create)
  const existingFileId = await findFileInFolder(drive, iconsFolderId, filename);

  if (existingFileId) {
    // Update existing file
    await drive.files.update({
      fileId: existingFileId,
      media: {
        mimeType: 'image/svg+xml',
        body: Readable.from([svgContent])
      }
    });
    return existingFileId;
  } else {
    // Create new file
    const response = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType: 'image/svg+xml',
        parents: [iconsFolderId]
      },
      media: {
        mimeType: 'image/svg+xml',
        body: Readable.from([svgContent])
      },
      fields: 'id'
    });
    return response.data.id;
  }
}

/**
 * Upload an image to the Images folder in Drive
 * Makes the file publicly readable so it can be accessed without auth
 * Returns the Drive file ID
 */
export async function uploadImageToDrive(drive, pool, filename, buffer, mimeType) {
  const { imagesFolderId } = await ensureDriveFolders(drive, pool);

  // Check if file already exists
  const existingFileId = await findFileInFolder(drive, imagesFolderId, filename);

  let fileId;
  if (existingFileId) {
    // Update existing file
    await drive.files.update({
      fileId: existingFileId,
      media: {
        mimeType,
        body: Readable.from([buffer])
      }
    });
    fileId = existingFileId;
  } else {
    // Create new file
    const response = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType,
        parents: [imagesFolderId]
      },
      media: {
        mimeType,
        body: Readable.from([buffer])
      },
      fields: 'id'
    });
    fileId = response.data.id;

    // Make file publicly readable (anyone with link can view)
    try {
      await drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
    } catch (permError) {
      console.warn(`Failed to set public permission (non-fatal):`, permError.message);
    }
  }

  return fileId;
}

/**
 * Upload a GeoJSON file to the Geospatial folder in Drive
 * Used for storing trail/river geometry data
 * Returns the Drive file ID
 */
export async function uploadGeoJSONToDrive(drive, pool, filename, geojsonData) {
  const { geospatialFolderId } = await ensureDriveFolders(drive, pool);

  // Ensure filename ends with .geojson
  if (!filename.endsWith('.geojson')) {
    filename = `${filename}.geojson`;
  }

  const content = typeof geojsonData === 'string' ? geojsonData : JSON.stringify(geojsonData, null, 2);

  // Check if file already exists
  const existingFileId = await findFileInFolder(drive, geospatialFolderId, filename);

  let fileId;
  if (existingFileId) {
    // Update existing file
    await drive.files.update({
      fileId: existingFileId,
      media: {
        mimeType: 'application/geo+json',
        body: Readable.from([content])
      }
    });
    fileId = existingFileId;
  } else {
    // Create new file
    const response = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType: 'application/geo+json',
        parents: [geospatialFolderId]
      },
      media: {
        mimeType: 'application/geo+json',
        body: Readable.from([content])
      },
      fields: 'id'
    });
    fileId = response.data.id;
  }

  return fileId;
}

/**
 * Download a GeoJSON file from Drive and parse it
 */
export async function downloadGeoJSONFromDrive(drive, fileId) {
  const buffer = await downloadFileFromDrive(drive, fileId);
  if (!buffer) return null;

  try {
    return JSON.parse(buffer.toString('utf-8'));
  } catch (error) {
    console.error('Failed to parse GeoJSON from Drive:', error.message);
    return null;
  }
}

/**
 * Find a file by name in a specific folder
 */
async function findFileInFolder(drive, folderId, filename) {
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and name = '${filename}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1
    });
    return response.data.files?.[0]?.id || null;
  } catch (error) {
    console.error('Error finding file in folder:', error.message);
    return null;
  }
}

/**
 * Download a file's content from Google Drive
 */
export async function downloadFileFromDrive(drive, fileId) {
  try {
    const response = await drive.files.get({
      fileId,
      alt: 'media'
    }, {
      responseType: 'arraybuffer'
    });

    return Buffer.from(response.data);
  } catch (error) {
    if (error.code === 404) {
      console.warn(`File ${fileId} not found in Drive`);
      return null;
    }
    throw error;
  }
}

/**
 * Delete a file from Google Drive
 */
export async function deleteFileFromDrive(drive, fileId) {
  try {
    await drive.files.delete({ fileId });
    return true;
  } catch (error) {
    if (error.code === 404) {
      // File already deleted
      return true;
    }
    throw error;
  }
}

/**
 * Get file metadata from Drive
 */
export async function getFileMetadata(drive, fileId) {
  try {
    const response = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink'
    });
    return response.data;
  } catch (error) {
    if (error.code === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Get a web link to view the ROTV folder in Google Drive
 */
export async function getDriveFolderLink(pool) {
  const rootFolderId = await getDriveSetting(pool, 'root_folder_id');
  if (!rootFolderId) {
    return null;
  }
  return `https://drive.google.com/drive/folders/${rootFolderId}`;
}

/**
 * Get a public URL for a Drive file
 * Uses the lh3.googleusercontent.com format which works best for images
 */
export function getDriveImageUrl(fileId) {
  // This format works well for publicly shared images
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

/**
 * Count files in the Icons, Images, and Geospatial folders
 */
export async function countDriveFiles(drive, pool) {
  const iconsFolderId = await getDriveSetting(pool, 'icons_folder_id');
  const imagesFolderId = await getDriveSetting(pool, 'images_folder_id');
  const geospatialFolderId = await getDriveSetting(pool, 'geospatial_folder_id');

  let iconsCount = 0;
  let imagesCount = 0;
  let geospatialCount = 0;

  if (iconsFolderId) {
    try {
      const response = await drive.files.list({
        q: `'${iconsFolderId}' in parents and trashed = false`,
        fields: 'files(id)',
        pageSize: 1000
      });
      iconsCount = response.data.files?.length || 0;
    } catch (error) {
      console.error('Error counting icons:', error.message);
    }
  }

  if (imagesFolderId) {
    try {
      const response = await drive.files.list({
        q: `'${imagesFolderId}' in parents and trashed = false`,
        fields: 'files(id)',
        pageSize: 1000
      });
      imagesCount = response.data.files?.length || 0;
    } catch (error) {
      console.error('Error counting images:', error.message);
    }
  }

  if (geospatialFolderId) {
    try {
      const response = await drive.files.list({
        q: `'${geospatialFolderId}' in parents and trashed = false`,
        fields: 'files(id)',
        pageSize: 1000
      });
      geospatialCount = response.data.files?.length || 0;
    } catch (error) {
      console.error('Error counting geospatial files:', error.message);
    }
  }

  return { iconsCount, imagesCount, geospatialCount };
}
