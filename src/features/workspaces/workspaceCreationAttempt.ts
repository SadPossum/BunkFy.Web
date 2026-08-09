export type WorkspaceCreationPayload = {
  name: string;
  slug: string;
};

export type WorkspaceCreationAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveWorkspaceCreationAttempt(
  current: WorkspaceCreationAttempt | null,
  payload: WorkspaceCreationPayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): WorkspaceCreationAttempt {
  const fingerprint = workspaceCreationFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function workspaceCreationFingerprint(
  payload: WorkspaceCreationPayload,
): string {
  return JSON.stringify({
    name: payload.name.trim(),
    slug: payload.slug.trim().toLowerCase(),
  });
}
