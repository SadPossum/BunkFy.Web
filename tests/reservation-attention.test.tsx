// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserRound } from "lucide-react";
import type { ReservationListItem, RoomInventory } from "../src/api/types";
import { ApiError } from "../src/api/client";
import { usePropertyDate } from "../src/app/usePropertyDate";
import { reservationAttentionReason, reservationAttentionReasons, type ReservationAttention } from "../src/features/reservations/reservationOperationalView";
import { ReservationAttentionIndicators } from "../src/features/reservations/ReservationAttentionIndicators";
import { CalendarWeekView } from "../src/features/calendar/CalendarWeekView";
import { calendarAttentionReservationIds } from "../src/features/calendar/useCalendarSegments";
import { calendarSegmentFor, calendarWindowDays } from "../src/features/calendar/calendarWindow";
import { OperationalPreviewContent, type OperationalPreviewContentModel } from "../src/features/operational-preview/OperationalPreviewContent";

vi.mock("../src/features/operational-preview/OperationalPreviewProvider", () => ({ useOperationalPreview: () => ({ activeRoute: null, openPreview: vi.fn() }) }));
const today = "2026-09-13", segment = calendarSegmentFor(today);
const stay = (fields: Partial<ReservationListItem> = {}): ReservationListItem => ({ reservationId: "stay", propertyId: "p", primaryGuestName: "Alex Example", guestCount: 1, arrival: "2026-09-06", departure: "2026-09-08", inventoryUnitIds: ["bed"], inventoryUnitCount: 1, holdsInventory: true, status: 2, sourceKind: "direct", ...fields } as ReservationListItem);
const snapshot = (data: ReservationListItem[] | undefined, fields: { error?: unknown; fetchStatus?: string } = {}) => ({ data, error: null as unknown, fetchStatus: "idle", isLoading: false, refetch: vi.fn(), ...fields });
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html");
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("shared reservation attention facts", () => {
  it.each([
    [1, "allocation-pending", "Allocation pending"], [3, "allocation-rejected", "Allocation rejected"],
    [4, "cancellation-pending", "Cancellation pending"], [7, "no-show-pending", "No-show pending"],
    [9, "checkout-pending", "Checkout pending"], [2, "arrival-overdue", "Arrival overdue"], [6, "checkout-overdue", "Checkout overdue"],
  ] as const)("uses the same single reason for status %s in Today and Calendar", (status, key, label) => {
    expect(reservationAttentionReasons(stay({ status }), today)).toMatchObject([{ key, label }]);
    expect(reservationAttentionReason(stay({ status }), today)).toBe(label);
  });
  it.each([null, undefined, "", "2026-02-30", "browser-today", "2026-9-13"])("does not invent a property date from %s", date => {
    expect(reservationAttentionReasons(stay(), date)).toEqual([]);
    expect(reservationAttentionReasons(stay({ status: 3 }), date)).toEqual([]);
  });
  it.each([5, 8, 10, 99])("final/unknown status%s has no actionable reason", status => {
    expect(reservationAttentionReasons(stay({ status: status as ReservationListItem["status"] }), today)).toEqual([]);
  });
  it("keeps same-day/future/ordinary in-house stays quiet and uses real day arithmetic", () => {
    expect(reservationAttentionReasons(stay({ arrival: today, departure: "2026-09-15" }), today)).toEqual([]);
    expect(reservationAttentionReasons(stay({ status: 6, departure: today }), today)).toEqual([]);
    expect(reservationAttentionReasons(stay({ status: 6, departure: "2026-09-15" }), today)).toEqual([]);
    expect(reservationAttentionReasons(stay(), today)[0]).toMatchObject({ scheduledDate: "2026-09-06", daysOverdue: 7 });
    expect(reservationAttentionReasons(stay({ arrival: "2026-03-28" }), "2026-03-30")[0]?.daysOverdue).toBe(2);
    expect(reservationAttentionReasons(stay({ arrival: "2026-02-30" }), today)).toEqual([]);
  });
});

describe("reservation-only segment currentness", () => {
  it.each(["fetching", "paused", 401, 403, 503, "authority", "foreign", "absent"])("excludes cached or unowned facts for %s", condition => {
    const query = snapshot(condition === "absent" ? undefined : [stay()], {
      fetchStatus: typeof condition === "string" && ["fetching", "paused"].includes(condition) ? condition : "idle",
      error: typeof condition === "number" ? new ApiError("test", condition) : null,
    });
    expect([...calendarAttentionReservationIds([segment], [query], condition === "foreign" ? "other" : "p", condition !== "authority")]).toEqual([]);
  });
  it("uses unaffected reservation segments independently of room/block coverage", () => {
    const next = calendarSegmentFor(segment.to), later = stay({ reservationId: "later", arrival: next.from, departure: next.to });
    const queries = [snapshot([stay()]), snapshot([later], { error: new ApiError("test", 503) })];
    expect([...calendarAttentionReservationIds([segment, next], queries, "p", true)]).toEqual(["stay"]);
    expect([...calendarAttentionReservationIds([segment, next], [queries[0], snapshot([later])], "p", true)]).toEqual(["stay", "later"]);
  });
  it.each(["stale", "conflict", "missing"])("does not borrow confidence across a %s overlapping owner", kind => {
    const next = calendarSegmentFor(segment.to), overlap = stay({ departure: next.to });
    const second = kind === "missing" ? [] : [{ ...overlap, ...(kind === "conflict" ? { status: 7 as const } : {}) }];
    expect([...calendarAttentionReservationIds([segment, next], [snapshot([overlap]), snapshot(second, { fetchStatus: kind === "stale" ? "fetching" : "idle" })], "p", true)]).toEqual([]);
  });
});

describe("real Calendar and shared preview presentation", () => {
  const room = { propertyId: "p", roomId: "r", roomName: "Dorm101", salesMode: "bedLevel", units: [{ propertyId: "p", roomId: "r", bedId: "bed", inventoryUnitId: "bed", label: "101-A", kind: "bed", isSellable: true, isTopologyActive: true }] } as RoomInventory;
  function calendar(fields: Partial<ComponentProps<typeof CalendarWeekView>> = {}) {
    return html(createElement(MemoryRouter, null, createElement(CalendarWeekView, { propertyId: "p", dateKey: today, selectedDay: "2026-09-06", todayKey: today, attentionOperatingDate: today, attentionReservationIds: new Set(["stay"]), from: segment.from, to: segment.to, days: calendarWindowDays([segment]), onSelectDay: vi.fn(), rooms: [room], roomState: "ready", reservations: [stay()], blocks: [], availabilityCurrent: true, canOpenSpaces: false, ...fields })));
  }
  it.each(["2026-09-06", "2026-09-13"])("keeps property-today reasons when selected day is %s", selectedDay => {
    const document = calendar({ selectedDay }), row = document.querySelector("#calendar-unit-bed")!.closest("tr")!;
    const bar = row.querySelector("button[data-operational-preview-trigger]")!;
    expect(bar.getAttribute("aria-label")).toContain("Arrival overdue");
    expect(bar.querySelector("[data-attention-reason=arrival-overdue]")).not.toBeNull();
    expect(bar.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
  it.each(["unknown-date", "stale-stay", "foreign"])("suppresses attention for %s without hiding the reservation", condition => {
    const document = calendar({ ...(condition === "unknown-date" ? { attentionOperatingDate: null } : condition === "stale-stay" ? { attentionReservationIds: new Set<string>() } : { reservations: [stay({ propertyId: "other" })] }) });
    expect(document.querySelectorAll("[data-reservation-attention]")).toHaveLength(0);
    if (condition !== "foreign") expect(document.body.textContent).toContain("Alex Example");
  });
  it("adds the reason to the narrow reservation control too", () => {
    const document = calendar();
    const mobile = document.querySelector(".lg\\:hidden")!;
    expect(mobile.textContent).toContain("Arrival overdue");
  });
  it.each(["unit", "unmapped"])("does not call a confirmed interior stay in house in the %s row", placement => {
    for (const current of [true, false]) {
      const document = calendar({ selectedDay: "2026-09-07", attentionReservationIds: new Set(current ? ["stay"] : []), reservations: [stay({ inventoryUnitIds: [placement === "unit" ? "bed" : "missing"] })] });
      const mobile = document.querySelector(".lg\\:hidden")!;
      const control = [...mobile.querySelectorAll("button[data-operational-preview-trigger]")].find(button => button.getAttribute("aria-label")?.includes("Alex Example"))!;
      expect(control).toBeDefined();
      expect(control.textContent).toContain("Stay scheduled");
      expect(control.getAttribute("aria-label")).toContain("Stay scheduled, confirmed");
      expect(control.textContent).not.toContain("In house");
      expect(control.getAttribute("aria-label")).not.toContain("In house");
      expect(control.textContent?.includes("Arrival overdue")).toBe(current);
    }
  });
  it.each(["unit", "unmapped"])("uses recorded check-in and pending checkout truth in the %s row", placement => {
    for (const [status, label] of [[6, "In house"], [9, "Checkout pending"]] as const) {
      const document = calendar({ selectedDay: "2026-09-07", reservations: [stay({ status, inventoryUnitIds: [placement === "unit" ? "bed" : "missing"] })] });
      const control = [...document.querySelector(".lg\\:hidden")!.querySelectorAll("button[data-operational-preview-trigger]")].find(button => button.getAttribute("aria-label")?.includes("Alex Example"))!;
      expect(control).toBeDefined();
      expect(control.textContent).toContain(label);
      expect(control.getAttribute("aria-label")).toContain(`Alex Example, ${label},`);
      expect(control.textContent).not.toContain("Needs attention");
      if (status === 9) expect(control.getAttribute("aria-label")).not.toContain("In house");
    }
  });
  it.each([[2, "Arrival overdue"], [6, "Checkout overdue"]] as const)("makes the reason visible on multi-day status%s bars", (status, label) => {
    const document = calendar({ reservations: [stay({ status, departure: "2026-09-11" })] });
    const row = document.querySelector("#calendar-unit-bed")!.closest("tr")!;
    const bar = row.querySelector("button[data-operational-preview-trigger]")!;
    expect(bar.textContent).toContain(label);
    expect(bar.textContent).not.toContain("Needs attention");
    expect(bar.textContent).toContain("Alex Example");
    expect(bar.getAttribute("aria-label")).toContain(label);
  });
  it("supports bounded decorative multiple reasons only as a presentation fixture", () => {
    const reasons: ReservationAttention[] = [reservationAttentionReasons(stay(), today)[0], reservationAttentionReasons(stay({ status: 3 }), today)[0], reservationAttentionReasons(stay({ status: 9 }), today)[0]];
    const document = html(createElement(ReservationAttentionIndicators, { reasons }));
    expect(document.querySelectorAll("[data-attention-reason]")).toHaveLength(2);
    expect(document.body.textContent).toBe("+1");
    expect(document.querySelector("[aria-hidden=true]")).not.toBeNull();
    const compact = html(createElement(ReservationAttentionIndicators, { reasons, compact: true }));
    expect(compact.querySelectorAll("[data-attention-reason]")).toHaveLength(1);
    expect(compact.body.textContent).toBe("3");
  });
  it("explains overdue dates and rejected inventory without manufacturing actions", () => {
    const model: OperationalPreviewContentModel = { kindLabel: "Reservation", title: "Alex Example", status: "Confirmed", icon: UserRound, iconTone: "", summary: "1 guest", details: [], sourceMessage: "Current reservation details.", sourceTone: "current", actions: [], attention: reservationAttentionReasons(stay(), today), attentionOperatingDate: today };
    const render = (value: typeof model) => html(createElement(MemoryRouter, null, createElement(OperationalPreviewContent, { model: value, headingId: "preview", originLabel: "From Calendar", refreshLabel: "Refresh", refreshPending: false, showRefresh: false, onClose: vi.fn(), onNavigate: vi.fn(), onRefresh: vi.fn() })));
    expect(render(model).body.textContent).toContain("7 days overdue");
    expect(render(model).body.textContent).toContain("Property today:");
    const rejected = render({ ...model, attention: reservationAttentionReasons(stay({ status: 3 }), today) });
    expect(rejected.body.textContent).toContain("requested room or bed was not held");
    expect(rejected.querySelectorAll("button")).toHaveLength(1); // Close only, not a fabricated mutation.
    expect(render({ ...model, attention: [] }).querySelector('[aria-label="Needs attention"]')).toBeNull();
  });
});

describe("property date clock", () => {
  it("updates at local midnight/resume, not every timer tick, and drops invalid timezone", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T22:58:00Z"));
    const container = document.createElement("div"), root = createRoot(container); let renders = 0;
    function Probe({ zone }: { zone: string }) { const date = usePropertyDate(zone); renders++; return createElement("p", null, date ?? "unknown"); }
    try {
      act(() => root.render(createElement(Probe, { zone: "Europe/London" })));
      expect(container.textContent).toBe("2026-09-13"); const before = renders;
      act(() => vi.advanceTimersByTime(60_000)); expect(renders).toBe(before);
      act(() => vi.advanceTimersByTime(60_000)); expect(container.textContent).toBe("2026-09-14");
      vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
      act(() => document.dispatchEvent(new Event("visibilitychange"))); expect(container.textContent).toBe("2026-09-15");
      act(() => root.render(createElement(Probe, { zone: "invalid" }))); expect(container.textContent).toBe("unknown");
    } finally { act(() => root.unmount()); }
  });
});
