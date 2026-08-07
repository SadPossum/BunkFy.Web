import { staffMutationHash } from "./staffMutationAttempt";

export type StaffLifecycleAction = "suspend" | "resume" | "depart";

export type StaffLifecycleAttempt = {
  staffMemberId: string;
  action: StaffLifecycleAction;
  expectedVersion: number;
  valueFingerprint: string;
  requestFingerprint: string;
  operationId: string;
};

export async function resolveStaffLifecycleAttempt(
  current: StaffLifecycleAttempt | null,
  staffMemberId: string,
  currentVersion: number,
  action: StaffLifecycleAction,
  reason: string,
  effectiveOn: string,
  createOperationId: () => string = () => crypto.randomUUID(),
): Promise<StaffLifecycleAttempt> {
  const normalizedReason = reason.trim();
  const normalizedEffectiveOn = action === "depart" ? effectiveOn.trim() : "";
  const valueFingerprint = await staffMutationHash([
    "staff-lifecycle-ui-value-v1",
    staffMemberId.toLowerCase(),
    action,
    normalizedReason,
    normalizedEffectiveOn,
  ]);
  const expectedVersion = current &&
      current.staffMemberId === staffMemberId &&
      current.action === action &&
      current.valueFingerprint === valueFingerprint
    ? current.expectedVersion
    : currentVersion;
  const requestFingerprint = await staffMutationHash([
    "staff-lifecycle-ui-request-v1",
    staffMemberId.toLowerCase(),
    String(expectedVersion),
    valueFingerprint,
  ]);

  return current?.requestFingerprint === requestFingerprint
    ? current
    : {
        staffMemberId,
        action,
        expectedVersion,
        valueFingerprint,
        requestFingerprint,
        operationId: createOperationId(),
      };
}
