/**
 * Render a 5-field POSIX cron (minute hour dom month dow) as a short, human
 * cadence like "Daily at 02:00", "Weekly on Fri at 14:00" or "Every 2 hours".
 * Recognises the common daily/weekly/monthly/interval shapes inline (those read
 * best hand-tuned) and hands everything else to `cronstrue` — raw cron is only
 * ever shown if cronstrue itself can't parse the expression.
 */
import cronstrue from 'cronstrue';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime(minute: string, hour: string): string | null {
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  const h = Number(hour);
  const m = Number(minute);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function dayName(dow: string): string | null {
  if (!/^\d+$/.test(dow)) return null;
  const n = Number(dow);
  // POSIX allows 0 or 7 for Sunday.
  return (n === 7 ? DAY_NAMES[0] : DAY_NAMES[n]) ?? null;
}

/** Nicely-worded cadence for the common shapes; null to fall back to cronstrue. */
function commonCadence(parts: [string, string, string, string, string]): string | null {
  const [minute, hour, dom, month, dow] = parts;
  const everywhere = dom === '*' && month === '*' && dow === '*';

  // Interval / hourly shapes (minute pinned to 0 so they read cleanly).
  if (minute === '0' && everywhere) {
    if (hour === '*') return 'Hourly';
    const stepHours = hour.match(/^\*\/(\d+)$/);
    if (stepHours) return `Every ${stepHours[1]} hours`;
  }

  const time = formatTime(minute, hour);
  if (!time) return null;

  if (everywhere) return `Daily at ${time}`;
  if (month === '*' && dom === '*' && dow !== '*') {
    const day = dayName(dow);
    if (day) return `Weekly on ${day} at ${time}`;
  }
  // Plain numeric day-of-month only — "*/3" and friends aren't monthly, so let
  // cronstrue describe them ("every 3 days") rather than mislabel them.
  if (month === '*' && /^\d+$/.test(dom) && dow === '*') return `Monthly at ${time}`;
  return null;
}

export function formatCadence(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) {
    const common = commonCadence(parts as [string, string, string, string, string]);
    if (common) return common;
  }
  // Ranges, month lists, minute intervals, anything unusual — cronstrue reads
  // best. Raw cron only surfaces when even cronstrue can't parse it.
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: true });
  } catch {
    return cron;
  }
}
