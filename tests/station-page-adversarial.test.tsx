// @vitest-environment jsdom
/**
 * Actual StationPage/React/recovery storage with only stationApi IO replaced.
 * Independent auditor draft retained in PIN-PREVIEW-PREFLIGHT-20260928.
 * Main separates ambiguous transport retry from definitive wrong-PIN rejection.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StationPage } from "../src/features/stations/StationPage";
import {
  readQuarantinedCheckIn,
  readStationAttempt,
  saveStationAttempt,
  STATION_LOCK_KEY,
  type StationAttempt,
} from "../src/features/stations/stationRecovery";
import { stationState } from "../src/features/stations/stationTypes";

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
};

const io = vi.hoisted(() => ({
  current: vi.fn(), roster: vi.fn(), unlock: vi.fn(), lock: vi.fn(),
  activity: vi.fn(), redeem: vi.fn(), arrivals: vi.fn(), checkIn: vi.fn(), checkInOutcome: vi.fn(),
}));
vi.mock("../src/features/stations/stationClient", async load => {
  const actual = await load<typeof import("../src/features/stations/stationClient")>();
  return { ...actual, stationApi: io };
});

const ids = {
  browser: "11111111-1111-4111-8111-111111111111",
  actorA: "22222222-2222-4222-8222-222222222222",
  actorB: "33333333-3333-4333-8333-333333333333",
  staffA: "44444444-4444-4444-8444-444444444444",
  staffB: "55555555-5555-4555-8555-555555555555",
  reservationA: "66666666-6666-4666-8666-666666666666",
  reservationB: "77777777-7777-4777-8777-777777777777",
  operationA: "88888888-8888-4888-8888-888888888888",
  operationB: "99999999-9999-4999-8999-999999999999",
};
const csrf = "synthetic-csrf";

const session = (actorId = ids.actorA, generation = 7) => ({
  browserSessionId: ids.browser, generation, stationLabel: "Front desk",
  actor: { actorSessionId: actorId, generation },
  actorIdleExpiresAtUtc: "2026-09-28T12:15:00Z",
  actorAbsoluteExpiresAtUtc: "2026-09-28T20:00:00Z",
  pairingExpiresAtUtc: "2026-09-29T12:00:00Z",
});
const active = (actorId = ids.actorA, generation = 7) => ({
  runtime: { state: stationState.active, session: session(actorId, generation) },
  csrfToken: csrf, propertyName: "Synthetic property",
  staffDisplayName: actorId === ids.actorA ? "Alex" : "Blair",
});
const locked = (generation = 7) => ({
  runtime: { state: stationState.locked, session: { ...session(ids.actorA, generation), actor: null } },
  csrfToken: csrf, propertyName: "Synthetic property", staffDisplayName: null,
});
const arrival = (reservationId: string, name: string) => ({
  reservation: { reservationId, primaryGuestName: name, arrival: "2026-09-28", departure: "2026-09-29", expectedVersion: 3 },
  places: [{ roomName: "Dorm 104", bedLabel: "104-A" }],
});
const arrivals = (...items: ReturnType<typeof arrival>[]) => ({ state: 0, propertyLocalDate: "2026-09-28", items, continuation: null });
const roster = { items: [{ staffMemberId: ids.staffA, displayName: "Alex", rosterReference: "A-01" }], hasMore: false };

class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn(); close = vi.fn();
  constructor(public readonly name: string) { FakeChannel.instances.push(this); }
}

let visibility: DocumentVisibilityState = "visible";
let uuidIndex = 0;
const uuids = [ids.operationA, ids.operationB, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"];
let container: HTMLDivElement;
let root: Root;

async function flush() { await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); }); }
async function render(setupGrantId?: string) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<StationPage setupGrantId={setupGrantId} />)); await flush();
}
async function click(label: RegExp) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(node => label.test(node.textContent ?? ""));
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await flush(); return button!;
}
async function submitPin(pin = "123456") {
  const input = container.querySelector<HTMLInputElement>('input[name="pin"]')!;
  await act(async () => { input.value = pin; input.dispatchEvent(new Event("input", { bubbles: true })); });
  const form = input.closest("form")!;
  await act(async () => form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
  await flush();
}
const text = () => container.textContent ?? "";
// jsdom cannot create trusted native input. Invoke the rendered React handler for
// deterministic ordering; the separate Chromium gate proves native event wiring.
async function foregroundOn(label: RegExp) {
  const target = [...container.querySelectorAll<HTMLButtonElement>("button")].find(node => label.test(node.textContent ?? ""))!;
  const main = container.querySelector("main")!;
  const props = Object.entries(main).find(([key]) => key.startsWith("__reactProps$"))?.[1] as {
    onPointerDown: (event: { isTrusted: boolean; target: Element }) => void;
  };
  expect(target).toBeDefined(); expect(props?.onPointerDown).toBeTypeOf("function");
  await act(async () => props.onPointerDown({ isTrusted: true, target })); await flush();
}
const checkInAttempt = (operationId: string, actorSessionId = ids.actorA, reservationId = ids.reservationA): StationAttempt => ({
  kind: "check-in", operationId, browserSessionId: ids.browser, generation: 7,
  actorSessionId, reservationId, expectedVersion: 3,
});

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => uuids[uuidIndex++]! as `${string}-${string}-${string}-${string}-${string}`);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  visibility = "visible"; uuidIndex = 0; FakeChannel.instances = [];
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  for (const fn of Object.values(io)) fn.mockReset();
  io.roster.mockResolvedValue(roster); io.arrivals.mockResolvedValue(arrivals(arrival(ids.reservationA, "Guest A"), arrival(ids.reservationB, "Guest B")));
  io.activity.mockResolvedValue({});
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("StationPage adversarial privacy and operation recovery", () => {
  it.each(["current", "empty", "incomplete"])("keeps refresh focusable and prevents repeat requests through %s arrivals", async state => {
    io.current.mockResolvedValue(active()); await render();
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(node => /Refresh arrivals/.test(node.textContent ?? ""))!;
    button.focus();
    const response = deferred<ReturnType<typeof arrivals>>(); io.arrivals.mockReturnValueOnce(response.promise);
    await click(/Refresh arrivals/);
    expect(button.disabled).toBe(false); // Native disabled blurs Chromium; jsdom alone cannot prove painted focus.
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(button); expect(text()).not.toContain("Guest A");
    await click(/Refresh arrivals/); await click(/Refresh arrivals/);
    expect(io.arrivals).toHaveBeenCalledTimes(2);
    response.resolve(state === "incomplete" ? { ...arrivals(), state: 4 } : state === "empty" ? arrivals() : arrivals(arrival(ids.reservationA, "Guest A")));
    await flush();
    expect(button.isConnected).toBe(true); expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-disabled")).toBe("false"); expect(button.getAttribute("aria-busy")).toBe("false");
    expect(io.arrivals).toHaveBeenCalledTimes(2);
  });

  it("does not pull focus back to refresh after the operator moves to Lock", async () => {
    io.current.mockResolvedValue(active()); await render();
    const response = deferred<ReturnType<typeof arrivals>>(); io.arrivals.mockReturnValueOnce(response.promise);
    await click(/Refresh arrivals/);
    const lock = [...container.querySelectorAll<HTMLButtonElement>("button")].find(node => /Lock \/ switch staff/.test(node.textContent ?? ""))!;
    lock.focus(); response.resolve(arrivals()); await flush();
    expect(document.activeElement).toBe(lock);
  });

  it("clears the offline notice after authoritative active recovery without erasing an uncertain check-in", async () => {
    saveStationAttempt("check-in", checkInAttempt(ids.operationA));
    io.current.mockResolvedValue(active()); await render();
    await act(async () => window.dispatchEvent(new Event("offline"))); await flush();
    expect(text()).toContain("You’re offline."); expect(text()).not.toContain("Guest A");
    await act(async () => window.dispatchEvent(new Event("online"))); await flush();
    expect(text()).toContain("Guest A"); expect(text()).not.toContain("You’re offline.");
    expect(text()).toContain("A check-in needs its result confirmed");
    expect(readStationAttempt("check-in")?.operationId).toBe(ids.operationA);
  });

  it("does not clear an unconfirmed lock warning when current still returns Active", async () => {
    localStorage.setItem(STATION_LOCK_KEY, "pending");
    io.current.mockResolvedValue(active()); await render();
    expect(text()).toContain("The server has not confirmed the lock");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(text()).toContain("The server has not confirmed the lock"); expect(text()).not.toContain("Guest A");
    expect(io.arrivals).not.toHaveBeenCalled();
  });

  it("waits for activity and its current read before arrivals, coalescing interval polls", async () => {
    io.current.mockResolvedValue(active()); await render();
    const activity = deferred<unknown>(), current = deferred<ReturnType<typeof active>>();
    io.activity.mockReturnValueOnce(activity.promise); io.current.mockReturnValueOnce(current.promise);
    await foregroundOn(/Refresh arrivals/); await click(/Refresh arrivals/);
    expect(io.activity).toHaveBeenCalledTimes(1); expect(io.arrivals).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(io.current).toHaveBeenCalledTimes(1);
    activity.resolve({}); await flush(); expect(io.current).toHaveBeenCalledTimes(2);
    expect(io.arrivals).toHaveBeenCalledTimes(1);
    current.resolve(active()); await flush(); expect(io.arrivals).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Guest A");
  });

  it("does not send a waiting arrival read after activity failure", async () => {
    io.current.mockResolvedValue(active()); await render();
    const activity = deferred<unknown>(); io.activity.mockReturnValueOnce(activity.promise);
    await foregroundOn(/Refresh arrivals/); await click(/Refresh arrivals/);
    activity.reject(new Error("Activity unavailable")); await flush();
    expect(io.arrivals).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Station details are hidden"); expect(text()).not.toContain("Guest A");
  });

  it("lets lock win over held activity and discards the queued job", async () => {
    io.current.mockResolvedValue(active()); await render();
    const activity = deferred<unknown>(); io.activity.mockReturnValueOnce(activity.promise);
    await foregroundOn(/Refresh arrivals/); await click(/Refresh arrivals/);
    io.lock.mockResolvedValue({ state: stationState.locked }); io.current.mockResolvedValue(locked(8));
    await click(/Lock \/ switch staff/); expect(text()).not.toContain("Guest A");
    activity.resolve({}); await flush();
    expect(io.arrivals).toHaveBeenCalledTimes(1); expect(text()).toContain("Choose your name");
    expect(text()).not.toContain("Guest A");
  });

  it("waits before minting a check-in intent and preserves its identity on a waiting retry", async () => {
    io.current.mockResolvedValue(active()); await render(); await click(/^ Check in$|^Check in$/);
    const activity = deferred<unknown>(); io.activity.mockReturnValueOnce(activity.promise);
    await foregroundOn(/Confirm check-in/); await click(/Confirm check-in/);
    expect(io.checkIn).not.toHaveBeenCalled(); expect(readStationAttempt("check-in")).toBeNull();
    io.checkIn.mockRejectedValueOnce(new TypeError("lost response"));
    activity.resolve({}); await flush(); expect(io.checkIn).toHaveBeenCalledTimes(1);
    const original = readStationAttempt("check-in")!.operationId;
    await act(async () => vi.advanceTimersByTimeAsync(60_001));
    const retryActivity = deferred<unknown>(); io.activity.mockReturnValueOnce(retryActivity.promise);
    await foregroundOn(/Check \/ retry original check-in/); await click(/Check \/ retry original check-in/);
    expect(io.checkIn).toHaveBeenCalledTimes(1); expect(readStationAttempt("check-in")!.operationId).toBe(original);
    io.checkIn.mockResolvedValueOnce({ state: 6, receipt: {} }); retryActivity.resolve({}); await flush();
    expect(io.checkIn).toHaveBeenCalledTimes(2);
    expect(io.checkIn.mock.calls[1][0].operationId).toBe(original);
  });

  it.each(["hidden", "offline"])("discards a waiting check-in after the page becomes %s", async cause => {
    io.current.mockResolvedValue(active()); await render(); await click(/^ Check in$|^Check in$/);
    const activity = deferred<unknown>(); io.activity.mockReturnValueOnce(activity.promise);
    await foregroundOn(/Confirm check-in/); await click(/Confirm check-in/);
    await act(async () => {
      if (cause === "hidden") { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); }
      else window.dispatchEvent(new Event("offline"));
    });
    activity.resolve({}); await flush();
    expect(io.checkIn).not.toHaveBeenCalled(); expect(readStationAttempt("check-in")).toBeNull();
    expect(text()).not.toContain("Guest A");
  });

  it("discards queued intent if post-activity authority changes", async () => {
    io.current.mockResolvedValue(active()); await render(); await click(/^ Check in$|^Check in$/);
    const activity = deferred<unknown>(); io.activity.mockReturnValueOnce(activity.promise);
    await foregroundOn(/Confirm check-in/); await click(/Confirm check-in/);
    io.current.mockResolvedValue(locked(8)); activity.resolve({}); await flush();
    expect(io.checkIn).not.toHaveBeenCalled(); expect(readStationAttempt("check-in")).toBeNull();
    expect(text()).toContain("Choose your name"); expect(text()).not.toContain("Guest A");
  });

  it("does not renew activity while a first-job request is in flight", async () => {
    io.current.mockResolvedValue(active()); await render();
    const response = deferred<ReturnType<typeof arrivals>>(); io.arrivals.mockReturnValueOnce(response.promise);
    await click(/Refresh arrivals/); await foregroundOn(/Refresh arrivals/);
    expect(io.activity).not.toHaveBeenCalled();
    response.resolve(arrivals(arrival(ids.reservationA, "Guest A"))); await flush();
    await foregroundOn(/Refresh arrivals/); expect(io.activity).toHaveBeenCalledTimes(1);
  });

  it("detaches a stalled old activity on switch without letting its completion release the new actor's gate", async () => {
    io.current.mockResolvedValue(active()); await render();
    const oldActivity = deferred<unknown>(); io.activity.mockReturnValueOnce(oldActivity.promise);
    await foregroundOn(/Refresh arrivals/); await click(/Refresh arrivals/);
    io.lock.mockResolvedValue({ state: stationState.locked }); io.current.mockResolvedValue(locked(8));
    await click(/Lock \/ switch staff/); expect(text()).toContain("Choose your name");
    io.current.mockResolvedValue(active(ids.actorB, 9));
    await act(async () => FakeChannel.instances[0]!.onmessage?.(new MessageEvent("message", { data: "changed" }))); await flush();
    expect(text()).toContain("Working as Blair"); expect(text()).toContain("Guest A");
    const newActivity = deferred<unknown>(); io.activity.mockReturnValueOnce(newActivity.promise);
    await foregroundOn(/Refresh arrivals/); await click(/Refresh arrivals/);
    const calls = io.arrivals.mock.calls.length;
    oldActivity.resolve({}); await flush();
    await act(async () => vi.advanceTimersByTimeAsync(60_001));
    await foregroundOn(/Refresh arrivals/);
    expect(io.activity).toHaveBeenCalledTimes(2); expect(io.arrivals).toHaveBeenCalledTimes(calls);
    newActivity.resolve({}); await flush();
    expect(io.arrivals).toHaveBeenCalledTimes(calls + 1); expect(text()).toContain("Working as Blair");
  });

  it("detaches a stalled old arrival read without letting its release unblock a new pending job", async () => {
    io.current.mockResolvedValue(active()); await render();
    const oldRead = deferred<ReturnType<typeof arrivals>>(); io.arrivals.mockReturnValueOnce(oldRead.promise);
    await click(/Refresh arrivals/);
    io.lock.mockResolvedValue({ state: stationState.locked }); io.current.mockResolvedValue(locked(8));
    await click(/Lock \/ switch staff/);
    io.current.mockResolvedValue(active(ids.actorB, 9));
    await act(async () => FakeChannel.instances[0]!.onmessage?.(new MessageEvent("message", { data: "changed" }))); await flush();
    await foregroundOn(/Refresh arrivals/); expect(io.activity).toHaveBeenCalledTimes(1);
    const newRead = deferred<ReturnType<typeof arrivals>>(); io.arrivals.mockReturnValueOnce(newRead.promise);
    await click(/Refresh arrivals/); oldRead.resolve(arrivals(arrival(ids.reservationA, "Stale guest"))); await flush();
    await act(async () => vi.advanceTimersByTimeAsync(60_001)); await foregroundOn(/Refresh arrivals/);
    expect(io.activity).toHaveBeenCalledTimes(1); expect(text()).not.toContain("Stale guest");
    newRead.resolve(arrivals(arrival(ids.reservationB, "New guest"))); await flush();
    await foregroundOn(/Refresh arrivals/); expect(io.activity).toHaveBeenCalledTimes(2);
    expect(text()).toContain("New guest");
  });

  it("keeps the active identity and lock control while incomplete arrivals are retried locally", async () => {
    io.current.mockResolvedValue(active());
    io.arrivals.mockResolvedValueOnce({ state: 4, items: [], continuation: null, propertyId: null, propertyLocalDate: null });
    await render();
    expect(text()).toContain("Arrival information is not ready");
    expect(text()).toContain("Working as Alex");
    expect(text()).toContain("Lock / switch staff");
    expect(text()).not.toContain("Station details are hidden");
    expect(text()).not.toContain("Guest A");
    await click(/Refresh arrivals/);
    expect(text()).toContain("Guest A");
    expect(io.current).toHaveBeenCalledTimes(1);
    expect(io.arrivals).toHaveBeenCalledTimes(2);
  });

  it("still hides the station on an arrivals actor-generation conflict", async () => {
    io.current.mockResolvedValue(active());
    io.arrivals.mockRejectedValue(new (await import("../src/features/stations/stationClient")).StationRequestError(409, 4));
    await render();
    expect(text()).toContain("Station details are hidden");
    expect(text()).not.toContain("Working as Alex");
    expect(text()).not.toContain("Guest A");
  });

  it("loads the newly eligible staff roster after setup even when browser generation stays unchanged", async () => {
    io.current.mockResolvedValue(locked());
    io.redeem.mockResolvedValue({ outcome: 1 });
    io.roster.mockResolvedValue({ items: [{ staffMemberId: ids.staffB, displayName: "New staff Blair", rosterReference: "B-02" }], hasMore: false });
    await render("prepared-private-grant");
    expect(io.roster).not.toHaveBeenCalled();
    container.querySelector<HTMLInputElement>('input[name="confirmPin"]')!.value = "123456";
    await submitPin();
    expect(io.redeem).toHaveBeenCalledTimes(1);
    expect(io.roster).toHaveBeenCalledTimes(1);
    expect(text()).toContain("New staff Blair");
    expect(text()).toContain("Choose your name");
  });

  it("does not expose or fetch a staff roster while PIN setup is still unconfirmed", async () => {
    io.current.mockResolvedValue(locked());
    io.redeem.mockRejectedValue(new Error("connection lost"));
    await render("prepared-private-grant");
    container.querySelector<HTMLInputElement>('input[name="confirmPin"]')!.value = "123456";
    await submitPin();
    expect(io.roster).not.toHaveBeenCalled();
    expect(text()).toContain("Create your staff PIN");
    expect(text()).not.toContain("Choose your name");
  });

  it("hides active guest content synchronously when Lock is activated, before a held lock response", async () => {
    const held = deferred<unknown>(); io.current.mockResolvedValue(active()); io.lock.mockReturnValue(held.promise);
    await render(); expect(text()).toContain("Guest A");
    await click(/Lock \/ switch staff/);
    expect(text()).not.toContain("Guest A"); expect(text()).toContain("Securing your station");
    io.current.mockResolvedValue(locked(8)); held.resolve({ state: stationState.locked }); await flush();
  });

  it("hides active content on offline and a late arrivals GET cannot revive it", async () => {
    const held = deferred<unknown>(); io.current.mockResolvedValue(active()); io.arrivals.mockReturnValue(held.promise);
    await render(); await act(async () => { window.dispatchEvent(new Event("offline")); }); await flush();
    expect(text()).toContain("Guest details are hidden");
    held.resolve(arrivals(arrival(ids.reservationA, "Late private guest"))); await flush();
    expect(text()).not.toContain("Late private guest"); expect(text()).toContain("You’re offline");
  });

  it("hides on visibility loss and ignores a held current GET after the page becomes hidden", async () => {
    const held = deferred<unknown>(); io.current.mockReturnValue(held.promise); await render();
    await act(async () => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); }); await flush();
    held.resolve(active()); await flush();
    expect(text()).toContain("Station details are hidden"); expect(text()).not.toContain("Due arrivals");
  });

  it("treats a corrupt persisted lock marker as a privacy barrier across reload/mount", async () => {
    localStorage.setItem(STATION_LOCK_KEY, "{corrupt"); io.current.mockResolvedValue(active());
    await render(); expect(text()).toContain("Guest details are hidden");
    expect(text()).not.toContain("Due arrivals"); expect(localStorage.getItem(STATION_LOCK_KEY)).toBe("{corrupt");
  });

  it("retries an unconfirmed PIN attempt with the same operation id instead of consuming a new attempt", async () => {
    io.current.mockResolvedValue(locked()); io.unlock
      .mockRejectedValueOnce(new TypeError("Synthetic lost response"))
      .mockResolvedValueOnce({ state: stationState.active });
    await render(); await click(/^Alex/); await submitPin("111111");
    const first = io.unlock.mock.calls[0]![0].operationId;
    // Only an uncertain result retains the operation identity.
    await io.current.mock.results.at(-1)?.value; await flush(); await click(/^Alex/); await submitPin("111111");
    expect(io.unlock).toHaveBeenCalledTimes(2); expect(io.unlock.mock.calls[1]![0].operationId).toBe(first);
  });

  it("allows a corrected PIN under a new operation after a definitive rejected guess", async () => {
    io.current.mockResolvedValue(locked()); io.unlock
      .mockRejectedValueOnce(new (await import("../src/features/stations/stationClient")).StationRequestError(403))
      .mockResolvedValueOnce({ state: stationState.active });
    await render(); await click(/^Alex/); await submitPin("111111");
    const first = io.unlock.mock.calls[0]![0].operationId;
    expect(readStationAttempt("unlock")).toBeNull();
    await click(/^Alex/); await submitPin("222222");
    expect(io.unlock).toHaveBeenCalledTimes(2);
    expect(io.unlock.mock.calls[1]![0].operationId).not.toBe(first);
    expect(io.unlock.mock.calls[1]![0].pin).toBe("222222");
  });

  it("on staff switch quarantines only the old reservation and keeps other arrivals operable", async () => {
    saveStationAttempt("check-in", checkInAttempt(ids.operationA)); io.current.mockResolvedValue(active(ids.actorB, 8));
    io.arrivals.mockResolvedValue(arrivals(arrival(ids.reservationA, "Held guest"), arrival(ids.reservationB, "Available guest")));
    await render(); await flush();
    expect(readStationAttempt("check-in")).toBeNull(); expect(readQuarantinedCheckIn()?.operationId).toBe(ids.operationA);
    const cards = [...container.querySelectorAll("li")];
    expect(cards.find(card => card.textContent?.includes("Held guest"))?.querySelector("button")?.disabled).toBe(true);
    expect(cards.find(card => card.textContent?.includes("Available guest"))?.querySelector("button")?.disabled).toBe(false);
  });

  it("preserves the two-slot ceiling and refuses to overwrite an older quarantined operation", async () => {
    sessionStorage.setItem("bunkfy.station.check-in-review.v1", JSON.stringify(checkInAttempt(ids.operationA)));
    saveStationAttempt("check-in", checkInAttempt(ids.operationB, ids.actorA, ids.reservationB));
    io.current.mockResolvedValue(active(ids.actorB, 8)); await render(); await flush();
    expect(readQuarantinedCheckIn()?.operationId).toBe(ids.operationA);
    expect(readStationAttempt("check-in")?.operationId).toBe(ids.operationB);
    expect(text()).toContain("two results need review");
    expect([...container.querySelectorAll<HTMLButtonElement>("li button")].every(button => button.disabled)).toBe(true);
  });

  it("confirms an old actor's check-in through the outcome-only endpoint without replaying it", async () => {
    saveStationAttempt("check-in", checkInAttempt(ids.operationA));
    io.current.mockResolvedValue(active(ids.actorB, 8)); io.checkInOutcome.mockResolvedValue({ state: 1 });
    await render(); await click(/Check original result/);
    expect(io.checkInOutcome).toHaveBeenCalledWith({ operationId: ids.operationA, reservationId: ids.reservationA,
      expectedVersion: 3, browserSessionId: ids.browser, actorSessionId: ids.actorA, expectedGeneration: 7 }, csrf);
    expect(io.checkIn).not.toHaveBeenCalled();
    expect(readQuarantinedCheckIn()).toBeNull(); expect(readStationAttempt("check-in")).toBeNull();
  });

  it.each([0, 2, 3, 99])("keeps an original operation held when its outcome is not Applied (%i)", async state => {
    saveStationAttempt("check-in", checkInAttempt(ids.operationA));
    io.current.mockResolvedValue(active(ids.actorB, 8)); io.checkInOutcome.mockResolvedValue({ state });
    await render(); await click(/Check original result/);
    expect(readQuarantinedCheckIn()?.operationId).toBe(ids.operationA);
    expect(text()).toContain("Nothing was retried"); expect(io.checkIn).not.toHaveBeenCalled();
  });

  it("an old outcome arriving after the page hides cannot reveal guest content or erase another operation", async () => {
    const held = deferred<unknown>(); saveStationAttempt("check-in", checkInAttempt(ids.operationA));
    io.current.mockResolvedValue(active(ids.actorB, 8)); io.checkInOutcome.mockReturnValue(held.promise);
    await render(); await click(/Check original result/);
    saveStationAttempt("check-in", checkInAttempt(ids.operationB, ids.actorB, ids.reservationB));
    await act(async () => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); }); await flush();
    held.resolve({ state: 1 }); await flush();
    expect(readStationAttempt("check-in")?.operationId).toBe(ids.operationB);
    expect(readQuarantinedCheckIn()).toBeNull(); expect(text()).not.toContain("Guest A");
    expect(io.checkIn).not.toHaveBeenCalled();
  });

  it("keeps a historical conflict local to the held reservation instead of hiding the active station", async () => {
    saveStationAttempt("check-in", checkInAttempt(ids.operationA)); io.current.mockResolvedValue(active(ids.actorB, 8));
    io.checkInOutcome.mockRejectedValue(new (await import("../src/features/stations/stationClient")).StationRequestError(409, 2));
    await render(); await click(/Check original result/);
    expect(text()).toContain("does not match a confirmed check-in"); expect(text()).toContain("Guest B");
    expect(text()).not.toContain("Station details are hidden");
    expect(readQuarantinedCheckIn()?.operationId).toBe(ids.operationA); expect(io.checkIn).not.toHaveBeenCalled();
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].some(button => /Check original result/.test(button.textContent ?? ""))).toBe(false);
  });

  it("a late successful check-in response cannot clear a newer operation", async () => {
    const held = deferred<unknown>(); io.current.mockResolvedValue(active()); io.checkIn.mockReturnValue(held.promise);
    await render(); await click(/Check in/); await click(/Confirm check-in/);
    const old = readStationAttempt("check-in")!;
    saveStationAttempt("check-in", checkInAttempt(ids.operationB, ids.actorA, ids.reservationB));
    held.resolve({ state: 6, receipt: { operationId: old.operationId } }); await flush();
    expect(readStationAttempt("check-in")?.operationId).toBe(ids.operationB);
  });

  it("does not render a replay/recovery banner while the original check-in request is still pending", async () => {
    const held = deferred<unknown>(); io.current.mockResolvedValue(active()); io.checkIn.mockReturnValue(held.promise);
    await render(); await click(/Check in/); await click(/Confirm check-in/);
    expect(io.checkIn).toHaveBeenCalledTimes(1); expect(text()).toContain("Checking…");
    expect(text()).not.toContain("A check-in needs its result confirmed");
    expect(container.querySelectorAll("button")).toSatisfy((buttons: NodeListOf<HTMLButtonElement>) =>
      [...buttons].filter(button => /Check \/ retry original check-in/.test(button.textContent ?? "")).length === 0);
    held.reject(new TypeError("synthetic offline")); await flush();
  });

  it("late current success after a cross-tab changing boundary cannot expose active content", async () => {
    const held = deferred<unknown>(); io.current.mockReturnValue(held.promise); await render();
    await act(async () => { FakeChannel.instances[0]!.onmessage?.(new MessageEvent("message", { data: "changing" })); }); await flush();
    held.resolve(active()); await flush();
    expect(text()).toContain("Station details are hidden"); expect(text()).not.toContain("Due arrivals");
  });

  it("a visibility boundary during pending check-in leaves recovery state but removes guest content", async () => {
    const held = deferred<unknown>(); io.current.mockResolvedValue(active()); io.checkIn.mockReturnValue(held.promise);
    await render(); await click(/Check in/); await click(/Confirm check-in/);
    const operation = readStationAttempt("check-in")?.operationId;
    await act(async () => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); }); await flush();
    expect(text()).not.toContain("Guest A"); expect(readStationAttempt("check-in")?.operationId).toBe(operation);
    held.reject(new TypeError("synthetic hidden network boundary")); await flush();
  });
});
