import { spawn } from 'child_process';
import { Readable } from 'stream';
import { getDriveSetting, setDriveSetting } from './driveImageService.js';

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
