/**
 * Postgres `date` columns come back as 'YYYY-MM-DD' and `time` columns as
 * 'HH:MM:SS', so the agent modules build and compare them as plain strings.
 * Everything below reads the process's local calendar, which
 * src/config/timezone.ts pins to India time whatever the host's zone — going
 * through UTC would shift "today" by a day for the first 5.5 hours of every
 * IST morning.
 */

export function toDateString(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayString() {
  return toDateString(new Date());
}

export function toTimeString(value: Date) {
  return value.toTimeString().slice(0, 8);
}

/** Inclusive first/last day of the month the given date falls in. */
export function monthRange(reference: Date = new Date()) {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  return {
    from: toDateString(new Date(year, month, 1)),
    to: toDateString(new Date(year, month + 1, 0)),
  };
}

/** Falls back to the current month when the client sends no range. */
export function resolveDateRange(range: { from?: string; to?: string }) {
  const fallback = monthRange();
  return {
    from: range.from ?? fallback.from,
    to: range.to ?? fallback.to,
  };
}

/** Monday of the week the given date falls in. */
export function weekStartString(reference: Date = new Date()) {
  const date = new Date(reference);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return toDateString(date);
}
