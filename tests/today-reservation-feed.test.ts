import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ReservationListItem, ReservationListResponse } from "../src/api/types";
import { accessAuthorityQuerySurvivesScrub } from "../src/app/accessAuthority";
import { combineTodayReservations, loadTodayReservationFeed, TodayReservationFeedError } from "../src/features/dashboard/todayReservationFeed";

const propertyId = "11111111-1111-4111-8111-111111111111", unitId = "22222222-2222-4222-8222-222222222222", date = "2026-09-08";
const item = (id = 1, changes: Partial<ReservationListItem> = {}): ReservationListItem => ({ reservationId: `33333333-3333-4333-8333-${String(id).padStart(12, "0")}`, propertyId, arrival: date, departure: "2026-09-10", expectedArrivalTime: null, expectedDepartureTime: null, primaryGuestName: "QA", guestCount: 1, inventoryUnitCount: 1, inventoryUnitIds: [unitId], holdsInventory: true, sourceKind: "direct", status: "confirmed", ...changes });
const response = (reservations: ReservationListItem[], page = 1, hasMore = false): ReservationListResponse => ({ reservations, page, pageSize: 100, hasMore });
const requestFrom = (fn: (path: string, options?: RequestInit) => Promise<ReservationListResponse>) => <T>(path: string, options?: RequestInit) => fn(path, options) as Promise<T>;

describe("complete Today-only reservation feed", () => {
  it("fully pages two legal independent streams and includes older non-overlapping unresolved stays", async () => {
    const paths: URL[] = [], older = item(150, { arrival: "2026-08-01", departure: "2026-08-03", status: "checkedIn" });
    const result = await loadTodayReservationFeed(requestFrom(async path => {
      const url = new URL(path, "https://example.test"); paths.push(url);
      if (url.searchParams.has("view")) return response([item(), older]);
      return url.searchParams.get("page") === "1" ? response(Array.from({ length: 100 }, (_, i) => item(i + 1)), 1, true) : response([item(101)], 2);
    }), propertyId, date);
    expect(result.reservations).toHaveLength(102); expect(result.reservations).toContainEqual(older);
    const attention = paths.find(url => url.searchParams.has("view"))!.searchParams;
    expect(attention.get("view")).toBe("3"); expect(attention.get("operatingDate")).toBe(date);
    expect(attention.has("status")).toBe(false); expect(attention.has("overlapsFrom")).toBe(false);
    const overlap = paths.find(url => url.searchParams.has("overlapsFrom"))!.searchParams;
    expect(overlap.get("overlapsFrom")).toBe("2026-09-07"); expect(overlap.get("overlapsTo")).toBe("2026-09-09");
    expect(overlap.getAll("status")).toEqual(["1", "2", "3", "4", "6", "7", "9"]);
    expect(paths.every(url => url.searchParams.get("pageSize") === "100")).toBe(true);
  });
  it.each(["status", "arrival", "departure", "primaryGuestName", "inventoryUnitIds", "holdsInventory"] as const)("withholds versionless %s conflicts, never selects a winner", field => {
    const changes = { status: "checkedIn", arrival: "2026-09-07", departure: "2026-09-11", primaryGuestName: "Changed", inventoryUnitIds: [propertyId], holdsInventory: false } as const;
    const result = combineTodayReservations(propertyId, date, [item(), item(2)], [item(1, { [field]: changes[field] })]);
    expect(result.reservations).toEqual([item(2)]); expect(result.conflictingIds).toEqual([item().reservationId]);
  });
  it("deduplicates equal observations including inventory order without dropping distinct records", () => {
    const first = item(1, { inventoryUnitCount: 2, inventoryUnitIds: [unitId, propertyId] });
    expect(combineTodayReservations(propertyId, date, [first], [{ ...first, inventoryUnitIds: [propertyId, unitId] }, item(2)]).reservations).toHaveLength(2);
  });
  it.each([
    { page: 2 }, { pageSize: 50 }, { hasMore: true }, { reservations: [item(1, { propertyId: unitId })] },
    { reservations: [item(1, { arrival: "2026-02-30" })] }, { reservations: [item(1, { inventoryUnitCount: 2 })] },
    { reservations: [item(1, { status: "checkedOut" })] }, { reservations: [item(), item()] },
  ])("rejects malformed/partial/scope-drift pages without publishing partial success: %j", async changes => {
    await expect(loadTodayReservationFeed(requestFrom(async () => ({ ...response([]), ...changes })), propertyId, date)).rejects.toBeInstanceOf(TodayReservationFeedError);
  });
  it("aborts sibling pagination on failure, including a transport that resolves after cancellation", async () => {
    let resolve!: (value: ReservationListResponse) => void, siblingSignal!: AbortSignal;
    const calls = vi.fn(async (path: string, options?: RequestInit) => {
      if (path.includes("view=3")) { siblingSignal = options!.signal!; return new Promise<ReservationListResponse>(done => { resolve = done; }); }
      throw new Error("503");
    });
    const pending = loadTodayReservationFeed(requestFrom(calls), propertyId, date);
    await expect(pending).rejects.toThrow("503"); expect(siblingSignal.aborted).toBe(true);
    resolve(response(Array.from({ length: 100 }, (_, i) => item(i + 1)), 1, true));
    await Promise.resolve(); await Promise.resolve(); expect(calls).toHaveBeenCalledTimes(2);
  });
  it("uses existing permission scrub cancellation and cannot resurrect late pages after restoration", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const queryKey = ["reservations", propertyId, "today", date, "tenant:actor:session:g1"];
    const waits: ((value: ReservationListResponse) => void)[] = [], signals: AbortSignal[] = [];
    expect(accessAuthorityQuerySurvivesScrub(queryKey)).toBe(false);
    const pending = client.fetchQuery({ queryKey, queryFn: ({ signal }) => loadTodayReservationFeed(requestFrom(async (_path, options) => {
      signals.push(options!.signal!); return new Promise(done => waits.push(done));
    }), propertyId, date, signal) });
    const cancelled = pending.catch(error => error);
    client.removeQueries({ predicate: query => !accessAuthorityQuerySurvivesScrub(query.queryKey) });
    expect(signals.every(signal => signal.aborted)).toBe(true);
    waits.forEach(done => done(response([item()]))); await cancelled; await Promise.resolve();
    expect(client.getQueryData(queryKey)).toBeUndefined();
    const fresh = await client.fetchQuery({ queryKey, queryFn: () => loadTodayReservationFeed(requestFrom(async () => response([item(2)])), propertyId, date) });
    expect(fresh.reservations).toEqual([item(2)]); client.clear();
  });
  it("propagates property/date/actor abort and prevents the next page even if transport ignores the signal", async () => {
    const controller = new AbortController(); let calls = 0;
    await expect(loadTodayReservationFeed(requestFrom(async () => { calls++; controller.abort(); return response([]); }), propertyId, date, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});
