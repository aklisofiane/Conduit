/**
 * Cron cadence → prose review window for the generated Scope node. The window
 * is the *largest* gap between consecutive fires, so a static review window
 * never misses changes made between runs. The `scope` preset bakes a 24h
 * default; the real window rides on `instructionsAppend`.
 *
 * Cadence-aware but dependency-free (this module ships in the web bundle, so no
 * cron-parser dep): it parses the day-of-week / day-of-month fields to tell a
 * true weekly cron (one matching weekday → 7-day gap) from a weekday-daily one
 * (Mon–Fri → 3-day gap), which the old "dow constrained ⇒ weekly" heuristic
 * mislabeled as a 7-day window and re-reviewed the same week every weekday. A
 * proper "since the last run" window is the deeper follow-up.
 */

const DOW_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** A single value in the day-of-week field → 0..6 (POSIX 7 and names map in), else null. */
function dowValue(token: string): number | null {
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    if (n === 7) return 0; // POSIX allows 0 or 7 for Sunday.
    return n >= 0 && n <= 6 ? n : null;
  }
  const named = DOW_NAMES[token.toLowerCase()];
  return named ?? null;
}

/** True when the field is a single integer (e.g. `0`, `2`) rather than `*`/range/list/step. */
function isSingularField(field: string): boolean {
  return /^\d+$/.test(field);
}

/** A cron firing more than once a day (minute or hour is non-singular). */
function firesMultipleTimesPerDay(minute: string, hour: string): boolean {
  return !isSingularField(minute) || !isSingularField(hour);
}

/** Expand a day-of-week field (`1`, `1-5`, `1,4`, steps, `MON-FRI`, …) to the set of matched days. */
function matchedDaysOfWeek(dow: string): Set<number> {
  const out = new Set<number>();
  for (const part of dow.split(',')) {
    const [body, stepRaw] = part.split('/');
    const step = stepRaw && /^\d+$/.test(stepRaw) ? Number(stepRaw) : 1;
    if (step < 1) continue;
    let lo: number | null;
    let hi: number | null;
    if (body === '*') {
      lo = 0;
      hi = 6;
    } else {
      const [a, b] = body!.split('-');
      lo = dowValue(a ?? '');
      hi = b === undefined ? lo : dowValue(b);
    }
    if (lo === null || hi === null) continue;
    // Forward distance handles wrap-around ranges like `FRI-MON` (5 → 1).
    const span = (hi - lo + 7) % 7;
    for (let i = 0; i <= span; i += step) out.add((lo + i) % 7);
  }
  return out;
}

/** Largest gap (in days) between consecutive fires across a week of matched weekdays. */
function maxWeekdayGap(days: Set<number>): number {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length <= 1) return 7; // fires once a week → a 7-day gap
  let max = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 7;
    max = Math.max(max, next - cur);
  }
  return max;
}

function windowForGapDays(gap: number): string {
  if (gap >= 7) return 'the last 7 days';
  if (gap >= 2) return `the last ${gap} days`;
  return 'the last 24 hours';
}

/**
 * Derive the prose diff window for a 5-field POSIX cron. Coarse by design —
 * sub-daily → a day, daily → a day, weekday sets → their largest gap, weekly →
 * 7 days, monthly → 30 days. Falls back to a day for anything unparseable.
 */
export function diffWindowFromCron(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return 'the last 24 hours';
  const [minute, hour, dom, , dow] = fields as [string, string, string, string, string];

  // More than once a day → a day comfortably covers the gap between runs.
  if (firesMultipleTimesPerDay(minute, hour)) return 'the last 24 hours';

  // Day-of-month constrained → monthly cadence.
  if (dom !== '*') return 'the last 30 days';

  // Day-of-week constrained → the largest run between matching weekdays.
  if (dow !== '*') {
    const days = matchedDaysOfWeek(dow);
    if (days.size === 0) return 'the last 7 days'; // unparseable dow → conservative
    return windowForGapDays(maxWeekdayGap(days));
  }

  // Once a day, every day.
  return 'the last 24 hours';
}
