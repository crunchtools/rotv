import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// server.js must refuse to start without PGPASSWORD rather than fall back to
// the well-known dev credential (#920, #922).
const backendDir = fileURLToPath(new URL('..', import.meta.url));
const EXIT_TIMEOUT_MS = 15000;

function startWithoutPassword() {
  const env = { ...process.env };
  delete env.PGPASSWORD;
  // dotenv/config would otherwise load a .env that may supply PGPASSWORD.
  delete env.DOTENV_CONFIG_PATH;
  env.DOTENV_PATH = '/nonexistent/rotv-test.env';

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: backendDir, env });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.resume();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server.js did not exit within ${EXIT_TIMEOUT_MS}ms without PGPASSWORD`));
    }, EXIT_TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}

describe('server.js startup without PGPASSWORD', () => {
  it('exits 1 with a FATAL message', async () => {
    const { code, stderr } = await startWithoutPassword();
    expect(code).toBe(1);
    expect(stderr).toContain('FATAL: PGPASSWORD is not set');
  }, EXIT_TIMEOUT_MS + 5000);
});
