import { describe, expect, it } from 'vitest';
import { diffWindowFromCron } from './cadence';

describe('diffWindowFromCron', () => {
  it('maps a once-daily cron to a 24h window', () => {
    expect(diffWindowFromCron('0 2 * * *')).toBe('the last 24 hours');
  });

  it('maps a true weekly cron (single weekday) to a 7-day window', () => {
    expect(diffWindowFromCron('0 2 * * 1')).toBe('the last 7 days');
    expect(diffWindowFromCron('0 2 * * MON')).toBe('the last 7 days');
  });

  it('maps a weekday-daily cron to its largest gap, not a full week', () => {
    // Mon–Fri: the only long gap is Fri → Mon (3 days), NOT 7.
    expect(diffWindowFromCron('0 2 * * 1-5')).toBe('the last 3 days');
    expect(diffWindowFromCron('0 2 * * MON-FRI')).toBe('the last 3 days');
  });

  it('handles weekday lists and steps by their largest inter-fire gap', () => {
    // Mon & Thu: gaps are 3 (Mon→Thu) and 4 (Thu→Mon) → 4.
    expect(diffWindowFromCron('0 2 * * 1,4')).toBe('the last 4 days');
    // Every other day-of-week starting Sunday → daily-ish, largest gap 2.
    expect(diffWindowFromCron('0 2 * * */2')).toBe('the last 2 days');
  });

  it('treats every weekday (0-6) as effectively daily', () => {
    expect(diffWindowFromCron('0 2 * * 0-6')).toBe('the last 24 hours');
  });

  it('maps a day-of-month cron to a 30-day window', () => {
    expect(diffWindowFromCron('0 2 1 * *')).toBe('the last 30 days');
  });

  it('treats sub-daily crons (non-singular minute/hour) as a 24h window', () => {
    expect(diffWindowFromCron('*/30 * * * *')).toBe('the last 24 hours');
    expect(diffWindowFromCron('0 */6 * * *')).toBe('the last 24 hours');
    expect(diffWindowFromCron('0 9-17 * * 1-5')).toBe('the last 24 hours');
  });

  it('falls back to a 24h window for a malformed expression', () => {
    expect(diffWindowFromCron('not-a-cron')).toBe('the last 24 hours');
  });
});
