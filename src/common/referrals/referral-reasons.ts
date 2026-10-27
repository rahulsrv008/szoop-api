import type { ReferralRewardReason } from 'src/database/entities';

export type ReasonAudience = 'agent' | 'admin';

/** Numbers recorded with the reason, as they were when it was decided. */
export interface ReasonDetail {
  jobsDone?: number;
  jobsRequired?: number;
  windowDays?: number;
  cap?: number;
  earned?: number;
  status?: string;
  approvalStatus?: string;
  matchedName?: string;
  matchedEmployeeId?: string | null;
  remarks?: string | null;
  adminName?: string | null;
}

const rupees = (value: number) => `₹${Number(value).toLocaleString('en-IN')}`;

/**
 * Why a reward was missed, cut or taken back, in plain words. The agent reads
 * "you…", the admin reads "Agent…". Null when there's nothing to explain.
 */
export function reasonText(
  code: ReferralRewardReason | null,
  detail: ReasonDetail | null,
  amounts: { intended: number; amount: number },
  audience: ReasonAudience,
): string | null {
  const d = detail ?? {};
  const agent = audience === 'agent';
  switch (code) {
    case 'INACTIVE':
      return agent
        ? `You had ${d.jobsDone} of ${d.jobsRequired} jobs in the last ${d.windowDays} days`
        : `Agent had ${d.jobsDone} of ${d.jobsRequired} required jobs in the last ${d.windowDays} days`;
    case 'CAP_REACHED':
      return agent
        ? `You had already reached the ${rupees(d.cap ?? 0)} limit`
        : `Lifetime limit of ${rupees(d.cap ?? 0)} already reached`;
    case 'CAP_PARTIAL':
      return `Reduced from ${rupees(amounts.intended)} to ${rupees(amounts.amount)}: ${
        agent ? '' : 'lifetime '
      }limit of ${rupees(d.cap ?? 0)} reached`;
    case 'ACCOUNT_INACTIVE':
      return agent
        ? 'Your account was not active at the time'
        : `Agent account was ${(d.status === 'SUSPENDED' ? 'suspended' : 'not approved')} when this was earned`;
    case 'SAME_BANK_ACCOUNT':
      return agent
        ? 'Not allowed: the same bank account is used by both agents'
        : `Same bank account as ${d.matchedName ?? 'another agent'}${
            d.matchedEmployeeId ? ` (${d.matchedEmployeeId})` : ''
          }: likely a self-referral`;
    case 'ADMIN_REVERSED':
      return agent
        ? `Taken back by SZOOP${d.remarks ? `: ${d.remarks}` : ''}`
        : `Reversed by ${d.adminName ?? 'an admin'}${d.remarks ? `: ${d.remarks}` : ''}`;
    default:
      return null;
  }
}
