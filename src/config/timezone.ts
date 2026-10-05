/**
 * Bookings are entered and read as India wall-clock values ('2026-10-20' +
 * '10:00:00'), and the code turns those strings into Dates in the process's
 * local zone. Pin that zone so the result is the same on a laptop, in Docker
 * or on Vercel (which runs in UTC). Imported first by every entry point,
 * before anything creates a Date.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
process.env.TZ = APP_TIMEZONE;
