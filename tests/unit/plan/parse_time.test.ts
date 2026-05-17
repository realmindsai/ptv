import { describe, it, expect } from 'vitest';
import { parseTime } from '../../../src/plan/parse_time';

describe('parseTime()', () => {
  it('returns undefined for undefined', () => {
    expect(parseTime(undefined)).toBeUndefined();
  });

  it('parses an ISO8601 timezone-aware string verbatim', () => {
    const t = parseTime('2026-05-16T08:00:00Z');
    expect(t?.toISOString()).toBe('2026-05-16T08:00:00.000Z');
  });

  it('rejects an obviously invalid string', () => {
    expect(() => parseTime('not-a-date')).toThrow(/invalid date/);
  });

  it('parses HH:MM as Melbourne local time (offset +10 or +11)', () => {
    const parsed = parseTime('08:00');
    expect(parsed).toBeInstanceOf(Date);
    const melHour = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne', hour: 'numeric', hour12: false,
    }).format(parsed as Date);
    expect(parseInt(melHour, 10)).toBe(8);
  });

  it('parses HH:MM with a different hour correctly', () => {
    const parsed = parseTime('17:30');
    const melTime = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).format(parsed as Date);
    // Melbourne should report 17:30 (allow for both "17:30" and "17.30" locale variants)
    expect(melTime).toMatch(/^17[:.]30$/);
  });
});
