export class OfflineRequestError extends Error {
  public readonly code = "Network.Offline";

  public constructor() {
    super("You are offline. This request was not sent or queued.");
    this.name = "OfflineRequestError";
  }
}

export class NetworkRequestError extends Error {
  public readonly code = "Network.Unreachable";

  public constructor(cause?: unknown) {
    super("BunkFy could not reach the service.", { cause });
    this.name = "NetworkRequestError";
  }
}

export function browserIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function requestNeedsOnlineWrite(method: string | undefined): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

export function assertRequestCanStart(options: RequestInit): void {
  if (!browserIsOnline() && requestNeedsOnlineWrite(options.method)) {
    throw new OfflineRequestError();
  }
}

export function networkRequestFailure(error: unknown): Error {
  if (isAbortError(error)) return error as Error;
  return browserIsOnline()
    ? new NetworkRequestError(error)
    : new OfflineRequestError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
