import { QueriesObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { calendarReservationSnapshotMatches, calendarSegmentQueryKey, calendarSegmentSourceCurrent, calendarSegmentSources, combineCalendarQueries, pruneCalendarSegmentQueries, useCalendarSegments } from "../src/features/calendar/useCalendarSegments";
import { calendarSegmentFor, extendCalendarWindow, mergeCalendarSegments } from "../src/features/calendar/calendarWindow";
import { ApiError } from "../src/api/client";
import { loadReservationCalendarQuery } from "../src/features/calendar/calendarApi";
import { loadAllManualInventoryBlocks } from "../src/features/inventory/inventoryApi";
import type { ManualBlock, ReservationListItem } from "../src/api/types";

// The installed Query observer is exercised below; this small hook driver also
// invokes the real segment hook's memoization and latest retry/extend closures.
const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], queryCursor: 0, results: [] as unknown[], keys: [] as unknown[], client: null as unknown }));
vi.mock("react", async load => {
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const index = hooks.cursor++, old = hooks.values[index] as { deps: unknown[]; value: unknown } | undefined;
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) hooks.values[index] = { deps, value: factory() };
    return (hooks.values[index] as { value: unknown }).value;
  };
  return { ...await load<typeof import("react")>(), useEffect: vi.fn(), useMemo: memo,
    useCallback: (callback: () => unknown, deps: unknown[]) => memo(() => callback, deps),
    useRef: (initial: unknown) => { const index = hooks.cursor++; return hooks.values[index] ?? (hooks.values[index] = { current: initial }); },
    useState: (initial: () => unknown) => { const index = hooks.cursor++; if (!(index in hooks.values)) hooks.values[index] = initial(); return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }]; },
  };
});
vi.mock("@tanstack/react-query", async load => ({ ...await load<typeof import("@tanstack/react-query")>(), useQueryClient: () => hooks.client,
  useQueries: (options: { queries: { queryKey: unknown }[] }) => { hooks.keys.push(options.queries.map(query => query.queryKey)); return hooks.results[hooks.queryCursor++]; },
}));

it("reuses the real hook projection/coverage on a viewport update, and uses current retry/extend scopes after truth, range and authority changes", () => {
  const client = new QueryClient(); hooks.client = client; hooks.values = [];
  const snapshot = <T,>(data: T) => ({ data, error: null as unknown, fetchStatus: "idle", isLoading: false, refetch: vi.fn() });
  const reservation = snapshot([] as ReservationListItem[]), block = snapshot({ blocks: [], page: 1, pageSize: 100, hasMore: false });
  hooks.results = [[reservation], [block]];
  const args = { request: vi.fn(), propertyId: "property", authority: "actor:1", anchor: "2026-09-08", enabled: true, current: true, frozen: false };
  const render = (changes: Partial<typeof args> = {}) => { hooks.cursor = 0; hooks.queryCursor = 0; hooks.keys = []; return useCalendarSegments({ ...args, ...changes }); };
  const initial = render(), panned = render({ anchor: "2026-09-09" });
  expect(panned.reservations).toBe(initial.reservations); expect(panned.blocks).toBe(initial.blocks); expect(panned.coverage).toBe(initial.coverage); expect(panned.extend).toBe(initial.extend);
  const notCurrent = render({ current: false });
  expect(notCurrent.coverage).not.toBe(initial.coverage); expect(notCurrent.coverage[0].current).toBe(false);
  const fetching = { ...reservation, fetchStatus: "fetching" }; hooks.results = [[fetching], [block]];
  expect(render().coverage[0].current).toBe(false);
  const failed = { ...reservation, error: new ApiError("Unavailable", 503) }; hooks.results = [[failed], [block]];
  const failure = render(); expect(failure.coverage[0].current).toBe(false);
  failure.coverage[0].retry(); expect(reservation.refetch).toHaveBeenCalledOnce(); expect(block.refetch).toHaveBeenCalledOnce();
  failure.extend(1);
  const newReservation = snapshot([] as ReservationListItem[]), newBlock = snapshot({ ...block.data });
  hooks.results = [[reservation, newReservation], [block, newBlock]];
  const extended = render(); expect(extended.segments).toHaveLength(2);
  extended.coverage[1].retry(); expect(newReservation.refetch).toHaveBeenCalledOnce(); expect(newBlock.refetch).toHaveBeenCalledOnce();
  extended.extend(-1);
  hooks.results = [[reservation, newReservation, reservation], [block, newBlock, block]];
  const reversed = render(); expect(reversed.segments).toHaveLength(3); expect(reversed.segments[0].to).toBe(initial.segments[0].from);
  const absentReservation = snapshot(undefined), absentBlock = snapshot(undefined); hooks.results = [[absentReservation], [absentBlock]];
  const scoped = render({ authority: "actor:2", propertyId: "other" });
  expect(scoped.reservations).toEqual([]); expect(scoped.blocks).toEqual([]); expect(scoped.coverage[0].current).toBe(false);
  expect(hooks.keys).toEqual([[calendarSegmentQueryKey("reservation", "other", "actor:2", scoped.segments[0])], [calendarSegmentQueryKey("block", "other", "actor:2", scoped.segments[0])]]);
  scoped.coverage[0].retry(); expect(absentReservation.refetch).toHaveBeenCalledOnce(); expect(absentBlock.refetch).toHaveBeenCalledOnce();
  scoped.extend(1); hooks.results = [[absentReservation, absentReservation], [absentBlock, absentBlock]];
  expect(render({ authority: "actor:2", propertyId: "other" }).segments).toHaveLength(2);
  client.clear();
});

describe("Calendar stable complete query projection", () => {
  const item = { reservationId: "stay", propertyId: "property", arrival: "2026-08-01", departure: "2026-11-01", inventoryUnitIds: ["unit"], holdsInventory: true, status: 2 } as ReservationListItem;
  const block = { blockId: "block", propertyId: "property", inventoryUnitId: "unit", arrival: "2026-08-01", departure: "2026-11-01", version: 1 } as ManualBlock;
  const snapshot = <T,>(data: T) => ({ data, error: null as unknown, fetchStatus: "idle", isLoading: false, refetch: vi.fn() });
  it("uses installed Query combine structural sharing for new raw arrays, retaining whole DTO changes and truth fields", () => {
    const client = new QueryClient(), key = ["projection-test"];
    client.setQueryData(key, [item]);
    const options = [{ queryKey: key, enabled: false }];
    const observer = new QueriesObserver<ReturnType<typeof combineCalendarQueries>>(client, options);
    const unsubscribe = observer.subscribe(() => {});
    const query = client.getQueryCache().find({ queryKey: key })!, base = query.state;
    const [raw, combine] = observer.getOptimisticResult(options, combineCalendarQueries);
    const initial = combine(raw);
    expect(combine(raw.map(result => ({ ...result })))).toBe(initial);
    query.setState({ dataUpdatedAt: base.dataUpdatedAt + 1 });
    expect(observer.getOptimisticResult(options, combineCalendarQueries)[1]()).toBe(initial);
    for (const change of [{ fetchStatus: "fetching" as const }, { fetchStatus: "paused" as const }, { error: new ApiError("Unavailable", 503) }, { error: new ApiError("Denied", 403) }, { error: new ApiError("Session", 401) }, { status: "pending" as const, fetchStatus: "fetching" as const }]) {
      query.setState({ ...base, ...change });
      expect(observer.getOptimisticResult(options, combineCalendarQueries)[1]()).not.toBe(initial);
    }
    for (const change of [{ status: 3 }, { arrival: "2026-08-02" }, { departure: "2026-10-01" }, { inventoryUnitIds: ["other"] }, { primaryGuestName: "Changed" }]) {
      query.setState({ ...base, data: [{ ...item, ...change }] });
      const changed = observer.getOptimisticResult(options, combineCalendarQueries)[1]();
      expect(changed).not.toBe(initial); expect(changed).toMatchObject([{ data: [{ ...item, ...change }] }]);
    }
    unsubscribe(); observer.destroy(); client.clear();
  });
  it.each(["fetching", "paused", "503", "403", "401", "authority"])("does not conceal %s behind populated cached data", condition => {
    const reservation = snapshot([item]), blocks = snapshot({ blocks: [block], page: 1, pageSize: 100, hasMore: false });
    if (["fetching", "paused"].includes(condition)) reservation.fetchStatus = condition;
    if (["503", "403", "401"].includes(condition)) reservation.error = new ApiError(condition, Number(condition));
    const source = calendarSegmentSources([calendarSegmentFor("2026-09-08")], [reservation], [blocks], "property", "actor:1", true, condition !== "authority")[0];
    expect(source.reservationsCurrent).toBe(false);
    expect(source.reservations).toEqual(["403", "401"].includes(condition) ? [] : [item]);
    expect(source.blocksCurrent).toBe(condition !== "authority");
  });
  it("rejects foreign data and gives a new authority only its new key's absent or current records", () => {
    const segment = calendarSegmentFor("2026-09-08"), reservations = [snapshot([item])], blocks = [snapshot({ blocks: [block], page: 1, pageSize: 100, hasMore: false })];
    const before = calendarSegmentSources([segment], reservations, blocks, "property", "actor:1", true, true);
    const foreign = calendarSegmentSources([segment], reservations, blocks, "other", "actor:2", true, true);
    expect(foreign[0]).toMatchObject({ authority: "actor:2", reservations: [], blocks: [], reservationsCurrent: false, blocksCurrent: false });
    const absent = calendarSegmentSources([segment], [snapshot(undefined)], [snapshot(undefined)], "property", "actor:2", true, true);
    expect(absent[0].reservations).toEqual([]); expect(absent[0].blocks).toEqual([]);
    expect(absent[0].authority).not.toBe(before[0].authority);
  });
  it("invalidates overlapping conflict truth when out-of-order status or block versions change", () => {
    const first = calendarSegmentFor("2026-09-08"), segments = [first, calendarSegmentFor(first.to)];
    const reservations = [snapshot([item]), snapshot([item])], blocks = [snapshot({ blocks: [block], page: 1, pageSize: 100, hasMore: false }), snapshot({ blocks: [block], page: 1, pageSize: 100, hasMore: false })];
    const clean = mergeCalendarSegments(calendarSegmentSources(segments, reservations, blocks, "property", "actor", true, true));
    expect(clean.conflictIds).toEqual([]);
    const conflicting = mergeCalendarSegments(calendarSegmentSources(segments, [reservations[0], snapshot([{ ...item, status: 3 }])], [blocks[0], snapshot({ blocks: [{ ...block, version: 2 }], page: 1, pageSize: 100, hasMore: false })], "property", "actor", true, true));
    expect(conflicting.conflictIds).toEqual(["block:block", "reservation:stay"]);
    expect([...conflicting.conflicts]).toEqual(segments.map(segment => segment.from));
    expect(conflicting.reservations).toEqual([]); expect(conflicting.blocks).toEqual([]);
  });
});

describe("Calendar segment query custody", () => {
  it("binds source, actual authority, property and requested range without breaking invalidation prefixes", () => {
    const segment = calendarSegmentFor("2026-09-08");
    const key = calendarSegmentQueryKey("reservation", "property", "tenant:actor:session:generation:property", segment);
    expect(key.slice(0, 2)).toEqual(["reservation-calendar", "property"]);
    expect(key.slice(-2)).toEqual([segment.reservationFrom, segment.to]);
    expect(calendarSegmentQueryKey("block", "property", "authority", segment).slice(-2)).toEqual([segment.from, segment.to]);
    expect(calendarSegmentQueryKey("reservation", "property", "new-actor", segment)).not.toEqual(key);
    expect(calendarSegmentQueryKey("reservation", "other-property", "tenant:actor:session:generation:property", segment)).not.toEqual(key);
  });
  it("keeps at most six owned entries through repeated eviction, preserving other owners", () => {
    const client = new QueryClient();
    client.setQueryData(["blocks", "property", "selected-history"], ["untouched"]);
    client.setQueryData(["reservation-calendar", "other-property", "calendar-segment-v1", "other"], ["untouched"]);
    let segments = [calendarSegmentFor("2026-09-08")];
    for (const direction of [1, 1, 1, 1, -1, -1, -1, -1] as const) {
      segments = extendCalendarWindow(segments, direction, false);
      pruneCalendarSegmentQueries(client, "property", "authority", segments);
      for (const segment of segments) for (const source of ["reservation", "block"] as const) client.setQueryData(calendarSegmentQueryKey(source, "property", "authority", segment), []);
      expect(client.getQueryCache().findAll({ predicate: (query) => query.queryKey[3] === "authority" })).toHaveLength(segments.length * 2);
      expect(client.getQueryData(["blocks", "property", "selected-history"])).toEqual(["untouched"]);
    }
    client.clear();
  });
  it("aborts an evicted request and cannot resurrect it with a late incompatible response", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const segment = calendarSegmentFor("2026-09-08"), key = calendarSegmentQueryKey("reservation", "property", "authority", segment);
    let release!: (value: unknown) => void;
    const deferred = new Promise((resolve) => { release = resolve; });
    const result = client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => loadReservationCalendarQuery(client, key, async <T>() => await deferred as T, "property", segment.reservationFrom, segment.to, signal) }).catch(() => "cancelled");
    pruneCalendarSegmentQueries(client, "property", "authority", []);
    release({ reservations: [{ holdsInventory: undefined }], hasMore: false });
    await result; await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getQueryCache().find({ queryKey: key, exact: true })).toBeUndefined();
    client.clear();
  });
  it.each([false, true])("never treats partial block pagination as a complete segment (later failure=%s)", async (fail) => {
    let page = 0;
    const request = async <T>() => {
      page += 1;
      if (fail && page === 2) throw new Error("later page failed");
      return { blocks: Array.from({ length: page === 1 ? 100 : 3 }, (_, index) => ({ blockId: `${page}:${index}` })), hasMore: page === 1 } as T;
    };
    const pending = loadAllManualInventoryBlocks(request, "property", false, undefined, calendarSegmentFor("2026-09-08"));
    if (fail) await expect(pending).rejects.toThrow("later page failed");
    else expect((await pending).blocks).toHaveLength(103);
    expect(page).toBe(2);
  });
  it("requires exact matching records and independently settled source/authority truth", () => {
    const item = { reservationId: "stay", propertyId: "property", arrival: "2026-09-08", departure: "2026-09-09", inventoryUnitIds: ["unit"] } as ReservationListItem;
    expect(calendarReservationSnapshotMatches([item], "property")).toBe(true);
    expect(calendarReservationSnapshotMatches([{ ...item, propertyId: "foreign" }], "property")).toBe(false);
    expect(calendarReservationSnapshotMatches([{ ...item, departure: "2026-02-30" }], "property")).toBe(false);
    expect(calendarSegmentSourceCurrent(true, null, "idle", true)).toBe(true);
    for (const status of ["fetching", "paused"]) expect(calendarSegmentSourceCurrent(true, null, status, true)).toBe(false);
    expect(calendarSegmentSourceCurrent(false, null, "idle", true)).toBe(false);
    expect(calendarSegmentSourceCurrent(true, new Error("503"), "idle", true)).toBe(false);
    expect(calendarSegmentSourceCurrent(true, null, "idle", false)).toBe(false);
  });
});
