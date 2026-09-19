import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { Property, PropertyMutationReceipt } from "../src/api/types";
import { PropertyRetirementPanel } from "../src/features/properties/PropertyRetirementPanel";
import { PropertyProcessingPanel } from "../src/features/properties/PropertyProcessingPanel";
import { PropertyEditorForms } from "../src/features/properties/PropertyEditorForms";
import type { usePropertyEditor } from "../src/features/properties/usePropertyEditor";
import { propertyRetirementAllowed, propertyRetirementAttemptCurrent, propertyRetirementKnownRejection, propertyRetirementReceiptMatches, type PropertyRetirementEditor, type PropertyRetirementInput } from "../src/features/properties/usePropertyRetirementEditor";
import { parsePropertyRetirementReturn, propertyRetirementLayoutHref } from "../src/features/properties/propertyRetirementRoutes";
import { resolvePropertySimpleLifecycleAttempt } from "../src/features/properties/propertyLifecycleAttempt";
import { propertyProcessingMessage } from "../src/features/properties/propertyProcessing";
import { OwnerOriginLink } from "../src/features/spaces/OwnerOriginLink";

vi.mock("../src/app/session", () => ({ useSession: () => ({ request: vi.fn(), stepUpWithPassword: vi.fn() }) }));
const propertyId = "ad31d219-da63-40fc-84ec-f01ebd0f7637";
const otherId = "0dd7c9bb-7794-4242-86f3-6dd3e728bf83";
const property = { propertyId, name: "QA closure property", code: "QACLOSE", status: "active", processingStatus: "enabled", version: 3 } as Property;
const current = { context: "tenant/actor/generation/property", instance: 2 };
const input: PropertyRetirementInput = { ...current, property, tenantId: "tenant", replay: false, payload: { operationId: otherId, confirmed: true, expectedVersion: 3 } };
const receipt: PropertyMutationReceipt = { propertyId, status: "retired", processingStatus: "enabled", version: 4 };
const evidence = { property, permissionsCurrent: true, propertyCurrent: true, mayManage: true };
const source = (file: string) => readFileSync(new URL("../src/" + file, import.meta.url), "utf8");

describe("property retirement exact operation and receipt", () => {
  it("requires current property authority/version for a new operation but permits exact replay after the property advances", () => {
    expect(propertyRetirementAllowed(input, evidence, current)).toBe(true);
    for (const key of ["permissionsCurrent", "propertyCurrent", "mayManage"] as const) {
      expect(propertyRetirementAllowed(input, { ...evidence, [key]: false }, current)).toBe(false);
      expect(propertyRetirementAllowed({ ...input, replay: true }, { ...evidence, [key]: false }, current)).toBe(false);
    }
    const retired: Property = { ...property, status: "retired", version: 4 };
    expect(propertyRetirementAllowed(input, { ...evidence, property: retired }, current)).toBe(false);
    expect(propertyRetirementAllowed({ ...input, replay: true }, { ...evidence, property: retired }, current)).toBe(true);
    expect(input.payload).toEqual({ operationId: otherId, confirmed: true, expectedVersion: 3 });
    expect(propertyRetirementAllowed({ ...input, replay: true }, { ...evidence, property: { ...retired, propertyId: otherId } }, current)).toBe(false);
  });
  it.each([
    { ...current, context: "tenant/other-actor/generation/property" },
    { ...current, context: "tenant/actor/new-generation/property" },
    { ...current, context: "tenant/actor/generation/other-property" },
    { ...current, instance: 3 },
  ])("fences late property/actor/session/editor changes %s", (changed) => {
    expect(propertyRetirementAttemptCurrent(input, changed)).toBe(false);
    expect(propertyRetirementAllowed({ ...input, replay: true }, evidence, changed)).toBe(false);
  });
  it("validates exact retired receipt, expected successor revision and unchanged stored processing configuration", () => {
    expect(propertyRetirementReceiptMatches(receipt, input)).toBe(true);
    for (const bad of [null, {}, { ...receipt, propertyId: otherId }, { ...receipt, status: "active" }, { ...receipt, status: 2 },
      { ...receipt, processingStatus: "suspended" }, { ...receipt, processingStatus: "future" },
      ...[0, 3, 5, 4.5, Infinity, Number.MAX_SAFE_INTEGER + 1].map((version) => ({ ...receipt, version }))]) {
      expect(propertyRetirementReceiptMatches(bad, input)).toBe(false);
    }
    for (const processingStatus of ["unconfigured", "enabled", "suspended"] as const) {
      expect(propertyRetirementReceiptMatches({ ...receipt, processingStatus }, { ...input, property: { ...property, processingStatus } })).toBe(true);
    }
  });
  it("separates known rejection from GMA and unknown outcome; deliberate reconfirmation allocates a new operation", () => {
    for (const status of [400, 403, 404, 409, 423]) expect(propertyRetirementKnownRejection(new ApiError("Rejected", status))).toBe(true);
    for (const error of [new Error("Network"), new ApiError("Unavailable", 503), new ApiError("Password", 401, "Security.InsufficientAuthentication"), new ApiError("Password", 403, "Security.InsufficientAuthentication")]) expect(propertyRetirementKnownRejection(error)).toBe(false);
    const attempt = resolvePropertySimpleLifecycleAttempt(null, "retirement", propertyId, 3, () => otherId);
    expect(resolvePropertySimpleLifecycleAttempt(attempt, "retirement", propertyId, 3)).toBe(attempt);
    const reviewed = resolvePropertySimpleLifecycleAttempt(null, "retirement", propertyId, 4, () => propertyId);
    expect(reviewed.operationId).not.toBe(attempt.operationId);
  });
});

function renderEditor(overrides: Partial<PropertyRetirementEditor> = {}, inline = true) {
  const editor = { context: current.context, instance: 2, property, target: property, confirmed: null, opener: { current: null },
    mutation: { error: null }, busy: false, canConfirm: true, authorityCurrent: true, canReplay: false, rejected: false,
    reviewed: false, refreshing: false, layoutHref: "/spaces?section=layout&property=" + propertyId, ...overrides } as PropertyRetirementEditor;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PropertyRetirementPanel, { editor, inline })));
}
describe("property retirement confirmation and readback", () => {
  it("preserves a mid-open retired identity draft read-only without impossible refresh/reopen instructions", () => {
    const editor = {
      propertyForm: { property: { ...property, name: "Entered draft remains visible" } }, propertyFormRetired: true,
      propertyFormCanSubmit: false, propertyConflict: false, propertyOpener: { current: null }, catalog: {},
      propertyMutation: { error: new ApiError("Retired", 409, "Properties.PropertyRetired"), isPending: false },
      timeZoneMutation: { error: null }, closePropertyForm: vi.fn(),
    } as unknown as ReturnType<typeof usePropertyEditor>;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PropertyEditorForms, { editor, inline: true, kind: "identity" })));
    expect(html).toContain("This property was retired. Your draft is kept here for reference; it cannot be saved.");
    expect(html).toContain("Entered draft remains visible");
    expect(html.match(/readOnly=""/g)).toHaveLength(2);
    expect(html).not.toContain("cancel and reopen Edit");
    expect(html).not.toContain("Refresh property</button>");
    expect(html).toMatch(/disabled=""[^>]*>Save changes/);
    expect(html).toContain("Cancel</button>");
  });
  it("names the exact property, requires explicit confirmation, states effective suspension and does not invent reason/draining/stop", () => {
    const html = renderEditor();
    expect(html).toContain("Retire property · QA closure property");
    expect(html).toContain("Every active room must be retired first");
    expect(html).toContain("Retirement stops new processing for this property");
    expect(html).toContain('type="checkbox"');
    expect(html).toMatch(/disabled=""[^>]*>Confirm property retirement/);
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("Stop retirement");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("does not suspend");
    expect(renderEditor({}, false)).toContain('role="dialog"');
  });
  it("blocks dismissal/confirmation while pending and keeps the exact confirmation surface", () => {
    const html = renderEditor({ busy: true, canConfirm: false });
    expect(html).toMatch(/disabled=""[^>]*>Cancel/);
    expect(html).toMatch(/disabled=""[^>]*>Retiring/);
    expect(html).toContain('type="checkbox"');
  });
  it("offers exact replay only for unconfirmed outcomes, never for confirmed receipt plus failed directory read", () => {
    const unknown = renderEditor({ mutation: { error: new ApiError("503", 503) } as unknown as PropertyRetirementEditor["mutation"], canReplay: true });
    expect(unknown).toContain("Retry same request");
    expect(unknown).toContain("original property revision");
    const completed = { target: null, confirmed: { property, receipt }, readbackCurrent: false };
    for (const inline of [true, false]) {
      const failedRead = renderEditor(completed, inline);
      expect(failedRead).toContain("Property retired · QA closure property");
      expect(failedRead).toContain("Retirement is confirmed");
      expect(failedRead).toContain("Stored processing configuration at retirement: enabled");
      expect(failedRead).toContain("not the current effective processing status");
      expect(failedRead).not.toContain("Retry same request");
      expect(failedRead).not.toContain("<form");
      expect(failedRead).not.toContain("<button"); // Existing directory notice remains the sole GET recovery owner.
    }
    expect(renderEditor({ ...completed, readbackCurrent: true })).not.toContain("not yet been confirmed");
  });
  it("handles active-room rejection without inventing offender IDs and requires review before a new confirmation", () => {
    const html = renderEditor({ mutation: { error: new ApiError("Active rooms", 409, "Properties.PropertyHasActiveRooms") } as unknown as PropertyRetirementEditor["mutation"], rejected: true, activeRooms: true });
    expect(html).toContain("Review rooms in Layout");
    expect(html).toContain("does not identify individual rooms");
    expect(html).toContain("Refresh property");
    expect(html).not.toContain("Retry same request");
    expect(html).not.toContain("Confirm property retirement</button>");
    const retired = renderEditor({ property: { ...property, status: "retired" }, canConfirm: false, reviewed: true });
    expect(retired).toContain("already retired");
    expect(retired).not.toContain("Review current property</button>");
  });
  it("renders GMA separately and makes pending same-attempt resume explicit", () => {
    const html = renderEditor({ mutation: { error: new ApiError("Password", 401, "Security.InsufficientAuthentication") } as unknown as PropertyRetirementEditor["mutation"], resumePending: true });
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toContain("Waiting for current access before retrying the same retirement");
    expect(html).not.toContain("Confirm property retirement</button>");
  });
  it.each(["active", "retired"] as const)("retains effective suspended processing facts and removes actions, including a %s directory snapshot", (status) => {
    const client = new QueryClient();
    client.setQueryData(["property-processing", propertyId], { propertyId, propertyVersion: 4, configuredStatus: "enabled", effectiveStatus: "suspended", reasonCode: "Properties.PropertyRetired", governancePolicy: null });
    client.setQueryData(["country-policies", propertyId], { items: [] });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertyProcessingPanel, {
      property: { ...property, status, version: 4 }, embedded: true, canManage: true, permissionsCurrent: true, propertyCurrent: status === "retired", onChanged: () => {},
    })));
    expect(html).toContain("Processing is suspended because this property is retired");
    expect(html).not.toContain("Configure</button>");
    expect(html).not.toContain("Suspend</button>");
    expect(html).not.toContain("Change policy</button>");
    expect(html).not.toContain("No usable country policy is configured");
    client.clear();
  });
  it.each(["enabled", "unconfigured", "suspended"] as const)("shows retired suspension through stale/error %s processing and read recovery, without changing active-property meaning", (cachedStatus) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, staleTime: Infinity } } });
    const key = ["property-processing", propertyId];
    const cached = { propertyId, propertyVersion: 3, configuredStatus: cachedStatus, effectiveStatus: cachedStatus, reasonCode: null, governancePolicy: null };
    client.setQueryData(key, cached);
    client.setQueryData(["country-policies", propertyId], { items: [] });
    const renderProcessing = (status: Property["status"]) => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertyProcessingPanel, {
      property: { ...property, status, version: status === "retired" ? 4 : 3 }, embedded: true, canManage: true, permissionsCurrent: true, propertyCurrent: true, onChanged: () => {},
    })));
    for (const failed of [false, true]) {
      client.getQueryCache().find({ queryKey: key })!.setState({ error: failed ? new ApiError("Processing unavailable", 503) : null, status: failed ? "error" : "success", fetchStatus: "idle" });
      const retired = renderProcessing("retired");
      expect(retired).toContain(">suspended</span>");
      expect(retired).toContain("Processing is suspended because this property is retired");
      expect(retired).not.toContain(propertyProcessingMessage(cachedStatus));
      expect(retired).not.toContain("Configure</button>");
      expect(retired).not.toContain("Suspend</button>");
      expect(retired).not.toContain("No usable country policy is configured");
      if (failed) {
        expect(retired).toContain("Data-processing context is delayed");
        expect(retired).toContain("Processing status is showing its last confirmed snapshot");
        expect(retired).toContain("Try again");
      }
      const active = renderProcessing("active");
      expect(active).toContain(">" + cachedStatus + "</span>");
      expect(active).toContain(propertyProcessingMessage(cachedStatus));
      expect(active).not.toContain("because this property is retired");
    }
    client.setQueryData(key, { ...cached, propertyVersion: 4, effectiveStatus: "suspended", reasonCode: "Properties.PropertyRetired" });
    const recovered = renderProcessing("retired");
    expect(recovered).toContain(">suspended</span>");
    expect(recovered).toContain("Processing is suspended because this property is retired");
    expect(recovered).not.toContain("Data-processing context is delayed");
    client.clear();
  });
  it.each([false, true])("gives processing recovery an explicit flex stack with usable embedded width (cached=%s)", (cached) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false } } });
    const queryKey = ["property-processing", propertyId];
    client.setQueryData(queryKey, { propertyId, propertyVersion: 4, configuredStatus: "unconfigured", effectiveStatus: "suspended", reasonCode: "Properties.PropertyRetired", governancePolicy: null });
    client.getQueryCache().find({ queryKey })!.setState({ ...(cached ? {} : { data: undefined }), error: new ApiError("Unavailable", 503), status: "error", fetchStatus: "idle" });
    client.setQueryData(["country-policies", propertyId], { items: [] });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertyProcessingPanel, {
      property: { ...property, status: "retired", version: 4 }, embedded: true, canManage: true, permissionsCurrent: true, propertyCurrent: true, onChanged: () => {},
    })));
    const noticeClass = html.match(/class="([^"]*alert[^"]*)" role="status"/)?.[1]?.split(/\s+/) ?? [];
    expect(noticeClass).toContain("flex");
    expect(noticeClass).toContain("flex-col");
    expect(noticeClass).toContain("sm:flex-row");
    expect(noticeClass).not.toContain("mx-5");
    expect(noticeClass).not.toContain("sm:mx-6");
    expect(html.match(/Try again/g)).toHaveLength(1);
    client.clear();
  });
});

describe("property retirement origin and shared integration", () => {
  it.each(["/spaces", "/properties"])("preserves %s confirmation through Layout and reload with the original operational origin", (pathname) => {
    const params = new URLSearchParams({ property: propertyId, section: "property", retire: "property", surfaceReturn: "today", surfaceReturnView: "visual", surfaceReturnProperty: propertyId });
    const href = propertyRetirementLayoutHref(propertyId, params, pathname);
    const destination = new URL(href, "https://test.invalid");
    expect(destination.pathname).toBe("/spaces");
    expect(destination.searchParams.get("section")).toBe("layout");
    expect(destination.searchParams.has("room")).toBe(false);
    const back = parsePropertyRetirementReturn(destination.searchParams, propertyId)!;
    expect(back.href).toBe(pathname + "?" + params);
    expect(parsePropertyRetirementReturn(destination.searchParams, otherId)).toBeNull();
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [href] }, createElement(OwnerOriginLink)));
    expect(html).toContain("Back to Property / retirement");
    expect(html).toContain("retire%3Dproperty".replace("%3D", "="));
  });
  it("rejects external, mismatched, recursive and non-property return forms", () => {
    for (const href of ["https://evil.invalid/spaces?section=property&retire=property&property=" + propertyId,
      "/spaces?section=layout&retire=property&property=" + propertyId, "/properties?retire=room&property=" + propertyId,
      "/spaces?section=property&retire=property&property=" + propertyId + "&propertyRetirementReturn=again",
      "/properties?retire=property&property=" + propertyId + "#fragment"]) expect(parsePropertyRetirementReturn(new URLSearchParams({ propertyRetirementReturn: href }), propertyId)).toBeNull();
  });
  it("uses one mutation owner, preserves guarded focus and excludes overlapping property-version edits", () => {
    const owner = source("features/properties/usePropertyRetirementEditor.ts");
    const legacy = source("features/properties/PropertiesPage.tsx");
    const spaces = source("features/spaces/SpacesPropertySection.tsx");
    for (const consumer of [legacy, spaces]) {
      expect(consumer).toContain("usePropertyRetirementEditor({");
      expect(consumer).toContain("<PropertyRetirementPanel");
      expect(consumer).toContain("actionsDisabled=");
      expect(consumer).toContain("onEngagementChange={setProcessingEngaged}");
      expect(consumer).not.toContain("resolvePropertySimpleLifecycleAttempt");
    }
    expect(spaces).not.toContain("Retirement options");
    expect(spaces).toContain("const retirementEngaged = Boolean(retirement.target) || retirement.busy || Boolean(retirement.confirmed)");
    expect(legacy).toContain("const propertyRetirementEngaged = propertyRetirementPending || Boolean(propertyRetirement.confirmed)");
    expect(legacy).toContain('disabled={editor.busy || propertyRetirementPending} onClick={() => setPropertyForm({})}');
    expect(spaces).toContain('property.status === "active" && !retirement.confirmed');
    expect(owner).toContain("body: JSON.stringify(input.payload)");
    expect(owner).toContain("propertyRetirementReceiptMatches(receipt, input)");
    expect(owner).toContain("current.current.mounted = false; current.current.instance += 1");
    expect(owner).toContain("mutation.mutate({ ...resume, replay: true })");
    expect(owner).toContain('params.get("retire") === "property"');
    expect(owner).not.toContain("refetchInterval");
    const panel = source("features/properties/PropertyRetirementPanel.tsx");
    expect(panel).toContain("const close = useCallback(() => closeRef.current(), [])");
    expect(panel).toContain("document.activeElement !== node || node === section.current");
    expect(panel).toContain("visible(trigger) ? trigger : visible(fallback) ? fallback : null");
    expect(panel).toContain("focus:outline-2 focus:outline-primary");
    const processing = source("features/properties/PropertyProcessingPanel.tsx");
    expect(processing).toContain("activationOpen || suspensionOpen || activation.isPending || suspension.isPending");
    expect(processing).toContain('property.status === "active" && !retired && !actionsDisabled && canManage');
    expect(processing).toContain('property.status === "retired" || state?.reasonCode === "Properties.PropertyRetired"');
    expect(processing).toContain('open={activationOpen && !retired}');
    expect(processing).toContain('open={suspensionOpen && !retired}');
    expect(processing).toContain('[canManage, permissionsCurrent, retired]');
    expect(spaces).toContain('mayManageIdentity && property.status === "active" && <button');
    expect(legacy).toContain('const canUpdateProperty = mayManageProperty && selectedProperty?.status === "active"');
    const identity = source("features/properties/usePropertyEditor.ts");
    expect(identity).toContain('if (state.property && (!canUpdate || !propertyIdentityRecordEditable(property, state.property))) return');
    expect(identity).toContain('if (propertyFormRetired || (input.property && (!canUpdate || !propertyIdentityRecordEditable(property, input.property)))) return');
    expect(identity).toContain('canUpdate && propertyIdentityRecordEditable(property, input.property)');
    expect(identity).toContain('!propertyFormRetired && propertyMutation.variables');
    expect(identity).toContain(': canCreate && catalog.current && catalog.isSelectable(input.timeZoneId)');
    const frame = source("features/properties/PropertyEditorFrame.tsx");
    expect(frame).toContain('if (opener && opener.current !== trigger) return');
    expect(frame).toContain('const destination = visible(trigger) ? trigger : visible(fallback) ? fallback : null');
  });
});
