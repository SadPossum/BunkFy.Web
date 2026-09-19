import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reservation, ReservationMutationReceipt } from "../src/api/types";
import { ApiError } from "../src/api/client";
import type { RouteNavigationLease } from "../src/app/routeNavigationLease";
import { bookingDetailsDraft, bookingDetailsPayload, useReservationDetailsEditor } from "../src/features/reservations/useReservationDetailsEditor";

// Real reservation-local hook with deterministic state/effect/request doubles.
// Native history, DOM focus and actual server idempotency require browser/API proof.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], cleanups: new Map<number, () => void>(), request: vi.fn() }));
vi.mock("react", async load => ({ ...await load<typeof import("react")>(),
  useRef: (initial: unknown) => { const i = hooks.cursor++; return hooks.slots[i] ?? (hooks.slots[i] = { current: initial }); },
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.slots)) hooks.slots[i] = initial; return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = typeof value === "function" ? value(hooks.slots[i]) : value; }]; },
  useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => { const i = hooks.cursor++, previous = hooks.slots[i] as unknown[] | undefined; if (previous && deps.every((value, index) => Object.is(value, previous[index]))) return; hooks.slots[i] = deps; hooks.effects.push(() => { hooks.cleanups.get(i)?.(); hooks.cleanups.delete(i); const cleanup = effect(); if (cleanup) hooks.cleanups.set(i, cleanup); }); },
}));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: hooks.request }) }));
const record = (): Reservation => ({ propertyId: "p", reservationId: "r", primaryGuestName: "QA guest", guestCount: 2, email: "qa@example.invalid", phone: null, notes: "Original", expectedArrivalTime: "14:30:00", expectedDepartureTime: null, detailsRevision: 2, version: 17, status: "checkedOut" } as Reservation);
const reportOwner = vi.fn(), onSaved = vi.fn();
const navigation = { reportOwner } as unknown as RouteNavigationLease;
let props: Parameters<typeof useReservationDetailsEditor>[0];
function render(change: Partial<typeof props> = {}) { props = { ...props, ...change }; hooks.cursor = 0; hooks.effects = []; const value = useReservationDetailsEditor(props); hooks.effects.forEach(effect => effect()); return value; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.cleanups.clear(); hooks.request.mockReset(); reportOwner.mockReset(); onSaved.mockReset().mockResolvedValue(undefined); props = { identity: "actor-session-workspace:p:r", propertyId: "p", reservationId: "r", current: record(), authorityCurrent: true, authorityLost: false, navigation, onSaved }; });
afterEach(() => hooks.cleanups.forEach(cleanup => cleanup()));

describe("ordinary booking details owner", () => {
  it("keeps terminal-stay correction supported and uses detailsRevision, not lifecycle version", () => {
    const item = record(), draft = bookingDetailsDraft(item), payload = bookingDetailsPayload(item, { ...draft, primaryGuestName: " QA corrected ", phone: " " });
    expect(payload.expectedDetailsRevision).toBe(2); expect(payload).not.toHaveProperty("expectedVersion"); expect(payload.primaryGuestName).toBe("QA corrected"); expect(payload.phone).toBeNull(); expect(payload.expectedArrivalTime).toBe("14:30");
    render().begin(); expect(render().editor).not.toBeNull();
  });
  it("engages only changed fields and releases when a pristine draft is restored", () => {
    render().begin(); expect(render().dirty).toBe(false); expect(reportOwner).toHaveBeenLastCalledWith(expect.objectContaining({ engaged: false }));
    render().change("notes", "Unsaved"); expect(render().dirty).toBe(true); expect(reportOwner).toHaveBeenLastCalledWith(expect.objectContaining({ engaged: true, pending: false }));
    render().change("notes", "Original"); expect(render().dirty).toBe(false); expect(reportOwner).toHaveBeenLastCalledWith(expect.objectContaining({ engaged: false }));
  });
  it("retains all fields and captured revision through ordinary refresh without permitting a save", async () => {
    render().begin(); render().change("notes", "Unsaved"); render().change("expectedArrivalTime", "16:45");
    const paused = render({ authorityCurrent: false }); await paused.submit(); paused.change("notes", "Must not replace");
    const kept = render(); expect(kept.editor?.draft.notes).toBe("Unsaved"); expect(kept.editor?.draft.expectedArrivalTime).toBe("16:45"); expect(kept.editor?.detailsRevision).toBe(2); expect(hooks.request).not.toHaveBeenCalled();
    expect(render({ authorityCurrent: true }).editor?.draft.notes).toBe("Unsaved");
  });
  it("does not rebase or dispatch a new change after read revision drift; replacement is explicit", async () => {
    render().begin(); render().change("notes", "My draft"); const drift = render({ current: { ...record(), detailsRevision: 3, notes: "Another current change" } });
    expect(drift.revisionChanged).toBe(true); expect(drift.editor?.draft.notes).toBe("My draft"); await drift.submit(); expect(hooks.request).not.toHaveBeenCalled();
    render().useCurrentDetails(); const adopted = render(); expect(adopted.editor?.detailsRevision).toBe(3); expect(adopted.editor?.draft.notes).toBe("Another current change"); expect(adopted.dirty).toBe(false);
  });
  it("retains exact sent operation/payload across uncertain result and later read revision advance", async () => {
    hooks.request.mockRejectedValueOnce(new ApiError("Lost response", 503)); render().begin(); render().change("notes", "One intended change"); await render().submit();
    let owner = render(); expect(owner.unresolved).toBe(true); expect(owner.editor?.sending).toBe(false); const sent = hooks.request.mock.calls[0][1].body;
    owner.cancel(); owner.change("notes", "Second operation forbidden"); owner.useCurrentDetails(); expect(render().editor?.draft.notes).toBe("One intended change");
    owner = render({ current: { ...record(), detailsRevision: 4, version: 99, notes: "Later current details" } }); expect(owner.revisionChanged).toBe(true);
    hooks.request.mockResolvedValueOnce({ propertyId: "p", reservationId: "r", detailsRevision: 3, version: 18 } as ReservationMutationReceipt); await owner.submit();
    expect(hooks.request).toHaveBeenCalledTimes(2); expect(hooks.request.mock.calls[1][1].body).toBe(sent); expect(JSON.parse(sent).expectedDetailsRevision).toBe(2); expect(onSaved).toHaveBeenCalledTimes(1); expect(render().editor).toBeNull();
  });
  it("serializes pending submit and forbids discard while the request is in flight", async () => {
    const pending = deferred<ReservationMutationReceipt>(); hooks.request.mockReturnValue(pending.promise); render().begin(); render().change("email", "changed@example.invalid"); const first = render().submit(); await render().submit();
    const value = render(); value.cancel(); expect(value.unresolved).toBe(true); expect(reportOwner).toHaveBeenLastCalledWith(expect.objectContaining({ engaged: true, pending: true })); expect(hooks.request).toHaveBeenCalledTimes(1);
    pending.resolve({ propertyId: "p", reservationId: "r", detailsRevision: 3, version: 18 } as ReservationMutationReceipt); await first; expect(render().editor).toBeNull();
  });
  it.each([400, 409, 422])("keeps draft but releases the attempt on definitive rejection%s", async status => {
    hooks.request.mockRejectedValueOnce(new ApiError("Rejected", status)); render().begin(); render().change("notes", "Review me"); await render().submit(); const value = render(); expect(value.editor?.draft.notes).toBe("Review me"); expect(value.unresolved).toBe(false); expect(value.editor?.error).toBeInstanceOf(ApiError);
  });
  it("treats a mismatched response as uncertain rather than success", async () => {
    hooks.request.mockResolvedValue({ propertyId: "other", reservationId: "r", detailsRevision: 3 }); render().begin(); render().change("notes", "Own draft"); await render().submit(); expect(render().unresolved).toBe(true); expect(onSaved).not.toHaveBeenCalled();
  });
  it.each(["identity", "permission", "unmount"])("scrubs or fences a late result after %s loss", async boundary => {
    const pending = deferred<ReservationMutationReceipt>(); hooks.request.mockReturnValue(pending.promise); render().begin(); render().change("notes", "Private draft"); const saved = render().submit();
    if (boundary === "identity") expect(render({ identity: "new-actor-session-property-booking" }).editor).toBeNull();
    else if (boundary === "permission") expect(render({ authorityLost: true, authorityCurrent: false }).editor).toBeNull();
    else hooks.cleanups.forEach(cleanup => cleanup());
    pending.resolve({ propertyId: "p", reservationId: "r", detailsRevision: 3, version: 18 } as ReservationMutationReceipt); await saved; expect(onSaved).not.toHaveBeenCalled();
  });
  it("explicit Cancel drops only an unsent draft and reports the owner idle", () => { render().begin(); render().change("notes", "Discard me"); render(); render().cancel(); expect(render().editor).toBeNull(); expect(reportOwner).toHaveBeenLastCalledWith(expect.objectContaining({ engaged: false, pending: false })); });
});
