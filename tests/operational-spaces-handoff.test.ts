import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Property, RoomInventory } from "../src/api/types";
import { permissions, propertyAccessScope } from "../src/app/permissions";
import { CalendarPage, calendarPropertyTarget } from "../src/features/calendar/CalendarPage";
import { CalendarWeekView } from "../src/features/calendar/CalendarWeekView";
import { weekWindow } from "../src/features/calendar/calendarModel";
import { DashboardPage } from "../src/features/dashboard/DashboardPage";
import { TodayOperationsView } from "../src/features/dashboard/TodayOperationsView";
import { TodayVisualView } from "../src/features/dashboard/TodayVisualView";
import { OperationalOriginLink } from "../src/features/operational-preview/OperationalOriginLink";
import { operationalSpacesHref } from "../src/features/operational-preview/operationalSurfaceReturn";
import { withOperationalReturnRoute } from "../src/features/operational-preview/operationalPreviewRoute";

const state = vi.hoisted(() => ({ properties: [] as Property[], selected: "", propertiesRead: true,
  permissionError: null as Error | null, directoryError: null as Error | null, refreshing: false,
  permissionData: true, requests: [] as { permission: string; scope: string }[] }));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: vi.fn(), session: { tenantId: "tenant-a" } }) }));
vi.mock("../src/app/workspace", () => ({ useWorkspace: () => ({
  properties: state.properties, selectedPropertyId: state.selected,
  selectedProperty: state.properties.find((property) => property.propertyId === state.selected),
  propertiesLoaded: true, propertiesLoading: false, propertiesFetching: state.refreshing,
  propertiesError: state.directoryError, refetchProperties: vi.fn(), setSelectedPropertyId: vi.fn(),
}) }));
vi.mock("../src/app/permissions", async (original) => ({
  ...await original<typeof import("../src/app/permissions")>(),
  usePermissions: (requests: { permission: string; scope: string }[]) => {
    state.requests = requests;
    return { hasData: state.permissionData, isLoading: false, isFetching: state.refreshing, error: state.permissionError,
      refetch: vi.fn(), allows: (permission: string, scope: string) => requests.some((item) => item.permission === permission && item.scope === scope)
        && (permission !== "properties.read" || state.propertiesRead) };
  },
}));
vi.mock("../src/features/operational-preview/OperationalPreviewProvider", () => ({
  useOperationalPreview: () => ({ activeRoute: null, openPreview: vi.fn() }),
}));

const propertyId = "11111111-1111-4111-8111-111111111111";
const canalId = "22222222-2222-4222-8222-222222222222";
const roomId = "33333333-3333-4333-8333-333333333333";
const property = { propertyId, name: "Harbour", code: "H", status: "active", processingStatus: "unconfigured",
  timeZoneId: "Etc/UTC", timeZoneStatus: "canonical", version: 1 } as Property;
const room: RoomInventory = { propertyId, roomId, roomName: "Harbour dorm", buildingLabel: "Main", floorLabel: "1",
  salesMode: "bedLevel", version: 1, units: [{ propertyId, roomId, inventoryUnitId: "44444444-4444-4444-8444-444444444444",
    bedId: "55555555-5555-4555-8555-555555555555", kind: "bed", label: "402-A", isSellable: true, isTopologyActive: true }] };
const calendarOrigin = { surface: "calendar" as const, propertyId, date: "2026-09-09", day: "2026-09-11" };
const calendarUrl = `/calendar?property=${propertyId}&date=2026-09-09&day=2026-09-11`;
const clients: QueryClient[] = [];
function reset() {
  state.properties = [property, { ...property, propertyId: canalId, name: "Canal" }]; state.selected = propertyId;
  state.propertiesRead = true; state.permissionError = null; state.directoryError = null; state.refreshing = false;
  state.permissionData = true; state.requests = [];
}
reset();
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); reset(); });
function render(element: ReactElement, url = calendarUrl) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  clients.push(client);
  client.setQueryData(["inventory-rooms", propertyId], { rooms: [room], hasMore: false });
  client.setQueryData(["reservation-calendar", propertyId, "2026-09-06", "2026-09-14"], []);
  client.setQueryData(["blocks", propertyId, false, "2026-09-07", "2026-09-14"], { blocks: [], hasMore: false });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, { initialEntries: [url] }, element)));
  // useQuery's observer options are also assigned to the underlying query at
  // runtime; narrow the observer-only field instead of casting the cache API.
  const queries = client.getQueryCache().getAll().filter((query) => query.options.queryFn).map((query) => ({
    queryKey: query.queryKey, enabled: "enabled" in query.options ? query.options.enabled : undefined,
  }));
  return { html, queries };
}
function links(html: string) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));
}
function week(rooms: RoomInventory[], canOpenSpaces = true) {
  const grid = weekWindow(new Date(2026, 8, 9));
  return createElement(CalendarWeekView, { propertyId, dateKey: calendarOrigin.date, selectedDay: calendarOrigin.day,
    ...grid, onSelectDay: vi.fn(), reservations: [], rooms, roomState: "ready", blocks: [], availabilityCurrent: true,
    canOpenSpaces, todayKey: "2026-09-05" });
}

describe("rendered operational Spaces handoffs", () => {
  it("returns Today Rooms structural context from its room settings link without guest search", () => {
    const html = render(createElement(TodayVisualView, { propertyId, propertyName: "Harbour", rooms: [room], roomState: "ready", availabilityState: "unavailable", reservations: [], reservationState: "ready", blocks: [], blockState: "ready", localDate: "2026-09-08", canOpenSpaces: true }), `/?property=${propertyId}&view=visual&todayRoom=${roomId}&todayFilter=attention`).html;
    const href = links(html).find(link => link.startsWith("/spaces"))!;
    expect(href).toContain(`surfaceReturnTodayRoom=${roomId}`); expect(href).toContain("surfaceReturnTodayFilter=attention");
    expect(href).not.toContain("search"); expect(html).toContain("Manage rooms");
    expect(html.indexOf("data-today-result-actions")).toBeLessThan(html.indexOf("Manage rooms"));
    const denied = render(createElement(TodayVisualView, { propertyId, propertyName: "Harbour", rooms: [room], roomState: "ready", availabilityState: "unavailable", reservations: [], reservationState: "ready", blocks: [], blockState: "ready", localDate: "2026-09-08", canOpenSpaces: false }), `/?property=${propertyId}&view=visual`).html;
    expect(links(denied).some(link => link.startsWith("/spaces"))).toBe(false); expect(denied).toContain("Clear");
  });
  it("uses the same exact room target on desktop/mobile, and a roomless Layout target when empty", () => {
    const expected = operationalSpacesHref(calendarOrigin, "layout", roomId);
    expect(links(render(week([room])).html).filter((href) => href === expected)).toHaveLength(2);
    const empty = render(week([])).html;
    expect(links(empty)).toContain(operationalSpacesHref(calendarOrigin, "layout"));
    expect(empty).toContain("Rooms &amp; beds");
    expect(links(empty).some((href) => href.startsWith("/inventory"))).toBe(false);
    for (const rooms of [[], [room]]) expect(links(render(week(rooms, false)).html).some((href) => href.startsWith("/spaces"))).toBe(false);
  });
  it("shows truthful Today Operations destinations without fabricating an entity selection", () => {
    const props = { propertyId, canOpenSpaces: true, snapshotState: "ready" as const, inventory: [room],
      inventoryState: "ready" as const, blocks: [], blockState: "ready" as const,
      reservations: [], reservationState: "ready" as const };
    const html = render(createElement(TodayOperationsView, props)).html;
    const origin = { surface: "today" as const, propertyId, view: "operations" as const };
    const destinations = links(html).filter((href) => href.startsWith("/spaces"));
    expect(destinations).toEqual([operationalSpacesHref(origin, "availability"), operationalSpacesHref(origin, "layout")]);
    expect(destinations.every((href) => !new URL(href, "https://example.test").searchParams.has("op"))).toBe(true);
    expect(html).toContain("Rooms &amp; beds"); expect(html).toContain("Availability");
    const denied = render(createElement(TodayOperationsView, { ...props, canOpenSpaces: false })).html;
    expect(links(denied).some((href) => href.startsWith("/spaces"))).toBe(false);
    expect(denied).toContain("Today summary");
  });
  it("uses exact-scope properties.read only for destination actions, retaining Calendar/Today read access", () => {
    state.propertiesRead = false;
    for (const [element, url] of [[createElement(CalendarPage), calendarUrl], [createElement(DashboardPage), `/?property=${propertyId}&view=operations`]] as const) {
      const result = render(element, url);
      expect(links(result.html).some((href) => href.startsWith("/spaces"))).toBe(false);
      expect(result.html).toContain("Harbour");
      expect(result.queries.some((query) => query.enabled === true)).toBe(true);
      expect(state.requests).toContainEqual({ permission: permissions.propertiesRead, scope: propertyAccessScope("tenant-a", propertyId) });
    }
  });
  it("keeps successful same-property actions during background refresh, but hides them on known source/authority failure", () => {
    state.refreshing = true;
    expect(links(render(createElement(CalendarPage)).html).filter((href) => href.startsWith("/spaces"))).toHaveLength(2);
    expect(links(render(createElement(DashboardPage), `/?property=${propertyId}&view=operations`).html).filter((href) => href.startsWith("/spaces"))).toHaveLength(2);
    state.directoryError = new Error("directory unavailable");
    expect(links(render(createElement(CalendarPage)).html).some((href) => href.startsWith("/spaces"))).toBe(false);
    state.directoryError = null; state.permissionError = new Error("authority unavailable");
    expect(links(render(createElement(CalendarPage)).html).some((href) => href.startsWith("/spaces"))).toBe(false);
    expect(render(createElement(CalendarPage)).queries.every((query) => query.enabled === false)).toBe(true);
  });
  it("the actual origin consumer rejects mixed entity/surface input instead of choosing one", () => {
    const surface = new URL(operationalSpacesHref(calendarOrigin, "layout"), "https://example.test");
    const clean = render(createElement(OperationalOriginLink), surface.pathname + surface.search).html;
    expect(clean).toContain("Back to Calendar");
    const entity = withOperationalReturnRoute(new URLSearchParams(), {
      selection: { kind: "reservation", propertyId, reservationId: roomId }, origin: calendarOrigin,
    });
    entity.forEach((value, key) => surface.searchParams.set(key, value));
    expect(render(createElement(OperationalOriginLink), surface.pathname + surface.search).html).toBe("");
  });
});

describe("Calendar requested-property binding before domain queries", () => {
  it("does not render or query the persisted Canal property for a Harbour URL while selection catches up", () => {
    state.selected = canalId;
    const result = render(createElement(CalendarPage));
    expect(result.html).toContain("Opening the requested property"); expect(result.html).not.toContain("Canal");
    expect(result.queries).toHaveLength(3);
    expect(result.queries.every((query) => query.queryKey[1] === propertyId && query.enabled === false)).toBe(true);
    expect(state.requests.every((item) => item.scope === propertyAccessScope("tenant-a", propertyId))).toBe(true);
    state.selected = propertyId;
    const settled = render(createElement(CalendarPage));
    expect(settled.html).toContain("Harbour dorm");
    expect(settled.queries.every((query) => query.queryKey[1] === propertyId && query.enabled === true)).toBe(true);
  });
  it.each(["property=unknown", "property=", `property=${propertyId}&property=${canalId}`])("fails closed for unavailable/ambiguous %s", (search) => {
    const result = render(createElement(CalendarPage), `/calendar?${search}&date=2026-09-09&day=2026-09-11`);
    expect(result.html).toContain("This property is not available");
    expect(result.queries.every((query) => query.enabled === false)).toBe(true);
    expect(state.requests).toEqual([]);
  });
  it("retains the selected property for an ordinary Calendar route without a property parameter", () => {
    expect(calendarPropertyTarget(new URLSearchParams(), state.properties, propertyId)).toMatchObject({ propertyId, bound: true, requested: false });
    expect(render(createElement(CalendarPage), "/calendar?date=2026-09-09&day=2026-09-11").html).toContain("Harbour dorm");
  });
  it("does not enable Today reads for duplicate or not-yet-bound URL properties", () => {
    for (const url of [`/?view=operations&property=${propertyId}&property=${canalId}`, `/?view=operations&property=${propertyId}`]) {
      state.selected = canalId;
      expect(render(createElement(DashboardPage), url).queries.every((query) => query.enabled === false)).toBe(true);
    }
  });
});
