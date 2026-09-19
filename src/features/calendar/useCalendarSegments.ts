import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ManualBlockListResponse, ReservationListItem } from "../../api/types";
import { ApiError } from "../../api/client";
import { LIVE_LIST_REFRESH_INTERVAL_MS, reservationNeedsLiveRefresh } from "../../app/liveUpdates";
import { loadAllManualInventoryBlocks } from "../inventory/inventoryApi";
import { loadReservationCalendarQuery, resolveReservationCalendarSource, shouldRetryReservationCalendar, type ReservationCalendarQueryData } from "./calendarApi";
import { calendarInitialWindow, calendarReconciliationNeeded, extendCalendarWindow, mergeCalendarSegments, realCalendarDate, type CalendarCoverage, type CalendarSegment } from "./calendarWindow";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
type CalendarQuerySnapshot<T> = {
  data: T | undefined; error: unknown; fetchStatus: string; isLoading: boolean; refetch: () => unknown;
};

// Query's combine structurally shares the complete DTO plus every truth field we
// consume. Its stable function identity avoids rebuilding on viewport-only renders.
export function combineCalendarQueries<T>(queries: readonly CalendarQuerySnapshot<T>[]) {
  return queries.map(({ data, error, fetchStatus, isLoading, refetch }) => ({ data, error, fetchStatus, isLoading, refetch }));
}

export function calendarSegmentSources(segments: CalendarSegment[], reservationQueries: CalendarQuerySnapshot<ReservationCalendarQueryData>[],
  blockQueries: CalendarQuerySnapshot<ManualBlockListResponse>[], propertyId: string, authority: string, enabled: boolean, current: boolean) {
  return segments.map((segment, index) => {
    const reservations = reservationQueries[index], blocks = blockQueries[index];
    const resolved = resolveReservationCalendarSource(reservations.data, reservations.error);
    const denied = (error: unknown) => error instanceof ApiError && [401, 403].includes(error.status);
    const reservationsUsable = enabled && resolved.hasData && !denied(reservations.error) && calendarReservationSnapshotMatches(resolved.reservations, propertyId);
    const blocksUsable = enabled && blocks.data !== undefined && !denied(blocks.error)
      && blocks.data.blocks.every((item) => item && typeof item.blockId === "string" && typeof item.inventoryUnitId === "string"
        && item.propertyId === propertyId && realCalendarDate(item.arrival) && realCalendarDate(item.departure) && item.arrival < item.departure);
    return {
      segment, authority, reservations: reservationsUsable ? resolved.reservations : [], blocks: blocksUsable ? blocks.data!.blocks : [],
      reservationsCurrent: calendarSegmentSourceCurrent(reservationsUsable, reservations.error, reservations.fetchStatus, current),
      blocksCurrent: calendarSegmentSourceCurrent(blocksUsable, blocks.error, blocks.fetchStatus, current),
      loading: reservations.isLoading || blocks.isLoading,
      fetching: reservations.fetchStatus !== "idle" || blocks.fetchStatus !== "idle",
      unavailable: !reservationsUsable || !blocksUsable,
    };
  });
}

export function calendarSegmentQueryKey(kind: "reservation" | "block", propertyId: string, authority: string, segment: CalendarSegment) {
  return [kind === "reservation" ? "reservation-calendar" : "blocks", propertyId, "calendar-segment-v1", authority,
    kind === "reservation" ? segment.reservationFrom : segment.from, segment.to] as const;
}

export function calendarReservationSnapshotMatches(items: readonly ReservationListItem[], propertyId: string) {
  return items.every((item) => item && item.propertyId === propertyId && typeof item.reservationId === "string" && item.reservationId.length > 0
    && realCalendarDate(item.arrival) && realCalendarDate(item.departure)
    && item.arrival < item.departure && Array.isArray(item.inventoryUnitIds) && item.inventoryUnitIds.every((id) => typeof id === "string") && new Set(item.inventoryUnitIds).size === item.inventoryUnitIds.length);
}

export function calendarSegmentSourceCurrent(usable: boolean, error: unknown, fetchStatus: string, authorityCurrent: boolean) {
  return authorityCurrent && usable && !error && fetchStatus === "idle";
}

export function calendarAttentionReservationIds(segments: CalendarSegment[], queries: CalendarQuerySnapshot<ReservationCalendarQueryData>[], propertyId: string, current: boolean): ReadonlySet<string> {
  const sources = segments.map((segment, index) => {
    const query = queries[index], resolved = resolveReservationCalendarSource(query.data, query.error);
    const usable = resolved.hasData && calendarReservationSnapshotMatches(resolved.reservations, propertyId);
    return { segment, reservations: usable ? resolved.reservations : [], blocks: [],
      reservationsCurrent: calendarSegmentSourceCurrent(usable, query.error, query.fetchStatus, current) };
  });
  // Compare all copies, including retained stale ones. Contradictory or missing
  // owners cannot lend currentness to a bar through a different loaded segment.
  const merged = mergeCalendarSegments(sources);
  return new Set(merged.reservations.filter(reservation => {
    const owners = sources.filter(source => reservation.arrival < source.segment.to && reservation.departure >= source.segment.from);
    return owners.length > 0 && owners.every(source => source.reservationsCurrent);
  }).map(reservation => reservation.reservationId));
}

export function pruneCalendarSegmentQueries(client: ReturnType<typeof useQueryClient>, propertyId: string, authority: string, retainedSegments: CalendarSegment[]) {
  const retained = new Set(retainedSegments.flatMap((segment) => ["reservation", "block"].map((kind) => JSON.stringify(calendarSegmentQueryKey(kind as "reservation" | "block", propertyId, authority, segment)))));
  const obsolete = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[2] === "calendar-segment-v1"
    && query.queryKey[1] === propertyId && query.queryKey[3] === authority && !retained.has(JSON.stringify(query.queryKey)) };
  void client.cancelQueries(obsolete);
  client.removeQueries(obsolete);
}

export function useCalendarSegments({ request, propertyId, authority, anchor, ownedDay, enabled, current, attentionCurrent = false, frozen }: {
  request: ApiRequest; propertyId: string; authority: string; anchor: string; ownedDay?: string; enabled: boolean; current: boolean; attentionCurrent?: boolean; frozen: boolean;
}) {
  const client = useQueryClient();
  const [window, setWindow] = useState(() => ({ authority, segments: calendarInitialWindow(anchor, ownedDay) }));
  const segments = useMemo(() => window.authority === authority ? window.segments : calendarInitialWindow(anchor, ownedDay), [window, authority, anchor, ownedDay]);
  const conflictHold = useRef(new Set<string>());
  const reconciled = useRef("");
  useEffect(() => { conflictHold.current.clear(); reconciled.current = ""; }, [authority]);
  const generation = `${authority}:${segments.map((segment) => segment.from).join(":")}`;
  const previousAnchor = useRef(`${authority}:${anchor}`);
  const reservationQueries = useQueries({ queries: segments.map((segment) => {
    const queryKey = calendarSegmentQueryKey("reservation", propertyId, authority, segment);
    return {
      queryKey, enabled, gcTime: 0,
      queryFn: ({ signal }: { signal: AbortSignal }) => loadReservationCalendarQuery(client, queryKey, request, propertyId, segment.reservationFrom, segment.to, signal),
      retry: shouldRetryReservationCalendar,
      refetchInterval: (query: { state: { data: ReservationCalendarQueryData | undefined; error: unknown } }) =>
        !conflictHold.current.has(segment.from) && resolveReservationCalendarSource(query.state.data, query.state.error).reservations.some((item) => reservationNeedsLiveRefresh(item.status))
          ? LIVE_LIST_REFRESH_INTERVAL_MS : false,
      refetchIntervalInBackground: false,
    };
  }), combine: combineCalendarQueries });
  const blockQueries = useQueries({ queries: segments.map((segment) => ({
    queryKey: calendarSegmentQueryKey("block", propertyId, authority, segment), enabled, gcTime: 0,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ManualBlockListResponse> => {
      const scopedRequest: ApiRequest = async <T>(path: string, options?: RequestInit) => {
        signal.throwIfAborted(); const result = await request<T>(path, options); signal.throwIfAborted(); return result;
      };
      const result = await loadAllManualInventoryBlocks(scopedRequest, propertyId, false, signal, segment);
      signal.throwIfAborted();
      return result;
    },
  })), combine: combineCalendarQueries });
  const sources = useMemo(() => calendarSegmentSources(segments, reservationQueries, blockQueries, propertyId, authority, enabled, current),
    [segments, reservationQueries, blockQueries, propertyId, authority, enabled, current]);
  const merged = useMemo(() => mergeCalendarSegments(sources), [sources]);
  const attentionReservationIds = useMemo(() => calendarAttentionReservationIds(segments, reservationQueries, propertyId, enabled && attentionCurrent),
    [segments, reservationQueries, propertyId, enabled, attentionCurrent]);
  const conflictSignature = [...merged.conflicts].sort().join(":");
  const sourceFetching = sources.some((source) => source.fetching);
  const queryRefs = useRef({ reservationQueries, blockQueries, segments });
  queryRefs.current = { reservationQueries, blockQueries, segments };
  useEffect(() => {
    conflictHold.current = new Set(conflictSignature ? conflictSignature.split(":") : []);
    if (!calendarReconciliationNeeded(generation, reconciled.current, Boolean(conflictSignature), sourceFetching, enabled)) return;
    reconciled.current = generation;
    const affected = new Set(conflictSignature.split(":"));
    queryRefs.current.segments.forEach((segment, index) => {
      if (!affected.has(segment.from)) return;
      void queryRefs.current.reservationQueries[index].refetch();
      void queryRefs.current.blockQueries[index].refetch();
    });
  }, [conflictSignature, sourceFetching, generation, enabled]);

  const replaceWindow = useCallback((next: CalendarSegment[]) => {
    pruneCalendarSegmentQueries(client, propertyId, authority, next);
    setWindow({ authority, segments: next });
  }, [authority, client, propertyId]);

  useEffect(() => {
    if (frozen && ownedDay && (ownedDay < segments[0].from || ownedDay >= segments[segments.length - 1].to)) {
      previousAnchor.current = `${authority}:${anchor}`;
      replaceWindow(calendarInitialWindow(anchor, ownedDay));
      return;
    }
    if (frozen) return;
    const key = `${authority}:${anchor}`;
    if (previousAnchor.current === key && window.authority === authority) return;
    previousAnchor.current = key;
    if (window.authority !== authority || anchor < segments[0].from || anchor >= segments[segments.length - 1].to) replaceWindow(calendarInitialWindow(anchor, ownedDay));
  }, [anchor, authority, frozen, ownedDay, replaceWindow, segments, window.authority]);

  useEffect(() => {
    if (enabled) return;
    void client.cancelQueries({ predicate: (query) => query.queryKey[2] === "calendar-segment-v1" && query.queryKey[3] === authority });
  }, [authority, client, enabled]);
  useEffect(() => () => {
    const owned = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[2] === "calendar-segment-v1" && query.queryKey[3] === authority };
    void client.cancelQueries(owned);
    client.removeQueries(owned);
  }, [authority, client]);

  const retry = useCallback((from: string) => {
    if (!enabled) return;
    queryRefs.current.segments.forEach((segment, index) => {
      if (segment.from !== from && !merged.conflicts.has(segment.from)) return;
      void queryRefs.current.reservationQueries[index].refetch();
      void queryRefs.current.blockQueries[index].refetch();
    });
  }, [enabled, merged.conflicts]);
  const coverage: CalendarCoverage[] = useMemo(() => sources.map((source) => ({
    from: source.segment.from, to: source.segment.to,
    current: source.reservationsCurrent && source.blocksCurrent && !merged.conflicts.has(source.segment.from),
    reservationsCurrent: source.reservationsCurrent && !merged.conflicts.has(source.segment.from),
    blocksCurrent: source.blocksCurrent && !merged.conflicts.has(source.segment.from),
    conflict: merged.conflicts.has(source.segment.from),
    label: merged.conflicts.has(source.segment.from) ? "Conflicting schedule snapshots — unconfirmed"
      : source.loading ? "Loading schedule" : source.unavailable ? "Schedule unavailable" : "Schedule unconfirmed",
    retry: () => retry(source.segment.from),
  })), [sources, merged.conflicts, retry]);
  const extend = useCallback((direction: -1 | 1) => {
    if (enabled && !frozen) replaceWindow(extendCalendarWindow(segments, direction, frozen));
  }, [enabled, frozen, replaceWindow, segments]);
  return { segments, coverage, reservations: merged.reservations, blocks: merged.blocks, conflictIds: merged.conflictIds, attentionReservationIds,
    extend };
}
