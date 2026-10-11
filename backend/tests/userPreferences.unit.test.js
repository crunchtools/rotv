import { describe, it, expect } from 'vitest';
import { allowedPreferences } from '../routes/userSettings.js';

describe('allowedPreferences', () => {
  it('keeps a known preference with an allowed value', () => {
    expect(allowedPreferences({ listSort: 'park' })).toEqual({ listSort: 'park' });
    expect(allowedPreferences({ listSort: 'difficulty-desc' })).toEqual({ listSort: 'difficulty-desc' });
  });

  it('keeps the free-choice picks that are a list id and a POI id', () => {
    expect(allowedPreferences({ listChoices: { 1: 1044, 2: 'x', abc: 5, 3: -4 } })).toEqual({ listChoices: { 1: 1044 } });
    expect(allowedPreferences({ listChoices: [1044] })).toEqual({});
    expect(allowedPreferences({ listChoices: { abc: 5 } })).toEqual({});
  });

  it('keeps at most 50 free-choice picks', () => {
    const picks = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i + 1), 1000 + i]));
    const kept = allowedPreferences({ listChoices: picks }).listChoices;
    expect(Object.keys(kept)).toHaveLength(50);
    expect(kept[50]).toBe(1049);
    expect(kept[51]).toBeUndefined();
  });

  it('keeps contact details it knows, trimmed and capped, and lets them be cleared', () => {
    expect(allowedPreferences({ contact: { firstName: ' Scott ', lastName: 'McCarty', zip: '4'.repeat(40), role: 'admin', city: 7, phone: '  ' } }))
      .toEqual({ contact: { firstName: 'Scott', lastName: 'McCarty', zip: '4'.repeat(12), phone: '' } });
    expect(allowedPreferences({ contact: {} })).toEqual({ contact: {} });
    expect(allowedPreferences({ contact: 'Scott' })).toEqual({});
  });

  it('drops unknown keys, disallowed values and non-objects', () => {
    expect(allowedPreferences({ listSort: 'sideways', isAdmin: true })).toEqual({});
    expect(allowedPreferences(null)).toEqual({});
    expect(allowedPreferences('listSort')).toEqual({});
  });
});
