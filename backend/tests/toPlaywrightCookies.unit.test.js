import { describe, it, expect } from 'vitest';
import { toPlaywrightCookies } from '../services/contentExtractor.js';

const base = { name: 'n', value: 'v', domain: '.x.com' };

describe('toPlaywrightCookies', () => {
  it.each([
    ['strict', 'Strict'], ['Strict', 'Strict'], ['lax', 'Lax'], ['LAX', 'Lax'],
    ['no_restriction', 'None'], ['unspecified', 'None'], [null, 'None'], [undefined, 'None'], ['weird', 'None']
  ])('maps sameSite %s to %s', (input, expected) => {
    expect(toPlaywrightCookies([{ ...base, sameSite: input }])[0].sameSite).toBe(expected);
  });

  it('defaults path, secure and httpOnly', () => {
    expect(toPlaywrightCookies([base])[0]).toEqual({
      ...base, path: '/', secure: true, httpOnly: false, sameSite: 'None'
    });
    expect(toPlaywrightCookies([{ ...base, path: '/i', secure: false, httpOnly: true }])[0])
      .toMatchObject({ path: '/i', secure: false, httpOnly: true });
  });

  it('drops null and nameless or valueless entries', () => {
    expect(toPlaywrightCookies([null, { ...base, name: '' }, { ...base, value: '' }, base]).map(c => c.name)).toEqual(['n']);
  });

  it('keeps expiry from expires or the extension expirationDate', () => {
    expect(toPlaywrightCookies([{ ...base, expires: 1790000000 }])[0].expires).toBe(1790000000);
    expect(toPlaywrightCookies([{ ...base, expirationDate: 1790000000.5 }])[0].expires).toBe(1790000000.5);
    expect(toPlaywrightCookies([{ ...base, expires: -1 }])[0]).not.toHaveProperty('expires');
    expect(toPlaywrightCookies([base])[0]).not.toHaveProperty('expires');
  });
});
