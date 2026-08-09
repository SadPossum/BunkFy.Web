export type WorkspaceUpdatePayload = {
  organizationId: string;
  expectedVersion: number;
  name: string;
  slug: string;
};

export type WorkspaceUpdateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveWorkspaceUpdateAttempt(
  current: WorkspaceUpdateAttempt | null,
  payload: WorkspaceUpdatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): WorkspaceUpdateAttempt {
  const fingerprint = workspaceUpdateFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function workspaceUpdateFingerprint(
  payload: WorkspaceUpdatePayload,
): string {
  return JSON.stringify({
    organizationId: payload.organizationId,
    expectedVersion: payload.expectedVersion,
    name: payload.name.trim(),
    slug: payload.slug.trim().toLowerCase(),
  });
}
