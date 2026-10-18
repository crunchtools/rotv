/**
 * The direct network route fetches from lotor itself, so it may only reach
 * public internet addresses (publicAddress.js).
 */
import { describe, it, expect, vi } from 'vitest';

const TABLE = {
  'newfranklin.org': [{ address: '23.185.0.4', family: 4 }],
  'rebind.example': [{ address: '23.185.0.4', family: 4 }, { address: '10.89.1.10', family: 4 }],
  'v6.example': [{ address: '2606:4700::6810:84e5', family: 6 }],
  'mapped.example': [{ address: '::ffff:7f00:1', family: 6 }]
};
vi.mock('node:dns', () => ({
  default: {
    lookup: vi.fn((host, options, callback) => {
      if (!TABLE[host]) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      return callback(null, TABLE[host]);
    })
  }
}));

const { isPublicAddress, isPublicHost, isPublicUrl, publicLookup } = await import('../utils/publicAddress.js');

describe('isPublicAddress', () => {
  it('rejects loopback, private, link-local, CGNAT and metadata ranges', () => {
    for (const a of ['127.0.0.1', '10.89.1.10', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(a), a).toBe(false);
    }
  });

  it('accepts public addresses', () => {
    for (const a of ['23.185.0.4', '172.105.105.45', '2606:4700::6810:84e5']) {
      expect(isPublicAddress(a), a).toBe(true);
    }
  });
});

describe('isPublicHost / isPublicUrl', () => {
  it('needs every resolved address to be public', async () => {
    expect(await isPublicHost('newfranklin.org')).toBe(true);
    expect(await isPublicHost('v6.example')).toBe(true);
    expect(await isPublicHost('rebind.example')).toBe(false);
    expect(await isPublicHost('mapped.example')).toBe(false);
    expect(await isPublicHost('nxdomain.example')).toBe(false);
  });

  it('refuses local names, private literals and non-http schemes', async () => {
    expect(await isPublicUrl('http://localhost:8082/api')).toBe(false);
    expect(await isPublicUrl('http://127.0.0.1:8019/health')).toBe(false);
    expect(await isPublicUrl('http://[::1]/')).toBe(false);
    expect(await isPublicUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(await isPublicUrl('file:///etc/passwd')).toBe(false);
    expect(await isPublicUrl('https://newfranklin.org/1222/Community-Events')).toBe(true);
  });
});

describe('publicLookup', () => {
  const lookupAsync = (host, options = {}) => new Promise(resolve => publicLookup(host, options, (err, ...rest) => resolve({ err, rest })));

  it('answers like dns.lookup for public names', async () => {
    expect((await lookupAsync('newfranklin.org')).rest).toEqual(['23.185.0.4', 4]);
    expect((await lookupAsync('newfranklin.org', { all: true })).rest[0]).toEqual(TABLE['newfranklin.org']);
  });

  it('fails with ENOTPUBLIC when any address is not public', async () => {
    expect((await lookupAsync('rebind.example')).err.code).toBe('ENOTPUBLIC');
    expect((await lookupAsync('mapped.example')).err.code).toBe('ENOTPUBLIC');
    expect((await lookupAsync('nxdomain.example')).err.code).toBe('ENOTFOUND');
  });
});
