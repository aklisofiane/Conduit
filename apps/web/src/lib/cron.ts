/**
 * Render a 5-field POSIX cron (minute hour dom month dow) as a short, human
 * cadence like "Daily at 02:00" or "Weekly on Mon". Deliberately simple — it
 * only recognises the common daily/weekly/monthly shapes the analyzer emits and
 * falls back to the raw expression for anything it doesn't understand.
 */
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

export function formatCadence(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const time = formatTime(minute, hour);

  if (dom === '*' && month === '*' && dow === '*') {
    return time ? `Daily at ${time}` : 'Daily';
  }
  if (dow !== '*' && dom === '*') {
    const day = dayName(dow);
    if (day) return time ? `Weekly on ${day} at ${time}` : `Weekly on ${day}`;
    return 'Weekly';
  }
  if (dom !== '*') {
    return time ? `Monthly at ${time}` : 'Monthly';
  }
  return cron;
}
