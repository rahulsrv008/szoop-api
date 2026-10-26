import { SETTING_KEYS, SettingsService } from 'src/common/services/settings.service';

export interface ReferralConfig {
  enabled: boolean;
  /** How many people can use one code, ever. */
  maxPerAgent: number;
  /** How many levels up a reward goes; 1 = direct referrer only. */
  maxLevels: number;
  /** Level 1 reward for the 1st, 2nd, 3rd… referee to qualify; the last repeats. */
  rewardTiers: number[];
  /** Level 2, 3, … rewards; the last repeats for deeper levels. */
  levelRewards: number[];
  /** Lifetime limit on level 1 + deeper rewards per agent. */
  maxEarning: number;
  /** Jobs a referee must complete before anyone is rewarded. */
  qualifyJobs: number;
  joiningBonus: number;
  /** Jobs an agent needs in the window to receive level 2+ rewards; 0 = always. */
  activeMinJobs: number;
  activeWindowDays: number;
}

export const REFERRAL_DEFAULTS: ReferralConfig = {
  enabled: false,
  maxPerAgent: 3,
  maxLevels: 3,
  rewardTiers: [300, 500, 700],
  levelRewards: [100, 50],
  maxEarning: 5000,
  qualifyJobs: 5,
  joiningBonus: 200,
  activeMinJobs: 10,
  activeWindowDays: 30,
};

/** Hard bound on levels so a typo (30 instead of 3) can't pay 30 levels up. */
export const REFERRAL_MAX_LEVELS_LIMIT = 10;

/**
 * Reads every referral setting (admin panel row → env var → default). Values
 * that don't parse or are out of range fall back to the default, so a bad
 * setting never stops signups or rewards.
 */
export async function readReferralConfig(
  settings: SettingsService,
): Promise<ReferralConfig> {
  const d = REFERRAL_DEFAULTS;
  const [
    enabled,
    maxPerAgent,
    maxLevels,
    rewardTiers,
    levelRewards,
    maxEarning,
    qualifyJobs,
    joiningBonus,
    activeMinJobs,
    activeWindowDays,
  ] = await Promise.all([
    settings.get<unknown>(SETTING_KEYS.REFERRAL_ENABLED, d.enabled),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_MAX_PER_AGENT, d.maxPerAgent),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_MAX_LEVELS, d.maxLevels),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_REWARD_TIERS, d.rewardTiers),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_LEVEL_REWARDS, d.levelRewards),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_MAX_EARNING, d.maxEarning),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_QUALIFY_JOBS, d.qualifyJobs),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_JOINING_BONUS, d.joiningBonus),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_ACTIVE_MIN_JOBS, d.activeMinJobs),
    settings.get<unknown>(SETTING_KEYS.REFERRAL_ACTIVE_WINDOW_DAYS, d.activeWindowDays),
  ]);

  return {
    enabled: toBool(enabled, d.enabled),
    maxPerAgent: toInt(maxPerAgent, 1, 100, d.maxPerAgent),
    maxLevels: toInt(maxLevels, 1, REFERRAL_MAX_LEVELS_LIMIT, d.maxLevels),
    rewardTiers: toAmounts(rewardTiers, d.rewardTiers),
    levelRewards: toAmounts(levelRewards, d.levelRewards),
    maxEarning: toInt(maxEarning, 0, 1_000_000, d.maxEarning),
    qualifyJobs: toInt(qualifyJobs, 1, 1000, d.qualifyJobs),
    joiningBonus: toInt(joiningBonus, 0, 100_000, d.joiningBonus),
    activeMinJobs: toInt(activeMinJobs, 0, 1000, d.activeMinJobs),
    activeWindowDays: toInt(activeWindowDays, 1, 365, d.activeWindowDays),
  };
}

function toBool(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return fallback;
}

function toInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Accepts a JSON array from the admin panel or "300,500,700" from the env. */
function toAmounts(value: unknown, fallback: number[]) {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').filter((part) => part.trim() !== '')
      : null;
  if (!parts?.length) return fallback;
  const amounts = parts.map((part) => Number(part));
  return amounts.every((n) => Number.isFinite(n) && n >= 0) ? amounts : fallback;
}
