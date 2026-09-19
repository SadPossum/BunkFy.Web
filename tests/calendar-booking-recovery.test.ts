import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Modal } from "../src/components/ui/primitives";
import { requestedReservationPreselection } from "../src/features/reservations/CreateReservationModal";
import { reservationCreateReceiptMatches, reservationCreationSubmitAllowed, reservationEditorCompletionCurrent, reservationEditorIdentity } from "../src/features/reservations/reservationsMutationAuthority";
import { resolveReservationCreateAttempt, type ReservationCreatePayload } from "../src/features/reservations/reservationCreateAttempt";
import type { ReservationMutationReceipt } from "../src/api/types";

const payload: ReservationCreatePayload = { arrival: "2026-09-11", departure: "2026-09-13", inventoryUnitIds: ["104-D"], primaryGuestName: "Demo Practice", guestCount: 1, sourceKind: 1, sourceSystem: null, sourceReference: null, email: null, phone: null, notes: null, expectedArrivalTime: null, expectedDepartureTime: null };
const evidence = { formValid: true, guestIntentCurrent: true, permissionsCurrent: true, canCreate: true, exactReplay: false, freshInventoryCurrent: true };
const preselect = { requestedUnitId: "104-D", choosingOther: false, available: true, exactReplay: false, rangeKey: "2026-09-11:2026-09-13", initializedRange: "" };
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("booking draft and exact-result recovery", () => {
  it("keeps unchanged operation ID recoverable after its own allocation is no longer free", () => {
    const attempt = resolveReservationCreateAttempt(null, payload, () => "first-operation");
    expect(reservationCreationSubmitAllowed({ ...evidence, freshInventoryCurrent: false })).toBe(false);
    expect(reservationCreationSubmitAllowed({ ...evidence, exactReplay: true, freshInventoryCurrent: false })).toBe(true);
    expect(resolveReservationCreateAttempt(attempt, payload, () => "wrong-second-operation")).toBe(attempt);
    const changed = resolveReservationCreateAttempt(attempt, { ...payload, departure: "2026-09-14" }, () => "new-intent");
    expect(changed.operationId).toBe("new-intent");
    expect(changed.fingerprint).not.toBe(attempt.fingerprint);
  });
  it.each(["permissionsCurrent", "canCreate", "formValid", "guestIntentCurrent"] as const)("locks fresh and retry submission without %s", (key) => {
    expect(reservationCreationSubmitAllowed({ ...evidence, [key]: false })).toBe(false);
    expect(reservationCreationSubmitAllowed({ ...evidence, exactReplay: true, [key]: false })).toBe(false);
  });
  it("preselects only current requested inventory, never a replacement", () => {
    expect(requestedReservationPreselection(preselect)).toEqual(["104-D"]);
    expect(requestedReservationPreselection({ ...preselect, available: false })).toBeNull();
    expect(requestedReservationPreselection({ ...preselect, requestedUnitId: undefined })).toBeNull();
    expect(requestedReservationPreselection({ ...preselect, choosingOther: true })).toBeNull();
    expect(requestedReservationPreselection({ ...preselect, exactReplay: true })).toBeNull();
  });
  it("restores the original target after an intentional selection/range reset", () => {
    const initializedRange = preselect.rangeKey;
    expect(requestedReservationPreselection({ ...preselect, initializedRange })).toBeNull();
    // The Back-to-requested and date handlers clear selections and initialization together.
    expect(requestedReservationPreselection({ ...preselect, initializedRange: "" })).toEqual(["104-D"]);
    expect(requestedReservationPreselection({ ...preselect, rangeKey: "2026-09-12:2026-09-13", initializedRange: "" })).toEqual(["104-D"]);
    expect(requestedReservationPreselection({ ...preselect, initializedRange: "", exactReplay: false })).toEqual(["104-D"]);
  });
  it("fences obsolete property, actor, session and unmounted-editor completion", () => {
    const session = { tenantId: "tenant", accessToken: "not-a-token", username: "qa", subjectId: "staff", sessionId: "session", generation: "generation" };
    const identity = reservationEditorIdentity(session, "property");
    expect(reservationEditorCompletionCurrent(identity, identity, true)).toBe(true);
    expect(reservationEditorCompletionCurrent(identity, identity, false)).toBe(false);
    for (const changed of [reservationEditorIdentity(session, "other-property"), reservationEditorIdentity({ ...session, subjectId: "other-staff" }, "property"), reservationEditorIdentity({ ...session, sessionId: "new-session" }, "property"), reservationEditorIdentity({ ...session, generation: "new-generation" }, "property")]) {
      expect(reservationEditorCompletionCurrent(identity, changed, true)).toBe(false);
    }
  });
  it("does not treat mismatched or malformed creation receipts as a completed booking", () => {
    const receipt = { propertyId: "property", reservationId: "reservation", version: 1, detailsRevision: 1, status: "pendingAllocation" } as ReservationMutationReceipt;
    expect(reservationCreateReceiptMatches(receipt, "property")).toBe(true);
    for (const changed of [{ ...receipt, propertyId: "other" }, { ...receipt, reservationId: "" }, { ...receipt, version: 0 }, { ...receipt, detailsRevision: 0 }, { ...receipt, status: 999 as ReservationMutationReceipt["status"] }]) {
      expect(reservationCreateReceiptMatches(changed, "property")).toBe(false);
    }
  });
});

describe("pending close and source wiring (static/source checks, not browser proof)", () => {
  it("makes only an explicitly pending dialog's close button disabled", () => {
    const render = (closeDisabled?: boolean) => renderToStaticMarkup(createElement(Modal, { open: true, title: "Reservation", children: "Form", onClose() {}, closeDisabled }));
    expect(render(true)).toMatch(/disabled=""[^>]*aria-label="Close dialog"/);
    expect(render()).not.toMatch(/disabled=""[^>]*aria-label="Close dialog"/);
    const modal = source("components/ui/primitives.tsx");
    expect(modal).toContain("closeRef.current = closeDisabled ? () => undefined : onClose");
    expect(modal).toContain('className="modal-backdrop" onClick={() => closeRef.current()}');
  });
  it("retains one draft and binds protected queries, cancellation and exact callbacks", () => {
    const create = source("features/reservations/CreateReservationModal.tsx");
    const page = source("features/reservations/ReservationsPage.tsx");
    expect(page).toContain("permissions.inventoryRead");
    expect(page).toContain('const editor = createOpen && ((propertySelected && selectedProperty) || accessRecovery.phase === "reset")');
    expect(page).not.toContain("createOpen && canCreate");
    expect(page).toContain("currentEditor.current !== editorKey");
    expect(create).toContain("enabled: mayLoadInventory && calendarBookingRangeValid");
    expect(create).toContain("{ signal }");
    expect(create).toContain("queryClient.cancelQueries");
    expect(create.indexOf('assertRequestCanStart({ method: "POST" })')).toBeLessThan(create.indexOf("variables.dispatched = true"));
    expect(create).toContain("if (variables.dispatched && instance.current.mounted");
    expect(create).toContain("closeDisabled={savePending}");
    expect(create).toContain("disabled={submitting} onClick={onCancel}");
    expect(create).toContain('if (chooseOtherInventory) { setSelectedUnits([]); preselectedRange.current = ""; }');
    expect(create).not.toContain("current.filter((id) => availableIds.has(id))");
    expect(create).not.toContain("localStorage");
    expect(create).not.toContain("sessionStorage");
    expect(create).not.toContain("queryClient.setQueryData");
  });
  it("keeps a semantic desktop scroll surface at 1024 and keyboard buttons alongside the existing bars", () => {
    const week = source("features/calendar/CalendarWeekView.tsx");
    expect(week).toContain('className="hidden lg:block"');
    expect(week).toContain('role="region"');
    expect(week).toContain('aria-label="Room and bed occupancy timeline"');
    expect(week).toContain("overflow-auto");
    expect(week).toContain("sticky top-0");
    expect(week).toContain('scope="row"');
    expect(week).toContain("data-calendar-booking-trigger");
    const bookControls = week.slice(week.indexOf("function CalendarBookControls("), week.indexOf("export function calendarNarrowIntervalDisclosure("));
    expect(bookControls).toContain('const current = coverage ? calendarDayCoverage(coverage, day)?.current === true : availabilityCurrent');
    expect(bookControls).toContain('return day >= todayKey && current && dayStates.get(day)?.availability === "free"');
    expect(bookControls).toContain("aria-disabled={!bookingEnabled}");
    expect(bookControls).toMatch(/onClick=\{\(\) => \{ if \(bookingEnabled\) \{[^}]*onBook\(resource, day\); \} \}\}/);
    expect(week).toContain('calendarDayCoverage(coverage, day)?.current === true');
    expect(week).toContain('if (event.target !== event.currentTarget');
    expect(week).toContain('if (viewportFrozen) return');
    const page = source("features/calendar/CalendarPage.tsx");
    expect(page).toContain('const bookingPageKey = `${authority}:${toDateKey(anchor)}:${selectedDay}`');
    expect(page).not.toContain('${session?.generation}:${searchParams}');
    expect(page).toContain("booking.context.target.arrival");
    expect(week).not.toContain('role="grid"');
    expect(week).toContain("<ScheduleDepartureMarker");
  });
  it("restores exact booking focus using minimum reveal without publishing the restore transaction", () => {
    const week = source("features/calendar/CalendarWeekView.tsx");
    const restore = week.slice(week.indexOf("const restoredFocus = useRef"), week.indexOf("function toggleDesktopRoom"));
    expect(restore).toContain("calendarBookingTriggerKey(bookingFocus.unitId, selectedKey)");
    expect(restore).toContain('element.getAttribute("aria-disabled") !== "true"');
    expect(restore).not.toContain("scrollIntoView");
    expect(restore).toContain("revealCalendarTimelineAction(target, timeline)");
    expect(restore).toContain("calendarTimelineFocusAdjustment(frame");
    expect(restore).toContain("target.focus({ preventScroll: true })");
    expect(restore.indexOf("restoringScroll.current = true")).toBeLessThan(restore.indexOf("revealCalendarTimelineAction(target, timeline)"));
    expect(restore).toContain("clearTimeout(scrollTimer.current)");
    expect(restore).toContain("previousScroll.current = timeline.scrollLeft");
    expect(restore).not.toContain("viewportCallback.current");
    expect(week).toContain("if (restoringScroll.current) return");
  });
});
