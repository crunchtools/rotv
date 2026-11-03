/**
 * admin@ forward (RT #1546): goes through the configured relay, never
 * straight to Gmail's MX, and refuses when outbound mail is off so the
 * sending MTA retries instead of losing the message.
 */
import { describe, it, expect, vi } from 'vitest';
import { forwardAdminEmail } from '../services/newsletterService.js';

const RAW = Buffer.from(
  'From: Visitor <visitor@example.com>\r\nTo: admin@rootsofthevalley.org\r\nSubject: Trail question\r\n\r\nIs the towpath open?\r\n'
);

function fakeTransport() {
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'id' });
  const createTransport = vi.fn(() => ({ sendMail }));
  return { createTransport, sendMail };
}

describe('forwardAdminEmail', () => {
  it('sends through SMTP_HOST, not Gmail', async () => {
    const { createTransport, sendMail } = fakeTransport();
    await forwardAdminEmail(RAW, {
      env: { SMTP_HOST: '10.89.1.1', SMTP_PORT: '2587' },
      createTransport
    });
    const options = createTransport.mock.calls[0][0];
    expect(options.host).toBe('10.89.1.1');
    expect(options.port).toBe(2587);
    const msg = sendMail.mock.calls[0][0];
    expect(msg.envelope).toEqual({ from: 'admin@rootsofthevalley.org', to: 'scott.mccarty@gmail.com' });
    expect(msg.subject).toBe('[ROTV] Trail question');
    expect(msg.replyTo).toBe('visitor@example.com');
    expect(msg.text).toContain('Is the towpath open?');
  });

  it('throws when outbound mail is not configured', async () => {
    const { createTransport } = fakeTransport();
    await expect(forwardAdminEmail(RAW, { env: {}, createTransport })).rejects.toThrow('not configured');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('propagates a relay refusal so the caller answers 451', async () => {
    const createTransport = () => ({ sendMail: vi.fn().mockRejectedValue(new Error('relay down')) });
    await expect(
      forwardAdminEmail(RAW, { env: { SMTP_HOST: '10.89.1.1' }, createTransport })
    ).rejects.toThrow('relay down');
  });
});
