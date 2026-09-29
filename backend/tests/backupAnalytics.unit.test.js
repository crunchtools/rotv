import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// pg_dump exit code per database, set by each test
const exitCodes = {};

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd, args) => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    const database = args.at(-1);
    setImmediate(() => {
      proc.stdout.end(`-- dump of ${database}\n`);
      proc.emit('close', exitCodes[database] ?? 0);
    });
    return proc;
  }),
}));
vi.mock('../services/driveImageService.js', () => ({
  getDriveSetting: vi.fn(async () => 'folder-1'),
  setDriveSetting: vi.fn(),
  uploadImageToDrive: vi.fn(),
}));
vi.mock('../services/jobLogger.js', () => ({ logInfo: vi.fn(), logError: vi.fn(), flush: vi.fn() }));

const { triggerBackup, listBackups } = await import('../services/backupService.js');

function fakeDrive() {
  const uploaded = [];
  return {
    uploaded,
    files: {
      get: vi.fn(async () => ({ data: { id: 'folder-1', trashed: false } })),
      create: vi.fn(async ({ requestBody, media }) => {
        let body = '';
        for await (const chunk of media.body) body += chunk;
        uploaded.push({ name: requestBody.name, body });
        return { data: { id: `id-${requestBody.name}` } };
      }),
      delete: vi.fn(async () => ({})),
      list: vi.fn(async () => ({ data: { files: [] } })),
    },
  };
}

const pool = { query: vi.fn(async () => ({ rows: [] })) };

describe('database backup with analytics (#637)', () => {
  beforeEach(() => { for (const k of Object.keys(exitCodes)) delete exitCodes[k]; });

  it('streams the ROTV and umami dumps to Drive', async () => {
    const drive = fakeDrive();
    const result = await triggerBackup(pool, drive);
    expect(result.success).toBe(true);
    const names = drive.uploaded.map(u => u.name);
    expect(names.some(n => n.startsWith('rotv-backup-'))).toBe(true);
    expect(names.some(n => n.startsWith('umami-backup-'))).toBe(true);
    expect(drive.uploaded.find(u => u.name.startsWith('umami-')).body).toContain('dump of umami');
  });

  it('deletes a failed umami dump and still completes the ROTV backup', async () => {
    exitCodes.umami = 1;
    const drive = fakeDrive();
    const result = await triggerBackup(pool, drive);
    expect(result.success).toBe(true);
    expect(drive.files.delete).toHaveBeenCalledWith({ fileId: expect.stringContaining('umami-backup-') });
  });

  it('fails the backup when the ROTV dump fails', async () => {
    exitCodes[process.env.PGDATABASE || 'rotv'] = 1;
    await expect(triggerBackup(pool, fakeDrive())).rejects.toThrow('exited with code 1');
  });

  it('offers only ROTV backups for restore', async () => {
    const drive = fakeDrive();
    await listBackups(drive, pool);
    expect(drive.files.list.mock.calls[0][0].q).toContain("name contains 'rotv-backup-'");
  });
});
