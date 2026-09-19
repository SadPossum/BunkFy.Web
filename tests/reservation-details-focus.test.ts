import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureReservationDetailsFocus, finishReservationDetailsFocus } from "../src/features/reservations/reservationDetailsFocus";
import { GuestDetailsForm, ReservationDetail } from "../src/features/reservations/ReservationDetail";
import type { Reservation } from "../src/api/types";
import type { RouteNavigationLease } from "../src/app/routeNavigationLease";

// Real local focus helper and Detail effects; DOM/trap handoffs are deterministic
// doubles, not native browser layout, visible focus ring or next-Tab proof.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], cleanups: new Map<number, () => void>() }));
const editor = vi.hoisted(() => ({ value: null as { sending: boolean } | null, submit: vi.fn(), request: vi.fn() }));
vi.mock("react", async load => ({ ...await load<typeof import("react")>(),
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.slots)) hooks.slots[i] = initial; return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = value; }]; },
  useRef: (initial: unknown) => { const i = hooks.cursor++; return hooks.slots[i] ?? (hooks.slots[i] = { current: initial }); },
  useMemo: (factory: () => unknown) => factory(), useEffect: vi.fn(),
  useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => { const i = hooks.cursor++, previous = hooks.slots[i] as unknown[] | undefined; if (previous && deps.every((v, j) => Object.is(v, previous[j]))) return; hooks.slots[i] = deps; hooks.effects.push(() => { hooks.cleanups.get(i)?.(); hooks.cleanups.delete(i); const cleanup = effect(); if (cleanup) hooks.cleanups.set(i, cleanup); }); },
}));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: editor.request }) }));
vi.mock("../src/features/reservations/useReservationDetailsEditor", () => ({ useReservationDetailsEditor: () => ({ editor: editor.value, unresolved: false,
  begin: () => { editor.value = { sending: false }; }, cancel: () => { editor.value = null; }, submit: editor.submit }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: (options: { queryKey: string[] }) => ({ data: options.queryKey[0] === "reservation" ? { propertyId: "p", reservationId: "r", version: 1, detailsRevision: 1, arrival: "2026-09-08", departure: "2026-09-10", primaryGuestName: "QA focus", guestCount: 1, status: "confirmed" } as Reservation : undefined, error: null, isLoading: false, isFetching: false, refetch: vi.fn() }),
  useMutation: () => ({ isPending: false, error: null, reset: vi.fn() }),
}));
const listeners = new Set<() => void>();
class Node {
  isConnected = true; disabled = false; visible = true; hidden = false;
  owner: Node | null = null;
  parentElement: Node | null = null;
  overflowY = "visible"; clientTop = 0; clientHeight = 0; scrollHeight = 0; scrollTop = 0;
  rect = { top: 200, bottom: 240 };
  constructor(readonly name: string) {}
  matches = () => this.disabled;
  closest = (selector: string) => selector === "[data-bunkfy-modal-box]" ? this.owner : this.hidden ? this : null;
  contains = (other: unknown) => other === this || (other instanceof Node && other.owner === this);
  getClientRects = () => this.visible ? [{}] : [];
  getBoundingClientRect = () => this.rect;
  focus = vi.fn((_options?: unknown) => { focus(this); });
  querySelector = vi.fn(() => first);
}
const modal = new Node("own modal"), otherModal = new Node("another modal"), scrollport = new Node("modal body"), area = new Node("details area"), edit = new Node("Edit"), first = new Node("primary guest"), cancel = new Node("Cancel"), save = new Node("Save"), external = new Node("outside control"), localOther = new Node("other local control"), body = new Node("BODY");
const dom = { activeElement: body, body, querySelectorAll: () => [modal], addEventListener: (_name: string, callback: () => void) => listeners.add(callback), removeEventListener: (_name: string, callback: () => void) => listeners.delete(callback) };
function focus(node: Node) { dom.activeElement = node; [...listeners].forEach(callback => callback()); }
type Element = ReactElement<{ children?: unknown; ref?: { current: unknown }; onClick?: (event: { detail: number }) => void; "aria-labelledby"?: string }>;
function nodes(value: unknown): Element[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object") return []; const node = value as Element; return [node, ...nodes(node.props?.children)]; }
const props: ComponentProps<typeof ReservationDetail> = { propertyId: "p", reservationId: "r", editorIdentity: "actor-session:p:r", capabilities: { manage: true, manageGuests: false, readGuests: false, createGuests: false, checkIn: false, checkOut: false, cancel: false, noShow: false }, permissionSource: { label: "Access", state: "ready", isFetching: false, refetch: vi.fn() }, canReadInventory: false, businessDateToday: "2026-09-08", navigation: { reportOwner: vi.fn() } as unknown as RouteNavigationLease, onClose: vi.fn() };
function render(overrides: Partial<typeof props> = {}) {
  hooks.cursor = 0; hooks.effects = []; const tree = nodes(ReservationDetail({ ...props, ...overrides }));
  const section = tree.find(node => node.props?.["aria-labelledby"] === "booking-details-heading")!; section.props.ref!.current = area;
  const button = tree.find(node => node.type === "button" && nodes(node).some(n => Array.isArray(n.props.children) && n.props.children.includes("Edit booking details")));
  if (button) button.props.ref!.current = edit;
  hooks.effects.forEach(effect => effect());
  return { button, form: tree.find(node => node.type === GuestDetailsForm) as ReactElement<ComponentProps<typeof GuestDetailsForm>> | undefined };
}
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.cleanups.clear(); listeners.clear(); editor.value = null; editor.submit.mockReset();
  for (const node of [modal, otherModal, scrollport, area, edit, first, cancel, save, external, localOther, body]) { node.isConnected = true; node.disabled = false; node.visible = true; node.hidden = false; node.focus.mockClear(); node.owner = [scrollport, area, edit, first, cancel, save, localOther].includes(node) ? modal : null; node.parentElement = node.owner ? area : null; node.overflowY = "visible"; node.clientTop = 0; node.clientHeight = 0; node.scrollHeight = 0; node.scrollTop = 0; node.rect = { top: 200, bottom: 240 }; }
  area.parentElement = scrollport; scrollport.parentElement = modal; modal.parentElement = body;
  scrollport.overflowY = "auto"; scrollport.clientHeight = 600; scrollport.scrollHeight = 1800; scrollport.scrollTop = 300; scrollport.rect = { top: 130, bottom: 730 };
  area.contains = other => [edit, first, cancel, save].includes(other as Node); dom.activeElement = body; dom.querySelectorAll = () => [modal];
  vi.stubGlobal("document", dom); vi.stubGlobal("HTMLElement", Node); vi.stubGlobal("getComputedStyle", (node: Node) => ({ visibility: "visible", overflowY: node.overflowY }));
});
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
const element = (node: Node) => node as unknown as HTMLElement;

describe("reservation-local focus handoff", () => {
  it("native-style Edit activation accepts its exact modal handoff and focuses the first field once", () => {
    const initial = render(); expect(first.focus).not.toHaveBeenCalled(); focus(edit); initial.button!.props.onClick!({ detail: 0 });
    edit.isConnected = false; focus(modal); render(); expect(first.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(listeners.size).toBe(0);
    render(); expect(first.focus).toHaveBeenCalledTimes(1);
  });
  it("pointer entry does not force first-field focus or a clipped target reveal", () => { first.rect = { top: 105, bottom: 145 }; focus(edit); render().button!.props.onClick!({ detail: 1 }); edit.isConnected = false; focus(modal); render(); expect(first.focus).not.toHaveBeenCalled(); expect(scrollport.scrollTop).toBe(300); });
  it("Cancel returns to Edit through the same container handoff", () => {
    editor.value = { sending: false }; focus(cancel); render().form!.props.onCancel!(); cancel.isConnected = false; focus(modal); render();
    expect(edit.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(listeners.size).toBe(0);
  });
  it("save captures before pending disables its source and returns only after successful editor removal", () => {
    editor.value = { sending: false }; focus(save); render().form!.props.onSubmitIntent!(); save.disabled = true; editor.value = { sending: true }; focus(modal); render();
    expect(edit.focus).not.toHaveBeenCalled(); save.isConnected = false; editor.value = null; render(); expect(edit.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(listeners.size).toBe(0);
  });
  it("rejected/unknown save retains the editor and clears its return intent", () => {
    editor.value = { sending: false }; focus(save); render().form!.props.onSubmitIntent!(); editor.value = { sending: true }; save.disabled = true; focus(modal); render();
    editor.value = { sending: false }; render(); expect(edit.focus).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
    editor.value = null; save.isConnected = false; render(); expect(edit.focus).not.toHaveBeenCalled();
  });
  it("operator focus during an asynchronous save wins even after the modal later regains focus", () => {
    editor.value = { sending: false }; focus(save); render().form!.props.onSubmitIntent!(); editor.value = { sending: true }; save.disabled = true; focus(modal); render();
    focus(external); save.isConnected = false; focus(modal); editor.value = null; render();
    expect(edit.focus).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
  });
  it("ordinary editor refresh/revision rerenders do not repeat entry focus or move an operator's current field", () => {
    focus(edit); render().button!.props.onClick!({ detail: 0 }); edit.isConnected = false; focus(modal); render();
    first.focus.mockClear(); focus(localOther); editor.value = { sending: false }; render();
    render({ permissionSource: { ...props.permissionSource, isFetching: true } }); render();
    expect(dom.activeElement).toBe(localOther); expect(first.focus).not.toHaveBeenCalled(); expect(edit.focus).not.toHaveBeenCalled();
  });
  it.each([external, localOther])("permanently yields to %s even if focus later returns to the modal", target => {
    focus(edit); render().button!.props.onClick!({ detail: 0 }); focus(target); edit.isConnected = false; focus(modal); render();
    expect(first.focus).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
    expect(scrollport.scrollTop).toBe(300);
  });
  it.each(["identity", "authority", "unmount"])("cannot restore across %s loss", boundary => {
    focus(edit); render().button!.props.onClick!({ detail: 0 }); edit.isConnected = false; focus(modal);
    if (boundary === "unmount") hooks.cleanups.forEach(cleanup => cleanup());
    else render(boundary === "identity" ? { editorIdentity: "new-session:p:r" } : { permissionSource: { ...props.permissionSource, isFetching: true } });
    expect(first.focus).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
    expect(scrollport.scrollTop).toBe(300);
  });
  it.each(["different modal", "hidden", "disabled", "detached", "nested modal", "identity", "no authority"])("rejects an unsafe %s target", boundary => {
    focus(edit); const intent = captureReservationDetailsFocus(element(area), "owner"); edit.isConnected = false; focus(modal);
    if (boundary === "different modal") first.owner = otherModal;
    if (boundary === "hidden") first.hidden = true;
    if (boundary === "disabled") first.disabled = true;
    if (boundary === "detached") first.isConnected = false;
    if (boundary === "nested modal") dom.querySelectorAll = () => [modal, otherModal];
    expect(finishReservationDetailsFocus(intent, element(first), boundary === "identity" ? "other" : "owner", boundary !== "no authority")).toBe(false);
    expect(first.focus).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
    expect(scrollport.scrollTop).toBe(300);
  });
  it("does not invent a focus intent for initial-open, outside focus or a missing area", () => {
    expect(captureReservationDetailsFocus(element(area), "owner")).toBeNull(); focus(external);
    expect(captureReservationDetailsFocus(element(area), "owner")).toBeNull(); expect(captureReservationDetailsFocus(null, "owner")).toBeNull(); expect(listeners.size).toBe(0);
  });
  it.each([{ rect: { top: 105, bottom: 145 }, expected: 267 }, { rect: { top: 710, bottom: 750 }, expected: 328 }, { rect: { top: 138, bottom: 178 }, expected: 300 }])("minimally reveals the owned target with 8px clearance or leaves it stable: $expected", ({ rect, expected }) => {
    first.rect = rect; focus(edit); const intent = captureReservationDetailsFocus(element(area), "owner"); edit.isConnected = false; focus(modal);
    expect(finishReservationDetailsFocus(intent, element(first), "owner", true)).toBe(true);
    expect(scrollport.scrollTop).toBe(expected); expect(modal.scrollTop).toBe(0); expect(body.scrollTop).toBe(0);
  });
  it("repeated keyboard Cancel and re-entry each reveal only their still-owned target", () => {
    for (let cycle = 0; cycle < 2; cycle++) {
      edit.isConnected = true; first.rect = { top: 105, bottom: 145 }; scrollport.scrollTop = 300;
      focus(edit); render().button!.props.onClick!({ detail: 0 }); edit.isConnected = false; focus(modal); render();
      expect(dom.activeElement).toBe(first); expect(scrollport.scrollTop).toBe(267);
      cancel.isConnected = true; edit.rect = { top: 110, bottom: 154 }; focus(cancel); render().form!.props.onCancel!(); cancel.isConnected = false; edit.isConnected = true; focus(modal); render();
      expect(dom.activeElement).toBe(edit); expect(scrollport.scrollTop).toBe(239);
    }
  });
  it("does not scroll after the focused target synchronously yields to another control", () => {
    first.rect = { top: 105, bottom: 145 }; focus(edit); const intent = captureReservationDetailsFocus(element(area), "owner"); edit.isConnected = false; focus(modal);
    first.focus.mockImplementationOnce(() => focus(external));
    expect(finishReservationDetailsFocus(intent, element(first), "owner", true)).toBe(false);
    expect(dom.activeElement).toBe(external); expect(scrollport.scrollTop).toBe(300);
  });
});
