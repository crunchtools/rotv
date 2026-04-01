import { spawn } from 'child_process';
import { Readable } from 'stream';
import { getDriveSetting, setDriveSetting, uploadImageToDrive } from './driveImageService.js';
import imageServerClient from './imageServerClient.js';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';

const BACKUPS_FOLDER_NAME = 'Database';

/**
 * Ensure the Backups folder exists in Drive under the root ROTV folder
 */
async function ensureBackupsFolder(drive, pool) {
  let backupsFolderId = await getDriveSetting(pool, 'backups_folder_id');

  if (backupsFolderId) {
    // Verify folder still exists
    try {
      const response = await drive.files.get({
        fileId: backupsFolderId,
        fields: 'id,trashed'
      });
      if (response.data.trashed !== true) {
        return backupsFolderId;
      }
    } catch (error) {
      if (error.code !== 404) throw error;
    }
  }

  // Create the backups folder under the root folder
  const rootFolderId = await getDriveSetting(pool, 'root_folder_id');
  if (!rootFolderId) {
    throw new Error('Root Drive folder not configured. Set up Drive folders first.');
  }

  console.log('Creating Database folder...');
  const response = await drive.files.create({
    requestBody: {
      name: BACKUPS_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId]
    },
    fields: 'id'
  });

  backupsFolderId = response.data.id;
  await setDriveSetting(pool, 'backups_folder_id', backupsFolderId);
  return backupsFolderId;
}

/**
 * Run pg_dump and upload the SQL dump to Google Drive
 */
export async function triggerBackup(pool, drive) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
  const filename = `rotv-backup-${timestamp}.sql`;

  // Stream pg_dump output to avoid buffering large dumps in memory
  const pgHost = process.env.PGHOST || 'localhost';
  const pgPort = process.env.PGPORT || '5432';
  const pgDatabase = process.env.PGDATABASE || 'rotv';
  const pgUser = process.env.PGUSER || 'rotv';

  const sqlDump = await new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn('pg_dump', ['-h', pgHost, '-p', pgPort, '-U', pgUser, pgDatabase], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (data) => console.warn('[Backup] pg_dump stderr:', data.toString()));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`pg_dump exited with code ${code}`));
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    proc.on('error', reject);
  });

  // Ensure backups folder exists
  const backupsFolderId = await ensureBackupsFolder(drive, pool);

  // Upload to Drive
  const response = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType: 'application/sql',
      parents: [backupsFolderId]
    },
    media: {
      mimeType: 'application/sql',
      body: Readable.from([sqlDump])
    },
    fields: 'id'
  });

  const driveFileId = response.data.id;
  const now = new Date().toISOString();

  // Store last backup timestamp
  await pool.query(`
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES ('last_backup', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = CURRENT_TIMESTAMP
  `, [now]);

  console.log(`Backup uploaded to Drive: ${filename} (${driveFileId})`);

  return {
    success: true,
    filename,
    driveFileId,
    timestamp: now
  };
}

/**
 * List available backups in the Database folder
 */
export async function listBackups(drive, pool) {
  const backupsFolderId = await getDriveSetting(pool, 'backups_folder_id');
  if (!backupsFolderId) return [];

  try {
    const response = await drive.files.list({
      q: `'${backupsFolderId}' in parents and trashed = false`,
      fields: 'files(id,name,size,createdTime)',
      orderBy: 'createdTime desc',
      pageSize: 20
    });
    return response.data.files || [];
  } catch (error) {
    console.error('Error listing backups:', error.message);
    return [];
  }
}

/**
 * Restore a database from a Drive backup file
 */
export async function restoreBackup(pool, drive, fileId) {
  // Download the SQL dump from Drive
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );

  const sqlDump = response.data;
  if (!sqlDump || typeof sqlDump !== 'string') {
    throw new Error('Downloaded file is empty or not valid SQL');
  }

  const pgHost = process.env.PGHOST || 'localhost';
  const pgPort = process.env.PGPORT || '5432';
  const pgDatabase = process.env.PGDATABASE || 'rotv';
  const pgUser = process.env.PGUSER || 'rotv';

  // Run psql to restore — drop and recreate via pg_dump's output
  return new Promise((resolve, reject) => {
    const proc = spawn('psql', ['-h', pgHost, '-p', pgPort, '-U', pgUser, pgDatabase], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.stdin.write(sqlDump);
    proc.stdin.end();

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[Restore] psql stderr:', stderr);
        return reject(new Error(`psql exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
      console.log('[Restore] Database restored successfully');
      resolve({ success: true });
    });
    proc.on('error', reject);
  });
}

/**
 * Get the last backup status
 */
export async function getBackupStatus(pool) {
  const result = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'last_backup'"
  );
  const backupsFolderId = await getDriveSetting(pool, 'backups_folder_id');

  return {
    lastBackup: result.rows[0]?.value || null,
    backupsFolderId: backupsFolderId || null
  };
}

/**
 * List files in the Drive Images folder (paginated)
 */
async function listDriveImages(drive, imagesFolderId) {
  const files = [];
  let pageToken = null;

  do {
    const params = {
      q: `'${imagesFolderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType)',
      pageSize: 100
    };
    if (pageToken) params.pageToken = pageToken;

    const response = await drive.files.list(params);
    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * Sync image server DB + all media files to Drive Images folder.
 *
 * 1. Fetch pg_dump from image server, upload as imageserver-backup-{timestamp}.sql
 * 2. List all media files via listMediaFiles()
 * 3. For each file not already in Drive, download and upload with flat name {subdir}--{filename}
 */
export async function triggerImageBackup(pool, drive) {
  const imagesFolderId = await getDriveSetting(pool, 'images_folder_id');
  if (!imagesFolderId) {
    throw new Error('Images folder not configured in Drive');
  }

  if (!imageServerClient.initialized) {
    throw new Error('Image server not configured');
  }

  // Step 1: Backup image server database
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
  const dbFilename = `imageserver-backup-${timestamp}.sql`;

  const dbDump = await imageServerClient.fetchDbDump();
  if (!dbDump.success) {
    throw new Error(`Failed to fetch image server DB dump: ${dbDump.error}`);
  }

  await drive.files.create({
    requestBody: {
      name: dbFilename,
      mimeType: 'application/sql',
      parents: [imagesFolderId]
    },
    media: {
      mimeType: 'application/sql',
      body: Readable.from([dbDump.data])
    },
    fields: 'id'
  });
  console.log(`[ImageBackup] Uploaded DB dump: ${dbFilename}`);

  // Step 2: List all media files and compare with Drive
  const mediaFiles = await imageServerClient.listMediaFiles();
  const driveFiles = await listDriveImages(drive, imagesFolderId);
  const driveFileNames = new Set(driveFiles.map(f => f.name));

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const media of mediaFiles) {
    const driveName = `${media.subdir}--${media.filename}`;

    if (driveFileNames.has(driveName)) {
      skipped++;
      continue;
    }

    try {
      const fileData = await imageServerClient.fetchMediaFile(media.subdir, media.filename);
      if (!fileData.success) {
        failed++;
        continue;
      }

      await drive.files.create({
        requestBody: {
          name: driveName,
          mimeType: fileData.contentType,
          parents: [imagesFolderId]
        },
        media: {
          mimeType: fileData.contentType,
          body: Readable.from([fileData.data])
        },
        fields: 'id'
      });

      uploaded++;
    } catch (error) {
      console.warn(`[ImageBackup] Failed to backup ${media.subdir}/${media.filename}:`, error.message);
      failed++;
    }
  }

  const now = new Date().toISOString();
  await pool.query(`
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES ('last_image_backup', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = CURRENT_TIMESTAMP
  `, [now]);

  console.log(`[ImageBackup] Done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`);
  logInfo(null, 'backup', null, null, `Complete: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`, { uploaded, skipped, failed });
  await flushJobLogs();

  return { success: true, uploaded, skipped, failed, timestamp: now };
}

/**
 * Get image backup status — media files vs Drive files
 */
export async function getImageBackupStatus(pool, drive) {
  const imagesFolderId = await getDriveSetting(pool, 'images_folder_id');

  let mediaFileCount = 0;
  let driveMediaCount = 0;
  let driveDbDumpCount = 0;

  if (imageServerClient.initialized) {
    try {
      const mediaFiles = await imageServerClient.listMediaFiles();
      mediaFileCount = mediaFiles.length;
    } catch (error) {
      console.warn('[ImageBackup] Could not list media files:', error);
    }
  }

  if (imagesFolderId && drive) {
    const driveFiles = await listDriveImages(drive, imagesFolderId);
    for (const f of driveFiles) {
      if (f.name.startsWith('imageserver-backup-') && f.name.endsWith('.sql')) {
        driveDbDumpCount++;
      } else {
        driveMediaCount++;
      }
    }
  }

  const lastBackupResult = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'last_image_backup'"
  );

  return {
    mediaFileCount,
    driveMediaCount,
    driveDbDumpCount,
    lastBackup: lastBackupResult.rows[0]?.value || null,
    imagesFolderId: imagesFolderId || null
  };
}

/**
 * Restore image server from Drive Images folder.
 *
 * 1. Find most recent imageserver-backup-*.sql, download, POST to image server /api/restore/db
 * 2. For each {subdir}--{filename} file in Drive, download and PUT to image server
 */
export async function restoreImagesFromDrive(pool, drive) {
  const imagesFolderId = await getDriveSetting(pool, 'images_folder_id');
  if (!imagesFolderId) {
    throw new Error('Images folder not configured in Drive');
  }

  if (!imageServerClient.initialized) {
    throw new Error('Image server not configured');
  }

  const driveFiles = await listDriveImages(drive, imagesFolderId);

  // Step 1: Find and restore the most recent DB dump
  const dbDumps = driveFiles
    .filter(f => f.name.startsWith('imageserver-backup-') && f.name.endsWith('.sql'))
    .sort((a, b) => b.name.localeCompare(a.name)); // Newest first (timestamp in name)

  let dbRestored = false;
  if (dbDumps.length > 0) {
    const latestDump = dbDumps[0];
    console.log(`[ImageRestore] Restoring DB from: ${latestDump.name}`);

    const response = await drive.files.get(
      { fileId: latestDump.id, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    const sqlBuffer = Buffer.from(response.data);
    const restoreResult = await imageServerClient.restoreDb(sqlBuffer);

    if (restoreResult.success) {
      dbRestored = true;
      console.log('[ImageRestore] DB restored successfully');
    } else {
      console.error('[ImageRestore] DB restore failed:', restoreResult.error);
      throw new Error(`Database restore failed: ${restoreResult.error}`);
    }
  }

  // Step 2: Restore media files
  const existingMedia = await imageServerClient.listMediaFiles();
  const existingSet = new Set(existingMedia.map(m => `${m.subdir}--${m.filename}`));

  let restored = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of driveFiles) {
    // Skip DB dumps
    if (file.name.startsWith('imageserver-backup-') && file.name.endsWith('.sql')) {
      continue;
    }

    // Parse {subdir}--{filename} format
    const separatorIdx = file.name.indexOf('--');
    if (separatorIdx === -1) {
      console.warn(`[ImageRestore] Skipping unrecognized file: ${file.name}`);
      skipped++;
      continue;
    }

    const subdir = file.name.substring(0, separatorIdx);
    const filename = file.name.substring(separatorIdx + 2);

    // Skip if already exists on image server
    if (existingSet.has(file.name)) {
      skipped++;
      continue;
    }

    try {
      const response = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      const buffer = Buffer.from(response.data);
      const result = await imageServerClient.uploadMediaFile(subdir, filename, buffer);

      if (result.success) {
        restored++;
      } else {
        failed++;
      }
    } catch (error) {
      console.warn(`[ImageRestore] Failed to restore ${file.name}:`, error.message);
      failed++;
    }
  }

  console.log(`[ImageRestore] Done: DB=${dbRestored ? 'yes' : 'no'}, ${restored} media restored, ${skipped} skipped, ${failed} failed`);

  return { success: true, dbRestored, restored, skipped, failed };
}
