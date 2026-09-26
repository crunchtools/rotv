/**
 * Library contract tests for the #640 security upgrades (multer 2, nodemailer 10).
 * No route test exercises uploads or outbound mail, so these pin the behavior
 * server.js, routes/admin.js and services/newsletterService.js rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { once } from 'node:events';

vi.mock('../services/jobScheduler.js', () => ({ queueNewsletterJob: vi.fn() }));

const { startSmtpServer } = await import('../services/newsletterService.js');
const { queueNewsletterJob } = await import('../services/jobScheduler.js');

function uploadApp() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    }
  });

  const app = express();
  app.post('/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      res.json({
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        body: req.file.buffer.toString('utf-8'),
        caption: req.body.caption
      });
    });
  });
  return app;
}

describe('multer 2 memoryStorage contract', () => {
  it('delivers the file in req.file.buffer alongside text fields', async () => {
    const res = await request(uploadApp())
      .post('/upload')
      .field('caption', 'Brandywine Falls')
      .attach('file', Buffer.from('fake-png'), { filename: 'falls.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      originalname: 'falls.png',
      mimetype: 'image/png',
      size: 8,
      body: 'fake-png',
      caption: 'Brandywine Falls'
    });
  });

  it('rejects files over limits.fileSize with LIMIT_FILE_SIZE', async () => {
    const res = await request(uploadApp())
      .post('/upload')
      .attach('file', Buffer.alloc(2048), { filename: 'big.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LIMIT_FILE_SIZE');
  });

  it('passes fileFilter rejections to the error callback', async () => {
    const res = await request(uploadApp())
      .post('/upload')
      .attach('file', Buffer.from('{}'), { filename: 'x.json', contentType: 'application/json' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Only image files are allowed');
  });
});

describe('nodemailer 10 + mailparser contract', () => {
  it('exposes createTransport on the ESM default import', () => {
    expect(typeof nodemailer.createTransport).toBe('function');
  });

  it('round-trips a forwarded message through simpleParser', async () => {
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transporter.sendMail({
      envelope: { from: 'admin@rootsofthevalley.org', to: 'someone@example.com' },
      from: '"ROTV Admin Forward" <admin@rootsofthevalley.org>',
      to: 'someone@example.com',
      subject: '[ROTV] Trail report',
      replyTo: 'visitor@example.com',
      text: '--- Forwarded from visitor ---\n\nTowpath is flooded',
      html: '<p><em>Forwarded from visitor</em></p><hr><p>Towpath is flooded</p>'
    });

    const parsed = await simpleParser(info.message);
    expect(parsed.subject).toBe('[ROTV] Trail report');
    expect(parsed.from.value[0].address).toBe('admin@rootsofthevalley.org');
    expect(parsed.replyTo.value[0].address).toBe('visitor@example.com');
    expect(parsed.text).toContain('Towpath is flooded');
    expect(parsed.html).toContain('<em>Forwarded from visitor</em>');
  });
});

// Fix: exercise the real inbound SMTP server and nodemailer's SMTP transport, not just streamTransport (PR #642 review)
describe('newsletter SMTP receiver (smtp-server 3.19 + nodemailer 10 SMTP transport)', () => {
  let server;
  let pool;

  function send(to) {
    const transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: server.server.address().port,
      secure: false,
      ignoreTLS: true
    });
    return transporter.sendMail({
      from: '"Conservancy" <news@conservancyforcvnp.org>',
      to,
      subject: 'Fall events',
      html: '<p>Hike the Ledges</p>',
      text: 'Hike the Ledges'
    });
  }

  beforeEach(async () => {
    vi.mocked(queueNewsletterJob).mockReset();
    pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 42 }] }) };
    server = startSmtpServer(pool, { port: 0, host: '127.0.0.1' });
    await once(server.server, 'listening');
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('stores and queues mail sent to news@', async () => {
    await send('news@rootsofthevalley.org');

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO newsletter_emails');
    expect(params[0]).toContain('news@conservancyforcvnp.org');
    expect(params[1]).toBe('Fall events');
    expect(params[2]).toContain('Hike the Ledges');
    expect(queueNewsletterJob).toHaveBeenCalledWith(42);
  });

  it('rejects recipients outside the allow-list before any DB write', async () => {
    await expect(send('someone@rootsofthevalley.org')).rejects.toThrow(/not accepted/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('answers 451 when the message cannot be stored', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    await expect(send('news@rootsofthevalley.org')).rejects.toMatchObject({ responseCode: 451 });
    expect(queueNewsletterJob).not.toHaveBeenCalled();
  });
});
