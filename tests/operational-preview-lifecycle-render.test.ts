import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { CalendarDays, UserRound } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { OperationalPreviewContent, type OperationalPreviewContentModel } from "../src/features/operational-preview/OperationalPreviewContent";
import { ReservationPreviewLifecycleAction } from "../src/features/operational-preview/ReservationPreviewLifecycleAction";
import type { ReservationPreviewLifecycleOwner } from "../src/features/operational-preview/reservationPreviewLifecycle";

const model: OperationalPreviewContentModel = { kindLabel: "Reservation", title: "QA stay", icon: UserRound, iconTone: "", summary: "1 guest", status: "confirmed", details: [{ label: "Stay", value: "7 Sep to 9 Sep" }, { label: "Inventory status", value: "Occupied inventory" }, { label: "Source", value: "Direct" }], sourceMessage: "Current", sourceTone: "current", actions: [{ href: "/reservations?property=p&reservation=r", label: "Open reservation", icon: CalendarDays, primary: true }] };
const owner: ReservationPreviewLifecycleOwner = { identity: "owner", returnHref: "/?op=reservation", intent: { propertyId: "p", reservationId: "r", action: "check-in", businessDate: "2026-09-07", expectedVersion: 3 }, attempt: null, phase: "confirm", acknowledged: false, receiptVersion: null, pendingVersion: null, readAfter: 0, deferred: null };
const props = { action: "check-in" as const, owner: null as ReservationPreviewLifecycleOwner | null, current: true, readAllowed: true, recoveryAllowed: true, stayLabel: "QA stay", onBegin: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(), onCheck: vi.fn(), onRetry: vi.fn(), onContinue: vi.fn() };
function render(command: ReactNode = createElement(ReservationPreviewLifecycleAction, props), navigationPending = false) {
  return renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(OperationalPreviewContent, { headingId: "preview-heading", model, originLabel: "From Calendar", refreshLabel: "Refresh current state", refreshPending: false, showRefresh: false, onClose: vi.fn(), onNavigate: vi.fn(), onRefresh: vi.fn(), reservationCommand: command, navigationPending })));
}
describe("compact shared-preview lifecycle presentation", () => {
  it("puts one native primary immediately after Stay and before inventory/source facts", () => {
    const html = render();
    expect(html.indexOf("7 Sep to 9 Sep")).toBeLessThan(html.indexOf(">Check in</button>"));
    expect(html.indexOf(">Check in</button>")).toBeLessThan(html.indexOf("Inventory status"));
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toContain("min-h-11"); expect(html).toContain("Open reservation");
  });
  it("names stay and actual business date in harmless inline confirmation", () => {
    const html = render(createElement(ReservationPreviewLifecycleAction, { ...props, owner }));
    expect(html).toContain("Check in QA stay?"); expect(html).toContain("2026-09-07");
    expect(html).toContain("Keep reservation"); expect(html).toContain("No payment or cleaning change");
    expect(html.match(/btn-primary/g)).toHaveLength(1); expect(props.onConfirm).not.toHaveBeenCalled();
  });
  it("renders pending navigation as guarded buttons without destination hrefs", () => {
    const html = render(createElement(ReservationPreviewLifecycleAction, { ...props, owner: { ...owner, phase: "sending" } }), true);
    expect(html).not.toContain('href="/reservations'); expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("Keep reservation"); expect(html).toContain("request in progress");
  });
  it("keeps checkout pending and rejection distinct from final release", () => {
    const checkout = { ...owner, intent: { ...owner.intent, action: "check-out" as const } };
    const pending = render(createElement(ReservationPreviewLifecycleAction, { ...props, owner: { ...checkout, phase: "pending" } }));
    expect(pending).toContain("Inventory release is still pending"); expect(pending).not.toContain("confirms checkout and inventory release");
    const rejected = render(createElement(ReservationPreviewLifecycleAction, { ...props, owner: { ...checkout, phase: "rejected" } }));
    expect(rejected).toContain("stay remains in house"); expect(rejected).not.toContain("Retry same request");
  });
  it("retains recovery/date and reload limitation; denied mutation cannot retry", () => {
    const html = render(createElement(ReservationPreviewLifecycleAction, { ...props, owner: { ...owner, phase: "unknown" }, current: false, recoveryAllowed: false }));
    expect(html).toContain("original request is kept here"); expect(html).toContain("full reload loses this local recovery reference");
    expect(html).toMatch(/disabled=""[^>]*>Retry same request/); expect(html).toContain(">Check result</button>");
  });
  it("offers deferred navigation only deliberately after resolution", () => {
    const html = render(createElement(ReservationPreviewLifecycleAction, { ...props, owner: { ...owner, phase: "success", deferred: "/spaces?property=p" } }));
    expect(html).toContain("Continue to selected page"); expect(html).toContain("will not happen automatically");
    expect(props.onContinue).not.toHaveBeenCalled();
  });
  it("omits the command for ineligible or non-reservation previews", () => {
    expect(renderToStaticMarkup(createElement(ReservationPreviewLifecycleAction, { ...props, action: null }))).toBe("");
    const html = render(createElement("span", {}, "")); expect(html).not.toContain(">Check in</button>");
  });
});
