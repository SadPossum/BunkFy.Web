import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { Reservation } from "../src/api/types";
import { ReservationCreationRecovery } from "../src/features/reservations/ReservationCreationRecovery";
import { newReservationRecoveryCoordinate, readReservationRecovery, storeReservationRecovery } from "../src/features/reservations/reservationCreationRecovery";

// Execute the actual recovery effect with deterministic hooks. Real browser, networking and layout are separate gates.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], pending: [] as (() => void)[], cleanups: new Map<number, () => void>(), request: vi.fn(), session: {} as Record<string, string> }));
vi.mock("../src/app/session", () => ({ useSession: () => ({ session: hooks.session, request: hooks.request }) }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (value: unknown) => { const index = hooks.cursor++; return hooks.slots[index] ?? (hooks.slots[index] = { current: value }); },
  useState: (initial: unknown) => {
    const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value; }];
  },
  useLayoutEffect: () => { hooks.cursor++; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++; const before = hooks.slots[index] as unknown[] | undefined;
    if (before && before.length === deps.length && deps.every((value, i) => Object.is(value, before[i]))) return;
    hooks.slots[index] = deps;
    hooks.pending.push(() => { hooks.cleanups.get(index)?.(); hooks.cleanups.delete(index); const cleanup = effect(); if (cleanup) hooks.cleanups.set(index, cleanup); });
  },
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = { tenantId: id(1), subjectId: id(2), sessionId: id(3), accessToken: "not-a-token", username: "synthetic" };
const record = () => newReservationRecoveryCoordinate(session, id(4), id(5), true);
const reservation = { propertyId: id(4), reservationId: id(5), version: 1, detailsRevision: 1, status: "confirmed", inventoryUnitIds: [id(6)] } as Reservation;
let raw: string | null;
const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } };
type Props = ComponentProps<typeof ReservationCreationRecovery>;
type Element = ReactElement<{ children?: unknown; onClick?: () => void; disabled?: boolean; error?: unknown }>;
function nodes(value: unknown): Element[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  const element = value as Element; return [element, ...nodes(element.props?.children)];
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join(" ");
  return value && typeof value === "object" ? text((value as Element).props?.children) : "";
}
function render(overrides: Partial<Props> = {}) {
  hooks.cursor = 0; hooks.pending = [];
  const tree = ReservationCreationRecovery({ snapshot: readReservationRecovery(storage), propertyId: id(4), mayReadCurrent: true, pending: false, autoCheck: true, onRecovered, refresh: vi.fn(), ...overrides });
  hooks.pending.forEach((effect) => effect()); return tree;
}
const onRecovered = vi.fn(async () => undefined);
const flush = () => new Promise((resolve) => setImmediate(resolve));
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.pending = []; hooks.cleanups.clear(); hooks.request.mockReset(); onRecovered.mockClear();
  hooks.session = { ...session }; raw = null;
  vi.stubGlobal("window", { sessionStorage: storage, dispatchEvent: vi.fn() });
  storeReservationRecovery(record(), storage);
});
afterEach(() => { hooks.cleanups.forEach((cleanup) => cleanup()); hooks.cleanups.clear(); vi.unstubAllGlobals(); });

describe("existing-GET reload recovery flow", () => {
  it("recovers one exact GET, records primary existence and warns without any guest operation", async () => {
    hooks.request.mockResolvedValue(reservation); render(); await flush(); render();
    expect(hooks.request).toHaveBeenCalledTimes(1);
    expect(hooks.request).toHaveBeenCalledWith(`/api/reservations/properties/${id(4)}/${id(5)}`, { signal: expect.any(AbortSignal) });
    expect(onRecovered).toHaveBeenCalledWith(reservation, expect.stringContaining("no guest operation was repeated"));
    expect(readReservationRecovery(storage)).toMatchObject({ kind: "record", record: { state: "primary-confirmed", followOnNeeded: true } });
  });
  it.each([new ApiError("Not found", 404), new ApiError("Forbidden", 403), new ApiError("Unavailable", 503), new Error("Offline")])("retains unresolved %s, then permits deliberate exact GET retry", async (failure) => {
    hooks.request.mockRejectedValueOnce(failure).mockResolvedValueOnce(reservation);
    render(); await flush(); const tree = render();
    expect(onRecovered).not.toHaveBeenCalled(); expect(raw).not.toBeNull();
    const error = nodes(tree).find((node) => node.props?.error)?.props.error;
    if (failure instanceof ApiError && failure.status === 404) expect(String(error)).toContain("may still be finishing");
    const button = nodes(tree).find((node) => node.type === "button" && text(node) === "Check saved reservation")!;
    expect(button.props.disabled).toBe(false); button.props.onClick!(); render(); await flush();
    expect(hooks.request).toHaveBeenCalledTimes(2); expect(onRecovered).toHaveBeenCalledTimes(1);
  });
  it.each(["tenantId", "subjectId", "sessionId"])("never reads a different %s marker", async (key) => {
    hooks.session[key] = id(9); const tree = render(); await flush();
    expect(hooks.request).not.toHaveBeenCalled(); expect(text(tree)).toContain("different signed-in session"); expect(raw).not.toBeNull();
  });
  it("does not read while current authority, property, pending or return-context admission is missing", () => {
    render({ mayReadCurrent: false }); render({ propertyId: id(9) }); render({ pending: true }); render({ contextReady: false });
    expect(hooks.request).not.toHaveBeenCalled(); expect(raw).not.toBeNull();
  });
  it("preserves mounted exact POST recovery instead of automatically starting a competing GET", () => {
    render({ autoCheck: false }); expect(hooks.request).not.toHaveBeenCalled();
  });
  it("rejects wrong identity and malformed receipts without navigation or clearing", async () => {
    hooks.request.mockResolvedValue({ ...reservation, reservationId: id(9) }); render(); await flush();
    expect(onRecovered).not.toHaveBeenCalled(); expect(readReservationRecovery(storage)).toMatchObject({ kind: "record", record: { state: "prepared" } });
  });
  it("aborts and fences a late read after authority is lost, then allows a fresh authorized check", async () => {
    let resolve!: (value: Reservation) => void;
    hooks.request.mockImplementationOnce(() => new Promise<Reservation>((done) => { resolve = done; })).mockResolvedValueOnce(reservation);
    render(); const options = hooks.request.mock.calls[0][1] as RequestInit;
    render({ mayReadCurrent: false }); expect(options.signal?.aborted).toBe(true);
    resolve(reservation); await flush(); expect(onRecovered).not.toHaveBeenCalled();
    render(); await flush(); expect(onRecovered).toHaveBeenCalledTimes(1);
  });
  it("does not trust malformed metadata and exposes an explicit non-reading exit", async () => {
    raw = "{broken"; const tree = render(); await flush();
    expect(hooks.request).not.toHaveBeenCalled(); expect(text(tree)).toContain("unreadable or unsupported");
    expect(nodes(tree).some((node) => text(node) === "Stop recovery…")).toBe(true);
  });
});
