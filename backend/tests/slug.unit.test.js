import { describe, it, expect } from 'vitest';
import { slugify, slugifyWithSuffix } from '../utils/slug.js';

describe('slugify', () => {
  it('lowercases, strips punctuation, replaces spaces with hyphens', () => {
    expect(slugify('Cuyahoga Waterfalls Tour!')).toBe('cuyahoga-waterfalls-tour');
  });

  it('collapses repeated whitespace and hyphens', () => {
    expect(slugify('  Cuyahoga   Valley  ---  Tour ')).toBe('cuyahoga-valley-tour');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('---trail---')).toBe('trail');
  });

  it('returns empty string for null or empty input', () => {
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });

  it('caps the slug at 60 characters', () => {
    const long = 'a'.repeat(120);
    expect(slugify(long).length).toBe(60);
  });

  it('strips characters that arent alphanumeric or spaces or hyphens', () => {
    expect(slugify('Towpath: River & Trail @ Stop #1')).toBe('towpath-river-trail-stop-1');
  });
});

describe('slugifyWithSuffix', () => {
  it('appends a hex suffix after the base slug', () => {
    const s = slugifyWithSuffix('Brandywine Falls');
    expect(s).toMatch(/^brandywine-falls-[0-9a-f]{8}$/);
  });

  it('falls back to "trip" when name is empty', () => {
    const s = slugifyWithSuffix('');
    expect(s).toMatch(/^trip-[0-9a-f]{8}$/);
  });

  it('produces distinct slugs for the same input on repeated calls', () => {
    const a = slugifyWithSuffix('Brandywine Falls');
    const b = slugifyWithSuffix('Brandywine Falls');
    expect(a).not.toBe(b);
  });
});
