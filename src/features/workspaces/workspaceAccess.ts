import { ApiError } from "../../api/client";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function waitForWorkspaceAccess(
  request: ApiRequest,
  workspaceId: string,
  options: { timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<void> {
  if (!workspaceId.trim()) throw new Error("A workspace is required.");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      // The visible-properties query succeeds for both tenant-wide owners and
      // property-scoped staff once their access grants are available.
      await request<unknown>("/api/properties?page=1&pageSize=1");
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 403) throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error("Workspace access is still being prepared. Try again in a moment.");
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs));
  }
}
