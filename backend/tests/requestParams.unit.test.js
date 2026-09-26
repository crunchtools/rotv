import { describe, it, expect } from 'vitest';
import { resolveTimezone, parsePositiveId } from '../utils/requestParams.js';

describe('resolveTimezone', () => {
  it.each(['America/New_York', 'Europe/London', 'America/Indiana/Indianapolis', 'America/Port_of_Spain'])(
    'accepts IANA zone %s', (tz) => {
      expect(resolveTimezone(tz)).toBe(tz);
    });

  it.each([undefined, null, 42, ['America/Chicago'], '', 'UTC', 'EST5EDT', 'America/New_York; DROP TABLE pois',
    "America/New_York' --", 'America/New York', 'A/B/C/D'])(
    'falls back to America/New_York for %j', (tz) => {
      expect(resolveTimezone(tz)).toBe('America/New_York');
    });
});

describe('parsePositiveId', () => {
  it.each([['1', 1], ['42', 42], [7, 7]])('parses %j as %i', (input, expected) => {
    expect(parsePositiveId(input)).toBe(expected);
  });

  it.each(['0', '-3', '1.5', 'abc', '', undefined, null, '12abc', 'Infinity'])('rejects %j', (input) => {
    expect(parsePositiveId(input)).toBeNull();
  });
});
