import { describe, it, expect } from 'vitest';
import { slugifyWithSuffix } from '../utils/slug.js';

const HEX_SUFFIX = /-[0-9a-f]{8}$/;
function baseOf(slug) {
  return slug.replace(HEX_SUFFIX, '');
}

describe('slugifyWithSuffix', () => {
  it('lowercases, strips punctuation, replaces spaces with hyphens', () => {
    expect(baseOf(slugifyWithSuffix('Cuyahoga Waterfalls Tour!'))).toBe('cuyahoga-waterfalls-tour');
  });

  it('collapses repeated whitespace and hyphens', () => {
    expect(baseOf(slugifyWithSuffix('  Cuyahoga   Valley  ---  Tour '))).toBe('cuyahoga-valley-tour');
  });

  it('trims leading and trailing hyphens', () => {
    expect(baseOf(slugifyWithSuffix('---trail---'))).toBe('trail');
  });

  it('falls back to "trip" for null or empty input', () => {
    expect(baseOf(slugifyWithSuffix(''))).toBe('trip');
    expect(baseOf(slugifyWithSuffix(null))).toBe('trip');
    expect(baseOf(slugifyWithSuffix(undefined))).toBe('trip');
  });

  it('caps the base slug at 60 characters', () => {
    const long = 'a'.repeat(120);
    expect(baseOf(slugifyWithSuffix(long)).length).toBe(60);
  });

  it('strips characters that arent alphanumeric or spaces or hyphens', () => {
    expect(baseOf(slugifyWithSuffix('Towpath: River & Trail @ Stop #1'))).toBe('towpath-river-trail-stop-1');
  });

  it('appends an 8-character hex suffix', () => {
    expect(slugifyWithSuffix('Brandywine Falls')).toMatch(/^brandywine-falls-[0-9a-f]{8}$/);
  });

  it('produces distinct slugs for the same input on repeated calls', () => {
    const a = slugifyWithSuffix('Brandywine Falls');
    const b = slugifyWithSuffix('Brandywine Falls');
    expect(a).not.toBe(b);
  });
});
