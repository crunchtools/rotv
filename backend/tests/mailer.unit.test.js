import { describe, it, expect, vi, afterEach } from 'vitest';
import nodemailer from 'nodemailer';
import { transportOptions, createMailer, isMailEnabled } from '../services/mailer.js';
import { normalizeEmail } from '../services/emailLogin.js';

// Stand-in key bytes; only their round trip through base64 is under test.
const PEM = 'dkim-key-placeholder\nline-two\n';

describe('mailer configuration', () => {
  it('is disabled without SMTP_HOST, and send refuses rather than pretending', async () => {
    expect(isMailEnabled({})).toBe(false);
    expect(transportOptions({})).toBeNull();
    const mailer = createMailer({});
    expect(mailer.enabled).toBe(false);
    await expect(mailer.send({ to: 'a@example.com' })).rejects.toThrow('not configured');
  });

  it('builds a DKIM-signing transport from base64 key material', () => {
    const options = transportOptions({
      SMTP_HOST: '10.89.1.2',
      SMTP_PORT: '25',
      DKIM_DOMAIN: 'rootsofthevalley.org',
      DKIM_SELECTOR: 'rotv1',
      DKIM_PRIVATE_KEY_B64: Buffer.from(PEM).toString('base64')
    });
    expect(options).toMatchObject({ host: '10.89.1.2', port: 25, secure: false, requireTLS: true, name: 'rootsofthevalley.org' });
    expect(options.dkim).toEqual({ domainName: 'rootsofthevalley.org', keySelector: 'rotv1', privateKey: PEM });
    expect(options.auth).toBeUndefined();
    expect(options.tls.rejectUnauthorized).toBe(true);
  });

  it('only skips certificate checks when explicitly told to', () => {
    expect(transportOptions({ SMTP_HOST: 'h', SMTP_TLS_VERIFY: 'false' }).tls.rejectUnauthorized).toBe(false);
    expect(transportOptions({ SMTP_HOST: '10.0.0.2', SMTP_TLS_SERVERNAME: 'mail.example.com' }).tls)
      .toEqual({ rejectUnauthorized: true, servername: 'mail.example.com' });
  });

  it('adds SMTP auth only when a user is given, and skips DKIM when incomplete', () => {
    const options = transportOptions({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASS: 'p', DKIM_DOMAIN: 'x' });
    expect(options).toMatchObject({ port: 465, secure: true, requireTLS: false, auth: { user: 'u', pass: 'p' } });
    expect(options.dkim).toBeUndefined();
  });
});

describe('mailer send', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockTransport(sendMail) {
    const createTransport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail });
    return createTransport;
  }

  it('sends with the configured sender, reply-to and bounce address, and returns the message id', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<abc@rotv>' });
    const createTransport = mockTransport(sendMail);
    const mailer = createMailer({
      SMTP_HOST: '10.89.1.2',
      MAIL_REPLY_TO: 'admin@rootsofthevalley.org',
      MAIL_ENVELOPE_FROM: 'admin@rootsofthevalley.org'
    });
    const id = await mailer.send({ to: 'hiker@example.com', subject: 'S', text: 'T', html: '<p>H</p>' });

    expect(id).toBe('<abc@rotv>');
    expect(createTransport.mock.calls[0][0]).toMatchObject({ host: '10.89.1.2', requireTLS: true });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Roots of the Valley <signin@rootsofthevalley.org>',
      replyTo: 'admin@rootsofthevalley.org',
      envelope: { from: 'admin@rootsofthevalley.org', to: 'hiker@example.com' },
      to: 'hiker@example.com',
      subject: 'S',
      text: 'T',
      html: '<p>H</p>'
    });
  });

  it('propagates transport failures so callers never report a send that did not happen', async () => {
    mockTransport(vi.fn().mockRejectedValue(new Error('Must issue a STARTTLS command first')));
    const mailer = createMailer({ SMTP_HOST: '10.89.1.2' });
    await expect(mailer.send({ to: 'a@example.com', subject: 'S', text: 'T' })).rejects.toThrow('STARTTLS');
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases plausible addresses and rejects the rest', () => {
    expect(normalizeEmail('  Hiker@Example.COM ')).toBe('hiker@example.com');
    expect(normalizeEmail('no-at-sign')).toBeNull();
    expect(normalizeEmail('two words@example.com')).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});
