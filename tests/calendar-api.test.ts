import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createCompositeSource } from "../src/app/compositeSourceState";
import type { ReservationListItem, ReservationListResponse } from "../src/api/types";
import {
  isReservationInventoryTruthUnavailable,
  loadReservationCalendar,
  loadReservationCalendarQuery,
  RESERVATION_INVENTORY_TRUTH_BLOCKED_SNAPSHOT,
  RESERVATION_INVENTORY_TRUTH_UNAVAILABLE,
  resolveReservationCalendarSource,
  shouldRetryReservationCalendar,
  type ReservationCalendarQueryData,
} from "../src/features/calendar/calendarApi";

describe("calendar reservation API", () => {
  it.each([false, true])("fully drains more than 100 reservations without exposing a partial later-page failure (%s)", async (fail) => {
    let page = 0;
    const request = async <T>(): Promise<T> => {
      page += 1;
      if (fail && page === 2) throw new Error("second page unavailable");
      return response(Array.from({ length: page === 1 ? 100 : 7 }, (_, index) => reservation(`${page}:${index}`)), page, page === 1) as T;
    };
    const pending = loadReservationCalendar(request, "property-a", "2026-08-31", "2026-09-22");
    if (fail) await expect(pending).rejects.toThrow("second page unavailable");
    else expect(await pending).toHaveLength(107);
    expect(page).toBe(2);
  });
  it("loads the bounded schedule window until the final server page", async () => {
    const requests: Array<{ path: string; signal?: AbortSignal | null }> = [];
    const responses = [
      response([reservation("reservation-a")], 1, true),
      response([reservation("reservation-b", false)], 2, false),
    ];
    const controller = new AbortController();
    const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
      requests.push({ path, signal: options?.signal });
      return responses.shift() as T;
    };

    const result = await loadReservationCalendar(
      request,
      "property-a",
      "2026-07-27",
      "2026-09-07",
      controller.signal,
    );

    expect(result.map((item) => item.reservationId)).toEqual([
      "reservation-a",
      "reservation-b",
    ]);
    expect(requests).toHaveLength(2);
    expect(requests.every((item) => item.signal === controller.signal)).toBe(true);

    const first = new URL(requests[0]!.path, "https://bunkfy.test");
    expect(first.pathname).toBe("/api/reservations/properties/property-a");
    expect(first.searchParams.get("overlapsFrom")).toBe("2026-07-27");
    expect(first.searchParams.get("overlapsTo")).toBe("2026-09-07");
    expect(first.searchParams.get("pageSize")).toBe("100");
    expect(first.searchParams.getAll("status")).toEqual(["1", "2", "3", "4", "6", "7", "9", "10"]);
    expect(new URL(requests[1]!.path, "https://bunkfy.test").searchParams.get("page")).toBe("2");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["string", "true"],
  ])("fails closed when server hold truth is %s", async (_case, holdsInventory) => {
    const incompatible = {
      ...reservation("reservation-a"),
      holdsInventory,
    } as unknown as ReservationListItem;
    const request = async <T>(): Promise<T> =>
      response([incompatible], 1, false) as T;

    await expect(loadReservationCalendar(
      request,
      "property-a",
      "2026-07-27",
      "2026-09-07",
    )).rejects.toThrow(RESERVATION_INVENTORY_TRUTH_UNAVAILABLE);
  });

  it("does not return an earlier page when a later page is incompatible", async () => {
    const responses = [
      response([reservation("reservation-a", false)], 1, true),
      response([{
        ...reservation("reservation-b"),
        holdsInventory: undefined,
      } as unknown as ReservationListItem], 2, false),
    ];
    const request = async <T>(): Promise<T> => responses.shift() as T;

    await expect(loadReservationCalendar(
      request,
      "property-a",
      "2026-07-27",
      "2026-09-07",
    )).rejects.toThrow(RESERVATION_INVENTORY_TRUTH_UNAVAILABLE);
    expect(responses).toHaveLength(0);
  });

  it.each(["Calendar", "Today"])(
    "%s withholds compatible cached data after an incompatible background refetch",
    async () => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const queryKey = ["reservation-calendar", "property-a", "2026-07-27", "2026-09-07"] as const;
      const cached = [reservation("cached-reservation")];
      client.setQueryData(queryKey, cached);

      const incompatible = {
        ...reservation("incompatible-reservation"),
        holdsInventory: undefined,
      } as unknown as ReservationListItem;
      const request = async <T>(): Promise<T> => response([incompatible], 1, false) as T;

      await expect(client.fetchQuery({
        queryKey,
        queryFn: () => loadReservationCalendarQuery(
          client,
          queryKey,
          request,
          "property-a",
          "2026-07-27",
          "2026-09-07",
        ),
      })).rejects.toSatisfy(isReservationInventoryTruthUnavailable);

      let state = client.getQueryState<ReservationCalendarQueryData>(queryKey);
      expect(state?.data).toBe(RESERVATION_INVENTORY_TRUTH_BLOCKED_SNAPSHOT);
      const authority = resolveReservationCalendarSource(state?.data, state?.error);
      expect(authority).toEqual({ hasData: false, reservations: [] });
      expect(createCompositeSource({
        label: "reservation schedule",
        hasData: authority.hasData,
        isLoading: false,
        error: state?.error,
        isFetching: false,
        refetch: async () => undefined,
      }).state).toBe("unavailable");

      await expect(client.fetchQuery({
        queryKey,
        queryFn: async () => {
          throw new Error("offline after compatibility failure");
        },
      })).rejects.toThrow("offline after compatibility failure");
      state = client.getQueryState<ReservationCalendarQueryData>(queryKey);
      expect(state?.data).toBe(RESERVATION_INVENTORY_TRUTH_BLOCKED_SNAPSHOT);
      expect(resolveReservationCalendarSource(state?.data, state?.error))
        .toEqual({ hasData: false, reservations: [] });

      const recovered = [reservation("recovered-reservation", false)];
      const compatibleRequest = async <T>(): Promise<T> => response(recovered, 1, false) as T;
      await client.fetchQuery({
        queryKey,
        queryFn: () => loadReservationCalendarQuery(
          client,
          queryKey,
          compatibleRequest,
          "property-a",
          "2026-07-27",
          "2026-09-07",
        ),
      });
      state = client.getQueryState<ReservationCalendarQueryData>(queryKey);
      expect(state?.data).toEqual(recovered);
      expect(resolveReservationCalendarSource(state?.data, state?.error))
        .toEqual({ hasData: true, reservations: recovered });

      client.clear();
    },
  );

  it("keeps cached schedule data usable for an ordinary recoverable refetch failure", () => {
    const cached = [reservation("cached-reservation")];
    const authority = resolveReservationCalendarSource(cached, new Error("offline"));

    expect(authority).toEqual({ hasData: true, reservations: cached });
    expect(createCompositeSource({
      label: "reservation schedule",
      hasData: authority.hasData,
      isLoading: false,
      error: new Error("offline"),
      isFetching: false,
      refetch: async () => undefined,
    }).state).toBe("stale");
  });

  it("stops deterministic compatibility retries but preserves transient retry policy", () => {
    const incompatible = new Error(RESERVATION_INVENTORY_TRUTH_UNAVAILABLE);
    const request = async <T>(): Promise<T> => response([{
      ...reservation("incompatible-reservation"),
      holdsInventory: null,
    } as unknown as ReservationListItem], 1, false) as T;

    return loadReservationCalendar(
      request,
      "property-a",
      "2026-07-27",
      "2026-09-07",
    ).catch((error: unknown) => {
      expect(shouldRetryReservationCalendar(0, error)).toBe(false);
      expect(shouldRetryReservationCalendar(0, incompatible)).toBe(true);
      expect(shouldRetryReservationCalendar(1, new Error("offline"))).toBe(false);
    });
  });
});

function response(
  reservations: ReservationListItem[],
  page: number,
  hasMore: boolean,
): ReservationListResponse {
  return { reservations, page, pageSize: 100, hasMore };
}

function reservation(
  reservationId: string,
  holdsInventory = true,
): ReservationListItem {
  return {
    reservationId,
    propertyId: "property-a",
    primaryGuestName: "Test guest",
    guestCount: 1,
    arrival: "2026-08-01",
    departure: "2026-08-02",
    inventoryUnitCount: 1,
    inventoryUnitIds: ["unit-a"],
    holdsInventory,
    status: "confirmed",
    sourceKind: "direct",
  } as ReservationListItem;
}
