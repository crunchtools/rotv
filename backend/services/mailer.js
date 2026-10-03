/**
 * Transactional mail (spec 045). One SMTP transport configured from the
 * environment, DKIM-signed when a key is provided. In production it hands
 * messages to the mail.crunchtools.com Postfix relay, which queues and
 * retries; any SMTP provider works by changing the env.
 *
 * Env: SMTP_HOST, SMTP_PORT (default 25), SMTP_SECURE ('true' for implicit
 * TLS), SMTP_TLS_VERIFY ('false' to skip certificate checks),
 * SMTP_TLS_SERVERNAME (name to verify when SMTP_HOST is an IP),
 * SMTP_USER / SMTP_PASS (optional), MAIL_FROM, MAIL_REPLY_TO, MAIL_ENVELOPE_FROM, DKIM_DOMAIN, DKIM_SELECTOR, DKIM_PRIVATE_KEY_B64
 * (base64 PEM, since podman env-files can't hold multiline values).
 */

import nodemailer from 'nodemailer';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Mailer');

const DEFAULT_FROM = 'Roots of the Valley <signin@rootsofthevalley.org>';

/** True when outbound mail is configured. */
export function isMailEnabled(env = process.env) {
  return Boolean(env.SMTP_HOST);
}

/**
 * Build the nodemailer transport options from an env object.
 * @param {object} env - usually process.env
 * @returns {object|null} transport options, or null when SMTP_HOST is unset
 */
export function transportOptions(env = process.env) {
  if (!isMailEnabled(env)) return null;
  const options = {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 25),
    secure: env.SMTP_SECURE === 'true',
    // Sign-in links are credentials: refuse to send if STARTTLS is missing or
    // stripped, rather than falling back to plaintext.
    requireTLS: env.SMTP_SECURE !== 'true',
    name: env.SMTP_HELO_NAME || 'rootsofthevalley.org',
    // Certificates are verified unless SMTP_TLS_VERIFY=false. Production sets
    // that for its relay hop, which is a podman bridge on the same host.
    tls: {
      rejectUnauthorized: env.SMTP_TLS_VERIFY !== 'false',
      servername: env.SMTP_TLS_SERVERNAME || undefined
    }
  };
  if (env.SMTP_USER) {
    options.auth = { user: env.SMTP_USER, pass: env.SMTP_PASS };
  }
  if (env.DKIM_DOMAIN && env.DKIM_SELECTOR && env.DKIM_PRIVATE_KEY_B64) {
    options.dkim = {
      domainName: env.DKIM_DOMAIN,
      keySelector: env.DKIM_SELECTOR,
      privateKey: Buffer.from(env.DKIM_PRIVATE_KEY_B64, 'base64').toString('utf8')
    };
  }
  return options;
}

/**
 * Create a mailer from the environment.
 * @param {object} [env=process.env] - variables listed at the top of this file
 * @returns {{enabled: boolean, send: (msg: {to: string, subject: string, text: string, html?: string}) => Promise<string>}}
 *   enabled is false when SMTP_HOST is unset; send resolves to the message ID,
 *   and throws when mail is disabled or the relay rejects the message, so
 *   callers never report a send that did not happen.
 */
export function createMailer(env = process.env) {
  const options = transportOptions(env);
  if (!options) {
    logger.info('Outbound mail disabled (SMTP_HOST not set)');
    return {
      enabled: false,
      async send() {
        throw new Error('Outbound mail is not configured');
      }
    };
  }
  const transport = nodemailer.createTransport(options);
  logger.info(`Outbound mail via ${options.host}:${options.port}${options.dkim ? ` (DKIM ${options.dkim.keySelector}._domainkey.${options.dkim.domainName})` : ' (unsigned)'}`);
  return {
    enabled: true,
    async send({ to, subject, text, html }) {
      const info = await transport.sendMail({
        from: env.MAIL_FROM || DEFAULT_FROM,
        replyTo: env.MAIL_REPLY_TO || undefined,
        envelope: env.MAIL_ENVELOPE_FROM ? { from: env.MAIL_ENVELOPE_FROM, to } : undefined,
        to,
        subject,
        text,
        html
      });
      return info.messageId;
    }
  };
}
