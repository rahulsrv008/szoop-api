/**
 * Onboarding is four steps (personal details → KYC documents → selfie →
 * bank details) followed by an admin approval. Auth and registration both report progress,
 * so the shape and the step resolution live here.
 */

/** KYC documents an agent must upload before admin approval. */
export const REQUIRED_DOCUMENT_TYPES = ['AADHAAR', 'PAN'] as const;

export type RegistrationStep =
  | 'personal-details'
  | 'documents'
  | 'profile-photo'
  | 'bank-details'
  | 'awaiting-approval'
  | 'done';

export interface RegistrationSteps {
  personalDetails: boolean;
  documents: boolean;
  /** The selfie taken in the app (agents.profile_image). */
  profilePhoto: boolean;
  bankDetails: boolean;
}

export function isRegistrationComplete(steps: RegistrationSteps) {
  return steps.personalDetails && steps.documents && steps.profilePhoto && steps.bankDetails;
}

export function resolveNextStep(
  steps: RegistrationSteps,
  approvalStatus: string,
): RegistrationStep {
  if (!steps.personalDetails) return 'personal-details';
  if (!steps.documents) return 'documents';
  // Agents approved before the selfie was checked aren't sent back for one.
  if (!steps.profilePhoto && approvalStatus !== 'APPROVED') return 'profile-photo';
  if (!steps.bankDetails) return 'bank-details';
  return approvalStatus === 'APPROVED' ? 'done' : 'awaiting-approval';
}

/** The steps the agent still has to finish, for a checklist screen. */
export function missingSteps(steps: RegistrationSteps) {
  const missing: string[] = [];
  if (!steps.personalDetails) missing.push('personalDetails');
  if (!steps.documents) missing.push('documents');
  if (!steps.profilePhoto) missing.push('profilePhoto');
  if (!steps.bankDetails) missing.push('bankDetails');
  return missing;
}
