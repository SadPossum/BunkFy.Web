import { ApiError } from "../../api/client";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function waitForWorkspaceAccess(
  request: ApiRequest,
  workspaceId: string,
  options: { timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<void> {
  if (!workspaceId.trim()) throw new Error("A workspace is required.");
  const timeoutMs = options.timeoutMs ?? 75_000;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    let nextDelayMs = retryDelayMs;
    try {
      // The visible-properties query succeeds for both tenant-wide owners and
      // property-scoped staff once their access grants are available.
      await request<unknown>("/api/properties?page=1&pageSize=1");
      return;
    } catch (error) {
      if (!isWorkspaceAccessPending(error)) throw error;
      nextDelayMs = Math.max(retryDelayMs, error.retryAfterMs ?? 0);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("Workspace access is still being prepared. Try again in a moment.");
    }

    await new Promise((resolve) =>
      globalThis.setTimeout(resolve, Math.min(nextDelayMs, remainingMs)),
    );
  }
}

function isWorkspaceAccessPending(error: unknown): error is ApiError {
  return error instanceof ApiError && (
    error.status === 403 ||
    (error.status === 429 && error.code === "Http.RateLimitExceeded")
  );
}
