import {
  staffCreateFingerprint,
  type StaffCreatePayload,
} from "./staffCreateAttempt";
import {
  isStaffMutationFingerprint,
  isStaffMutationOperationId,
  staffMutationHash,
} from "./staffMutationAttempt";

const ONBOARDING_ATTEMPT_KEY = "bunkfy.onboarding.staff-profile-update.v1";

export type StaffProfileUpdatePayload = Omit<
  StaffCreatePayload,
  "authSubjectId"
>;

export type StaffProfileUpdateAttempt = {
  staffMemberId: string;
  expectedVersion: number;
  profileFingerprint: string;
  requestFingerprint: string;
  operationId: string;
};

export async function resolveStaffProfileUpdateAttempt(
  current: StaffProfileUpdateAttempt | null,
  staffMemberId: string,
  expectedVersion: number,
  payload: StaffProfileUpdatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): Promise<StaffProfileUpdateAttempt> {
  const profileFingerprint = await staffProfileFingerprint(
    staffMemberId,
    payload,
  );
  return resolveAttempt(
    current,
    staffMemberId,
    expectedVersion,
    profileFingerprint,
    createOperationId,
  );
}

export async function resolveDurableStaffProfileUpdateAttempt(
  current: StaffProfileUpdateAttempt | null,
  staffMemberId: string,
  currentVersion: number,
  payload: StaffProfileUpdatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): Promise<StaffProfileUpdateAttempt> {
  const profileFingerprint = await staffProfileFingerprint(
    staffMemberId,
    payload,
  );
  const expectedVersion = current &&
    current.staffMemberId === staffMemberId &&
    current.profileFingerprint === profileFingerprint
    ? current.expectedVersion
    : currentVersion;
  return resolveAttempt(
    current,
    staffMemberId,
    expectedVersion,
    profileFingerprint,
    createOperationId,
  );
}

export function readStaffProfileUpdateAttempt(
  staffMemberId: string,
  storage: Pick<Storage, "getItem"> = window.sessionStorage,
): StaffProfileUpdateAttempt | null {
  try {
    const value = JSON.parse(
      storage.getItem(onboardingAttemptKey(staffMemberId)) ?? "null",
    ) as Partial<StaffProfileUpdateAttempt> | null;
    return isAttempt(value, staffMemberId) ? value : null;
  } catch {
    return null;
  }
}

export function saveStaffProfileUpdateAttempt(
  attempt: StaffProfileUpdateAttempt,
  storage: Pick<Storage, "setItem"> = window.sessionStorage,
): void {
  storage.setItem(
    onboardingAttemptKey(attempt.staffMemberId),
    JSON.stringify(attempt),
  );
}

export function clearStaffProfileUpdateAttempt(
  staffMemberId: string,
  storage: Pick<Storage, "removeItem"> = window.sessionStorage,
): void {
  storage.removeItem(onboardingAttemptKey(staffMemberId));
}

async function resolveAttempt(
  current: StaffProfileUpdateAttempt | null,
  staffMemberId: string,
  expectedVersion: number,
  profileFingerprint: string,
  createOperationId: () => string,
): Promise<StaffProfileUpdateAttempt> {
  const requestFingerprint = await staffMutationHash([
    "staff-profile-update-ui-request-v1",
    staffMemberId.toLowerCase(),
    String(expectedVersion),
    profileFingerprint,
  ]);
  return current?.requestFingerprint === requestFingerprint
    ? current
    : {
        staffMemberId,
        expectedVersion,
        profileFingerprint,
        requestFingerprint,
        operationId: createOperationId(),
      };
}

async function staffProfileFingerprint(
  staffMemberId: string,
  payload: StaffProfileUpdatePayload,
): Promise<string> {
  return staffMutationHash([
    "staff-profile-update-ui-profile-v1",
    staffMemberId.toLowerCase(),
    staffCreateFingerprint({ ...payload, authSubjectId: null }),
  ]);
}

function isAttempt(
  value: Partial<StaffProfileUpdateAttempt> | null,
  staffMemberId: string,
): value is StaffProfileUpdateAttempt {
  return value?.staffMemberId === staffMemberId &&
    Number.isSafeInteger(value.expectedVersion) &&
    (value.expectedVersion ?? 0) > 0 &&
    isStaffMutationFingerprint(value.profileFingerprint) &&
    isStaffMutationFingerprint(value.requestFingerprint) &&
    isStaffMutationOperationId(value.operationId);
}

function onboardingAttemptKey(staffMemberId: string): string {
  return `${ONBOARDING_ATTEMPT_KEY}:${staffMemberId.toLowerCase()}`;
}
