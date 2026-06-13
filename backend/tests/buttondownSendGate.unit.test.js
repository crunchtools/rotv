/**
 * Fail-closed contract for the newsletter send gate (PR #476 follow-up).
 * A missing NEWSLETTER_SEND_ENABLED must mean NO send, so a forgotten env
 * file can never email real subscribers — the regression behind the triple
 * [PREVIEW] emails (#440). Sending requires the exact string "true".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// buttondownClient imports axios (used only inside a function); stub it so the
// module loads on the host without a full backend node_modules.
vi.mock('axios', () => ({ default: { create: vi.fn(() => ({})) } }));

const { isSendEnabled } = await import('../services/buttondownClient.js');

describe('isSendEnabled — fail-closed newsletter gate', () => {
  const original = process.env.NEWSLETTER_SEND_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.NEWSLETTER_SEND_ENABLED;
    else process.env.NEWSLETTER_SEND_ENABLED = original;
  });

  it('is disabled when the variable is unset (the safety default)', () => {
    delete process.env.NEWSLETTER_SEND_ENABLED;
    expect(isSendEnabled()).toBe(false);
  });

  it('is enabled for the exact string "true"', () => {
    process.env.NEWSLETTER_SEND_ENABLED = 'true';
    expect(isSendEnabled()).toBe(true);
  });

  it('is disabled for "false"', () => {
    process.env.NEWSLETTER_SEND_ENABLED = 'false';
    expect(isSendEnabled()).toBe(false);
  });

  it('is disabled for truthy-looking but non-"true" values', () => {
    for (const v of ['TRUE', 'True', '1', 'yes', 'on', ' true ', 'true ', '']) {
      process.env.NEWSLETTER_SEND_ENABLED = v;
      expect(isSendEnabled(), `value ${JSON.stringify(v)} must not enable sending`).toBe(false);
    }
  });
});
