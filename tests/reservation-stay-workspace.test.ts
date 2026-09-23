import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Reservation } from "../src/api/types";
import { ApiError } from "../src/api/client";
import type { RouteNavigationLease } from "../src/app/routeNavigationLease";
import { GuestDetailsForm, ReservationDetail } from "../src/features/reservations/ReservationDetail";
import { bookingDetailsDraft, type useReservationDetailsEditor } from "../src/features/reservations/useReservationDetailsEditor";

// Static rendered semantics and query admission, not browser reflow/history/focus proof.
const data = vi.hoisted(() => ({ queries: [] as { queryKey: unknown[]; enabled?: boolean }[], request: vi.fn(), item: null as Reservation | null,
  inventory: undefined as unknown, inventoryError: null as unknown, inventoryLoading: false, inventoryFetching: false }));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: data.request }) }));
vi.mock("../src/app/networkStatus", () => ({ useNetworkStatus: () => ({ isOffline: false }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: (options: { queryKey: unknown[]; enabled?: boolean }) => { data.queries.push(options); const inventory = options.queryKey[0] === "inventory-rooms"; return { data: options.queryKey[0] === "reservation" ? data.item : inventory ? data.inventory : undefined, error: inventory ? data.inventoryError : null, isLoading: inventory && data.inventoryLoading, isFetching: inventory && data.inventoryFetching, refetch: vi.fn() }; },
  useMutation: () => ({ isPending: false, error: null, mutate: vi.fn(), reset: vi.fn() }),
}));
vi.mock("../src/components/ui/primitives", async load => ({ ...await load<typeof import("../src/components/ui/primitives")>(),
  Modal: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) => open ? createElement("section", { role: "dialog" }, createElement("h2", null, title), children) : null,
}));
const record = (): Reservation => ({ propertyId: "p", reservationId: "r", primaryGuestName: "QA long booking name", guestCount: 2,
  email: "long.contact.value@example.invalid", phone: "+441234567890", notes: "First line\nSecond line with complete staff instructions",
  arrival: "2026-09-18", departure: "2026-09-20", expectedArrivalTime: "14:30:00", expectedDepartureTime: "10:00:00",
  detailsRevision: 3, version: 7, status: "confirmed", holdsInventory: true, inventoryUnitIds: ["u"], guests: [],
  sourceKind: "external", sourceSystem: "Source system", sourceReference: "SOURCE-REFERENCE-LONG", createdAtUtc: "2026-09-07T00:00:00Z",
  updatedAtUtc: null, allocationRequestId: "allocation-request", allocationId: "allocation", allocationVersion: 1,
  allocationRejection: 0, pendingAllocationAmendmentId: null, lastAllocationAmendmentRejection: 0, lastDetailsChangeOrigin: 1,
  pendingStayBusinessDate: null, pendingStayActorId: null, checkedInBusinessDate: null, checkedInAtUtc: null, checkedInBy: null,
  noShowBusinessDate: null, noShowAtUtc: null, noShowBy: null, checkedOutBusinessDate: null, checkedOutAtUtc: null, checkedOutBy: null,
});
const navigation = { reportOwner: vi.fn(), paused: false, expanded: false } as unknown as RouteNavigationLease;
const source = { label: "Access", state: "ready" as const, isFetching: false, refetch: vi.fn() };
const capabilities = { manage: true, manageGuests: true, readGuests: true, createGuests: true, checkIn: true, checkOut: true, noShow: true, cancel: true };
function view(overrides: Partial<Parameters<typeof ReservationDetail>[0]> = {}) {
  return renderToStaticMarkup(createElement(ReservationDetail, { propertyId: "p", reservationId: "r", editorIdentity: "actor:p:r", navigation,
    capabilities, permissionSource: source, canReadInventory: true, businessDateToday: "2026-09-07", onClose: vi.fn(), ...overrides }));
}
function stayMarkup(html: string) {
  const start=html.indexOf('<section aria-label="Stay summary"');
  let depth=0;
  for(const tag of html.slice(start).matchAll(/<\/?section\b[^>]*>/g)) {
    depth+=tag[0].startsWith("</")?-1:1;
    if(depth===0) return html.slice(start,start+tag.index!+tag[0].length);
  }
  throw new Error("Stay section boundary not found");
}
function form(overrides: Partial<ReturnType<typeof useReservationDetailsEditor>> = {}, current = true) {
  const draft = { ...bookingDetailsDraft(record()), notes: "Unsaved\nLocal notes", expectedArrivalTime: "16:45" };
  const details = { editor: { baseline: bookingDetailsDraft(record()), draft, detailsRevision: 3, attempt: null, sending: false, error: null },
    dirty: true, unresolved: false, revisionChanged: false, begin: vi.fn(), change: vi.fn(), cancel: vi.fn(), submit: vi.fn(), useCurrentDetails: vi.fn(), ...overrides } as ReturnType<typeof useReservationDetailsEditor>;
  return renderToStaticMarkup(createElement(GuestDetailsForm, { details, current: record(), authorityCurrent: current, onRefresh: vi.fn() }));
}
beforeEach(() => { data.queries = []; data.item = record(); data.request.mockReset(); data.inventoryError = null; data.inventoryLoading = false; data.inventoryFetching = false;
  data.inventory = { rooms: [{ propertyId: "p", roomId: "room", roomName: "Dormitory 104", units: [{ propertyId: "p", roomId: "room", inventoryUnitId: "u", label: "104-F", kind: "bed" }] }] }; });

describe("flat reservation stay workspace", () => {
  it.each(["confirmed","checkedIn","checkoutPending"] as const)("B2 groups %s lifecycle content inside the Stay closing boundary",status=>{
    data.item={...record(),status};
    const html=view(),stay=stayMarkup(html);
    expect(stay).toContain(status==="checkoutPending"?"BunkFy is processing this reservation":'aria-label="Reservation actions"');
    expect(stay).toContain(status==="checkedIn"?"Check out":status==="confirmed"?"Check in":"Actions will appear when it finishes");
    expect(stay).not.toContain('border-t'); expect(stay).not.toContain("Booking details");
  });
  it.each(["checkedOut","cancelled","noShow"] as const)("B2 keeps terminal %s without an empty lifecycle shell",status=>{
    data.item={...record(),status,holdsInventory:false};
    const stay=stayMarkup(view());
    expect(stay).toContain("Stay inventory"); expect(stay).not.toContain("Reservation actions");
    expect(stay).not.toContain("BunkFy is processing"); expect(stay).not.toContain("Check out");
  });
  it("puts exact held inventory with dates/status before lifecycle, one inline Edit and secondary disclosures", () => {
    const html = view(); expect(html.match(/>Edit booking details</g)).toHaveLength(1); expect(html).not.toContain('role="tab"');
    expect(html.indexOf("Stay summary")).toBeLessThan(html.indexOf("Reservation actions")); expect(html.indexOf("Dormitory 104 · 104-F")).toBeLessThan(html.indexOf("Reservation actions"));
    expect(html).toContain("2 nights · 2 guests · property local time"); expect(html).toContain("1 unit held"); expect(html).toContain("Check in");
    expect(html).toContain("long.contact.value@example.invalid"); expect(html).toContain("Second line with complete staff instructions"); expect(html).toContain("SOURCE-REFERENCE-LONG");
    expect(html).toContain('aria-controls="booking-details-history"'); expect(html).toContain('aria-controls="booking-guest-record"');
    expect(html).not.toContain("Create and link"); expect(html).not.toContain("Search Guest Records");
    expect(data.queries.find(q => q.queryKey[0] === "reservation-history")?.enabled).toBe(false);
    expect(data.queries.some(q => q.queryKey[0] === "guest" || q.queryKey[0] === "guest-picker")).toBe(false);
  });
  it("preserves legacy guest intent without a second tab or unsolicited Guest Record read", () => {
    const html = view({ initialTab: "guest" }); expect(html).toContain("Booking details"); expect(html).not.toContain('role="tab"');
    expect(data.queries.some(q => q.queryKey[0] === "guest-picker")).toBe(false);
  });
  it("history is lazy page20 with no other source authority implied", () => {
    view({ initialTab: "history" }); const history = data.queries.find(q => q.queryKey[0] === "reservation-history");
    expect(history?.enabled).toBe(true); expect(history?.queryKey).toEqual(["reservation-history", "p", "r", 1]);
    data.queries = []; view({ initialTab: "history", permissionSource: { ...source, isFetching: true } });
    expect(data.queries.find(q => q.queryKey[0] === "reservation-history")?.enabled).toBe(false);
  });
  it("Viewer without inventory authority keeps assigned quantity, not cached directory names or mutation commands", () => {
    const html = view({ canReadInventory: false, capabilities: Object.fromEntries(Object.keys(capabilities).map(key => [key, false])) as typeof capabilities });
    expect(html).toContain("1 unit held"); expect(html).not.toContain("Dormitory 104"); expect(html).not.toContain("Edit booking details"); expect(html).not.toContain("Reservation actions");
    expect(html).toContain("inventory access is not assigned"); expect(html).not.toContain("Some reservation details are delayed");
    expect(html).not.toContain("Try again"); expect(data.queries.find(q => q.queryKey[0] === "inventory-rooms")?.enabled).toBe(false);
  });
  it.each(["loading", "refreshing", "503", "403"])("permitted %s labels are not exposed as current names or misclassified as a missing grant", state => {
    if (state === "loading") { data.inventory = undefined; data.inventoryLoading = true; }
    if (state === "refreshing") data.inventoryFetching = true;
    if (state === "503" || state === "403") data.inventoryError = new ApiError("Inventory unavailable", Number(state));
    const html = view(); expect(html).toContain("1 unit held"); expect(html).not.toContain("Dormitory 104"); expect(html).not.toContain("inventory access is not assigned");
    expect(data.queries.find(q => q.queryKey[0] === "inventory-rooms")?.enabled).toBe(true);
    if (state === "loading" || state === "refreshing") expect(html).toContain("Confirming current room or bed names");
    else { expect(html.match(/>Try again</g)).toHaveLength(1); expect(html).toContain("Room or bed names are unconfirmed"); expect(html).not.toContain("last confirmed snapshot"); }
  });
  it("same matching read recovers exact names after failure while access revalidation never leaks them", () => {
    data.inventoryError = new ApiError("Temporary", 503); expect(view()).not.toContain("Dormitory 104");
    data.inventoryError = null; expect(view()).toContain("Dormitory 104 · 104-F");
    data.queries = []; const pending = view({ permissionSource: { ...source, isFetching: true } });
    expect(pending).not.toContain("Dormitory 104"); expect(pending).toContain("unconfirmed while access is checked");
    expect(data.queries.find(q => q.queryKey[0] === "inventory-rooms")?.enabled).toBe(false);
  });
  it("foreign-property inventory cannot supply a friendly assignment label", () => {
    data.inventory = { rooms: [{ propertyId: "other", roomId: "room", roomName: "Foreign private room", units: [{ propertyId: "other", roomId: "room", inventoryUnitId: "u", label: "Foreign bed", kind: "bed" }] }] };
    const html = view(); expect(html).not.toContain("Foreign private room"); expect(html).not.toContain("Foreign bed"); expect(html).toContain("1 unit held"); expect(html).toContain("Room or bed names are unconfirmed");
  });
  it("controlled fields retain expected time and notes with shrinkable narrow layout, no revision remount", () => {
    const html = form(); expect(html).toContain("04:45 PM"); expect(html).toContain("Unsaved\nLocal notes"); expect(html).toContain("min-w-0");
    expect(html).toContain("sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]"); expect(html).toMatch(/<textarea[^>]*min-w-0[^>]*>Unsaved/); expect(html).not.toContain('name="arrival"'); expect(html).not.toContain('name="departure"');
    expect(html).toContain("Guest and contact"); expect(html).toContain("Expected stay times");
    expect(html.indexOf('name="phone"')).toBeLessThan(html.indexOf("Expected stay times"));
    expect(html.indexOf("Expected stay times")).toBeLessThan(html.indexOf('name="notes"'));
  });
  it("refresh retains displayed draft but disables fields/save; unresolved result offers only exact replay", () => {
    const refreshing = form({}, false); expect(refreshing).toContain("Your draft stays here"); expect(refreshing).toContain("Unsaved"); expect(refreshing).toMatch(/disabled=""[^>]*>.*?Save booking details/s);
    const pending = form({ unresolved: true }); expect(pending).toContain("Retry same change"); expect(pending).toContain("result is not confirmed"); expect(pending).toContain('disabled="">Cancel');
  });
  it("revision drift explicitly separates draft/current values and forbids a replacement save until review", () => {
    const html = form({ revisionChanged: true }); expect(html).toContain("Your draft has not been replaced"); expect(html).toContain("Review current booking details");
    expect(html).toContain("Replace draft with current details"); expect(html).toContain("Unsaved"); expect(html).toContain("First line");
  });
});
