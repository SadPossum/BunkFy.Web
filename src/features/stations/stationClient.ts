import { resolveApiBaseUrl } from "../../api/client";
import { assertRequestCanStart, networkRequestFailure } from "../../api/requestConnectivity";
import type { components } from "../../api/contracts.generated";
import type { StationArrivals, StationCurrent, StationRoster, StationRuntime } from "./stationTypes";

export class StationRequestError extends Error {
  constructor(public readonly status: number, public readonly state?: number,
    public readonly retryAt?: number, public readonly code?: string) {
    super(status === 429 ? "Too many attempts. Wait before trying again."
      : status === 409 ? "The station changed. Refresh before continuing."
        : status === 401 ? "This browser needs to be paired by a manager."
          : status === 403 ? "Unable to continue. Refresh the station and try again."
            : "The station could not confirm the result. Check the connection and retry.");
    this.name = "StationRequestError";
  }
}

// Runtime StateChanged and job Incomplete both use 409/state 4. Recover only
// the complete, empty arrivals contract, never an authority or partial response.
function isIncompleteArrivals(status: number, payload: unknown): payload is StationArrivals {
  if (status !== 409 || !payload || typeof payload !== "object") return false;
  const body = payload as Record<string, unknown>;
  return body.state === 4 && Array.isArray(body.items) && body.items.length === 0 &&
    body.continuation === null && body.propertyId === null && body.propertyLocalDate === null &&
    Object.keys(body).every(key => ["state", "items", "continuation", "propertyId", "propertyLocalDate"].includes(key));
}

/** Cookie-only, same-origin transport. It cannot accept primary credentials or caller tenancy. */
async function stationRequest<T>(endpoint: string, options: {
  method?: "GET" | "POST";
  body?: unknown;
  csrf?: string;
  actor?: { actorSessionId: string; generation: number };
  signal?: AbortSignal;
  recover?: (status: number, payload: unknown) => payload is T;
} = {}): Promise<T> {
  const url = new URL(`${resolveApiBaseUrl()}/api/station-runtime${endpoint}`, window.location.origin);
  if (url.origin !== window.location.origin || url.protocol !== "https:") {
    throw new Error("Shared stations require the secure, same-origin BunkFy link.");
  }
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.csrf) headers.set("X-BunkFy-Station-CSRF", options.csrf);
  if (options.actor) {
    headers.set("X-BunkFy-Station-Actor", options.actor.actorSessionId);
    headers.set("X-BunkFy-Station-Generation", String(options.actor.generation));
  }
  const init: RequestInit = { method: options.method ?? "GET", headers,
    credentials: "same-origin", cache: "no-store", redirect: "error", signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body) };
  assertRequestCanStart(init);
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) { throw networkRequestFailure(error); }
  let payload: unknown;
  if (response.status !== 204 && response.headers.get("content-length") !== "0") {
    try { payload = await response.json(); } catch { /* Preserve HTTP semantics on proxy/empty failures. */ }
  }
  if (!response.ok) {
    if (options.recover?.(response.status, payload)) return payload;
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const retry = response.headers.get("Retry-After");
    const retryAt = typeof body.retryAfterUtc === "string" ? Date.parse(body.retryAfterUtc)
      : retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : retry ? Date.parse(retry) : undefined;
    throw new StationRequestError(response.status, typeof body.state === "number" ? body.state : undefined,
      retryAt !== undefined && Number.isFinite(retryAt) ? retryAt : undefined,
      typeof body.code === "string" ? body.code : undefined);
  }
  if (response.status !== 204 && payload === undefined) throw new StationRequestError(502);
  return payload as T;
}

type Schema = components["schemas"];
export const stationApi = {
  current: (signal?: AbortSignal) => stationRequest<StationCurrent>("/current", { signal }),
  roster: (search: string, page = 1, signal?: AbortSignal) => stationRequest<StationRoster>(
    `/roster?${new URLSearchParams({ search, page: String(page), pageSize: "25" })}`, { signal }),
  unlock: (body: Schema["StationUnlockRequest"], csrf: string) => stationRequest<StationRuntime>("/unlock", { method: "POST", body, csrf }),
  lock: (body: Schema["StationLockRequest"], csrf: string) => stationRequest<StationRuntime>("/lock", { method: "POST", body, csrf }),
  activity: (body: Schema["StationActivityRequest"], csrf: string) => stationRequest<StationRuntime>("/activity", { method: "POST", body, csrf }),
  redeem: (body: Schema["StationRedeemSetupRequest"], csrf: string) => stationRequest<StationRuntime>("/setup/redeem", { method: "POST", body, csrf }),
  arrivals: (actor: { actorSessionId: string; generation: number }, cursor?: string, signal?: AbortSignal) =>
    stationRequest<StationArrivals>(`/arrivals?${new URLSearchParams(cursor ? { cursor } : {})}`, { actor, signal, recover: isIncompleteArrivals }),
  checkIn: (body: Schema["StationCheckInRequest"], csrf: string) => stationRequest<Schema["StationCheckInResult"]>("/check-in", { method: "POST", body, csrf }),
  checkInOutcome: (body: Schema["StationCheckInOutcomeRequest"], csrf: string) => stationRequest<Schema["StationCheckInOutcome"]>("/check-in/outcome", { method: "POST", body, csrf }),
};
