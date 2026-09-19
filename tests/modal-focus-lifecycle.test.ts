import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../src/components/ui/primitives";
import { containPickerEscape, handleSelectPickerKey } from "../src/components/ui/SelectPicker";
import { focusModalRecoveryFeedback } from "../src/components/ui/modalFocus";

// Execute the real Modal effect with deterministic hook slots and DOM doubles.
// This verifies lifetime/handler ownership, not browser layout or Radix behavior.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], pending: [] as (() => void)[], cleanups: new Map<number, () => void>() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    return hooks.slots[index] ?? (hooks.slots[index] = { current: initial });
  },
  useId: () => "modal-id-" + hooks.cursor++,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], vi.fn()];
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useLayoutEffect: (effect: () => void) => { hooks.cursor++; hooks.pending.push(effect); },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (previous && deps.length === previous.length && deps.every((value, i) => Object.is(value, previous[i]))) return;
    hooks.slots[index] = deps;
    hooks.pending.push(() => {
      hooks.cleanups.get(index)?.(); hooks.cleanups.delete(index);
      const cleanup = effect(); if (cleanup) hooks.cleanups.set(index, cleanup);
    });
  },
}));

class NodeDouble {
  focus = vi.fn(() => { dom.activeElement = this; });
  hidden = false;
  visibility = "visible";
  disabled = false;
  isConnected = true;
  tabIndex = 0;
  controls = "";
  parent: NodeDouble | null = null;
  scrollIntoView = vi.fn();
  children: NodeDouble[] = [];
  getClientRects() { return this.hidden ? [] : [{}]; }
  closest(selector: string) { return selector === "[data-bunkfy-modal-box]" ? this.parent : this.hidden ? this : null; }
  getAttribute(name: string) { return name === "aria-controls" ? this.controls : null; }
  hasAttribute(name: string) { return name === "hidden" && this.hidden; }
  matches(selector: string) { return selector === ":disabled" && this.disabled; }
  contains(node: unknown) { return node === this || this.children.includes(node as NodeDouble); }
  querySelectorAll(selector: string) { return selector === "[aria-controls]" ? this.children.filter((node) => node.controls) : this.children; }
}
const listeners = new Set<(event: KeyboardEvent) => void>();
const dom = {
  activeElement: null as NodeDouble | null,
  body: { style: { overflow: "auto" } },
  querySelectorAll: () => [],
  getElementById: (_id: string): NodeDouble | null => null,
  addEventListener: vi.fn((_name: string, listener: (event: KeyboardEvent) => void) => { listeners.add(listener); }),
  removeEventListener: vi.fn((_name: string, listener: (event: KeyboardEvent) => void) => { listeners.delete(listener); }),
};
let dialog: NodeDouble;
let opener: NodeDouble;
let observedMutation: (() => void) | null = null;
const observerDisconnect = vi.fn();
type Element = ReactElement<{ ref?: { current: unknown }; children?: Element | Element[]; onClick?: () => void; "aria-label"?: string; className?: string; disabled?: boolean }>;
function elements(tree: Element | null): Element[] {
  if (!tree || typeof tree !== "object") return [];
  const children = tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children : [children]).flatMap((child) => elements(child ?? null))];
}
function render(open: boolean, onClose: () => void, closeDisabled = false) {
  hooks.cursor = 0; hooks.pending = [];
  const tree = Modal({ open, onClose, title: "Test", children: "Draft", closeDisabled }) as Element | null;
  const frame = elements(tree).find((element) => element.props?.ref);
  if (frame?.props.ref) frame.props.ref.current = dialog;
  hooks.pending.forEach((effect) => effect());
  return tree;
}
function key(key: string, shiftKey = false) {
  const event = { key, shiftKey, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
    nativeEvent: { isComposing: false },
  };
  return event;
}
function dispatch(event: ReturnType<typeof key>) {
  if (!event.stopped) listeners.forEach((listener) => listener(event as unknown as KeyboardEvent));
}
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.pending = []; hooks.cleanups.clear(); listeners.clear();
  vi.clearAllMocks(); dialog = new NodeDouble(); opener = new NodeDouble();
  dom.activeElement = opener; dom.body.style.overflow = "auto";
  vi.stubGlobal("document", dom); vi.stubGlobal("HTMLElement", NodeDouble);
  vi.stubGlobal("getComputedStyle", (node: NodeDouble) => ({ visibility: node.visibility }));
  observedMutation = null;
  vi.stubGlobal("MutationObserver", class {
    constructor(callback: () => void) { observedMutation = callback; }
    observe() {}
    disconnect() { observerDisconnect(); observedMutation = null; }
  });
});
afterEach(() => { hooks.cleanups.forEach((cleanup) => cleanup()); hooks.cleanups.clear(); vi.unstubAllGlobals(); });

describe("Modal open-lifetime focus and current close ownership", () => {
  it("keeps a nested draft focused across repeated parent renders without relocking or replacing listeners", () => {
    const close = vi.fn(); render(true, () => close());
    const search = new NodeDouble(); dialog.children.push(search); search.focus();
    for (let cycle = 0; cycle < 4; cycle++) render(true, () => close());
    expect(dom.activeElement).toBe(search);
    expect(dialog.focus).toHaveBeenCalledTimes(1);
    expect(opener.focus).not.toHaveBeenCalled();
    expect(dom.addEventListener).toHaveBeenCalledTimes(1);
    expect(dom.removeEventListener).not.toHaveBeenCalled();
    expect(dom.body.style.overflow).toBe("hidden");
  });
  it("uses the latest pending guard for Escape, Close and backdrop without refocusing", () => {
    const close = vi.fn(); render(true, () => close());
    const pending = true;
    const tree = render(true, () => { if (!pending) close(); });
    dispatch(key("Escape"));
    elements(tree).find((element) => element.props?.["aria-label"] === "Close dialog")!.props.onClick!();
    elements(tree).find((element) => element.props?.className === "modal-backdrop")!.props.onClick!();
    expect(close).not.toHaveBeenCalled();
    const latest = vi.fn(); render(true, latest); dispatch(key("Escape"));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(dialog.focus).toHaveBeenCalledTimes(1);
  });
  it("restores overflow/opener once on actual close and captures a new opener on reopening", () => {
    render(false, vi.fn()); expect(listeners.size).toBe(0);
    render(true, vi.fn()); render(true, vi.fn()); render(false, vi.fn());
    expect(dom.body.style.overflow).toBe("auto"); expect(dom.activeElement).toBe(opener);
    expect(opener.focus).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(0);
    const next = new NodeDouble(); next.focus();
    render(true, vi.fn()); render(false, vi.fn());
    expect(dom.activeElement).toBe(next); expect(opener.focus).toHaveBeenCalledTimes(1);
    expect(dom.removeEventListener).toHaveBeenCalledTimes(2);
  });
  it("locks X, Escape and backdrop through the pending prop without resetting focus or listeners", () => {
    const close = vi.fn(); render(true, close);
    const tree = render(true, close, true);
    dispatch(key("Escape"));
    const button = elements(tree).find((element) => element.props?.["aria-label"] === "Close dialog")!;
    expect(button.props.disabled).toBe(true);
    button.props.onClick!();
    elements(tree).find((element) => element.props?.className === "modal-backdrop")!.props.onClick!();
    expect(close).not.toHaveBeenCalled();
    expect(dialog.focus).toHaveBeenCalledTimes(1);
    expect(dom.addEventListener).toHaveBeenCalledTimes(1);
    render(true, close, false); dispatch(key("Escape"));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("preserves forward/reverse Tab wrapping and the empty-dialog fallback", () => {
    render(true, vi.fn()); const first = new NodeDouble(); const last = new NodeDouble(); dialog.children = [first, last];
    first.focus(); const reverse = key("Tab", true); dispatch(reverse); expect(dom.activeElement).toBe(last); expect(reverse.defaultPrevented).toBe(true);
    const forward = key("Tab"); dispatch(forward); expect(dom.activeElement).toBe(first); expect(forward.defaultPrevented).toBe(true);
    dialog.focus(); dispatch(key("Tab", true)); expect(dom.activeElement).toBe(last);
    dialog.children = []; const empty = key("Tab"); dispatch(empty); expect(dom.activeElement).toBe(dialog); expect(empty.defaultPrevented).toBe(true);
  });
  it("excludes controls disabled by a parent fieldset and uses dialog fallback", () => {
    render(true, vi.fn());
    const inheritedDisabled = new NodeDouble(); inheritedDisabled.disabled = true;
    dialog.children = [inheritedDisabled];
    const event = key("Tab"); dispatch(event);
    expect(event.defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(dialog);
    expect(inheritedDisabled.focus).not.toHaveBeenCalled();
  });
  it("excludes inherited CSS visibility hidden/collapse even when geometry exists", () => {
    render(true, vi.fn()); const hidden = new NodeDouble(); hidden.visibility = "hidden";
    const collapsed = new NodeDouble(); collapsed.visibility = "collapse"; const visible = new NodeDouble();
    dialog.children = [hidden, collapsed, visible]; dispatch(key("Tab")); expect(dom.activeElement).toBe(visible);
    visible.visibility = "hidden"; render(true, vi.fn()); expect(dom.activeElement).toBe(dialog);
    dispatch(key("Tab")); expect(dom.activeElement).toBe(dialog);
  });
  it("recovers forward and reverse Tab from BODY or a background link", () => {
    render(true, vi.fn()); const first = new NodeDouble(); const last = new NodeDouble(); dialog.children = [first, last];
    dom.activeElement = null; dispatch(key("Tab")); expect(dom.activeElement).toBe(first);
    opener.focus(); dispatch(key("Tab", true)); expect(dom.activeElement).toBe(last);
  });
  it("repairs disabled and removed control focus without scrolling or stealing valid input", () => {
    render(true, vi.fn()); const input = new NodeDouble(); dialog.children = [input]; input.focus();
    render(true, vi.fn()); expect(dom.activeElement).toBe(input);
    input.disabled = true; render(true, vi.fn()); expect(dom.activeElement).toBe(dialog);
    expect(dialog.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    input.disabled = false; input.focus(); dialog.children = []; render(true, vi.fn()); expect(dom.activeElement).toBe(dialog);
  });
  it("repairs child-only disabled/removal changes without a Modal rerender and disconnects on close", () => {
    render(true, vi.fn()); const input = new NodeDouble(); dialog.children = [input]; input.focus();
    observedMutation!(); expect(dom.activeElement).toBe(input);
    input.disabled = true; observedMutation!(); expect(dom.activeElement).toBe(dialog);
    input.disabled = false; input.focus(); dialog.children = []; observedMutation!(); expect(dom.activeElement).toBe(dialog);
    render(false, vi.fn()); expect(observerDisconnect).toHaveBeenCalledTimes(1); expect(observedMutation).toBeNull();
  });
  it("keeps this modal's owned picker portal focus and keyboard handling", () => {
    const close = vi.fn(); render(true, close);
    const trigger = new NodeDouble(); trigger.controls = "owned-picker"; dialog.children = [trigger];
    const portal = new NodeDouble(); const day = new NodeDouble(); portal.children = [day];
    vi.spyOn(dom, "getElementById").mockImplementation((id) => id === "owned-picker" ? portal : null);
    day.focus(); render(true, close); expect(dom.activeElement).toBe(day);
    const tab = key("Tab"); dispatch(tab); expect(tab.defaultPrevented).toBe(false);
    dispatch(key("Escape")); expect(close).not.toHaveBeenCalled();
    trigger.focus(); dispatch(key("Escape")); expect(close).toHaveBeenCalledTimes(1);
  });
  it("retains search focus outside the listbox when the trigger owns the whole picker portal", () => {
    const close = vi.fn(); render(true, close);
    const trigger = new NodeDouble(); trigger.controls = "picker-content"; dialog.children = [trigger];
    const search = new NodeDouble(); const listbox = new NodeDouble();
    const content = new NodeDouble(); content.children = [search, listbox];
    vi.spyOn(dom, "getElementById").mockImplementation((id) => id === "picker-content" ? content : id === "picker-listbox" ? listbox : null);
    expect(listbox.contains(search)).toBe(false);
    search.focus();
    for (let poll = 0; poll < 3; poll++) { render(true, close); observedMutation!(); }
    expect(dom.activeElement).toBe(search); expect(dialog.focus).toHaveBeenCalledTimes(1);
    dispatch(key("Escape")); expect(close).not.toHaveBeenCalled();
    // Ownership is not a global bypass: an unrelated background input is repaired.
    const unrelated = new NodeDouble(); unrelated.focus(); observedMutation!();
    expect(dom.activeElement).toBe(dialog);
  });
  it("focuses terminal recovery feedback only from fallback, not a valid input", () => {
    render(true, vi.fn()); const feedback = new NodeDouble(); feedback.parent = dialog; dialog.children = [feedback];
    focusModalRecoveryFeedback(feedback as unknown as HTMLElement);
    expect(dom.activeElement).toBe(feedback); expect(feedback.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    const input = new NodeDouble(); dialog.children.push(input); input.focus();
    focusModalRecoveryFeedback(feedback as unknown as HTMLElement); expect(dom.activeElement).toBe(input);
  });
  it("leaves consumed nested-picker Escape to the picker; the next parent Escape uses the current callback", () => {
    const close = vi.fn(); render(true, close);
    const pickerClose = vi.fn(); const searchEscape = key("Escape");
    handleSelectPickerKey(searchEscape, [], -1, { close: pickerClose, select: vi.fn(), setActive: vi.fn() }); dispatch(searchEscape);
    expect(pickerClose).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
    const radixEscape = key("Escape"); containPickerEscape(radixEscape); dispatch(radixEscape); expect(close).not.toHaveBeenCalled();
    const prevented = key("Escape"); prevented.preventDefault(); dispatch(prevented); expect(close).not.toHaveBeenCalled();
    dispatch(key("Escape")); expect(close).toHaveBeenCalledTimes(1);
  });
  it("binds ownership only to open and retains actual searchable/basic picker Escape containment", () => {
    const source = readFileSync(new URL("../src/components/ui/primitives.tsx", import.meta.url), "utf8");
    expect(source).toContain("closeRef.current = closeDisabled ? () => undefined : onClose"); expect(source).toContain("closeRef.current()");
    expect(source).toContain("}, [open]);"); expect(source).not.toContain("}, [open, onClose]);");
    const picker = readFileSync(new URL("../src/components/ui/SelectPicker.tsx", import.meta.url), "utf8");
    expect(picker.match(/onEscapeKeyDown={containPickerEscape}/g)).toHaveLength(2);
  });
});
