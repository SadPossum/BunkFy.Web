import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { components } from "../src/api/contracts.generated";
import type { RetirementContext, RetirementProcessSummary } from "../src/api/types";
import { retirementActionAllowed, retirementAttemptCurrent, retirementContextMatches, retirementCoordinatesMatch, retirementKnownRejection, retirementReceiptMatches, retirementReceiptSummary, retirementReadbackState, retirementReplayAllowed, retirementStatus, retirementStatusLabel, type RetirementEditorEvidence, type RetirementEditorTarget } from "../src/features/properties/topologyRetirementEditorModel";
import { retirementTargetFromRoute, parseRetirementReturn, withRetirementReturn, withRetirementTarget, withoutRetirementTarget } from "../src/features/properties/topologyRetirementRoutes";
import { resolveTopologyRetirementCancellationAttempt, resolveTopologyRetirementRequestAttempt, topologyRetirementCancellationPayload, topologyRetirementRequestPayload } from "../src/features/properties/topologyRetirementMutationAttempt";
import { TopologyRetirementPanel } from "../src/features/properties/TopologyRetirementPanel";
import type { TopologyRetirementEditor } from "../src/features/properties/useTopologyRetirementEditor";

vi.mock("../src/app/session", () => ({ useSession: () => ({ stepUpWithPassword: vi.fn() }) }));

const propertyId = "693a6fc9-71e0-4987-b27c-790eaf4f3cef";
const roomId = "234f6d3f-59ad-456f-8eee-50bd4a640e07";
const bedId = "30000000-0000-0000-0000-000000000001";
const processId = "40000000-0000-0000-0000-000000000001";
const target: RetirementEditorTarget = { propertyId, roomId, kind: "room", label: "QA room" };
const bedTarget: RetirementEditorTarget = { ...target, kind: "bed", bedId, label: "QA bed A" };
const summary: RetirementProcessSummary = { topologyChangeId: processId, status: 1, version: 1, reason: "Permanent change", requestedBy: "qa-actor",
  rejectionReasonCode: null, cancellationReason: null, canceledBy: null, createdAtUtc: "2026-09-05T07:00:00Z", updatedAtUtc: null, completedAtUtc: null, canceledAtUtc: null };
const data: RetirementContext = { propertyId, roomId, bedId: null, isTopologyActive: true, process: null,
  impact: { activeAllocationCount: 0, activeManualBlockCount: 0, activeBedRetirementCount: 0, parentRoomRetirementActive: false, affectedReservationIds: [], affectedReservationIdsTruncated: false },
  impactStatus: 1, canRequest: true, canRetry: false, canCancel: false };
const evidence: RetirementEditorEvidence = { propertyId, permissionsCurrent: true, propertyCurrent: true, roomsCurrent: true, bedsCurrent: true, mayRead: true, mayRetire: true };
const legacyReceipt = { ...summary, propertyId, roomId, rejectionReason: null, activeAllocationCount: 0, activeManualBlockCount: 0,
  activeBedRetirementCount: 0, affectedReservationIds: [], affectedReservationIdsTruncated: false };
const source = (path: string) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

describe("retirement context and captured mutation contracts", () => {
  it("publishes nullable but required process and impact in the generated contract itself", () => {
    type Generated = components["schemas"]["InventoryRetirementContextDto"];
    expectTypeOf<Extract<Generated["process"], null>>().toEqualTypeOf<null>();
    expectTypeOf<Extract<Generated["impact"], null>>().toEqualTypeOf<null>();
    expectTypeOf<Extract<Generated["process"], undefined>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Generated["impact"], undefined>>().toEqualTypeOf<never>();
    const snapshot = JSON.parse(readFileSync(new URL("../openapi/bunkfy-api.json", import.meta.url), "utf8"));
    const properties = snapshot.components.schemas.InventoryRetirementContextDto.properties;
    for (const key of ["process", "impact"]) {
      expect(properties[key]).toMatchObject({ type: "object", nullable: true });
      expect(properties[key]).not.toHaveProperty("$ref");
    }
    expect(snapshot.components.schemas.InventoryRetirementProcessSummaryDto).not.toHaveProperty("nullable");
    expect(snapshot.components.schemas.InventoryRetirementImpactDto).not.toHaveProperty("nullable");
  });
  it("distinguishes verified no process from partial impact without inventing zeros", () => {
    expect(retirementContextMatches(data, target)).toBe(true);
    const partial = { ...data, process: summary, impact: null, impactStatus: 2, canRequest: false };
    expect(retirementContextMatches(partial, target)).toBe(true);
    for (const broken of [{ ...partial, canRequest: true }, { ...partial, canRetry: true }, { ...partial, canCancel: true }, { ...partial, impact: data.impact }, { ...data, impact: null }, { ...data, process: undefined }]) expect(retirementContextMatches(broken, target)).toBe(false);
    for (const action of ["request", "retry", "cancel"] as const) expect(retirementActionAllowed(action, target, evidence, partial as RetirementContext, true)).toBe(false);
  });
  it("validates exact property room and bed plus bounded reservation samples and counts", () => {
    expect(retirementContextMatches({ ...data, bedId }, bedTarget)).toBe(true);
    for (const broken of [null, {}, { ...data, propertyId: roomId }, { ...data, roomId: propertyId }, { ...data, bedId }, { ...data, isTopologyActive: "yes" },
      ...[-1, 1.5, Infinity, 2147483648].map((activeAllocationCount) => ({ ...data, impact: { ...data.impact, activeAllocationCount } })),
      { ...data, impact: { ...data.impact, affectedReservationIds: [""] } },
      { ...data, impact: { ...data.impact, affectedReservationIds: [processId, processId] } },
      { ...data, impact: { ...data.impact, affectedReservationIds: Array.from({ length: 26 }, (_, index) => "50000000-0000-0000-0000-" + String(index + 1).padStart(12, "0")) } },
    ]) expect(retirementContextMatches(broken, target)).toBe(false);
    expect(retirementCoordinatesMatch({ ...data, propertyId: "" }, { ...target, propertyId: "" })).toBe(false);
    expect(retirementCoordinatesMatch({ ...data, bedId }, { ...bedTarget, bedId: roomId })).toBe(false);
  });
  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects malformed lifecycle version %s", (version) => {
    expect(retirementContextMatches({ ...data, process: { ...summary, version } }, target)).toBe(false);
  });
  it.each([null, "", "not-a-date"])("rejects a malformed lifecycle timestamp %s", (createdAtUtc) => {
    expect(retirementContextMatches({ ...data, process: { ...summary, createdAtUtc } }, target)).toBe(false);
  });
  it.each([
    [1, "draining"], [2, "finalizationRequested"], [3, "finalizedAwaitingTopology"], [4, "completed"], [5, "rejected"], [6, "canceled"],
  ])("preserves lifecycle representation %s and %s", (numeric, name) => {
    expect(retirementStatus(numeric)).toBe(numeric);
    expect(retirementStatus(name)).toBe(numeric);
    expect(retirementStatusLabel(name)).not.toContain("unconfirmed");
  });
  it("uses unconfirmed copy for unknown values without enabling actions", () => {
    expect(retirementStatus("future-state")).toBeNull();
    expect(retirementStatusLabel(0)).toBe("Status unconfirmed");
    expect(retirementStatusLabel(99)).toBe("Status unconfirmed");
    const unconfirmed = { ...data, process: { ...summary, status: 0 }, canRequest: true, canRetry: true, canCancel: true } as RetirementContext;
    for (const action of ["request", "retry", "cancel"] as const) expect(retirementActionAllowed(action, target, evidence, unconfirmed, true)).toBe(false);
  });
  it("maps actual known-ID Rejected numeric legacy enum to the lifecycle summary code", () => {
    for (const [coordinates, rejectionReason] of [[target, 1], [bedTarget, 1], [bedTarget, 2], [bedTarget, 3]] as const) {
      const receipt = { ...legacyReceipt, ...(coordinates.kind === "bed" ? { bedId } : {}), status: 5, rejectionReason };
      expect(retirementReceiptMatches(receipt, coordinates, processId)).toBe(true);
      if (retirementReceiptMatches(receipt, coordinates, processId)) expect(retirementReceiptSummary(receipt).rejectionReasonCode).toBe(rejectionReason);
    }
    expect(retirementReceiptMatches({ ...legacyReceipt, status: 5, rejectionReason: "RoomNotFound" }, target, processId)).toBe(false);
    expect(retirementReceiptMatches({ ...legacyReceipt, topologyChangeId: roomId }, target, processId)).toBe(false);
    expect(retirementReceiptMatches({ ...legacyReceipt, propertyId: bedId }, target)).toBe(false);
  });
  it("requires current authority and relevant topology sources for new request without a Configure dependency", () => {
    expect(retirementActionAllowed("request", target, evidence, data, true)).toBe(true);
    for (const key of ["permissionsCurrent", "propertyCurrent", "roomsCurrent", "mayRead", "mayRetire"] as const) expect(retirementActionAllowed("request", target, { ...evidence, [key]: false }, data, true)).toBe(false);
    expect(retirementActionAllowed("request", target, { ...evidence, bedsCurrent: false }, data, true)).toBe(true);
    expect(retirementActionAllowed("request", bedTarget, { ...evidence, bedsCurrent: false }, { ...data, bedId }, true)).toBe(false);
    expect(retirementActionAllowed("request", target, evidence, data, false)).toBe(false);
  });
  it("uses advisory plus actual lifecycle and impact gates for stop/retry/new-after-canceled", () => {
    expect(retirementActionAllowed("cancel", target, evidence, { ...data, process: summary, canCancel: true }, true)).toBe(true);
    for (const status of [0, 2, 3, 4, 5, 6] as const) expect(retirementActionAllowed("cancel", target, evidence, { ...data, process: { ...summary, status }, canCancel: true }, true)).toBe(false);
    const rejected = { ...data, process: { ...summary, status: 5 }, canRequest: false, canRetry: true } as RetirementContext;
    expect(retirementActionAllowed("retry", target, evidence, rejected, true)).toBe(true);
    expect(retirementActionAllowed("retry", target, evidence, { ...rejected, impact: { ...data.impact!, activeManualBlockCount: 1 } }, true)).toBe(false);
    expect(retirementActionAllowed("request", target, evidence, { ...data, process: { ...summary, status: 6 } }, true)).toBe(true);
    expect(retirementActionAllowed("request", target, evidence, { ...data, process: { ...summary, status: 4 }, isTopologyActive: false }, true)).toBe(false);
  });
  it("replays the original request after committed lifecycle advancement or retirement, never a fresh intent", () => {
    const attempt = resolveTopologyRetirementRequestAttempt(null, { propertyId, roomId, targetId: roomId, targetKind: "room", reason: "  Permanent change  " }, () => processId);
    const captured = topologyRetirementRequestPayload(attempt, "  Permanent change  ");
    for (const status of [1, 2, 3, 4, 6] as const) {
      const advanced = { ...data, process: { ...summary, status, version: 7 }, isTopologyActive: status !== 4, canRequest: false };
      expect(retirementReplayAllowed(target, evidence, advanced, true)).toBe(true);
      expect(retirementActionAllowed("request", target, evidence, advanced, true)).toBe(false);
    }
    expect(captured).toEqual({ operationId: processId, confirmed: true, reason: "Permanent change" });
    expect(retirementReplayAllowed(target, { ...evidence, mayRetire: false }, data, true)).toBe(false);
    expect(retirementReplayAllowed(target, evidence, { ...data, roomId: bedId }, true)).toBe(false);
    expect(retirementReplayAllowed(target, evidence, data, false)).toBe(false);
  });
  it("keeps a stop retry's exact original version and only allocates a new operation after deliberate review", () => {
    const input = { propertyId, targetKind: "room" as const, topologyChangeId: processId, expectedVersion: 2, reason: "Keep room" };
    const first = resolveTopologyRetirementCancellationAttempt(null, input, () => bedId);
    const payload = topologyRetirementCancellationPayload(first, input.expectedVersion, input.reason);
    const reviewed = resolveTopologyRetirementCancellationAttempt(null, { ...input, expectedVersion: 4 }, () => roomId);
    expect(payload).toEqual({ operationId: bedId, expectedVersion: 2, confirmed: true, reason: "Keep room" });
    expect(reviewed.operationId).toBe(roomId);
  });
  it("keeps a newly confirmed process through failed readback without calling it older history", () => {
    const confirmed = { ...summary, version: 2 };
    const old = { ...data, process: { ...summary, topologyChangeId: bedId, status: 6 } } as RetirementContext;
    expect(retirementReadbackState(old, confirmed, true, processId)).toEqual({ older: false, process: confirmed });
    expect(retirementReadbackState(data, confirmed, true, processId)).toEqual({ older: false, process: confirmed });
    const refreshed = { ...data, process: { ...summary, status: 4, version: 3 } } as RetirementContext;
    expect(retirementReadbackState(refreshed, confirmed, false, processId)).toEqual({ older: false, process: refreshed.process });
    expect(retirementReadbackState(refreshed, confirmed, false, bedId).older).toBe(true);
    expect(retirementReadbackState(old, confirmed, false, processId)).toEqual({ older: true, process: old.process });
  });
  it("fences context/editor drift and separates known rejection from assurance and unknown outcome", () => {
    const current = { context: "actor:tenant:property:room:bed", instance: 2 };
    expect(retirementAttemptCurrent(current, current)).toBe(true);
    expect(retirementAttemptCurrent(current, { ...current, instance: 3 })).toBe(false);
    expect(retirementAttemptCurrent(current, { ...current, context: "different-actor" })).toBe(false);
    for (const status of [400, 403, 404, 409, 423]) expect(retirementKnownRejection(new ApiError("Rejected", status))).toBe(true);
    for (const error of [new ApiError("Challenge", 403, "Security.InsufficientAuthentication"), new ApiError("Unavailable", 503), new Error("Network")]) expect(retirementKnownRejection(error)).toBe(false);
  });
});

describe("retirement exact return routes", () => {
  const current = withRetirementTarget(new URLSearchParams({ section: "layout", property: propertyId, surfaceReturn: "today", surfaceReturnView: "visual", surfaceReturnProperty: propertyId }), bedTarget, processId);
  it("persists exact current target and saved process through reload, and clears only retirement on close", () => {
    expect(retirementTargetFromRoute(current, propertyId)).toEqual({ propertyId, roomId, bedId, kind: "bed" });
    expect(withoutRetirementTarget(current).get("room")).toBe(roomId);
    expect(withoutRetirementTarget(current).has("retirement")).toBe(false);
    expect(withoutRetirementTarget(current).get("surfaceReturnView")).toBe("visual");
  });
  it.each(["/spaces", "/properties"])("returns from reservations/blocks to the exact %s process with prior origin chain", (pathname) => {
    const destination = withRetirementReturn(new URLSearchParams({ property: propertyId, reservation: bedId }), pathname, current);
    const back = parseRetirementReturn(destination, propertyId)!;
    expect(back.href).toBe(pathname + "?" + current);
    expect(back.href).toContain("retirement=" + processId);
    expect(back.href).toContain("surfaceReturnView=visual");
    expect(parseRetirementReturn(destination, roomId)).toBeNull();
  });
  it("rejects external malformed unknown-target and recursive origin inputs", () => {
    for (const value of ["https://evil.test/spaces?" + current, "//evil.test/spaces?" + current, "/reservations?" + current, "/spaces?property=" + propertyId, "/spaces?" + current + "#wrong"]) expect(parseRetirementReturn(new URLSearchParams({ retirementReturn: value }), propertyId)).toBeNull();
    expect(retirementTargetFromRoute(new URLSearchParams({ retire: "bed", room: roomId, bed: "" }), propertyId)).toBeNull();
    const nested = new URLSearchParams(current); nested.set("retirementReturn", "/spaces?stale=1");
    expect(withRetirementReturn(new URLSearchParams(), "/spaces", nested).get("retirementReturn")).not.toContain("stale");
  });
});

function renderEditor(overrides: Partial<TopologyRetirementEditor> = {}, mayReadReservations = true, blocks: { blocksHref?: string; mayUseTemporaryBlock?: boolean } = {}, inline = true) {
  const editor = { target, propertyId, context: "qa-context", instance: 1, opener: { current: null }, busy: false, notice: "", data,
    process: null, older: false, startingNew: false, readPending: false, readRefreshing: false, readError: null, authorityCurrent: true, contextCurrent: true,
    mutation: { error: null }, canRequest: true, canRetry: false, canCancel: false, origin: { pathname: "/spaces", params: withRetirementTarget(new URLSearchParams({ property: propertyId, section: "layout" }), target, overrides.process?.topologyChangeId) }, ...overrides } as TopologyRetirementEditor;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TopologyRetirementPanel, { editor, inline, mayReadReservations, ...blocks })));
}

describe("inline retirement presentation and shared wiring", () => {
  it("shows explicit terminal consequence, required500-character reason and distinct confirmation", () => {
    const html = renderEditor();
    expect(html).toContain("Retire room · QA room");
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('required=""');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Once completed, retirement cannot be reopened through the current Spaces workflow.");
    expect(html).toContain("For a temporary closure, use a dated block instead.");
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).not.toContain('role="dialog"');
  });
  it("shows initial loading without a no-process claim or premature retirement form", () => {
    const html = renderEditor({ data: undefined, readPending: true, canRequest: false });
    expect(html).toContain("Loading this room");
    expect(html).not.toContain("Confirm retirement");
    expect(html).not.toContain("<textarea");
  });
  it("retains authoritative process with unavailable impact and exactly one explicit read retry", () => {
    const html = renderEditor({ data: { ...data, process: summary, impact: null, impactStatus: 2, canRequest: false }, process: summary, canRequest: false, canCancel: false });
    expect(html).toContain("Waiting for reservations or blocks");
    expect(html).toContain("current reservations and blocks could not be checked");
    expect(html.match(/>Try again</g)).toHaveLength(1);
    expect(html).not.toContain("<dd>0</dd>");
    expect(html).toMatch(/disabled=""[^>]*>Stop retirement/);
  });
  it("shows stable confirmed receipt separately from failed current readback", () => {
    const stopped = { ...summary, status: 6, version: 2, cancellationReason: "Keep room", canceledBy: "qa-actor", canceledAtUtc: summary.createdAtUtc } as RetirementProcessSummary;
    const html = renderEditor({ process: stopped, notice: "Retirement stopped. Existing reservations and blocks are unchanged.", readError: new Error("503 controlled"), contextCurrent: false, canRequest: false });
    expect(html).toContain("Retirement stopped. Existing reservations and blocks are unchanged.");
    expect(html).toContain("Retirement details could not be confirmed");
    expect(html.match(/>Try again</g)).toHaveLength(1);
    expect(html).toContain("Requested (UTC)");
    expect(html).toContain("Stopped (UTC)");
    expect(html).not.toContain("available for new reservations again");
  });
  it("keeps older saved history inspectable but never renders current process controls", () => {
    const html = renderEditor({ process: summary, older: true, canRequest: false, canCancel: false });
    expect(html).toContain("earlier attempt");
    expect(html).toContain("Show current retirement");
    expect(html).not.toContain("Stop retirement");
  });
  it("keeps the authoritative completed result separate from dependent read failure and recovery", () => {
    const completed = { ...summary, status: 4, version: 4 } as RetirementProcessSummary;
    const editor = { process: completed, data: { ...data, process: completed, isTopologyActive: false }, canRequest: false };
    const failed = renderEditor({ ...editor, relatedReadState: "unconfirmed" });
    expect(failed).toContain("Retirement completed");
    expect(failed).toContain("Related room, bed and availability details are last confirmed, not current.");
    expect(failed).not.toContain(">Refresh related details<");
    expect(failed).not.toContain('role="alert"');
    expect(failed).not.toContain("Retirement details could not be confirmed");
    const pending = renderEditor({ ...editor, relatedReadState: "refreshing" });
    expect(pending).toContain("Treat the previous values as unconfirmed");
    const recovered = renderEditor({ ...editor, relatedReadState: "current" });
    expect(recovered).toContain("Retirement completed");
    expect(recovered).not.toContain("Refresh related details");
    expect(recovered).not.toContain("details are last confirmed, not current");
  });
  it("uses the proven scoped footer clearance for every retirement control without changing focus or wide-screen scrolling", () => {
    const panel = source("features/properties/TopologyRetirementPanel.tsx");
    const styles = source("styles.css");
    expect(panel).toContain("onFocusCapture={inline ?");
    expect(panel).toContain("!node.isConnected || document.activeElement !== node || node === section.current || !section.current?.contains(node)");
    expect(panel).toContain('if (!footer?.getClientRects().length) return;');
    expect(panel).toContain('node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })');
    expect(styles).toMatch(/@media \(width < 64rem\) \{[^}]*\[data-retirement-editor\] :is\(input, textarea, button, a, \[tabindex\]\)[^}]*scroll-margin-block: 5rem calc\(5rem \+ env\(safe-area-inset-bottom\)\)/);
    expect(panel).toContain("editor.opener.current !== trigger || document.activeElement !== document.body");
    expect(panel).toContain("visible(trigger) ? trigger : visible(fallback) ? fallback : null");
  });
  it("gives the legacy dialog its own single dependent-read recovery because parent warnings are behind the dialog", () => {
    const html = renderEditor({ process: { ...summary, status: 4 }, canRequest: false, relatedReadState: "unconfirmed" }, true, {}, false);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Retirement completed");
    expect(html.match(/>Refresh related details</g)).toHaveLength(1);
    expect(html).toContain("The retirement result is kept separately.");
  });
  it("renders affected reservations only with separate permission and exact retirement return", () => {
    const withClaims = { ...data, process: summary, impact: { ...data.impact!, activeAllocationCount: 1, affectedReservationIds: [bedId], affectedReservationIdsTruncated: true } };
    expect(renderEditor({ data: withClaims, process: summary }, false)).not.toContain("Review affected reservations");
    const html = renderEditor({ data: withClaims, process: summary });
    expect(html).toContain("Review affected reservations (first 25)");
    expect(html).toContain("retirementReturn=");
  });
  it("offers the temporary alternative only for an eligible target, while retaining review of existing blocks", () => {
    const blocksHref = "/spaces?section=blocks&property=" + propertyId + "&room=" + roomId;
    expect(renderEditor({}, true, { blocksHref })).not.toContain("Open Blocks for this space");
    expect(renderEditor({}, true, { blocksHref, mayUseTemporaryBlock: true })).toContain("Open Blocks for this space");
    expect(renderEditor({ data: { ...data, isTopologyActive: false } }, true, { blocksHref, mayUseTemporaryBlock: true })).not.toContain("Open Blocks for this space");
    const draining = { ...data, process: summary, canRequest: false, impact: { ...data.impact!, activeManualBlockCount: 1 } };
    const html = renderEditor({ data: draining, process: summary, canRequest: false }, true, { blocksHref });
    expect(html).toContain("Review blocks for this space");
    expect(html).not.toContain("Open Blocks for this space");
  });
  it("offers exact retry for unknown outcome and deliberate review for a known rejection", () => {
    const unknown = renderEditor({ mutation: { error: new ApiError("503", 503) } as unknown as TopologyRetirementEditor["mutation"], canReplay: true });
    expect(unknown).toContain("Retry same request");
    expect(unknown).toContain("original revision");
    const rejected = renderEditor({ mutation: { error: new ApiError("409", 409) } as unknown as TopologyRetirementEditor["mutation"], rejected: true, reviewed: true });
    expect(rejected).toContain("Use reviewed status and keep reason");
    expect(rejected).not.toContain("Retry same request");
  });
  it("keeps the authentication form separate and names waiting same-attempt resume", () => {
    const html = renderEditor({ mutation: { error: new ApiError("Challenge", 403, "Security.InsufficientAuthentication") } as unknown as TopologyRetirementEditor["mutation"], resumePending: true });
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toContain("Waiting for current access before retrying the same action");
    expect(html).not.toContain("Confirm retirement</button>");
  });
  it("uses one shared mutation owner and exact captured payload, fences late results and retains by-ID GET", () => {
    const owner = source("features/properties/useTopologyRetirementEditor.ts");
    for (const file of ["features/properties/PropertiesPage.tsx", "features/spaces/SpacesPage.tsx"]) {
      expect(source(file)).toContain("useTopologyRetirementEditor({");
      expect(source(file)).toContain("<TopologyRetirementPanel");
      expect(source(file)).not.toContain("resolveTopologyRetirementRequestAttempt");
      expect(source(file)).not.toContain("resolveTopologyRetirementCancellationAttempt");
    }
    expect(owner).toContain("body: JSON.stringify(input.payload)");
    expect(owner).toContain("retirementAttemptCurrent(input, current.current)");
    expect(owner).toContain("retirementReplayAllowed(input.target, latest.current, read.data, read.contextCurrent)");
    expect(owner).toContain("mutation.mutate({ ...resume, replay: true })");
    expect(owner).toContain('["retirement-known"');
    expect(owner).toContain("query.queryKey[2] === p");
    expect(owner).toContain("contextCurrent || receiptAwaitingRead || !data?.process");
    expect(owner).toContain("data.process, data.isTopologyActive");
    expect(owner).toContain("observeTransition(input, retirementReceiptSummary(receipt), null)");
    expect(owner).toContain("getQueryCache().subscribe(notify)");
    expect(source("features/properties/TopologyRetirementPanel.tsx")).toContain("editor.opener.current !== trigger");
    expect(source("features/properties/TopologyRetirementPanel.tsx")).toContain('nav[aria-label="Mobile navigation"]');
    expect(source("features/spaces/OwnerOriginLink.tsx")).toContain("parseRetirementReturn");
  });
});
