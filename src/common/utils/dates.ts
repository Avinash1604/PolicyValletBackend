// Policy dates are calendar dates (Postgres DATE), held in JS as UTC midnight.

const DAY_MS = 24 * 60 * 60 * 1000;
const indiaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
});

/** "2026-09-26" -> Date at UTC midnight. */
export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date at UTC midnight -> "2026-09-26". */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's date in India, so "expires today" flips at Indian midnight rather than UTC. */
export function today(): Date {
  return parseDate(indiaDate.format(new Date()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}
