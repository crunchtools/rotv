import { describe, it, expect } from 'vitest';
import { allowedPreferences } from '../routes/userSettings.js';

describe('allowedPreferences', () => {
  it('keeps a known preference with an allowed value', () => {
    expect(allowedPreferences({ listSort: 'park' })).toEqual({ listSort: 'park' });
    expect(allowedPreferences({ listSort: 'difficulty-desc' })).toEqual({ listSort: 'difficulty-desc' });
  });

  it('drops unknown keys, disallowed values and non-objects', () => {
    expect(allowedPreferences({ listSort: 'sideways', isAdmin: true })).toEqual({});
    expect(allowedPreferences(null)).toEqual({});
    expect(allowedPreferences('listSort')).toEqual({});
  });
});
