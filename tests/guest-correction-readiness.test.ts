import type { ComponentProps, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataRightsCase, DataRightsCorrectionExecutionDetails, GuestProfile } from "../src/api/types";
import { SelectPicker } from "../src/components/ui/SelectPicker";
import { CorrectionSubmit, CorrectionTextInput } from "../src/features/data-rights/CorrectionFormFields";
import { GuestCorrectionForm } from "../src/features/data-rights/GuestCorrectionForm";
import { PrivacyRequestCorrection } from "../src/features/data-rights/PrivacyRequestCorrection";
import { PrivacyRequestCorrectionOwnerEditor } from "../src/features/data-rights/PrivacyRequestCorrectionOwnerEditor";
import { PrivacyRequestDetail } from "../src/features/data-rights/PrivacyRequestDetail";
import { ReservationCorrectionForm } from "../src/features/data-rights/ReservationCorrectionForm";
import { WorkspaceStaffOnboardingCorrectionForm } from "../src/features/data-rights/WorkspaceStaffOnboardingCorrectionForm";
import { NationalityPicker } from "../src/features/guests/NationalityPicker";
import { LanguagePicker } from "../src/features/guests/LanguagePicker";

// Real component/handler chain with keyed hook and query doubles. Native focus/layout is a separate browser gate.
const h = vi.hoisted(() => ({ name: "", index: 0, slots: new Map<string, unknown[]>(), queries: {} as Record<string, { data: unknown; isFetching: boolean; isLoading: boolean; error: unknown }>,
  effects: [] as (() => void)[], dirty: false, request: vi.fn(), mutation: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn, useId: () => "nationality-test",
  useEffect: (fn: () => void) => { if (h.name.startsWith("searchable:")) h.effects.push(fn); },
  useState: (initial: unknown) => { const slots = h.slots.get(h.name) ?? []; h.slots.set(h.name, slots); const index = h.index++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: unknown) => { const value = typeof next === "function" ? next(slots[index]) : next; h.dirty ||= !Object.is(slots[index], value); slots[index] = value; }]; },
  useRef: (initial: unknown) => { const slots = h.slots.get(h.name) ?? []; h.slots.set(h.name, slots); const index = h.index++; return slots[index] ?? (slots[index] = { current: initial }); },
}));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: h.request }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ ...h.queries[queryKey[0]], refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  useMutation: (options: { mutationFn: (body: unknown) => unknown }) => ({ isPending: false, error: null, reset: vi.fn(), mutate: options.mutationFn }),
}));
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children)]; }
function invoke<P>(name: string, component: (props: P) => unknown, props: P) { h.name = name; h.index = 0; return component(props); }
function child<T>(tree: unknown, component: (props: T) => unknown) { return nodes(tree).find(node => node.type === component) as ReactElement<T> | undefined; }
const propertyId = "property-1", caseId = "case-1", guestId = "guest-1";
const profile = { guestId, version: 12, displayName: "QA Guest", legalName: null, email: null, phone: null, dateOfBirth: null,
  nationalityCountryCode: "GB", preferredLanguageTag: "en-GB", notes: null } as GuestProfile;
const claim = () => ({ executionId: "claim-1", caseId, propertyId, executionRevision: 10, selectedCaseVersion: 9, approvalRevision: 7,
  subject: { ownerKey: "guests", recordType: "guest-profile", recordId: guestId, recordVersion: 12 }, version: 1,
  status: 1, isCurrentActor: true, expiresAtUtc: new Date(Date.now() + 600_000).toISOString() } as DataRightsCorrectionExecutionDetails);
function chain(permissionCurrent = true, operatorScopeKey = "operator-1") {
  const permissions = { label: "Permissions", state: "ready" as const, isFetching: !permissionCurrent, refetch: vi.fn() };
  const detail = invoke("detail:" + operatorScopeKey, PrivacyRequestDetail, {
    scope: { kind: "guest", propertyId }, caseId, operatorScopeKey, permissionSource: permissions, erasePermissionSource: permissions,
    capabilities: { read: true, create: true, manage: true, discover: true, review: true, decide: true, execute: true, export: true, downloadExport: true, restrict: true, erase: true }, onClose: vi.fn(),
  } as ComponentProps<typeof PrivacyRequestDetail>);
  const correctionEntry = child(detail, PrivacyRequestCorrection)!;
  const correction = invoke("correction:" + operatorScopeKey, PrivacyRequestCorrection, correctionEntry.props);
  const ownerEntry = child(correction, PrivacyRequestCorrectionOwnerEditor);
  if (!ownerEntry) return null;
  const owner = invoke("owner:" + operatorScopeKey, PrivacyRequestCorrectionOwnerEditor, ownerEntry.props);
  const formEntry = child(owner, GuestCorrectionForm);
  if (!formEntry) return null;
  const key = String(formEntry.key);
  const form = invoke("form:" + key, GuestCorrectionForm, formEntry.props);
  return { form, key, props: formEntry.props, ownerProps: ownerEntry.props };
}
function picker(view: NonNullable<ReturnType<typeof chain>>) {
  const entry = child(view.form, NationalityPicker)!;
  const wrapped = invoke("nationality:" + view.key, NationalityPicker, entry.props);
  const select = child(wrapped, SelectPicker)!;
  const privateEntry = SelectPicker(select.props);
  for (let pass = 0; pass < 5; pass++) {
    h.dirty = false; h.effects = [];
    const tree = nodes(invoke("searchable:" + view.key, privateEntry.type as (props: typeof privateEntry.props) => unknown, privateEntry.props));
    h.effects.forEach(effect => effect());
    if (!h.dirty) return tree;
  }
  throw new Error("Searchable control did not settle");
}
const popup = (view: NonNullable<ReturnType<typeof chain>>) => picker(view).find(node => typeof node.props.onOpenChange === "function")!;
const input = (view: NonNullable<ReturnType<typeof chain>>) => picker(view).find(node => node.props.role === "combobox")!;
function submit(view: NonNullable<ReturnType<typeof chain>>) { (nodes(view.form)[0].props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() }); }
function changeName(view: NonNullable<ReturnType<typeof chain>>, value: string) { const field = nodes(view.form).find(node => node.type === CorrectionTextInput && node.props.label === "Display name")!; (field.props.onChange as (v: string) => void)(value); }
const applyDisabled = (view: NonNullable<ReturnType<typeof chain>>) => child(view.form, CorrectionSubmit)!.props.disabled;
beforeEach(() => {
  h.slots.clear(); h.request.mockReset(); h.request.mockResolvedValue({});
  const execution = claim();
  const ready = (data: unknown) => ({ data, isFetching: false, isLoading: false, error: null });
  h.queries = {
    "data-rights-case": ready({ id: caseId, propertyId, type: 1, status: 7, version: 10, requestedOperations: 2, selectedSubjectCount: 1 } as DataRightsCase),
    "data-rights-subjects": ready({ caseVersion: 10, subjects: [{ ...execution.subject, selectedAtUtc: "2026-09-13T00:00:00Z" }] }),
    "data-rights-correction": ready(execution), "data-rights-correction-owner": ready({ ...profile }),
  };
});

describe("Guest correction draft and submit readiness", () => {
  it.each(["data-rights-case", "data-rights-subjects", "data-rights-correction", "data-rights-correction-owner"])("retains the real Languages field selection through %s refresh and submits the full set only after readiness", source => {
    let view = chain()!;
    child(view.form, LanguagePicker)!.props.onChange(["en-GB", "fr", "sr-Latn"]);
    const originalKey = view.key;
    h.queries[source].isFetching = true; view = chain()!;
    const field = child(view.form, LanguagePicker)!;
    expect(view.key).toBe(originalKey); expect(field.props.value).toEqual(["en-GB", "fr", "sr-Latn"]);
    expect(field.props.disabled).toBe(false); expect(field.props.onDisabledClose).toBeTypeOf("function");
    submit(view); expect(h.request).not.toHaveBeenCalled();
    h.queries[source].isFetching = false; view = chain()!; submit(view);
    expect(JSON.parse(h.request.mock.calls[0][1].body)).toMatchObject({ languageTags: ["en-GB", "fr", "sr-Latn"], preferredLanguageTag: "en-GB", expectedVersion: 12 });
  });
  it("retains the disabled language draft during permission loss and removes the owner form after claim expiry", () => {
    let view = chain()!;
    child(view.form, LanguagePicker)!.props.onChange(["fr", "ja"]);
    view = chain(false)!;
    expect(child(view.form, LanguagePicker)!.props).toMatchObject({ value: ["fr", "ja"], disabled: true });
    submit(view); expect(h.request).not.toHaveBeenCalled();
    (h.queries["data-rights-correction"].data as DataRightsCorrectionExecutionDetails).expiresAtUtc = new Date(Date.now() - 1000).toISOString();
    expect(chain()).toBeNull();
    expect(h.request).not.toHaveBeenCalled();
  });
  it.each(["data-rights-case", "data-rights-subjects", "data-rights-correction", "data-rights-correction-owner"])("preserves actual filtered picker/draft across %s fetching but blocks synchronous submit", source => {
    let view = chain()!; changeName(view, "QA Draft");
    (popup(view).props.onOpenChange as (open: boolean) => void)(true);
    (input(view).props.onChange as (event: unknown) => void)({ target: { value: "jap" } });
    const originalKey = view.key;
    h.queries[source].isFetching = true; view = chain()!;
    expect(view.key).toBe(originalKey); expect(view.props.editingDisabled).toBe(false);
    expect(popup(view).props.open).toBe(true); expect(input(view).props.value).toBe("jap");
    expect(picker(view).filter(node => node.props.role === "option")).toHaveLength(1);
    expect(applyDisabled(view)).toBe(true); submit(view); expect(h.request).not.toHaveBeenCalled();
    h.queries[source].isFetching = false; view = chain()!;
    expect(popup(view).props.open).toBe(true); expect(input(view).props.value).toBe("jap"); expect(applyDisabled(view)).toBe(false);
    submit(view); expect(h.request).toHaveBeenCalledOnce();
    expect(JSON.parse(h.request.mock.calls[0][1].body)).toMatchObject({ displayName: "QA Draft", nationalityCountryCode: "GB", preferredLanguageTag: "en-GB", expectedVersion: 12, caseId });
  });
  it.each(["data-rights-case", "data-rights-subjects", "data-rights-correction", "data-rights-correction-owner"])("closes the picker on a cached %s error without treating stale as ready", source => {
    let view = chain()!; changeName(view, "QA Draft"); (popup(view).props.onOpenChange as (open: boolean) => void)(true);
    h.queries[source].error = new Error("controlled read failure"); view = chain()!;
    expect(view.props.editingDisabled).toBe(true); expect(popup(view).props.open).toBe(false); expect(applyDisabled(view)).toBe(true);
    submit(view); expect(h.request).not.toHaveBeenCalled();
  });
  it("strict permission refresh closes the popup and blocks direct submit", () => {
    let view = chain()!; changeName(view, "QA Draft"); (popup(view).props.onOpenChange as (open: boolean) => void)(true);
    view = chain(false)!; expect(view.props.editingDisabled).toBe(true); expect(popup(view).props.open).toBe(false); submit(view); expect(h.request).not.toHaveBeenCalled();
  });
  it("rekeys changed case/claim/operator identity, never reusing the former editable draft", () => {
    const first = chain()!; changeName(first, "Must not carry");
    const data = h.queries["data-rights-case"].data as DataRightsCase; data.version++;
    const next = chain()!; expect(next.key).not.toBe(first.key); expect(next.props.editingDisabled).toBe(true);
    expect(nodes(next.form).find(node => node.props.label === "Display name")?.props.value).toBe("QA Guest");
    expect(chain(true, "another-operator")!.key).not.toBe(next.key);
    const execution = h.queries["data-rights-correction"].data as DataRightsCorrectionExecutionDetails; execution.version++;
    expect(chain()!.key).not.toBe(next.key); execution.isCurrentActor = false; expect(chain()).toBeNull();
  });
  it("keeps owner revision mismatch outside the form", () => { (h.queries["data-rights-correction-owner"].data as GuestProfile).version++; expect(chain()).toBeNull(); });
  it("blocks pending, unchanged, empty-name and missing readiness submissions directly", () => {
    let view = chain()!; submit(view); expect(h.request).not.toHaveBeenCalled(); changeName(view, ""); view = chain()!; submit(view); expect(h.request).not.toHaveBeenCalled();
    changeName(view, "Changed"); view = chain()!;
    for (const override of [{ pending: true }, { editingDisabled: undefined }, { disabled: true }]) {
      const tree = invoke("form:" + view.key, GuestCorrectionForm, { ...view.props, ...override });
      expect(child(tree, CorrectionSubmit)!.props.disabled).toBe(true); submit({ ...view, form: tree });
    }
    expect(h.request).not.toHaveBeenCalled();
  });
  it.each(["reservations", "workspaces"])("leaves %s correction owner disabled behavior unchanged", ownerKey => {
    const execution = { ...claim(), subject: { ownerKey, recordType: ownerKey === "reservations" ? "reservation" : "staff-onboarding", recordId: "other", recordVersion: 12 } };
    h.queries["data-rights-correction-owner"].data = { ...profile, reservationId: "other", applicationId: "other" };
    h.queries["workspace-staff-onboarding"] = h.queries["data-rights-correction-owner"];
    for (const disabled of [false, true]) {
      const tree = invoke("other-owner", PrivacyRequestCorrectionOwnerEditor, { propertyId, execution, disabled, guestDraftReady: false, guestSubmitReady: false,
        operatorScopeKey: "operator-1", scopeKey: `guest:${propertyId}`, caseSnapshot: h.queries["data-rights-case"].data as DataRightsCase, onApplied: vi.fn() });
      const form = nodes(tree).find(node => node.type === ReservationCorrectionForm || node.type === WorkspaceStaffOnboardingCorrectionForm)!;
      expect(form.props.disabled).toBe(disabled); expect(form.props).not.toHaveProperty("editingDisabled");
    }
  });
});
