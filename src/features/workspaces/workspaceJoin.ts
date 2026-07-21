export type WorkspaceJoinResolution =
  | { kind: "joined"; workspaceId: string }
  | { kind: "pending-approval"; workspaceId: string };

export type WorkspaceJoinSecret = {
  kind: "invitation" | "enrollment";
  token: string;
};

const WORKSPACE_JOIN_SECRET_KEY = "bunkfy.join.secret.v1";

export function parseWorkspaceJoinSecret(hash: string): WorkspaceJoinSecret | null {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const invitation = parameters.get("invitation")?.trim();
  if (invitation) return { kind: "invitation", token: invitation };
  const enrollment = parameters.get("enrollment")?.trim();
  return enrollment ? { kind: "enrollment", token: enrollment } : null;
}

export function preserveWorkspaceJoinSecret(hash: string): WorkspaceJoinSecret | null {
  const secret = parseWorkspaceJoinSecret(hash);
  if (secret) {
    window.sessionStorage.setItem(WORKSPACE_JOIN_SECRET_KEY, JSON.stringify(secret));
  }
  return secret;
}

export function readPreservedWorkspaceJoinSecret(): WorkspaceJoinSecret | null {
  try {
    const value = window.sessionStorage.getItem(WORKSPACE_JOIN_SECRET_KEY);
    if (!value) return null;
    const secret = JSON.parse(value) as Partial<WorkspaceJoinSecret>;
    return (secret.kind === "invitation" || secret.kind === "enrollment") &&
      typeof secret.token === "string" && secret.token.trim()
      ? { kind: secret.kind, token: secret.token.trim() }
      : null;
  } catch {
    return null;
  }
}

export function clearPreservedWorkspaceJoinSecret(): void {
  window.sessionStorage.removeItem(WORKSPACE_JOIN_SECRET_KEY);
}

export function resolveEnrollmentJoin(
  outcome: {
    claim: { organizationId: string };
    membership: { organization: { organizationId: string } } | null;
  },
): WorkspaceJoinResolution {
  return outcome.membership
    ? {
        kind: "joined",
        workspaceId: outcome.membership.organization.organizationId,
      }
    : {
        kind: "pending-approval",
        workspaceId: outcome.claim.organizationId,
    };
}

export function workspaceJoinSourceKind(kind: "invitation" | "enrollment"): 1 | 2 {
  return kind === "invitation" ? 1 : 2;
}

export function isWorkspaceStaffOnboardingInProgress(status: number | undefined): boolean {
  return status === 1 || status === 2 || status === 3 || status === 4;
}

export function isWorkspaceStaffOnboardingTerminallyDenied(status: number | undefined): boolean {
  return status === 7 || status === 8;
}
