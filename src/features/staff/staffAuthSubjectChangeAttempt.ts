import { staffMutationHash } from "./staffMutationAttempt";

export type StaffAuthSubjectChangeAttempt = {
  staffMemberId: string;
  expectedVersion: number;
  subjectFingerprint: string;
  requestFingerprint: string;
  operationId: string;
};

export async function resolveStaffAuthSubjectChangeAttempt(
  current: StaffAuthSubjectChangeAttempt | null,
  staffMemberId: string,
  currentVersion: number,
  authSubjectId: string | null,
  createOperationId: () => string = () => crypto.randomUUID(),
): Promise<StaffAuthSubjectChangeAttempt> {
  const normalizedSubject = authSubjectId?.trim() || "";
  const subjectFingerprint = await staffMutationHash([
    "staff-auth-subject-change-ui-value-v1",
    staffMemberId.toLowerCase(),
    normalizedSubject,
  ]);
  const expectedVersion = current &&
      current.staffMemberId === staffMemberId &&
      current.subjectFingerprint === subjectFingerprint
    ? current.expectedVersion
    : currentVersion;
  const requestFingerprint = await staffMutationHash([
    "staff-auth-subject-change-ui-request-v1",
    staffMemberId.toLowerCase(),
    String(expectedVersion),
    subjectFingerprint,
  ]);

  return current?.requestFingerprint === requestFingerprint
    ? current
    : {
        staffMemberId,
        expectedVersion,
        subjectFingerprint,
        requestFingerprint,
        operationId: createOperationId(),
      };
}
