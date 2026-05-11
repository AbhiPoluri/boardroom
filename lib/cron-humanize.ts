/**
 * Translate a 5-field cron expression to plain English.
 * Covers the common patterns; falls back to the raw expression for anything
 * unusual (ranges with steps, multi-field combinations, etc.).
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtTime(hour: string, min: string): string | null {
  const h = parseInt(hour, 10);
  const m = parseInt(min, 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}:00 ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function humanizeCron(expr: string): string {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mo, dow] = parts;
  const isInt = (s: string) => /^\d+$/.test(s);

  // every N minutes
  const minStep = min.match(/^\*\/(\d+)$/);
  if (minStep && hour === '*' && dom === '*' && mo === '*' && dow === '*') {
    return `every ${minStep[1]} minutes`;
  }

  // every minute
  if (min === '*' && hour === '*' && dom === '*' && mo === '*' && dow === '*') {
    return 'every minute';
  }

  // every hour at :MM
  if (isInt(min) && hour === '*' && dom === '*' && mo === '*' && dow === '*') {
    return parseInt(min, 10) === 0
      ? 'every hour'
      : `every hour at :${min.padStart(2, '0')}`;
  }

  // every N hours
  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (hourStep && isInt(min) && dom === '*' && mo === '*' && dow === '*') {
    return parseInt(min, 10) === 0
      ? `every ${hourStep[1]} hours`
      : `every ${hourStep[1]} hours at :${min.padStart(2, '0')}`;
  }

  // daily at TIME — "M H * * *"
  if (isInt(min) && isInt(hour) && dom === '*' && mo === '*' && dow === '*') {
    const t = fmtTime(hour, min);
    return t ? `every day at ${t}` : expr;
  }

  // weekly on a single weekday — "M H * * D"
  if (isInt(min) && isInt(hour) && dom === '*' && mo === '*' && isInt(dow)) {
    const t = fmtTime(hour, min);
    const day = DAY_LONG[parseInt(dow, 10) % 7];
    return t && day ? `every ${day} at ${t}` : expr;
  }

  // weekday range — "M H * * D1-D2"
  const dowRange = dow.match(/^(\d+)-(\d+)$/);
  if (isInt(min) && isInt(hour) && dom === '*' && mo === '*' && dowRange) {
    const t = fmtTime(hour, min);
    const a = DAY_NAMES[parseInt(dowRange[1], 10) % 7];
    const b = DAY_NAMES[parseInt(dowRange[2], 10) % 7];
    if (t && a && b) {
      // Special case: 1-5 = weekdays
      if (dowRange[1] === '1' && dowRange[2] === '5') return `weekdays at ${t}`;
      return `${a}–${b} at ${t}`;
    }
  }

  // weekday list — "M H * * D1,D2,..."
  if (isInt(min) && isInt(hour) && dom === '*' && mo === '*' && /^\d+(,\d+)+$/.test(dow)) {
    const t = fmtTime(hour, min);
    const days = dow.split(',').map(d => DAY_NAMES[parseInt(d, 10) % 7]).filter(Boolean);
    if (t && days.length) {
      // 0,6 = weekends
      if (dow === '0,6' || dow === '6,0') return `weekends at ${t}`;
      return `${days.join(', ')} at ${t}`;
    }
  }

  // monthly on a specific day — "M H D * *"
  if (isInt(min) && isInt(hour) && isInt(dom) && mo === '*' && dow === '*') {
    const t = fmtTime(hour, min);
    const ord = ordinal(parseInt(dom, 10));
    return t ? `${ord} of every month at ${t}` : expr;
  }

  // every day every N hours — "0 */N * * *" already covered above

  return expr;
}
