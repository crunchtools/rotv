#!/usr/bin/env node
// Idempotent Umami bootstrap (#637), run as umami.service ExecStartPost.
// 1. Rotate the default admin/umami login to UMAMI_ADMIN_PASSWORD, or to a
//    random throwaway when that is unset, so the default never stays live.
// 2. Create the ROTV website with a fixed id, plus the read-only share page
//    that the admin Stats tab links to.
// Never fails the unit, so analytics can't restart-loop, with one exception:
// whenever the default password may still be live (no heartbeat, or rotation
// failed), Umami is stopped rather than left running with a known login.

import crypto from 'crypto';
import { execFileSync } from 'child_process';

const BASE = 'http://127.0.0.1:3000/stats';
const WEBSITE_ID = '804a81bc-5731-4028-bd22-2aa2f2b159c2';
const SHARE_SLUG = 'rotv';
// Umami's first-boot login. It is never a deployed credential: setup rotates
// it on first start, and stops Umami if it can't.
const DEFAULT_PASSWORD = 'umami';
const configuredPassword = process.env.UMAMI_ADMIN_PASSWORD;

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function waitForHeartbeat() {
  for (let i = 0; i < 180; i++) {
    try {
      const res = await fetch(`${BASE}/api/heartbeat`);
      if (res.ok) return true;
    } catch { /* not listening yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

function stopUmami(reason) {
  console.error(`umami-setup: ${reason}; stopping Umami`);
  execFileSync('systemctl', ['stop', '--no-block', 'umami.service']);
}

async function login(password) {
  const { status, data } = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password },
  });
  return status === 200 ? data.token : null;
}

async function main() {
  if (!(await waitForHeartbeat())) {
    stopUmami('no answer on /api/heartbeat within 180s, so the default password may be live');
    return;
  }

  let token = configuredPassword ? await login(configuredPassword) : null;
  if (!token) {
    token = await login(DEFAULT_PASSWORD);
    if (!token) {
      console.error('umami-setup: cannot log in with UMAMI_ADMIN_PASSWORD or the default');
      return;
    }
    if (!configuredPassword) {
      console.warn('umami-setup: UMAMI_ADMIN_PASSWORD unset, rotating admin to a random password nobody knows');
    }
    const newPassword = configuredPassword || crypto.randomBytes(24).toString('base64url');
    const { status, data } = await api('/api/me/password', {
      token, method: 'POST',
      body: { currentPassword: DEFAULT_PASSWORD, newPassword },
    });
    if (status !== 200) {
      stopUmami(`password rotation failed (${status}): ${JSON.stringify(data)}`);
      return;
    }
    console.log('umami-setup: rotated the default admin password');
    // The password change revokes the old token
    token = await login(newPassword);
    if (!token) {
      console.error('umami-setup: cannot log in with the rotated password');
      return;
    }
  }

  const existing = await api(`/api/websites/${WEBSITE_ID}`, { token });
  // A missing website answers 200 with a null body
  if (existing.status === 200 && existing.data) {
    console.log('umami-setup: website already exists');
    return;
  }
  const created = await api('/api/websites', {
    token, method: 'POST',
    body: { id: WEBSITE_ID, name: 'Roots of The Valley', domain: 'rootsofthevalley.org', shareId: SHARE_SLUG },
  });
  console.log(created.status === 200
    ? 'umami-setup: created the ROTV website and share page'
    : `umami-setup: website create failed (${created.status}): ${JSON.stringify(created.data)}`);
}

main().catch(err => console.error('umami-setup: bootstrap failed', err));
