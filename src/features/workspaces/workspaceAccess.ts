import type { AccessPermissionEvaluationResponse } from "../../api/types";
import { permissions, tenantAccessScope } from "../../app/permissions";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function waitForWorkspaceAccess(
  request: ApiRequest,
  workspaceId: string,
  options: { timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const scope = tenantAccessScope(workspaceId);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const result = await request<AccessPermissionEvaluationResponse>(
      "/api/access/permissions/evaluate",
      {
        method: "POST",
        body: JSON.stringify({
          checks: [{ permission: permissions.propertiesRead, scope }],
        }),
      },
    );
    if (result.permissions.some((decision) => decision.allowed)) return;
    if (Date.now() >= deadline) {
      throw new Error("Workspace access is still being prepared. Try again in a moment.");
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs));
  }
}
