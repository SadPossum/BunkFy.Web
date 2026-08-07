import { staffMutationHash } from "./staffMutationAttempt";

export type StaffPropertyAssignmentAttemptInput =
  | {
      action: "assignment";
      propertyJobTitle: string | null;
      isPrimary: boolean;
      effectiveFrom: string;
    }
  | {
      action: "unassign";
      effectiveTo: string;
      reason: string;
    };

export type StaffPropertyAssignmentAttempt = {
  staffMemberId: string;
  propertyId: string;
  action: StaffPropertyAssignmentAttemptInput["action"];
  expectedVersion: number;
  valueFingerprint: string;
  requestFingerprint: string;
  operationId: string;
};

export async function resolveStaffPropertyAssignmentAttempt(
  current: StaffPropertyAssignmentAttempt | null,
  staffMemberId: string,
  propertyId: string,
  currentVersion: number,
  input: StaffPropertyAssignmentAttemptInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): Promise<StaffPropertyAssignmentAttempt> {
  const normalizedValues = input.action === "assignment"
    ? [
        input.propertyJobTitle?.trim() ?? "",
        input.isPrimary ? "1" : "0",
        input.effectiveFrom.trim(),
      ]
    : [input.effectiveTo.trim(), input.reason.trim()];
  const valueFingerprint = await staffMutationHash([
    "staff-property-assignment-ui-value-v1",
    staffMemberId.toLowerCase(),
    propertyId.toLowerCase(),
    input.action,
    ...normalizedValues,
  ]);
  const expectedVersion = current &&
      current.staffMemberId === staffMemberId &&
      current.propertyId === propertyId &&
      current.action === input.action &&
      current.valueFingerprint === valueFingerprint
    ? current.expectedVersion
    : currentVersion;
  const requestFingerprint = await staffMutationHash([
    "staff-property-assignment-ui-request-v1",
    staffMemberId.toLowerCase(),
    propertyId.toLowerCase(),
    String(expectedVersion),
    valueFingerprint,
  ]);

  return current?.requestFingerprint === requestFingerprint
    ? current
    : {
        staffMemberId,
        propertyId,
        action: input.action,
        expectedVersion,
        valueFingerprint,
        requestFingerprint,
        operationId: createOperationId(),
      };
}
