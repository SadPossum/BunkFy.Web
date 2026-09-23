import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { ApiError } from "../src/api/client";
import { GuestsPage } from "../src/features/guests/GuestsPage";
import type { GuestCreatePayload } from "../src/features/guests/guestCreateAttempt";
import type { GuestProfile } from "../src/api/types";
import {
  guestMutationAllowed,
  guestRecordMatches,
} from "../src/features/guests/guestsMutationAuthority";

const repositoryRoot = process.cwd();

type MutationOptions = { mutationFn: (v: unknown) => unknown; onSuccess: (r: unknown, v: unknown) => unknown; onError: (e: Error, v: unknown) => unknown };
type Mutation = { options: MutationOptions; isPending: boolean; error: Error | null; mutate: (v: unknown) => void; reset: () => void };
const h = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => void)[], mutationIndex: 0, mutations: [] as Mutation[], lastRun: Promise.resolve(),
  request: vi.fn(), profile: undefined as GuestProfile | undefined, property: "property-a", params: new URLSearchParams("guest=guest-a"),
  generation: "actor-generation-1", mayRead: true, mayManage: true, permissionFetching: false, detailFetching: false }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: (effect: () => void) => h.effects.push(effect),
  useMemo: (fn: () => unknown) => fn(), useId: () => "guest-recovery-test",
  useState: (initial: unknown) => { const i = h.index++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? next(h.slots[i]) : next; }]; },
  useRef: (initial: unknown) => { const i = h.index++; return h.slots[i] ?? (h.slots[i] = { current: initial }); },
}));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: h.request, session: { tenantId: "tenant", username: "owner", generation: h.generation } }) }));
vi.mock("../src/app/workspace", () => ({ useWorkspace: () => ({ selectedProperty: { name: "QA Property" }, selectedPropertyId: h.property }) }));
vi.mock("../src/app/resourceFocus", () => ({ useTargetProperty: () => undefined }));
vi.mock("../src/app/permissions", () => ({ permissions: { guestsRead: "read", guestsCreate: "create", guestsManage: "manage", guestsArchive: "archive", reservationsRead: "reservations" },
  propertyAccessScope: () => h.property, usePermissions: () => ({ allows: (p: string) => p === "read" ? h.mayRead : p === "manage" ? h.mayManage : true,
    hasData: true, isLoading: false, isFetching: h.permissionFetching, error: null, refetch: vi.fn() }) }));
vi.mock("react-router", async original => ({ ...await original<typeof import("react-router")>(), useSearchParams: () => [h.params, (next: URLSearchParams) => { h.params = next; }] }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "guest-detail" ? h.profile : queryKey[0] === "guest-list" ? { guests: [h.profile], totalCount: 1, page: 1, pageSize: 30 } : { stays: [], totalCount: 0 },
    isLoading: false, isFetching: queryKey[0] === "guest-detail" && h.detailFetching, error: null, refetch: vi.fn() }),
  useMutation: (options: MutationOptions) => {
    const index = h.mutationIndex++;
    if (!h.mutations[index]) {
      const mutation: Mutation = { options, isPending: false, error: null, reset: () => { mutation.error = null; }, mutate: variables => {
        mutation.isPending = true; mutation.error = null;
        h.lastRun = Promise.resolve().then(() => mutation.options.mutationFn(variables)).then(result => mutation.options.onSuccess(result, variables), async error => {
          mutation.error = error; await mutation.options.onError(error, variables);
        }).then(() => { mutation.isPending = false; });
      } }; h.mutations[index] = mutation;
    }
    h.mutations[index].options = options; return h.mutations[index];
  },
}));
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const n = value as Node; return [n, ...nodes(n.props.children)]; }
function component(tree: unknown, name: string) { const found = nodes(tree).find(n => typeof n.type === "function" && n.type.name === name); if (!found) throw new Error("Missing component " + name); return found; }
function page() { h.index = 0; h.mutationIndex = 0; return GuestsPage(); }
function form() { return component(page(), "GuestForm").props; }
function edit() { const view = component(page(), "GuestDetail"); (view.props.onEdit as () => void)(); return form(); }
afterEach(() => vi.unstubAllGlobals());

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("guests source authority recovery", () => {
  it("requires only the current evidence consumed by each Guest Record command", () => {
    expect(guestMutationAllowed("create", {
      permissionsCurrent: true,
    })).toBe(true);
    expect(guestMutationAllowed("update", {
      permissionsCurrent: true,
      guestCurrent: true,
    })).toBe(true);
    expect(guestMutationAllowed("archive", {
      permissionsCurrent: true,
      guestCurrent: true,
    })).toBe(true);

    for (const action of ["create", "update", "archive"] as const) {
      expect(guestMutationAllowed(action, {
        permissionsCurrent: false,
        guestCurrent: true,
      })).toBe(false);
    }

    expect(guestMutationAllowed("update", {
      permissionsCurrent: true,
      guestCurrent: false,
    })).toBe(false);
    expect(guestMutationAllowed("archive", {
      permissionsCurrent: true,
    })).toBe(false);
  });

  it("rejects update and archive commands after the Guest Record advances", () => {
    const candidate = guest();

    expect(guestRecordMatches(candidate, candidate)).toBe(true);
    expect(guestRecordMatches({ ...candidate, version: 8 }, candidate)).toBe(false);
    expect(guestRecordMatches({
      ...candidate,
      lastChangedAtUtc: "2026-08-23T10:01:00Z",
    }, candidate)).toBe(false);
    expect(guestRecordMatches({ ...candidate, status: 2 }, candidate)).toBe(false);
    expect(guestRecordMatches({ ...candidate, guestId: "guest-b" }, candidate)).toBe(false);

    // A Guest Record may be visible from a property other than where it began.
    expect(guestRecordMatches({
      ...candidate,
      originPropertyId: "property-b",
    }, candidate)).toBe(true);
  });

  it("preserves independent snapshots and gates every Guest Record mutation path", () => {
    const page = source("features/guests/GuestsPage.tsx");

    expect(page).toContain("const permissionSource = createCompositeSource({");
    expect(page).toContain("const directorySource = createCompositeSource({");
    expect(page).toContain("const detailSource = createCompositeSource({");
    expect(page).toContain("const staysSource = createCompositeSource({");
    expect(page).toContain("guestRecordMatches(detail.data, guest)");
    expect(page).toContain("propertyId: selectedPropertyId");
    expect(page).toContain("selectedPropertyIdRef.current !== submission.propertyId");
    expect(page).toContain("if (!mayRead) {");
    expect(page).toContain("state={guestDataVisible && formIntent.current?.ownerKey === ownerKey ? formState : undefined}");
    expect(page).toContain("setFormState(undefined);");
    expect(page).toContain("setArchiveTarget(null);");
    expect(page).toContain("useTargetProperty(searchParams.get(\"property\"));");
    expect(page).toContain("next.set(\"guest\", guestId);");
    expect(page).toContain("Open reservation");
    expect(page).toContain("<CompositeSourceNotice");
    expect(page).toContain("<CompositeSourceFallback");
    expect(page).toContain("disabled={!authorityCurrent || Boolean(recovery)}");
    expect(page).not.toContain("placeholderData:");
    expect(page).not.toContain("guests.error ?");
    expect(page).not.toContain("detail.error ?");
  });

  it("keeps exact replay separate from editable commands and binds responses to the originating form", () => {
    const page = source("features/guests/GuestsPage.tsx");
    expect(page).toContain("attempt === updateRecovery?.attempt && recoveryAllowed");
    expect(page).toContain("!updateRecovery && guest.status === 1");
    expect(page).toContain("return attempt.requestBody");
    expect(page).toContain("formIntent.current !== submission.intent");
    expect(page).toContain("submission.intent.ownerKey !== ownerKeyRef.current");
    expect(page).toContain("selectedGuestId !== formState.guestId");
    expect(page).toContain("detail.data.status !== 1");
    expect(page).toContain("setGuestOutcome(\"Guest record saved.\")");
    const editor = page.slice(page.indexOf("function GuestEditor"), page.indexOf("function MutationAuthorityNotice"));
    expect(editor.indexOf("<ErrorState")).toBeLessThan(editor.indexOf("<fieldset"));
    expect(editor.indexOf("Retry save")).toBeLessThan(editor.indexOf("<fieldset"));
    expect(editor).toContain("<fieldset disabled={fieldsDisabled}");
    expect(editor).toContain("event.key === \"Tab\"");
    expect(editor).toContain("document.removeEventListener(\"focusin\", focus)");
    expect(editor).toContain("document.removeEventListener(\"pointerdown\", pointer)");
    expect(editor).toContain("authorityFeedback.current?.focus()");
  });
});

describe("real Guest page update handlers (native focus/layout remains a separate gate)", () => {
  const values: GuestCreatePayload = { displayName: "QA Guest", legalName: null, email: null, phone: null, dateOfBirth: null,
    nationalityCountryCode: "GB", preferredLanguageTag: null, languageTags: [], notes: null };
  beforeEach(() => { h.slots = []; h.index = 0; h.mutationIndex = 0; h.mutations = []; h.profile = guest(); h.property = "property-a";
    h.params = new URLSearchParams("guest=guest-a"); h.generation = "actor-generation-1"; h.mayRead = true; h.mayManage = true; h.permissionFetching = false; h.detailFetching = false; h.request.mockReset(); });
  it.each([false, true])("retries exact bytes after precommit/hidden-commit failure (committed=%s)", async committed => {
    h.request.mockImplementationOnce(async () => { if (committed) h.profile = { ...h.profile!, version: 8, languageTags: [] }; throw new ApiError("controlled delivery loss", 503); });
    (edit().onSubmit as (v: GuestCreatePayload) => void)(values); await h.lastRun;
    const first = h.request.mock.calls[0]; const recovery = form();
    expect(recovery.authorityCurrent).toBe(!committed); expect(recovery.recoveryAllowed).toBe(true);
    (recovery.onSubmit as (v: GuestCreatePayload) => void)({ ...values, languageTags: ["must-not-send"] });
    expect(h.request).toHaveBeenCalledTimes(1);
    h.request.mockResolvedValueOnce({ guestId: "guest-a", version: 8 });
    (recovery.onRetry as () => void)(); await h.lastRun;
    expect(h.request.mock.calls[1]).toEqual(first);
    expect(JSON.parse(first[1].body)).toMatchObject({ expectedVersion: 7, languageTags: [] });
    expect(form().state).toBeUndefined();
    expect(nodes(page()).some(n => n.props.role === "status" && n.props.children === "Guest record saved.")).toBe(true);
  });
  it("does not invent ownership from a matching GET and stops after a genuine conflict", async () => {
    h.request.mockRejectedValueOnce(new ApiError("precommit failure", 503));
    (edit().onSubmit as (v: GuestCreatePayload) => void)(values); await h.lastRun;
    h.profile = { ...h.profile!, version: 8, languageTags: [] };
    expect(form().state).toBeDefined(); expect(h.request).toHaveBeenCalledTimes(1);
    h.request.mockRejectedValueOnce(new ApiError("intervening version", 409));
    (form().onRetry as () => void)(); await h.lastRun;
    const failed = form(); expect(failed.recoveryAllowed).toBe(false); expect(failed.recovery).toMatchObject({ uncertain: false });
    (failed.onRetry as () => void)(); expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.request.mock.calls[1]).toEqual(h.request.mock.calls[0]);
  });
  it.each(["cancel", "property", "actor", "permission", "status", "refresh"])("blocks retained recovery after %s change", async change => {
    h.request.mockRejectedValueOnce(new ApiError("lost result", 503));
    (edit().onSubmit as (v: GuestCreatePayload) => void)({ ...values, languageTags: ["sr-Latn", "unknown-١"] }); await h.lastRun;
    const old = form();
    if (change === "cancel") (old.onClose as () => void)();
    if (change === "property") h.property = "property-b";
    if (change === "actor") h.generation = "actor-generation-2";
    if (change === "permission") h.mayManage = false;
    if (change === "status") h.profile = { ...h.profile!, status: 2 };
    if (change === "refresh") h.detailFetching = true;
    const current = form(); (current.onRetry as () => void)(); await h.lastRun;
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it("does not use exact-retry permission to authorize an ordinary stale-version edit", () => {
    edit(); h.profile = { ...h.profile!, version: 8 };
    const current = form(); expect(current.authorityCurrent).toBe(false);
    (current.onSubmit as (v: GuestCreatePayload) => void)(values);
    expect(h.request).not.toHaveBeenCalled();
  });
  it("does not let a late canceled save close or announce success over a newly opened form", async () => {
    let resolve!: (v: unknown) => void;
    h.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = edit(); (first.onSubmit as (v: GuestCreatePayload) => void)(values); await Promise.resolve();
    (first.onClose as () => void)(); edit();
    resolve({ guestId: "guest-a", version: 8 }); await h.lastRun;
    expect(form().state).toBeDefined();
    expect(nodes(page()).some(n => n.props.role === "status" && n.props.children === "Guest record saved.")).toBe(false);
  });
  it.each(["owned-modal-repair", "Tab", "pointer-away", "focus-away"])("focuses the owning top error only while failure focus remains owned (%s)", mode => {
    const props = { ...edit(), submitting: false, error: null as Error | null, onSubmit: vi.fn() };
    class Target { parent: Target | null = null; contains(target: Target | null): boolean { return Boolean(target && (target === this || this.contains(target.parent))); }
      closest() { return modal; } focus = vi.fn(() => { doc.activeElement = this; }); }
    const modal = new Target(), button = new Target(), notice = new Target(), heading = new Target(), outside = new Target();
    const doc = Object.assign(new EventTarget(), { activeElement: button, body: new Target() });
    vi.stubGlobal("document", doc); vi.stubGlobal("Node", Target);
    vi.stubGlobal("FormData", class { get(name: string) { return name === "displayName" ? "QA Guest" : ""; } });
    const guestForm = component(page(), "GuestForm");
    const modalElement = (guestForm.type as (p: unknown) => Node)(props);
    const editor = component(modalElement, "GuestEditor");
    const renderEditor = () => {
      h.index = 100; h.effects = [];
      const tree = nodes((editor.type as (p: unknown) => Node)(props));
      (tree.find(n => n.type === "div" && n.props.tabIndex === -1)!.props.ref as { current: Target }).current = notice;
      (tree.find(n => n.props.title === "Additional details")!.props.headingRef as { current: Target }).current = heading;
      return tree;
    };
    const initial = renderEditor();
    (initial.find(n => n.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn(), currentTarget: {} });
    expect(props.onSubmit).toHaveBeenCalledOnce(); props.submitting = true; renderEditor();
    const cleanup = h.effects[0]() as unknown as () => void;
    if (mode === "owned-modal-repair") { doc.activeElement = modal; const event = new Event("focusin"); Object.defineProperty(event, "target", { value: modal }); doc.dispatchEvent(event); }
    if (mode === "Tab") { const event = new Event("keydown"); Object.defineProperty(event, "key", { value: "Tab" }); doc.dispatchEvent(event); doc.activeElement = modal; }
    if (mode === "pointer-away" || mode === "focus-away") { doc.activeElement = outside; const event = new Event(mode === "pointer-away" ? "pointerdown" : "focusin"); Object.defineProperty(event, "target", { value: outside }); doc.dispatchEvent(event); }
    cleanup(); props.submitting = false; props.error = new ApiError("delivery uncertain", 503); renderEditor(); h.effects[1]();
    expect(notice.focus).toHaveBeenCalledTimes(mode === "owned-modal-repair" ? 1 : 0);
  });
});

function guest(): GuestProfile {
  return {
    guestId: "guest-a",
    originPropertyId: "property-a",
    displayName: "Maya Chen",
    legalName: null,
    email: "maya@example.test",
    phone: null,
    dateOfBirth: null,
    nationalityCountryCode: null,
    preferredLanguageTag: null,
    notes: null,
    status: 1,
    version: 7,
    createdBy: "staff:test",
    createdAtUtc: "2026-08-23T09:00:00Z",
    lastChangedBy: "staff:test",
    lastChangedAtUtc: "2026-08-23T10:00:00Z",
    archivedAtUtc: null,
  };
}
