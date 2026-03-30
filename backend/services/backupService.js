import { spawn } from 'child_process';
import { Readable } from 'stream';
import { getDriveSetting, setDriveSetting } from './driveImageService.js';

const BACKUPS_FOLDER_NAME = 'Backups';

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

  console.log('Creating Backups folder...');
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
