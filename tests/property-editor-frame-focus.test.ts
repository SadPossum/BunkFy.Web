import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyEditorFrame } from "../src/features/properties/PropertyEditorFrame";

// Exercise the real local frame effects/handler with deterministic hook slots
// and DOM geometry doubles. Browser layout/Tab behavior remains an after-gate.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], layout: [] as (() => void)[],
  passive: [] as (() => void)[], cleanups: new Map<number, () => void>() }));
vi.mock("react", async (original) => {
  function effect(queue: "layout" | "passive", callback: () => void | (() => void), deps: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (previous && deps.length === previous.length && deps.every((value, i) => Object.is(value, previous[i]))) return;
    hooks.slots[index] = deps;
    hooks[queue].push(() => {
      hooks.cleanups.get(index)?.(); hooks.cleanups.delete(index);
      const cleanup = callback(); if (cleanup) hooks.cleanups.set(index, cleanup);
    });
  }
  return { ...await original<typeof import("react")>(),
    useId: () => "frame-" + hooks.cursor++,
    useRef: (initial: unknown) => {
      const index = hooks.cursor++; return hooks.slots[index] ?? (hooks.slots[index] = { current: initial });
    },
    useLayoutEffect: (callback: () => void | (() => void), deps: unknown[]) => effect("layout", callback, deps),
    useEffect: (callback: () => void | (() => void), deps: unknown[]) => effect("passive", callback, deps),
  };
});

class NodeDouble {
  isConnected = true; shown = true; disabled = false; inert = false;
  textContent = "QA property";
  bounds = { top: 300, bottom: 332 };
  style = { scrollMarginBlock: "3px" };
  children: NodeDouble[] = [];
  focus = vi.fn(() => { dom.activeElement = this; });
  scrollMargins: string[] = [];
  scrollIntoView = vi.fn(() => { this.scrollMargins.push(this.style.scrollMarginBlock); });
  getClientRects() { return this.shown ? [this.bounds] : []; }
  getBoundingClientRect() { return this.bounds; }
  matches() { return this.disabled; }
  closest() { return this.inert ? this : null; }
  contains(node: unknown) { return node === this || this.children.includes(node as NodeDouble); }
  querySelector() { return this.children[0] ?? null; }
}
const dom = { activeElement: null as NodeDouble | null, body: null as unknown as NodeDouble,
  querySelector: (selector: string) => selector === "[data-property-retirement-heading]" ? heading
    : selector === ".app-topbar" ? topbar : selector.includes("Mobile navigation") ? footer : null };
const location = { pathname: "/properties", search: "?property=property-a" };
const frames: FrameRequestCallback[] = [];
let heading: NodeDouble, topbar: NodeDouble, footer: NodeDouble, region: NodeDouble, trigger: NodeDouble, control: NodeDouble;
type Frame = ReactElement<{ ref?: { current: unknown }; onFocusCapture?: (event: { target: NodeDouble }) => void }>;
function render(open: boolean, inline: boolean, opener?: { current: HTMLElement | null }) {
  hooks.cursor = 0; hooks.layout = []; hooks.passive = [];
  const tree = PropertyEditorFrame({ open, inline, opener, title: "Property", children: null, onClose: vi.fn() }) as Frame | null;
  if (tree?.props.ref) tree.props.ref.current = region;
  hooks.layout.forEach((effect) => effect());
  // Modal focuses itself in its passive effect, after local layout capture.
  if (open && !inline) dom.activeElement = new NodeDouble();
  hooks.passive.forEach((effect) => effect());
  return tree;
}
function flush() { frames.splice(0).forEach((callback) => callback(0)); }
function focus(tree: Frame, node: NodeDouble) { node.focus(); tree.props.onFocusCapture!({ target: node }); }
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.layout = []; hooks.passive = []; hooks.cleanups.clear(); frames.length = 0;
  heading = new NodeDouble(); topbar = new NodeDouble(); footer = new NodeDouble(); region = new NodeDouble(); trigger = new NodeDouble(); control = new NodeDouble();
  topbar.bounds = { top: 0, bottom: 64 }; footer.bounds = { top: 836, bottom: 900 };
  region.children = [control]; dom.body = new NodeDouble(); dom.activeElement = trigger;
  location.pathname = "/properties"; location.search = "?property=property-a";
  vi.stubGlobal("document", dom); vi.stubGlobal("window", { location }); vi.stubGlobal("HTMLElement", NodeDouble);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
});
afterEach(() => { hooks.cleanups.clear(); frames.length = 0; vi.unstubAllGlobals(); });

describe("PropertyEditorFrame local inline clearance", () => {
  it("clears bottom/footer and reverse/topbar obstruction with scoped margins, without changing focus", () => {
    const tree = render(true, true)!;
    for (const bounds of [{ top: 868, bottom: 900 }, { top: 40, bottom: 72 }]) {
      control.bounds = bounds; focus(tree, control); flush();
      expect(dom.activeElement).toBe(control);
      expect(control.style.scrollMarginBlock).toBe("3px");
    }
    expect(control.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(control.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest", behavior: "instant" });
    expect(control.scrollMargins).toEqual(Array(2).fill("5rem calc(5rem + env(safe-area-inset-bottom))"));
  });
  it("does not scroll already visible controls, the section, or a desktop without fixed mobile navigation", () => {
    const tree = render(true, true)!;
    focus(tree, control); flush(); expect(control.scrollIntoView).not.toHaveBeenCalled();
    control.bounds = { top: 868, bottom: 900 }; footer.shown = false;
    focus(tree, control); flush(); expect(control.scrollIntoView).not.toHaveBeenCalled();
    footer.shown = true; focus(tree, region); flush(); expect(region.scrollIntoView).not.toHaveBeenCalled();
  });
  it("drops deferred scrolling for detached, no-longer-focused or replaced editor nodes", () => {
    const tree = render(true, true)!; control.bounds = { top: 868, bottom: 900 };
    focus(tree, control); control.isConnected = false; flush();
    control.isConnected = true; focus(tree, control); heading.focus(); flush();
    focus(tree, control); tree.props.ref!.current = new NodeDouble(); flush();
    expect(control.scrollIntoView).not.toHaveBeenCalled();
  });
  it("preserves ordinary inline exact-opener restoration", () => {
    const opener = { current: trigger as unknown as HTMLElement };
    render(true, true, opener); render(false, true, opener); dom.activeElement = dom.body; flush();
    expect(dom.activeElement).toBe(trigger); expect(heading.focus).not.toHaveBeenCalled(); expect(opener.current).toBeNull();
  });
});

describe("PropertyEditorFrame legacy post-Modal fallback", () => {
  it.each(["detached", "hidden", "disabled", "inert"])("captures the real opener before Modal focus and restores its property heading when %s", (state) => {
    const opener = { current: null };
    render(true, false, opener); render(true, false, opener);
    if (state === "detached") trigger.isConnected = false;
    if (state === "hidden") trigger.shown = false;
    if (state === "disabled") trigger.disabled = true;
    if (state === "inert") trigger.inert = true;
    render(false, false, opener); dom.activeElement = dom.body; flush();
    expect(dom.activeElement).toBe(heading); expect(heading.focus).toHaveBeenCalledTimes(1);
  });
  it("does not override shared Modal restoration or another deliberate focus destination", () => {
    render(true, false); render(false, false); trigger.focus(); flush();
    expect(heading.focus).not.toHaveBeenCalled();
    render(true, false); trigger.isConnected = false; render(false, false); control.focus(); flush();
    expect(dom.activeElement).toBe(control); expect(heading.focus).not.toHaveBeenCalled();
  });
  it.each(["route", "heading", "label", "hidden-heading"])("refuses a stale or unavailable property context: %s", (change) => {
    render(true, false); trigger.isConnected = false; const captured = heading;
    if (change === "route") location.search = "?property=property-b";
    if (change === "heading") heading = new NodeDouble();
    if (change === "label") heading.textContent = "Another property";
    if (change === "hidden-heading") heading.shown = false;
    render(false, false); dom.activeElement = dom.body; flush();
    expect(captured.focus).not.toHaveBeenCalled(); expect(heading.focus).not.toHaveBeenCalled();
  });
  it("ignores an old close callback after a newer editor has captured its opener", () => {
    const opener = { current: null as HTMLElement | null };
    render(true, false, opener); trigger.isConnected = false; render(false, false, opener);
    control.focus(); render(true, false, opener); dom.activeElement = dom.body; flush();
    expect(heading.focus).not.toHaveBeenCalled();
    render(false, false, opener); control.focus(); flush(); expect(dom.activeElement).toBe(control);
  });
});
