export type ApiSession = { accessToken: string; tenantId: string; username: string };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function resolveApiBaseUrl(): string {
  return trimTrailingSlash(import.meta.env.VITE_BUNKFY_API_BASE_URL?.trim() || "http://localhost:5194");
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  session?: Pick<ApiSession, "accessToken" | "tenantId">,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (session?.tenantId) headers.set("X-Tenant-Id", session.tenantId);
  if (session?.accessToken) headers.set("Authorization", `Bearer ${session.accessToken}`);

  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const detail = getString(payload, "detail") || getString(payload, "message") || getString(payload, "title");
  const code = getString(payload, "code") || getNestedString(payload, "error", "code");
  return new ApiError(detail || `Request failed with HTTP ${response.status}`, response.status, code);
}

function getString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function getNestedString(value: unknown, parent: string, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return getString((value as Record<string, unknown>)[parent], key);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
