import { Readable } from 'stream';
import { google } from 'googleapis';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DriveImage');

const ROOT_FOLDER_NAME = 'Roots of The Valley';
const ICONS_FOLDER_NAME = 'Icons';
const IMAGES_FOLDER_NAME = 'Images';
const GEOSPATIAL_FOLDER_NAME = 'Geospatial';

export async function getDriveSetting(pool, key) {
  const settingQuery = await pool.query(
    'SELECT value FROM drive_settings WHERE key = $1',
    [key]
  );
  return settingQuery.rows[0]?.value || null;
}

export async function setDriveSetting(pool, key, value) {
  await pool.query(`
    INSERT INTO drive_settings (key, value, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = CURRENT_TIMESTAMP
  `, [key, value]);
}

export async function getAllDriveSettings(pool) {
  const settingsQuery = await pool.query('SELECT key, value FROM drive_settings');
  const settings = {};
  for (const row of settingsQuery.rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

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

export async function ensureDriveFolders(drive, pool) {
  let rootFolderId = await getDriveSetting(pool, 'root_folder_id');
  if (!rootFolderId || !(await folderExists(drive, rootFolderId))) {
    logger.info('Creating Roots of The Valley folder...');
    rootFolderId = await createFolder(drive, ROOT_FOLDER_NAME);
    await setDriveSetting(pool, 'root_folder_id', rootFolderId);
  }

  let iconsFolderId = await getDriveSetting(pool, 'icons_folder_id');
  if (!iconsFolderId || !(await folderExists(drive, iconsFolderId))) {
    logger.info('Creating Icons folder...');
    iconsFolderId = await createFolder(drive, ICONS_FOLDER_NAME, rootFolderId);
    await setDriveSetting(pool, 'icons_folder_id', iconsFolderId);
  }

  let imagesFolderId = await getDriveSetting(pool, 'images_folder_id');
  if (!imagesFolderId || !(await folderExists(drive, imagesFolderId))) {
    logger.info('Creating Images folder...');
    imagesFolderId = await createFolder(drive, IMAGES_FOLDER_NAME, rootFolderId);
    await setDriveSetting(pool, 'images_folder_id', imagesFolderId);
  }

  let geospatialFolderId = await getDriveSetting(pool, 'geospatial_folder_id');
  if (!geospatialFolderId || !(await folderExists(drive, geospatialFolderId))) {
    logger.info('Creating Geospatial folder...');
    geospatialFolderId = await createFolder(drive, GEOSPATIAL_FOLDER_NAME, rootFolderId);
    await setDriveSetting(pool, 'geospatial_folder_id', geospatialFolderId);
  }

  return { rootFolderId, iconsFolderId, imagesFolderId, geospatialFolderId };
}

export async function uploadIconToDrive(drive, pool, iconName, svgContent) {
  const { iconsFolderId } = await ensureDriveFolders(drive, pool);

  const filename = `${iconName}.svg`;

  const existingFileId = await findFileInFolder(drive, iconsFolderId, filename);

  if (existingFileId) {
    await drive.files.update({
      fileId: existingFileId,
      media: {
        mimeType: 'image/svg+xml',
        body: Readable.from([svgContent])
      }
    });
    return existingFileId;
  } else {
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

export async function uploadImageToDrive(drive, pool, filename, buffer, mimeType) {
  const { imagesFolderId } = await ensureDriveFolders(drive, pool);

  const existingFileId = await findFileInFolder(drive, imagesFolderId, filename);

  let fileId;
  if (existingFileId) {
    await drive.files.update({
      fileId: existingFileId,
      media: {
        mimeType,
        body: Readable.from([buffer])
      }
    });
    fileId = existingFileId;
  } else {
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

    try {
      await drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
    } catch (permError) {
      logger.warn(`Failed to set public permission (non-fatal):`, permError.message);
    }
  }

  return fileId;
}

// Drive query string literals are single-quoted; backslash-escape \ and ' so a
// filename containing a quote cannot break (or alter) the query.
function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFileInFolder(drive, folderId, filename) {
  try {
    const response = await drive.files.list({
      q: `'${escapeDriveQueryValue(folderId)}' in parents and name = '${escapeDriveQueryValue(filename)}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1
    });
    return response.data.files?.[0]?.id || null;
  } catch (error) {
    logger.error('Error finding file in folder:', error.message);
    return null;
  }
}

export async function deleteFileFromDrive(drive, fileId) {
  try {
    await drive.files.delete({ fileId });
    return true;
  } catch (error) {
    if (error.code === 404) {
      return true;
    }
    throw error;
  }
}

export async function getDriveFolderLink(pool) {
  const rootFolderId = await getDriveSetting(pool, 'root_folder_id');
  if (!rootFolderId) {
    return null;
  }
  return `https://drive.google.com/drive/folders/${rootFolderId}`;
}

export function getDriveImageUrl(fileId) {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

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
      logger.error('Error counting icons:', error.message);
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
      logger.error('Error counting images:', error.message);
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
      logger.error('Error counting geospatial files:', error.message);
    }
  }

  return { iconsCount, imagesCount, geospatialCount };
}

async function createOAuth2Client(credentials, pool, userId) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(credentials);

  if (credentials.refresh_token) {
    try {
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCredentials);

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
      logger.warn('Token refresh failed:', refreshError.message);
    }
  }

  return oauth2Client;
}

export function createDriveService(credentials) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(credentials);
  return google.drive({ version: 'v3', auth: oauth2Client });
}

export async function createDriveServiceWithRefresh(credentials, pool, userId) {
  const oauth2Client = await createOAuth2Client(credentials, pool, userId);
  return google.drive({ version: 'v3', auth: oauth2Client });
}
