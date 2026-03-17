const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [minute, hour, dom, month, dow] = parts;

  // every minute
  if (minute === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'every minute';
  }

  // every N minutes
  if (minute.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const n = parseInt(minute.slice(2), 10);
    if (n === 1) return 'every minute';
    return `every ${n} minutes`;
  }

  // specific minute, every hour variants
  if (/^\d+$/.test(minute) && dom === '*' && month === '*') {
    const min = parseInt(minute, 10);

    // every N hours
    if (hour.startsWith('*/')) {
      const n = parseInt(hour.slice(2), 10);
      if (n === 1) return 'every hour';
      return `every ${n} hours`;
    }

    // every hour at minute 0
    if (hour === '*') {
      if (min === 0) return 'every hour';
      return `every hour at minute ${min}`;
    }

    // specific hour
    if (/^\d+$/.test(hour)) {
      const h = parseInt(hour, 10);
      const timeStr = formatHour(h);

      // weekdays
      if (dow === '1-5') return `weekdays at ${timeStr}`;

      // weekends
      if (dow === '0,6' || dow === '6,0') return `weekends at ${timeStr}`;

      // specific weekday
      if (/^\d$/.test(dow)) {
        const dayNum = parseInt(dow, 10);
        return `weekly on ${DAY_NAMES[dayNum]} at ${timeStr}`;
      }

      // monthly on specific day
      if (/^\d+$/.test(dom) && dow === '*') {
        const d = parseInt(dom, 10);
        const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
        if (h === 0 && min === 0) return `monthly on the ${d}${suffix}`;
        return `monthly on the ${d}${suffix} at ${timeStr}`;
      }

      // daily
      if (dow === '*') {
        if (h === 0 && min === 0) return 'daily at midnight';
        if (h === 12 && min === 0) return 'daily at noon';
        return `daily at ${timeStr}`;
      }
    }
  }

  // fallback
  return expr;
}

export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    { min: 0, max: 59 },  // minute
    { min: 0, max: 23 },  // hour
    { min: 1, max: 31 },  // day of month
    { min: 1, max: 12 },  // month
    { min: 0, max: 7 },   // day of week (0 and 7 are both sunday)
  ];

  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    const range = ranges[i];

    // wildcard
    if (field === '*') continue;

    // step: */N or N/N
    if (field.includes('/')) {
      const [base, step] = field.split('/');
      if (base !== '*' && !/^\d+$/.test(base)) return false;
      if (!/^\d+$/.test(step) || parseInt(step, 10) < 1) return false;
      if (base !== '*') {
        const n = parseInt(base, 10);
        if (n < range.min || n > range.max) return false;
      }
      continue;
    }

    // range: N-N
    if (field.includes('-') && !field.includes(',')) {
      const [a, b] = field.split('-');
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (na < range.min || nb > range.max || na > nb) return false;
      continue;
    }

    // list: N,N,N (may contain ranges)
    if (field.includes(',')) {
      const items = field.split(',');
      for (const item of items) {
        if (item.includes('-')) {
          const [a, b] = item.split('-');
          if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
          const na = parseInt(a, 10);
          const nb = parseInt(b, 10);
          if (na < range.min || nb > range.max) return false;
        } else {
          if (!/^\d+$/.test(item)) return false;
          const n = parseInt(item, 10);
          if (n < range.min || n > range.max) return false;
        }
      }
      continue;
    }

    // single number
    if (/^\d+$/.test(field)) {
      const n = parseInt(field, 10);
      if (n < range.min || n > range.max) return false;
      continue;
    }

    return false;
  }

  return true;
}

export function getNextRunDescription(expr: string): string {
  if (!isValidCron(expr)) return '';

  const parts = expr.trim().split(/\s+/);
  const [minute, hour] = parts;

  // Rough estimation based on cron pattern
  if (minute === '*') return 'next: in ~1 minute';
  if (minute.startsWith('*/')) {
    const n = parseInt(minute.slice(2), 10);
    return `next: in ~${n} minute${n !== 1 ? 's' : ''}`;
  }
  if (hour === '*') return 'next: within the hour';
  if (hour.startsWith('*/')) {
    const n = parseInt(hour.slice(2), 10);
    return `next: within ~${n} hour${n !== 1 ? 's' : ''}`;
  }

  // Specific hour — calculate rough time until next run
  if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    const now = new Date();
    const targetH = parseInt(hour, 10);
    const targetM = parseInt(minute, 10);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const targetMinutes = targetH * 60 + targetM;
    let diff = targetMinutes - nowMinutes;
    if (diff <= 0) diff += 24 * 60; // next day

    if (diff < 60) return `next: in ~${diff} minute${diff !== 1 ? 's' : ''}`;
    const hours = Math.floor(diff / 60);
    return `next: in ~${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  return 'next: scheduled';
}
