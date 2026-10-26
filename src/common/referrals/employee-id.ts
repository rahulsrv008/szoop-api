import { randomInt } from 'crypto';
import { todayString } from 'src/agent/shared/date.util';

/** No 0/O or 1/I/L, so a code read out over the phone can't be mistyped. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RANDOM_LENGTH = 5;

/** SZ + 2-digit year + 5 random characters, e.g. SZ26K7M4P (~28M per year). */
export function generateEmployeeId(today = todayString()) {
  let suffix = '';
  for (let i = 0; i < RANDOM_LENGTH; i += 1) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `SZ${today.slice(2, 4)}${suffix}`;
}

/** Accepts what people type: any case, with spaces or dashes ("sz26-k7m4p"). */
export function normalizeEmployeeId(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** SZ26K7M4P → SZ26-K7M4P, for display only. */
export function formatEmployeeId(id: string | null) {
  return id ? `${id.slice(0, 4)}-${id.slice(4)}` : null;
}
