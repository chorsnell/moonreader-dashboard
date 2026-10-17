const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A local date as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local date and time as YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS, with no time zone. */
export function localDateTime(
  d = new Date(),
  precision: 'minutes' | 'seconds' = 'seconds',
): string {
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${localDate(d)}T${precision === 'minutes' ? time : `${time}:${pad(d.getSeconds())}`}`;
}

/** The timestamp used in update.log: YYYY-MM-DD HH:MM:SS, local time. */
export function logTimestamp(d = new Date()): string {
  return localDateTime(d).replace('T', ' ');
}

const DAY_MS = 86_400_000;

/** The calendar date `days` days after 1970-01-01, as YYYY-MM-DD. */
export function dateFromEpochDays(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * Rounds to one decimal place the way the dashboard always has (Python's round): by the
 * number's exact value, with exact halves such as 1.25 going to the even digit (1.2).
 */
export function round1(n: number): number {
  // n * 4 and n * 2 are exact, so this spots the only values that sit exactly on a half
  if (Number.isInteger(n * 4) && !Number.isInteger(n * 2)) {
    const below = Math.floor(n * 10);
    return (below % 2 === 0 ? below : below + 1) / 10;
  }
  return Number(n.toFixed(1));
}
