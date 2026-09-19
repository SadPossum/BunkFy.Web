import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguagePicker } from "../src/features/guests/LanguagePicker";

// Actual component handlers with hook doubles: not native layout, focus or browser proof.
const h = vi.hoisted(() => ({ cursor: 0, ids: 0, slots: [] as unknown[], effects: [] as (() => void)[], dirty: false, load: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(), useId: () => `languages-${h.ids++}`,
  useRef: (initial: unknown) => ({ current: initial }), useEffect: (callback: () => void) => h.effects.push(callback),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
    return [h.slots[i], (value: unknown) => { const next = typeof value === "function" ? value(h.slots[i]) : value; if (!Object.is(next, h.slots[i])) { h.slots[i] = next; h.dirty = true; } }]; },
}));
vi.mock("../src/features/guests/guestLanguageOptions", async original => ({
  ...await original<typeof import("../src/features/guests/guestLanguageOptions")>(), loadGuestLanguageCatalog: h.load,
}));
type Node = ReactElement<Record<string, unknown>>;
type Props = ComponentProps<typeof LanguagePicker>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children)]; }
function render(props: Props): Node[] {
  for (let pass = 0; pass < 5; pass++) {
    h.cursor = 0; h.ids = 0; h.dirty = false; h.effects = [];
    const tree = nodes(LanguagePicker(props)); h.effects.forEach(effect => effect()); if (!h.dirty) return tree;
  }
  throw new Error("Picker did not settle");
}
function find(props: Props, name: string) { return render(props).find(node => node.props["aria-label"] === name)!; }
function root(props: Props) { return render(props).find(node => typeof node.props.onOpenChange === "function")!; }
function change(node: Node, value: string) { (node.props.onChange as (event: unknown) => void)({ target: { value } }); }
function key(node: Node, value: string, composing = false) {
  const event = { key: value, nativeEvent: { isComposing: composing }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  (node.props.onKeyDown as (event: unknown) => void)(event); return event;
}
async function open(props: Props) {
  (root(props).props.onOpenChange as (open: boolean) => void)(true); render(props); await Promise.resolve(); render(props);
}
beforeEach(() => { h.slots = []; h.load.mockReset().mockResolvedValue([["en", "English"], ["fr", "French"], ["de", "German"]]); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("isolated Languages control", () => {
  it("does not request suggestions before opening or mutate on search; selection keeps popup open", async () => {
    const p: Props = { value: [], onChange: value => { p.value = value; } };
    render(p); expect(h.load).not.toHaveBeenCalled(); await open(p); expect(h.load).toHaveBeenCalled();
    change(find(p, "Search languages"), "French"); expect(p.value).toEqual([]);
    const event = key(find(p, "Search languages"), "Enter");
    expect(event.preventDefault).toHaveBeenCalled(); expect(event.stopPropagation).toHaveBeenCalled();
    expect(p.value).toEqual(["fr"]); expect(root(p).props.open).toBe(true);
    change(find(p, "Search languages"), "English"); key(find(p, "Search languages"), "Enter");
    expect(p.value).toEqual(["fr", "en"]);
  });
  it("supports non-modifier multi-selection and Home/End in the list, while input Home/Space remain native", async () => {
    const p: Props = { value: [], onChange: value => { p.value = value; } }; await open(p);
    expect(key(find(p, "Search languages"), "Home").preventDefault).not.toHaveBeenCalled();
    expect(key(find(p, "Search languages"), " ").preventDefault).not.toHaveBeenCalled();
    key(find(p, "Language options"), "End"); key(find(p, "Language options"), " "); expect(p.value).toEqual(["de"]);
    key(find(p, "Language options"), "Home"); key(find(p, "Language options"), " "); expect(p.value).toEqual([]);
    key(find(p, "Language options"), "Home"); key(find(p, "Language options"), "ArrowDown"); key(find(p, "Language options"), "Enter"); expect(p.value).toEqual(["fr"]);
  });
  it("prevents empty-result and composition Enter from submitting or selecting", async () => {
    const p: Props = { value: [], onChange: vi.fn() }; await open(p);
    expect(key(find(p, "Search languages"), "Enter", true).preventDefault).toHaveBeenCalled();
    change(find(p, "Search languages"), "nothing matches this");
    expect(key(find(p, "Search languages"), "Enter").preventDefault).toHaveBeenCalled(); expect(p.onChange).not.toHaveBeenCalled();
  });
  it("preserves saved tags, removes only explicit selections, and closes when authority disables the portal", async () => {
    const change = vi.fn(), p: Props = { value: ["EN-gB", "unknown-١"], onChange: change }; await open(p);
    const remove = find(p, "Remove unknown-١");
    (remove.props.onClick as () => void)(); expect(change).toHaveBeenLastCalledWith(["EN-gB"]);
    change.mockClear(); p.disabled = true;
    expect(root(p).props.open).toBe(false); expect(find(p, "Choose languages").props.disabled).toBe(true);
    (find(p, "Remove unknown-١").props.onClick as () => void)(); expect(change).not.toHaveBeenCalled();
    expect(p.value).toEqual(["EN-gB", "unknown-١"]);
  });
  it("retains selections and offers a retry when catalog loading fails", async () => {
    h.load.mockRejectedValue(new Error("simulated chunk failure"));
    const p: Props = { value: ["unknown-١"], onChange: vi.fn() }; await open(p);
    expect(render(p).some(node => node.props.children === "Retry")).toBe(true);
    expect(find(p, "Remove unknown-١")).toBeDefined(); expect(p.onChange).not.toHaveBeenCalled();
  });
  it("bounds new selection, announces the error, and keeps the query editable", async () => {
    const p: Props = { value: Array.from({ length: 12 }, (_, index) => `x-${index}`), onChange: vi.fn() }; await open(p);
    change(find(p, "Search languages"), "French"); key(find(p, "Search languages"), "Enter");
    expect(p.onChange).not.toHaveBeenCalled(); expect(find(p, "Search languages").props.value).toBe("French");
    expect(render(p).some(node => node.props.role === "status" && node.props.children === "Choose up to 12 languages.")).toBe(true);
  });
  it("adds an exact regional/script tag only after an explicit advanced action", async () => {
    const p: Props = { value: ["sr"], onChange: value => { p.value = value; } }; await open(p);
    change(find(p, "Search languages"), "sr-Latn"); key(find(p, "Search languages"), "Enter"); expect(p.value).toEqual(["sr"]);
    (render(p).find(node => node.props.children === "Enter an exact tag")!.props.onClick as () => void)();
    const exact = () => render(p).find(node => node.type === "input" && node.props.placeholder === "For example, sr-Latn")!;
    change(exact(), "sr-Latn"); const event = key(exact(), "Enter");
    expect(event.preventDefault).toHaveBeenCalled(); expect(p.value).toEqual(["sr", "sr-latn"]); expect(root(p).props.open).toBe(true);
  });
  it("keeps invalid exact-tag input editable without adding or submitting", async () => {
    const p: Props = { value: ["en"], onChange: vi.fn() }; await open(p);
    (render(p).find(node => node.props.children === "Enter an exact tag")!.props.onClick as () => void)();
    const exact = () => render(p).find(node => node.type === "input" && node.props.placeholder === "For example, sr-Latn")!;
    change(exact(), "not_a_tag"); key(exact(), "Enter"); expect(p.onChange).not.toHaveBeenCalled(); expect(exact().props.value).toBe("not_a_tag");
  });
});

// The resize effect runs against bounded geometry/event doubles. Native modal
// clipping, Radix repositioning and the subsequent Tab still need browser proof.
describe("local viewport resize visibility", () => {
  class Element {
    parentElement: Element | null = null;
    isConnected = true; disabled = false;
    clientTop = 0; clientLeft = 0; clientHeight = 800; clientWidth = 1440;
    overflowY = "visible"; overflowX = "visible";
    rect = { top: 100, bottom: 144, left: 20, right: 220, width: 200, height: 44 };
    getBoundingClientRect() { return this.rect; }
    contains(other: Element | null): boolean { return Boolean(other && (other === this || this.contains(other.parentElement))); }
    closest() { return null; }
    getAttribute() { return null; }
    focus = vi.fn(() => { doc.activeElement = this; });
    scrollIntoView = vi.fn();
  }
  const doc = { activeElement: null as Element | null };
  async function setup(opened = false) {
    const props: Props = { value: ["unknown-١"], onChange: vi.fn() };
    if (opened) await open(props);
    const tree = render(props), effect = h.effects.at(-1)!;
    const container = new Element(), trigger = new Element(), token = new Element(), popup = new Element(), input = new Element();
    trigger.parentElement = container; token.parentElement = container; input.parentElement = popup;
    popup.rect = { top: 180, bottom: 480, left: 20, right: 300, width: 280, height: 300 };
    input.rect = { top: 190, bottom: 234, left: 30, right: 280, width: 250, height: 44 };
    (tree.find(n => n.props.role === "group")!.props.ref as { current: unknown }).current = container;
    (tree.find(n => n.type === "button" && n.props["aria-label"] === "Choose languages")!.props.ref as { current: unknown }).current = trigger;
    (tree.find(n => typeof n.props.onCloseAutoFocus === "function")!.props.ref as { current: unknown }).current = popup;
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, width: 1440, height: 800 });
    const win = Object.assign(new EventTarget(), { visualViewport: viewport, innerWidth: 1440, innerHeight: 800 });
    const frames = new Map<number, () => void>(); let id = 0;
    vi.stubGlobal("window", win); vi.stubGlobal("document", doc); vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("getComputedStyle", (element: Element) => element);
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { frames.set(++id, fn); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
    const cleanup = effect() as unknown as () => void;
    const tick = () => { const current = [...frames.values()]; frames.clear(); current.forEach(fn => fn()); };
    const resize = (width: number, height: number) => { viewport.width = width; viewport.height = height; win.dispatchEvent(new Event("resize")); };
    return { props, tree, container, trigger, token, popup, input, viewport, win, frames, cleanup, tick, resize };
  }
  it.each(["trigger", "token"] as const)("reveals a closed focused %s after wide-to-narrow resize without replacing focus or draft", async name => {
    const f = await setup(); const target = f[name]; doc.activeElement = target;
    target.rect = { ...target.rect, top: 820, bottom: 864 };
    f.resize(320, 568); f.tick();
    expect(target.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "nearest", inline: "nearest", behavior: "instant" });
    expect(target.focus).not.toHaveBeenCalled(); expect(doc.activeElement).toBe(target); expect(f.props.onChange).not.toHaveBeenCalled();
    expect(f.tree.find(n => n.props.role === "group")?.props.onKeyDown).toBeUndefined();
    f.cleanup();
  });
  it("does nothing on mount, ordinary renders, external focus, already-visible narrow controls or resize back to wide", async () => {
    const f = await setup(); doc.activeElement = f.trigger;
    expect(f.trigger.scrollIntoView).not.toHaveBeenCalled();
    f.resize(320, 568); f.tick(); f.resize(1440, 800); f.tick();
    doc.activeElement = new Element(); f.trigger.rect = { ...f.trigger.rect, top: 900, bottom: 944 }; f.resize(320, 568); f.tick();
    expect(f.trigger.scrollIntoView).not.toHaveBeenCalled(); expect(f.trigger.focus).not.toHaveBeenCalled(); f.cleanup();
  });
  it("uses the clipped modal body rather than considering a control under its header visible", async () => {
    const f = await setup(); doc.activeElement = f.token;
    f.container.overflowY = "auto"; f.container.rect = { ...f.container.rect, top: 180, bottom: 500, height: 320 }; f.container.clientHeight = 320;
    f.resize(1024, 800); f.tick(); expect(f.token.scrollIntoView).toHaveBeenCalledOnce(); f.cleanup();
  });
  it("reveals the offscreen anchor while preserving an open popup's search focus when it still fits", async () => {
    const f = await setup(true); doc.activeElement = f.input; f.trigger.rect = { ...f.trigger.rect, top: 820, bottom: 864 };
    f.resize(320, 568); f.tick(); f.tick();
    expect(f.trigger.scrollIntoView).toHaveBeenCalledOnce(); expect(f.trigger.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(f.input); expect(h.slots[0]).toBe(true); expect(f.props.onChange).not.toHaveBeenCalled(); f.cleanup();
  });
  it("closes only an unusable owned popup and reveals its same enabled trigger", async () => {
    const f = await setup(true); doc.activeElement = f.input;
    f.popup.rect = { ...f.popup.rect, height: 100, bottom: 280 }; f.trigger.rect = { ...f.trigger.rect, top: 820, bottom: 864 };
    f.resize(320, 256); f.tick(); f.tick();
    expect(h.slots[0]).toBe(false); expect(f.trigger.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(doc.activeElement).toBe(f.trigger); expect(f.props.onChange).not.toHaveBeenCalled(); f.cleanup();
  });
  it("does not take focus back after a deliberate move between layout frames; cancels queued work and listeners", async () => {
    const f = await setup(true); doc.activeElement = f.input; f.popup.rect.height = 100;
    f.resize(320, 256); f.resize(320, 256); expect(f.frames.size).toBe(1); f.tick();
    const outside = new Element(); doc.activeElement = outside; f.tick(); expect(f.trigger.focus).not.toHaveBeenCalled();
    doc.activeElement = f.input; f.viewport.dispatchEvent(new Event("resize")); expect(f.frames.size).toBe(1);
    f.cleanup(); expect(f.frames.size).toBe(0); f.resize(1440, 800); expect(f.frames.size).toBe(0); expect(f.props.onChange).not.toHaveBeenCalled();
  });
});
