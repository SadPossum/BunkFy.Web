import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveApiBaseUrl } from "../src/api/client";
import { NetworkRequestError, OfflineRequestError } from "../src/api/requestConnectivity";
import { stationApi, StationRequestError } from "../src/features/stations/stationClient";

vi.mock("../src/api/client", () => ({ resolveApiBaseUrl: vi.fn() }));

const origin = "https://station.example.test";
const operationId = "00000000-0000-4000-8000-000000000001";
const staffMemberId = "00000000-0000-4000-8000-000000000002";
const actorSessionId = "00000000-0000-4000-8000-000000000003";
const csrf = "synthetic-protected-csrf";
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function lastRequest() {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  expect(init).toBeDefined();
  return { url: new URL(String(input)), init: init!, headers: new Headers(init!.headers) };
}

beforeEach(() => {
  vi.mocked(resolveApiBaseUrl).mockReturnValue("");
  fetchMock.mockReset().mockImplementation(async () => json({}));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: new URL(origin) });
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cookie-only station transport", () => {
  it.each(["", origin])("uses HTTPS same-origin with no primary authority for API base %j", async (base) => {
    vi.mocked(resolveApiBaseUrl).mockReturnValue(base);
    const storedPrimary = vi.fn(() => "synthetic-primary-token-and-tenant");
    const storedCookie = vi.fn(() => "synthetic-station-cookie");
    vi.stubGlobal("localStorage", { getItem: storedPrimary });
    vi.stubGlobal("sessionStorage", { getItem: storedCookie });
    const controller = new AbortController();
    const payload = { runtime: { state: 1 } };
    fetchMock.mockResolvedValueOnce(json(payload));

    await expect(stationApi.current(controller.signal)).resolves.toEqual(payload);

    const { url, init, headers } = lastRequest();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(url.href).toBe(`${origin}/api/station-runtime/current`);
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
    expect(init.body).toBeUndefined();
    expect([...headers.entries()]).toEqual([["accept", "application/json"]]);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("X-Tenant-Id")).toBe(false);
    expect(headers.has("Cookie")).toBe(false);
    expect(storedPrimary).not.toHaveBeenCalled();
    expect(storedCookie).not.toHaveBeenCalled();
  });

  it.each([
    { name: "insecure document", documentOrigin: "http://station.example.test", base: "" },
    { name: "insecure API", documentOrigin: origin, base: "http://station.example.test" },
    { name: "different host", documentOrigin: origin, base: "https://other.example.test" },
    { name: "different port", documentOrigin: origin, base: `${origin}:8443` },
    { name: "protocol-relative other host", documentOrigin: origin, base: "//other.example.test" },
  ])("rejects $name before fetch", async ({ documentOrigin, base }) => {
    vi.stubGlobal("window", { location: new URL(documentOrigin) });
    vi.mocked(resolveApiBaseUrl).mockReturnValue(base);

    await expect(stationApi.current()).rejects.toThrow("secure, same-origin");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const unlock = { operationId, staffMemberId, expectedGeneration: 7, pin: "000001" };
  const lock = { operationId, expectedGeneration: 7 };
  const activity = { operationId, actorSessionId, expectedGeneration: 7 };
  const redeem = { operationId, setupGrantId: staffMemberId, pin: "000001" };
  const checkIn = { operationId, reservationId: staffMemberId, expectedVersion: 4, actorSessionId, expectedGeneration: 7 };
  const outcome = { ...checkIn, browserSessionId: staffMemberId };
  it.each([
    { path: "/unlock", body: unlock, send: () => stationApi.unlock(unlock, csrf) },
    { path: "/lock", body: lock, send: () => stationApi.lock(lock, csrf) },
    { path: "/activity", body: activity, send: () => stationApi.activity(activity, csrf) },
    { path: "/setup/redeem", body: redeem, send: () => stationApi.redeem(redeem, csrf) },
    { path: "/check-in", body: checkIn, send: () => stationApi.checkIn(checkIn, csrf) },
    { path: "/check-in/outcome", body: outcome, send: () => stationApi.checkInOutcome(outcome, csrf) },
    { path: "/check-out", body: checkIn, send: () => stationApi.checkOut(checkIn, csrf) },
    { path: "/check-out/outcome", body: outcome, send: () => stationApi.checkOutOutcome(outcome, csrf) },
  ])("sends $path with CSRF in a header and only its operation body", async ({ path, body, send }) => {
    await send();

    const { url, init, headers } = lastRequest();
    expect(url.href).toBe(`${origin}/api/station-runtime${path}`);
    expect(url.search).toBe("");
    expect(url.href).not.toContain(csrf);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error" });
    expect([...headers.entries()]).toEqual([
      ["accept", "application/json"], ["content-type", "application/json"], ["x-bunkfy-station-csrf", csrf],
    ]);
    expect(JSON.parse(String(init.body))).toEqual(body);
    expect(String(init.body)).not.toContain(csrf);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("X-Tenant-Id")).toBe(false);
  });

  it("places arrival actor/generation in headers and only the opaque cursor in the query", async () => {
    const controller = new AbortController();
    const cursor = "synthetic-cursor/+?=&";
    await stationApi.arrivals({ actorSessionId, generation: 7 }, cursor, controller.signal);

    const { url, init, headers } = lastRequest();
    expect(url.pathname).toBe("/api/station-runtime/arrivals");
    expect([...url.searchParams.entries()]).toEqual([["cursor", cursor]]);
    expect(url.href).not.toContain(actorSessionId);
    expect(init.signal).toBe(controller.signal);
    expect(init.body).toBeUndefined();
    expect([...headers.entries()]).toEqual([
      ["accept", "application/json"], ["x-bunkfy-station-actor", actorSessionId], ["x-bunkfy-station-generation", "7"],
    ]);
  });

  it("retains actor/generation guards for the first arrivals page without a cursor", async () => {
    await stationApi.arrivals({ actorSessionId, generation: 8 });
    const { url, headers } = lastRequest();
    expect([...url.searchParams.entries()]).toEqual([]);
    expect(headers.get("X-BunkFy-Station-Actor")).toBe(actorSessionId);
    expect(headers.get("X-BunkFy-Station-Generation")).toBe("8");
    expect(headers.has("X-BunkFy-Station-CSRF")).toBe(false);
  });

  it("loads departures with the same cookie-only actor guard and opaque paging, never client property or date authority", async () => {
    const controller = new AbortController();
    await stationApi.departures({ actorSessionId, generation: 9 }, "opaque/+?cursor", controller.signal);
    const { url, init, headers } = lastRequest();
    expect(url.pathname).toBe("/api/station-runtime/departures");
    expect([...url.searchParams.entries()]).toEqual([["cursor", "opaque/+?cursor"]]);
    expect(headers.get("X-BunkFy-Station-Actor")).toBe(actorSessionId);
    expect(headers.get("X-BunkFy-Station-Generation")).toBe("9");
    expect(init.signal).toBe(controller.signal); expect(init.body).toBeUndefined();
    expect(headers.has("Authorization")).toBe(false); expect(headers.has("X-Tenant-Id")).toBe(false);
  });

  it("encodes roster search as data with the fixed page bound and no tenant/property authority", async () => {
    await stationApi.roster("A&B / ?", 2);
    const { url, headers } = lastRequest();
    expect(url.pathname).toBe("/api/station-runtime/roster");
    expect([...url.searchParams.entries()]).toEqual([["search", "A&B / ?"], ["page", "2"], ["pageSize", "25"]]);
    expect([...headers.entries()]).toEqual([["accept", "application/json"]]);
  });
});

describe("station HTTP failure semantics", () => {
  it("recovers only a complete guest-free incomplete-departures contract, not an actor conflict", async () => {
    const incomplete = { state: 4, items: [], continuation: null, propertyId: null, propertyLocalDate: null };
    fetchMock.mockResolvedValueOnce(json(incomplete, 409));
    await expect(stationApi.departures({ actorSessionId, generation: 7 })).resolves.toEqual(incomplete);
    fetchMock.mockResolvedValueOnce(json({ ...incomplete, code: "Station.StateChanged" }, 409));
    await expect(stationApi.departures({ actorSessionId, generation: 7 })).rejects.toBeInstanceOf(StationRequestError);
  });
  it("keeps an empty, typed incomplete-arrivals response separate from a station authority conflict", async () => {
    const incomplete = { state: 4, items: [], continuation: null, propertyId: null, propertyLocalDate: null };
    fetchMock.mockResolvedValueOnce(json(incomplete, 409));
    await expect(stationApi.arrivals({ actorSessionId, generation: 7 })).resolves.toEqual(incomplete);
  });

  it.each([
    { state: 4, session: null, outcome: null },
    { state: 4, code: "Station.StateChanged", items: [], continuation: null, propertyId: null, propertyLocalDate: null },
    { state: 4, items: [{ reservation: { primaryGuestName: "Partial guest" } }], continuation: null, propertyId: null, propertyLocalDate: null },
    { state: 4, items: [], continuation: "unexpected-cursor", propertyId: null, propertyLocalDate: null },
    { state: 5, items: [], continuation: null, propertyId: null, propertyLocalDate: null },
  ])("does not recover an authority, partial, or malformed arrival conflict (%j)", async body => {
    fetchMock.mockResolvedValueOnce(json(body, 409));
    await expect(stationApi.arrivals({ actorSessionId, generation: 7 })).rejects.toBeInstanceOf(StationRequestError);
  });

  it("does not interpret incomplete-arrivals data as recovery on other endpoints or statuses", async () => {
    const incomplete = { state: 4, items: [], continuation: null, propertyId: null, propertyLocalDate: null };
    fetchMock.mockResolvedValueOnce(json(incomplete, 409));
    await expect(stationApi.current()).rejects.toBeInstanceOf(StationRequestError);
    fetchMock.mockResolvedValueOnce(json(incomplete, 403));
    await expect(stationApi.arrivals({ actorSessionId, generation: 7 })).rejects.toBeInstanceOf(StationRequestError);
  });

  it.each([
    { status: 403, name: "HTML proxy body", body: "<html>denied</html>", zero: false },
    { status: 403, name: "empty body", body: null, zero: false },
    { status: 403, name: "declared zero length", body: null, zero: true },
    { status: 429, name: "HTML proxy body", body: "<html>slow down</html>", zero: false },
    { status: 429, name: "empty body", body: null, zero: false },
    { status: 429, name: "declared zero length", body: null, zero: true },
  ])("preserves $status for $name", async ({ status, body, zero }) => {
    const now = Date.UTC(2026, 8, 28, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const response = new Response(body, { status, headers: {
      "Content-Type": "text/html", "Retry-After": "3", ...(zero ? { "Content-Length": "0" } : {}),
    } });
    const parse = vi.spyOn(response, "json");
    fetchMock.mockResolvedValueOnce(response);

    const error: unknown = await stationApi.current().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(StationRequestError);
    expect(error).toMatchObject({ status, state: undefined, retryAt: now + 3000, code: undefined });
    expect(error).not.toBeInstanceOf(SyntaxError);
    if (zero) expect(parse).not.toHaveBeenCalled();
  });

  it("preserves typed state/code but never copies an error body's detail into the message", async () => {
    fetchMock.mockResolvedValueOnce(json({ state: 4, code: "Station.StateChanged", detail: "synthetic-private-detail", pin: "000001" }, 409));

    const error: unknown = await stationApi.current().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(StationRequestError);
    expect(error).toMatchObject({ status: 409, state: 4, code: "Station.StateChanged" });
    expect((error as Error).message).not.toContain("synthetic-private-detail");
    expect((error as Error).message).not.toContain("000001");
  });

  it.each([
    { name: "HTTP date", body: {}, header: "Mon, 28 Sep 2026 12:01:00 GMT", expected: Date.UTC(2026, 8, 28, 12, 1) },
    { name: "body timestamp precedence", body: { retryAfterUtc: "2026-09-28T12:02:00Z" }, header: "3", expected: Date.UTC(2026, 8, 28, 12, 2) },
    { name: "invalid header", body: {}, header: "not-a-date", expected: undefined },
    { name: "non-finite delay", body: {}, header: "9".repeat(400), expected: undefined },
  ])("handles Retry-After $name", async ({ body, header, expected }) => {
    fetchMock.mockResolvedValueOnce(json(body, 429, { "Retry-After": header }));
    const error: unknown = await stationApi.current().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(StationRequestError);
    expect(error).toMatchObject({ status: 429, retryAt: expected });
  });

  it.each([
    { name: "HTML", body: "<html>not a contract</html>", zero: false },
    { name: "empty", body: null, zero: false },
    { name: "declared empty", body: null, zero: true },
  ])("does not accept a $name 200 response as a confirmed result", async ({ body, zero }) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200, headers: zero ? { "Content-Length": "0" } : {} }));
    await expect(stationApi.current()).rejects.toMatchObject({ name: "StationRequestError", status: 502 });
  });

  it("accepts 204 without attempting JSON parsing", async () => {
    const response = new Response(null, { status: 204 });
    const parse = vi.spyOn(response, "json");
    fetchMock.mockResolvedValueOnce(response);
    await expect(stationApi.lock({ operationId, expectedGeneration: 7 }, csrf)).resolves.toBeUndefined();
    expect(parse).not.toHaveBeenCalled();
  });

  it("blocks an offline PIN write before fetch", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(stationApi.unlock({ operationId, staffMemberId, expectedGeneration: 7, pin: "000001" }, csrf))
      .rejects.toBeInstanceOf(OfflineRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves caller cancellation without relabeling it as a station denial", async () => {
    const aborted = new DOMException("Aborted", "AbortError");
    fetchMock.mockRejectedValueOnce(aborted);
    await expect(stationApi.current()).rejects.toBe(aborted);
  });

  it("distinguishes a failed connection from an authoritative HTTP rejection", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(stationApi.current()).rejects.toBeInstanceOf(NetworkRequestError);
  });
});
