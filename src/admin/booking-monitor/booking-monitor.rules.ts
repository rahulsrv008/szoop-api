/** The step a live job is in; each is timed against when it should have moved on. */
export type MonitorStep = 'WAITING_FOR_AGENT' | 'NOT_SET_OFF' | 'ON_THE_WAY' | 'IN_PROGRESS';

export type MonitorSeverity = 'ok' | 'orange' | 'red';

/** Minutes, all of them. A step turns orange `…OrangeMinutes` after its clock starts and red at `…RedMinutes`. */
export interface MonitorRules {
  /** Broadcast to agents, nobody has taken it. */
  waitingOrangeMinutes: number;
  waitingRedMinutes: number;
  /** An agent picked it but hasn't tapped "I'm on my way". */
  setOffOrangeMinutes: number;
  setOffRedMinutes: number;
  /** On the way, not started by the expected start. */
  arrivalOrangeMinutes: number;
  arrivalRedMinutes: number;
  /** Started, not completed by the booked end. */
  overrunOrangeMinutes: number;
  overrunRedMinutes: number;
  /** A plan visit's agent should be on the way this long before it (plans aren't broadcast per visit). */
  setOffLeadMinutes: number;
  /** A "Right now" agent should have started the job this long after setting off. */
  instantArrivalMinutes: number;
}

export const MONITOR_RULES_SETTING = 'booking_monitor_rules';

export const DEFAULT_MONITOR_RULES: MonitorRules = {
  waitingOrangeMinutes: 3,
  waitingRedMinutes: 5,
  setOffOrangeMinutes: 3,
  setOffRedMinutes: 5,
  arrivalOrangeMinutes: 3,
  arrivalRedMinutes: 5,
  overrunOrangeMinutes: 10,
  overrunRedMinutes: 20,
  setOffLeadMinutes: 30,
  instantArrivalMinutes: 15,
};

export const MAX_RULE_MINUTES = 24 * 60;

export const RULE_PAIRS: [keyof MonitorRules, keyof MonitorRules][] = [
  ['waitingOrangeMinutes', 'waitingRedMinutes'],
  ['setOffOrangeMinutes', 'setOffRedMinutes'],
  ['arrivalOrangeMinutes', 'arrivalRedMinutes'],
  ['overrunOrangeMinutes', 'overrunRedMinutes'],
];

/**
 * The stored setting (object, or JSON text from an env var) laid over the
 * defaults. Unusable values fall back; red never comes before orange.
 */
export function resolveRules(stored: unknown): MonitorRules {
  let raw = stored;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rules: MonitorRules = { ...DEFAULT_MONITOR_RULES };
  for (const key of Object.keys(rules) as (keyof MonitorRules)[]) {
    const value = source[key];
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_RULE_MINUTES) {
      rules[key] = Math.round(parsed);
    }
  }
  for (const [orange, red] of RULE_PAIRS) {
    if (rules[red] < rules[orange]) rules[red] = rules[orange];
  }
  return rules;
}

export function limitsFor(step: MonitorStep, rules: MonitorRules) {
  switch (step) {
    case 'WAITING_FOR_AGENT':
      return { orange: rules.waitingOrangeMinutes, red: rules.waitingRedMinutes };
    case 'NOT_SET_OFF':
      return { orange: rules.setOffOrangeMinutes, red: rules.setOffRedMinutes };
    case 'ON_THE_WAY':
      return { orange: rules.arrivalOrangeMinutes, red: rules.arrivalRedMinutes };
    case 'IN_PROGRESS':
      return { orange: rules.overrunOrangeMinutes, red: rules.overrunRedMinutes };
  }
}

const RANK: Record<MonitorSeverity, number> = { ok: 0, orange: 1, red: 2 };

export function worse(a: MonitorSeverity, b: MonitorSeverity | null | undefined): MonitorSeverity {
  return b && RANK[b] > RANK[a] ? b : a;
}

export function severityRank(severity: MonitorSeverity) {
  return RANK[severity];
}

/** The colour at `now` from the step's own clock, never below `floor`. */
export function severityAt(
  now: Date,
  orangeAt: Date,
  redAt: Date,
  floor: MonitorSeverity | null,
): MonitorSeverity {
  const t = now.getTime();
  const own: MonitorSeverity = t >= redAt.getTime() ? 'red' : t >= orangeAt.getTime() ? 'orange' : 'ok';
  return worse(own, floor);
}

/** A local (India time) moment from a Postgres date and time; the date may be 'YYYY-MM-DD' or a Date. */
export function localMoment(date: string | Date, time: string | null | undefined) {
  const day =
    typeof date === 'string'
      ? date.slice(0, 10)
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return new Date(`${day}T${(time || '00:00:00').slice(0, 8)}`);
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function latest(...dates: (Date | null | undefined)[]) {
  const times = dates.filter((date): date is Date => !!date).map((date) => date.getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}
