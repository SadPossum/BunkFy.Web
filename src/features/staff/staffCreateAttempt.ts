export type StaffCreatePayload = {
  displayName: string;
  legalName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  employeeNumber: string | null;
  jobTitle: string | null;
  department: string | null;
  authSubjectId?: string | null;
};

export type StaffCreateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveStaffCreateAttempt(
  current: StaffCreateAttempt | null,
  payload: StaffCreatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): StaffCreateAttempt {
  const fingerprint = staffCreateFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function staffCreateFingerprint(payload: StaffCreatePayload): string {
  return JSON.stringify({
    displayName: payload.displayName.trim(),
    legalName: normalizeOptional(payload.legalName),
    workEmail: normalizeOptional(payload.workEmail)?.toLowerCase() ?? null,
    workPhone: normalizeOptional(payload.workPhone),
    employeeNumber: normalizeOptional(payload.employeeNumber),
    jobTitle: normalizeOptional(payload.jobTitle),
    department: normalizeOptional(payload.department),
    authSubjectId: normalizeOptional(payload.authSubjectId),
  });
}

function normalizeOptional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}
