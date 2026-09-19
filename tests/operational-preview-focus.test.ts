import { createElement, type ComponentProps, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationalPreviewProvider } from "../src/features/operational-preview/OperationalPreviewProvider";
import { operationalPreviewTriggerKey, withOperationalPreviewRoute, type OperationalPreviewRoute } from "../src/features/operational-preview/operationalPreviewRoute";
import { ReservationPreviewLifecycleAction } from "../src/features/operational-preview/ReservationPreviewLifecycleAction";
import type { ReservationPreviewLifecycleOwner } from "../src/features/operational-preview/reservationPreviewLifecycle";

// Execute the real Provider restoration effect. DOM doubles verify ordering and
// owner lifetime only; sticky geometry and native pan remain browser evidence.
const h = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], pending: [] as (() => void)[], cleanup: new Map<number, () => void>() }));
const router = vi.hoisted(() => ({ location: { pathname: "/calendar", search: "", state: null as { operationalPreviewEntry?: boolean; operationalPreviewSource?: unknown } | null, key: "origin", hash: "" }, navigate: vi.fn() }));
const authority = vi.hoisted(() => ({ session: { tenantId: "tenant", subjectId: "actor", sessionId: "session", generation: "generation", username: "qa" } as { tenantId: string; subjectId: string; sessionId: string; generation: string; username: string } | null }));
vi.mock("react-router", async original => ({ ...await original<typeof import("react-router")>(), useLocation: () => router.location, useNavigate: () => router.navigate }));
vi.mock("../src/app/session", () => ({ useSession: () => authority }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ?? (h.slots[i] = { current: initial }); },
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (next: unknown) => { h.slots[i] = next; }]; },
  useMemo: (factory: () => unknown) => factory(), useCallback: (callback: unknown) => callback,
  useEffect: () => { h.cursor++; },
  useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const i = h.cursor++, previous = h.slots[i] as unknown[] | undefined;
    if (previous && deps.every((value, j) => Object.is(value, previous[j]))) return;
    h.slots[i] = deps; h.pending.push(() => { h.cleanup.get(i)?.(); const cleanup = effect(); if (cleanup) h.cleanup.set(i, cleanup); });
  },
}));
const p = "11111111-1111-4111-8111-111111111111", r = "22222222-2222-4222-8222-222222222222";
const route: OperationalPreviewRoute = { selection: { kind: "reservation", propertyId: p, reservationId: r, date: "2026-09-07" }, origin: { surface: "calendar", propertyId: p, date: "2026-09-07", day: "2026-09-07" } };
const trace: string[] = [];
let available = true, visible = true, offset = 1200, nextHandle = 0;
const timers = new Map<number, { callback: () => void; delay: number }>();
const frames = new Map<number, () => void>();
const observers = new Set<() => void>();
const listeners = new Map<string, Set<() => void>>();
function focus(node: unknown) { dom.activeElement = node; [...listeners.get("focusin") ?? []].forEach(listener => listener()); }
function timer(delay: number) { const entry = [...timers].find(([, value]) => value.delay === delay); expect(entry).toBeDefined(); timers.delete(entry![0]); entry![1].callback(); }
function frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); }
function mutate() { [...observers].forEach(callback => callback()); }
const panel = { id: "operational-preview", isConnected: true, closest: () => panel };
const trigger = { id: "stay", isConnected: true, dataset: { operationalPreviewTrigger: operationalPreviewTriggerKey(route) },
  getClientRects: () => visible ? [{}] : [], getBoundingClientRect: () => ({ width: 100, height: 32, top: 100, left: 200, bottom: 132, right: 300 }),
  closest: () => null,
  focus: vi.fn(() => { trace.push("focus/sticky-reveal"); offset = 930; focus(trigger); }),
  scrollIntoView: vi.fn(() => { trace.push("native-nearest"); offset = 1040; }),
};
const body = {};
const main = { id: "main-content", isConnected: true, closest: () => null, focus: vi.fn(() => { focus(main); }) };
const dom = { body, activeElement: panel as unknown, querySelectorAll: () => available ? [trigger] : [], querySelector: () => main,
  addEventListener: (name: string, callback: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
  removeEventListener: (name: string, callback: () => void) => { listeners.get(name)?.delete(callback); },
};
function render(open: boolean, location: Partial<typeof router.location> = {}) {
  router.location = { pathname: "/calendar", search: "?" + (open ? withOperationalPreviewRoute(new URLSearchParams(`property=${p}&date=2026-09-07&day=2026-09-07`), route).toString() : `property=${p}&date=2026-09-07&day=2026-09-07`), state: null, key: open ? "preview" : "origin", hash: "", ...location };
  h.cursor = 0; h.pending = []; OperationalPreviewProvider({ children: createElement("div") }); h.pending.forEach(effect => effect());
}
beforeEach(() => {
  h.slots = []; h.cleanup.clear(); trace.length = 0; available = true; visible = true; offset = 1200; nextHandle = 0; dom.activeElement = panel;
  timers.clear(); frames.clear(); observers.clear(); listeners.clear();
  authority.session = { tenantId: "tenant", subjectId: "actor", sessionId: "session", generation: "generation", username: "qa" };
  trigger.dataset.operationalPreviewTrigger = operationalPreviewTriggerKey(route);
  trigger.focus.mockClear(); trigger.scrollIntoView.mockClear(); main.focus.mockClear(); router.navigate.mockClear();
  vi.stubGlobal("document", dom);
  vi.stubGlobal("window", { history: { length: 2 }, getComputedStyle: () => ({ visibility: "visible" }), innerWidth: 1024, innerHeight: 900,
    requestAnimationFrame: (callback: () => void) => { const id = ++nextHandle; frames.set(id, callback); return id; }, cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void, delay: number) => { const id = ++nextHandle; timers.set(id, { callback, delay }); return id; }, clearTimeout: (id: number) => timers.delete(id),
  });
  vi.stubGlobal("MutationObserver", class { constructor(private callback: () => void) {} observe() { observers.add(this.callback); } disconnect() { observers.delete(this.callback); } });
});
afterEach(() => { h.cleanup.forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
describe("preview close focus ordering", () => {
  it("preserves deliberate pan while open, then makes sticky-aware focus the final adjustment", () => {
    render(true); expect(trace).toEqual([]); expect(offset).toBe(1200);
    render(false); expect(trace).toEqual(["native-nearest", "focus/sticky-reveal"]); expect(offset).toBe(930);
    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(trigger.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });
  it("uses the same order when the trigger appears only at the timed fallback", () => {
    render(true); available = false; render(false); expect(trace).toEqual([]);
    available = true; timer(1_000); expect(trace).toEqual(["native-nearest", "focus/sticky-reveal"]); expect(offset).toBe(930);
  });
  it("does not reclaim focus or scroll after the operator has moved elsewhere", () => {
    render(true); dom.activeElement = { id: "other", isConnected: true, closest: () => null }; render(false);
    expect(trace).toEqual([]); expect(timers.size).toBe(0);
  });
  it("keeps the one-second MAIN fallback then restores a late exact trigger and stops after stability", () => {
    render(true); available = false; render(false); timer(1_000);
    expect(main.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(dom.activeElement).toBe(main);
    expect(observers.size).toBe(1); expect(frames.size).toBe(1);
    available = true; mutate(); expect(dom.activeElement).toBe(trigger); expect(trace).toEqual(["native-nearest", "focus/sticky-reveal"]);
    frame(); expect(observers.size).toBe(1); frame();
    expect(observers.size).toBe(0); expect(frames.size).toBe(0); expect(timers.size).toBe(0); expect(listeners.get("focusin")?.size).toBe(0);
    expect(router.navigate).not.toHaveBeenCalled(); expect(offset).toBe(930);
  });
  it("leaves MAIN accessible at the ten-second deadline and never observes a later trigger", () => {
    render(true); available = false; render(false); timer(1_000); timer(10_000);
    expect(dom.activeElement).toBe(main); expect(observers.size).toBe(0); expect(frames.size).toBe(0); expect(timers.size).toBe(0);
    available = true; mutate(); frame(); expect(trigger.focus).not.toHaveBeenCalled(); expect(dom.activeElement).toBe(main);
  });
  it("does not restore after the wall-clock deadline even if the browser delays its timer", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      render(true); available = false; render(false); timer(1_000);
      clock.mockReturnValue(10_001); available = true; mutate();
      expect(trigger.focus).not.toHaveBeenCalled(); expect(dom.activeElement).toBe(main); expect(timers.size).toBe(0); expect(observers.size).toBe(0);
    } finally { clock.mockRestore(); }
  });
  it("permanently yields to native Tab focus after MAIN fallback, even if focus later leaves that control", () => {
    render(true); available = false; render(false); timer(1_000);
    const newReservation = { id: "new-reservation", isConnected: true, closest: () => null }; focus(newReservation);
    expect(observers.size).toBe(0); expect(frames.size).toBe(0); expect(timers.size).toBe(0);
    available = true; mutate(); frame(); expect(dom.activeElement).toBe(newReservation); expect(trigger.focus).not.toHaveBeenCalled();
    dom.activeElement = body; mutate(); frame(); expect(trigger.focus).not.toHaveBeenCalled();
  });
  it("rechecks operator focus inside the one-second timer before either MAIN or exact focus", () => {
    render(true); available = false; render(false);
    const external = { id: "external", isConnected: true, closest: () => null }; dom.activeElement = external;
    available = true; timer(1_000); expect(dom.activeElement).toBe(external); expect(main.focus).not.toHaveBeenCalled(); expect(trace).toEqual([]);
    expect(observers.size).toBe(0); expect(frames.size).toBe(0); expect(timers.size).toBe(0);
  });
  it.each(["route", "date", "property", "entry", "hash", "selection"])("cancels delayed restoration on %s change", boundary => {
    render(true); available = false; render(false); timer(1_000);
    const changed = boundary === "route" ? { pathname: "/reservations" } : boundary === "date" ? { search: `?property=${p}&date=2026-09-08&day=2026-09-08` } : boundary === "property" ? { search: `?property=${r}&date=2026-09-07&day=2026-09-07` } : boundary === "entry" ? { key: "another-history-entry" } : boundary === "hash" ? { hash: "#other" } : { search: "?" + withOperationalPreviewRoute(new URLSearchParams(`property=${p}&date=2026-09-07&day=2026-09-07`), { ...route, selection: { ...route.selection, kind: "reservation", reservationId: p } }).toString() };
    render(boundary === "selection", changed); available = true; mutate(); frame();
    expect(trigger.focus).not.toHaveBeenCalled(); expect(dom.activeElement).toBe(main); expect(observers.size).toBe(0); expect(timers.size).toBe(0);
  });
  it.each(["tenantId", "subjectId", "sessionId", "generation", "username", "logout"])("cancels same-route delayed restoration on authority %s change", field => {
    render(true); available = false; render(false); timer(1_000);
    if (field === "logout") authority.session = null; else authority.session = { ...authority.session!, [field]: "changed" };
    render(false); available = true; mutate(); frame(); expect(trigger.focus).not.toHaveBeenCalled(); expect(dom.activeElement).toBe(main); expect(timers.size).toBe(0);
  });
  it("does not start a close restoration across a simultaneous authority or foreign property boundary", () => {
    render(true); authority.session = { ...authority.session!, generation: "new-session" }; render(false);
    expect(trigger.focus).not.toHaveBeenCalled(); expect(timers.size).toBe(0);
    render(true); render(false, { search: `?property=${r}&date=2026-09-07&day=2026-09-07` });
    expect(trigger.focus).not.toHaveBeenCalled(); expect(timers.size).toBe(0);
  });
  it("cancels every observer, frame, timer and focus listener on unmount", () => {
    render(true); available = false; render(false); timer(1_000); h.cleanup.forEach(cleanup => cleanup());
    available = true; mutate(); frame(); expect(trigger.focus).not.toHaveBeenCalled(); expect(observers.size).toBe(0); expect(frames.size).toBe(0); expect(timers.size).toBe(0); expect(listeners.get("focusin")?.size).toBe(0);
  });
  it("does not focus an invisible or differently keyed candidate during the late window", () => {
    render(true); available = false; render(false); timer(1_000); available = true; visible = false; mutate();
    expect(trigger.focus).not.toHaveBeenCalled(); visible = true; trigger.dataset.operationalPreviewTrigger = "foreign-selection"; mutate(); expect(trigger.focus).not.toHaveBeenCalled();
    trigger.dataset.operationalPreviewTrigger = operationalPreviewTriggerKey(route); mutate(); expect(trigger.focus).toHaveBeenCalledTimes(1);
  });
});

describe("captured preview source versus clicked Calendar origin", () => {
  it.each(["immediate", "delayed"])("restores the literal 5 Sep DOM key with source 12 Sep / selected 8 Sep: %s", timing => {
    const unitId = "33333333-3333-4333-8333-333333333333";
    const source = `?property=${p}&date=2026-09-12&day=2026-09-08&calViewDate=2026-09-02&calViewOffset=152`;
    const clicked: OperationalPreviewRoute = { selection: { kind: "reservation", propertyId: p, reservationId: r, inventoryUnitId: unitId, date: "2026-09-05" }, origin: { surface: "calendar", propertyId: p, date: "2026-09-12", day: "2026-09-08", viewport: { date: "2026-09-02", offset: 152 } } };
    // Literal rendered interval identity, intentionally not derived with the helper.
    trigger.dataset.operationalPreviewTrigger = `calendar:2026-09-05:reservation:${r}:${unitId}`;
    render(true, { search: "?" + withOperationalPreviewRoute(new URLSearchParams(source), clicked).toString(), state: { operationalPreviewEntry: true, operationalPreviewSource: "/calendar" + source } });
    expect(trace).toEqual([]);
    available = timing === "immediate";
    render(false, { search: source });
    if (timing === "delayed") {
      timer(1_000); expect(dom.activeElement).toBe(main);
      available = true; mutate();
    }
    expect(dom.activeElement).toBe(trigger); expect(trace).toEqual(["native-nearest", "focus/sticky-reveal"]);
    expect(trigger.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(router.location.pathname + router.location.search).toBe("/calendar" + source);
    expect(router.navigate).not.toHaveBeenCalled();
    frame(); frame(); expect(timers.size).toBe(0); expect(observers.size).toBe(0);
  });
  const clicked: OperationalPreviewRoute = { selection: { ...route.selection, kind: "reservation", reservationId: r, date: "2026-09-03" }, origin: { surface: "calendar", propertyId: p, date: "2026-09-03", day: "2026-09-03" } };
  const aligned = `?property=${p}&date=2026-09-03&day=2026-09-03&calViewDate=2026-09-03&calViewOffset=36`;
  const divergent = `?property=${p}&date=2026-09-12&day=2026-09-08&calViewDate=2026-09-03&calViewOffset=36`;
  function openCaptured(source: string | null) {
    trigger.dataset.operationalPreviewTrigger = operationalPreviewTriggerKey(clicked);
    render(true, { search: "?" + withOperationalPreviewRoute(new URLSearchParams(aligned), clicked).toString(), state: source === null ? null : { operationalPreviewEntry: true, operationalPreviewSource: source } });
    expect(trace).toEqual([]);
  }
  it.each([aligned, divergent])("restores the exact captured source %s without requiring clicked-date equality", search => {
    openCaptured("/calendar" + search); render(false, { search });
    expect(dom.activeElement).toBe(trigger); expect(trace).toEqual(["native-nearest", "focus/sticky-reveal"]);
    expect(router.location.pathname + router.location.search).toBe("/calendar" + search); expect(router.navigate).not.toHaveBeenCalled();
    frame(); frame(); expect(timers.size).toBe(0);
  });
  it.each(["path", "query", "property", "clicked-origin-only"])("rejects a captured-source %s mismatch without falling through to the origin", boundary => {
    openCaptured("/calendar" + divergent);
    render(false, boundary === "path" ? { pathname: "/", search: divergent } : { search: boundary === "query" ? divergent.replace("Offset=36", "Offset=37") : boundary === "property" ? divergent.replace(p, r) : aligned });
    expect(trace).toEqual([]); expect(main.focus).not.toHaveBeenCalled(); expect(timers.size).toBe(0);
  });
  it("retains the selected property fence even if a foreign-property source string matches exactly", () => {
    const foreign = divergent.replace(p, r); openCaptured("/calendar" + foreign); render(false, { search: foreign });
    expect(trace).toEqual([]); expect(timers.size).toBe(0);
  });
  it("does not invent a divergent source for a direct link without captured navigation state", () => {
    openCaptured(null); render(false, { search: divergent }); expect(trace).toEqual([]); expect(timers.size).toBe(0);
  });
  it("keeps the conservative aligned direct-link MAIN fallback when no initiating trigger is available", () => {
    openCaptured(null); available = false; render(false, { search: aligned }); timer(1_000);
    expect(dom.activeElement).toBe(main); expect(trigger.focus).not.toHaveBeenCalled(); expect(router.navigate).not.toHaveBeenCalled();
  });
  it.each(["late-target", "operator-Tab", "authority-change"])("preserves delayed captured-source guards for %s", outcome => {
    openCaptured("/calendar" + divergent); available = false; render(false, { search: divergent }); timer(1_000); expect(dom.activeElement).toBe(main);
    const external = { id: "new-reservation", isConnected: true, closest: () => null };
    if (outcome === "operator-Tab") focus(external);
    if (outcome === "authority-change") { authority.session = { ...authority.session!, generation: "new-generation" }; render(false, { search: divergent }); }
    available = true; mutate(); frame(); frame();
    expect(dom.activeElement).toBe(outcome === "late-target" ? trigger : outcome === "operator-Tab" ? external : main);
    expect(trigger.focus).toHaveBeenCalledTimes(outcome === "late-target" ? 1 : 0); expect(timers.size).toBe(0); expect(observers.size).toBe(0);
  });
});

describe("actual lifecycle Action local focus intent", () => {
  const keep = {}, quick = { focus: vi.fn((_options: FocusOptions) => { dom.activeElement = quick; }) };
  const actionRoot = { contains: (node: unknown) => node === keep || node === quick, querySelector: () => quick };
  const initialOwner = (action: "check-in" | "check-out"): ReservationPreviewLifecycleOwner => ({ identity: "identity", returnHref: "/", intent: { propertyId: p, reservationId: r, action, businessDate: "2026-09-07", expectedVersion: 3 }, attempt: null, phase: "confirm", acknowledged: false, receiptVersion: null, pendingVersion: null, readAfter: 0, deferred: null });
  const callbacks = { onBegin: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(), onCheck: vi.fn(), onRetry: vi.fn(), onContinue: vi.fn() };
  function actionRender(owner: ReservationPreviewLifecycleOwner | null, options: Partial<ComponentProps<typeof ReservationPreviewLifecycleAction>> = {}) {
    h.cursor = 0; h.pending = [];
    const tree = ReservationPreviewLifecycleAction({ action: "check-in", owner, current: true, readAllowed: true, recoveryAllowed: true, stayLabel: "QA stay", ...callbacks, ...options }) as ReactElement<{ ref: { current: unknown }; children: unknown }>;
    if (tree) tree.props.ref.current = actionRoot;
    h.pending.forEach(effect => effect()); return tree;
  }
  function click(tree: unknown, label: string): void {
    function find(value: unknown): ReactElement<{ children?: unknown; onClick?: () => void }> | undefined {
      if (Array.isArray(value)) return value.map(find).find(Boolean);
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const node = value as ReactElement<{ children?: unknown; onClick?: () => void }>;
      return node.type === "button" && node.props.children === label ? node : find(node.props.children);
    }
    const button = find(tree); expect(button).toBeDefined(); button!.props.onClick!();
  }
  beforeEach(() => { quick.focus.mockClear(); callbacks.onCancel.mockClear(); dom.activeElement = body; });
  it("does not move focus on initial idle opening", () => {
    actionRender(null); expect(quick.focus).not.toHaveBeenCalled(); expect(dom.activeElement).toBe(body);
  });
  it.each(["check-in", "check-out"] as const)("restores the same enabled %s action only after focused Cancel", action => {
    const tree = actionRender(initialOwner(action), { action }); dom.activeElement = keep; click(tree, "Keep reservation");
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1); dom.activeElement = body;
    actionRender(null, { action }); expect(quick.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(dom.activeElement).toBe(quick);
  });
  it.each(["currentness", "read", "different-action"])("drops the explicit focus intent on %s loss without replaying it later", boundary => {
    const tree = actionRender(initialOwner("check-in")); dom.activeElement = keep; click(tree, "Keep reservation"); dom.activeElement = body;
    actionRender(null, boundary === "currentness" ? { current: false } : boundary === "read" ? { readAllowed: false } : { action: "check-out" });
    expect(quick.focus).not.toHaveBeenCalled(); actionRender(null); expect(quick.focus).not.toHaveBeenCalled();
  });
  it("respects deliberate external focus between Cancel and commit", () => {
    const tree = actionRender(initialOwner("check-in")); dom.activeElement = keep; click(tree, "Keep reservation"); dom.activeElement = { external: true };
    actionRender(null); expect(quick.focus).not.toHaveBeenCalled();
  });
  it("does not arm restoration when Cancel was not focus-owned", () => {
    const tree = actionRender(initialOwner("check-in")); dom.activeElement = { external: true }; click(tree, "Keep reservation"); dom.activeElement = body;
    actionRender(null); expect(quick.focus).not.toHaveBeenCalled();
  });
  it("restores an eligible same-action successor after focused terminal Done", () => {
    const tree = actionRender({ ...initialOwner("check-in"), phase: "changed" }); dom.activeElement = keep; click(tree, "Done"); dom.activeElement = body;
    actionRender(null); expect(quick.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
});
