import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatePicker, datePickerMonth, datePickerYearMonth, datePickerYearPage, parseDateKey, toDateKey } from "../src/components/ui/DatePicker";

// Invoke real control handlers with deterministic React state. Native popup,
// geometry and focus/Tab behavior remain separate browser acceptance cells.
const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }));
vi.mock("react", async load => ({ ...await load<typeof import("react")>(),
  useRef: (initial: unknown) => { const index = hooks.cursor++; return hooks.values[index] ?? (hooks.values[index] = { current: initial }); },
  useState: (initial: unknown) => { const index = hooks.cursor++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }]; },
  useEffect: (effect: () => void, deps: unknown[]) => { const index = hooks.cursor++, previous = hooks.values[index] as unknown[] | undefined; if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) { hooks.values[index] = deps; hooks.effects.push(effect); } },
}));
type Node = ReactElement<Record<string, unknown> & { children?: unknown }>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object") return []; const node = value as Node; return [node, ...nodes(node.props?.children)]; }
const change = vi.fn();
const base = { value: "2026-09-08", ariaLabel: "Arrival date", onChange: change };
function render(props: Partial<ComponentProps<typeof DatePicker>> = {}) {
  hooks.cursor = 0; hooks.effects = [];
  const tree = nodes(DatePicker({ ...base, ...props })); hooks.effects.forEach(effect => effect());
  const find = (label: string) => tree.find(node => node.props?.["aria-label"] === label)!;
  return { tree, find, root: tree.find(node => node.props?.onOpenChange)!, calendar: tree.find(node => node.props?.mode === "single")! };
}
function invoke(node: Node, handler: string, event?: unknown) { (node.props[handler] as (value?: unknown) => void)(event); }
function openYears(props: Partial<ComponentProps<typeof DatePicker>> = {}) { invoke(render(props).find(`${props.ariaLabel ?? base.ariaLabel} choose year`), "onClick"); }
function goYear(props: Partial<ComponentProps<typeof DatePicker>> = {}) { invoke(render(props).tree.find(node => node.type === "button" && node.props.children === "Go")!, "onClick"); }
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = []; change.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
const date = (value: string) => parseDateKey(value)!;

describe("explicit date commit focus handoff", () => {
  function setup() {
    const day = {}, outside = {}, dom = { activeElement: day as object };
    const button = { isConnected: true, disabled: false, ancestor: "", hasGeometry: true, visibility: "visible",
      matches: (selector: string) => selector === ":disabled" && button.disabled,
      closest: (selector: string) => button.ancestor && selector.includes(button.ancestor) ? {} : null,
      getClientRects: () => button.hasGeometry ? [{}] : [], focus: vi.fn(() => { dom.activeElement = button; }) };
    const popup = { contains: (node: object) => node === day, querySelector: () => null };
    vi.stubGlobal("document", dom); vi.stubGlobal("getComputedStyle", () => ({ visibility: button.visibility }));
    invoke(render().root, "onOpenChange", true);
    const tree = render();
    (tree.tree.find(node => node.type === "button" && node.props["aria-haspopup"] === "dialog")!.props.ref as { current: unknown }).current = button;
    (tree.find("Arrival date calendar").props.ref as { current: unknown }).current = popup;
    return { button, dom, day, outside };
  }
  it.each(["day", "same value", "clear"])("focuses its trigger before the parent %s commit and closes locally", action => {
    const { button, dom } = setup();
    change.mockImplementation(() => { expect(dom.activeElement).toBe(button); });
    const tree = render();
    if (action === "clear") invoke(tree.tree.find(node => node.type === "button" && node.props.children === "Clear date")!, "onClick");
    else invoke(tree.calendar, "onSelect", date(action === "same value" ? base.value : "2000-02-29"));
    expect(button.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(button.focus.mock.invocationCallOrder[0]).toBeLessThan(change.mock.invocationCallOrder[0]);
    expect(change).toHaveBeenCalledExactlyOnceWith(action === "clear" ? "" : action === "same value" ? base.value : "2000-02-29");
    expect(render().root.props.open).toBe(false);
  });
  it.each(["detached", "disabled fieldset", "hidden ancestor", "inert ancestor", "aria-hidden ancestor", "no geometry", "hidden visibility", "collapsed visibility", "outside focus", "disabled prop"])("does not move focus for %s", condition => {
    const { button, dom, outside } = setup();
    if (condition === "detached") button.isConnected = false;
    if (condition === "disabled fieldset") button.disabled = true;
    if (condition === "hidden ancestor") button.ancestor = "[hidden]";
    if (condition === "inert ancestor") button.ancestor = "[inert]";
    if (condition === "aria-hidden ancestor") button.ancestor = "[aria-hidden='true']";
    if (condition === "no geometry") button.hasGeometry = false;
    if (condition === "hidden visibility") button.visibility = "hidden";
    if (condition === "collapsed visibility") button.visibility = "collapse";
    if (condition === "outside focus") dom.activeElement = outside;
    invoke(render({ disabled: condition === "disabled prop" }).calendar, "onSelect", date("2000-02-29"));
    expect(button.focus).not.toHaveBeenCalled();
  });
  it("does not claim focus on open, unrelated render, year navigation or outside/Escape close", () => {
    const { button } = setup(); render();
    openYears();
    invoke(render().find("Arrival date year"), "onChange", { target: { value: "2000" } });
    goYear();
    const event = { stopPropagation: vi.fn() };
    invoke(render().find("Arrival date calendar"), "onEscapeKeyDown", event);
    invoke(render().root, "onOpenChange", false);
    expect(button.focus).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it("does not refocus after the parent deliberately changes focus and disables the trigger", () => {
    const { button, dom, outside } = setup();
    change.mockImplementation(() => { dom.activeElement = outside; button.disabled = true; });
    invoke(render().calendar, "onSelect", date("2000-02-29"));
    render({ disabled: true });
    expect(button.focus).toHaveBeenCalledTimes(1); expect(dom.activeElement).toBe(outside);
  });
});

describe("direct month/year navigation", () => {
  it("navigates to2099 with Enter without selecting a day, closing or submitting the parent", () => {
    invoke(render().root, "onOpenChange", true);
    openYears();
    invoke(render().find("Arrival date year"), "onChange", { target: { value: "2099" } });
    const event = { key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    invoke(render().find("Arrival date year"), "onKeyDown", event);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(toDateKey(render().calendar.props.month as Date)).toBe("2099-09-01");
    expect(render().root.props.open).toBe(true); expect(change).not.toHaveBeenCalled();
    invoke(render().calendar, "onSelect", date("2099-09-18"));
    expect(change).toHaveBeenCalledExactlyOnceWith("2099-09-18"); expect(render().root.props.open).toBe(false);
  });
  it("commits a historical year with Go and changes month without changing the selected date", () => {
    invoke(render().root, "onOpenChange", true);
    openYears();
    invoke(render().find("Arrival date year"), "onChange", { target: { value: "1901" } });
    goYear();
    invoke(render().find("Arrival date month"), "onChange", { target: { value: "1" } });
    expect(toDateKey(render().calendar.props.month as Date)).toBe("1901-02-01");
    expect(toDateKey(render().calendar.props.selected as Date)).toBe(base.value); expect(change).not.toHaveBeenCalled();
  });
  it("reopens at the authoritative selected month while preserving deliberate navigation in an open session", () => {
    invoke(render().root, "onOpenChange", true);
    invoke(render().calendar, "onMonthChange", date("2026-02-01"));
    expect(toDateKey(render().calendar.props.month as Date)).toBe("2026-02-01");
    invoke(render().root, "onOpenChange", false); invoke(render().root, "onOpenChange", true);
    expect(toDateKey(render().calendar.props.month as Date)).toBe("2026-09-01"); expect(change).not.toHaveBeenCalled();
    render({ value: "2028-02-29" });
    expect(toDateKey(render({ value: "2028-02-29" }).calendar.props.month as Date)).toBe("2028-02-01");
  });
  it.each(["0", "0000", "10000", "-1", "2e3", "2026.5", ""])("rejects invalid year %s without selecting or navigating", value => {
    invoke(render().root, "onOpenChange", true);
    openYears();
    invoke(render().find("Arrival date year"), "onChange", { target: { value } }); goYear();
    expect(render().find("Arrival date year").props["aria-invalid"]).toBe(true);
    expect(toDateKey(render().calendar.props.month as Date)).toBe("2026-09-01"); expect(change).not.toHaveBeenCalled();
  });
  it("clamps navigation to tightened month bounds without silently changing an out-of-range value", () => {
    render(); const props = { min: "2027-03-15", max: "2028-10-20" }; render(props);
    expect(toDateKey(render(props).calendar.props.month as Date)).toBe("2027-03-01");
    expect(toDateKey(render(props).calendar.props.selected as Date)).toBe(base.value);
    expect(render(props).calendar.props.disabled).toEqual([{ before: date(props.min) }, { after: date(props.max) }]);
    const months = nodes(render(props).find("Arrival date month"));
    expect(months.find(node => node.type === "option" && node.props.value === 1)?.props.disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
  });
  it.each([{ min: "2026-09-08", year: "2099" }, { max: "2026-09-08", year: "1800" }])("supports one-sided date bounds without a new year window", ({ min, max, year }) => {
    const props = { min, max }; invoke(render(props).root, "onOpenChange", true);
    openYears(props);
    invoke(render(props).find("Arrival date year"), "onChange", { target: { value: year } }); goYear(props);
    expect((render(props).calendar.props.month as Date).getFullYear()).toBe(Number(year)); expect(change).not.toHaveBeenCalled();
  });
  it("keeps optional Clear separate, required consumers without Clear, and locked consumers closed", () => {
    const clear = render().tree.find(node => node.type === "button" && node.props.children === "Clear date")!;
    invoke(clear, "onClick"); expect(change).toHaveBeenCalledExactlyOnceWith(""); change.mockClear();
    expect(render({ required: true }).tree.some(node => node.props?.children === "Clear date")).toBe(false);
    invoke(render({ disabled: true }).root, "onOpenChange", true);
    expect(render({ disabled: true }).root.props.open).toBe(false);
    expect(render({ disabled: true }).find("Arrival date choose year").props.disabled).toBe(true); expect(change).not.toHaveBeenCalled();
  });
  it.each(["Arrival date", "Departure date", "Business date", "Block arrival", "Date of birth"])("keeps explicit month/year labels for %s consumers", ariaLabel => {
    const result = render({ ariaLabel }); expect(result.find(`${ariaLabel} month`).type).toBe("select"); expect(result.find(`${ariaLabel} choose year`).type).toBe("button");
    expect(result.find(`${ariaLabel} year`)).toBeUndefined();
    openYears({ ariaLabel }); expect(render({ ariaLabel }).find(`${ariaLabel} year`).type).toBe("input");
  });
  it("shows only one visible caption and discloses twelve years without committing a date", () => {
    expect(render().calendar.props.hideNavigation).toBe(true);
    expect(render().calendar.props.classNames).toMatchObject({ month_caption: "sr-only" });
    openYears(); const tree = render();
    expect(tree.tree.filter(node => node.props?.["data-year"])).toHaveLength(12);
    invoke(tree.tree.find(node => node.props?.["data-year"] === 2028)!, "onClick");
    expect((render().calendar.props.month as Date).getFullYear()).toBe(2028);
    expect(render().find("Arrival date choose year").props["aria-expanded"]).toBe(false);
    expect(change).not.toHaveBeenCalled();
  });
  it("consumes the first Escape in year choices, restores caption focus, and leaves the date popover open", () => {
    invoke(render().root, "onOpenChange", true); openYears();
    const focus = vi.fn();
    const popup = { scrollTop: 220, querySelector: () => null };
    (render().find("Arrival date calendar").props.ref as { current: unknown }).current = popup;
    (render().find("Arrival date choose year").props.ref as { current: unknown }).current = { focus };
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    invoke(render().find("Arrival date calendar"), "onEscapeKeyDown", event);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(popup.scrollTop).toBe(0);
    expect(render().root.props.open).toBe(true); expect(render().find("Arrival date choose year").props["aria-expanded"]).toBe(false);
    event.preventDefault.mockClear(); invoke(render().find("Arrival date calendar"), "onEscapeKeyDown", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("bounds popup height without shrinking controls and scrolls a year error into view", () => {
    render(); openYears(); const tree = render();
    expect(tree.find("Arrival date calendar").props.style).toEqual({ maxHeight: "min(var(--radix-popover-content-available-height), calc(100dvh - 1.5rem))" });
    expect(tree.find("Arrival date calendar").props.className).toContain("overflow-y-auto");
    const popup = { scrollTop: 0, scrollHeight: 420, querySelector: () => null };
    (tree.find("Arrival date calendar").props.ref as { current: unknown }).current = popup;
    invoke(tree.find("Arrival date year"), "onChange", { target: { value: "0" } }); goYear(); render();
    expect(popup.scrollTop).toBe(420);
  });
  it.each(["0001-01-01", "9999-12-31"])("bounds year pages and month navigation at %s", value => {
    const props = { value }; render(props); openYears(props);
    const tree = render(props), years = tree.tree.filter(node => node.props?.["data-year"]);
    expect(years.every(node => Number(node.props["data-year"]) >= 1 && Number(node.props["data-year"]) <= 9999)).toBe(true);
    expect(tree.find(value.startsWith("0001") ? "Previous 12 years" : "Next 12 years").props.disabled).toBe(true);
    invoke(tree.find("Arrival date choose year"), "onClick");
    expect(render(props).find(value.startsWith("0001") ? "Previous month" : "Next month").props.disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
  });
  it("pages years without changing the current month and disables out-of-bounds choices", () => {
    const props = { min: "2025-03-15", max: "2030-10-20" }; render(props); openYears(props);
    const years = render(props).tree.filter(node => node.props?.["data-year"]);
    expect(years.find(node => node.props["data-year"] === 2024)?.props.disabled).toBe(true);
    expect(years.find(node => node.props["data-year"] === 2025)?.props.disabled).toBe(false);
    expect(render(props).find("Next 12 years").props.disabled).toBe(false);
    invoke(render(props).find("Next 12 years"), "onClick");
    expect((render(props).calendar.props.month as Date).getFullYear()).toBe(2026);
    expect(render(props).find("Next 12 years").props.disabled).toBe(true);
    expect(datePickerYearPage(9999)).toBe(9997); expect(datePickerYearPage(1)).toBe(1);
  });
  it("rebases open year choices when the authoritative value or bounds change", () => {
    render(); openYears(); render();
    const props = { value: "2050-01-01", min: "2052-03-15", max: "2054-10-20" };
    render(props); const tree = render(props);
    expect((tree.calendar.props.month as Date).getFullYear()).toBe(2052);
    expect(tree.tree.some(node => node.props?.["data-year"] === 2052)).toBe(true);
    expect(tree.find("Arrival date choose year").props["aria-expanded"]).toBe(true);
    expect(change).not.toHaveBeenCalled();
  });
});

describe("local date/year limits", () => {
  it.each(["0001-01-01", "0099-12-31", "0100-02-28", "1900-02-28", "2000-02-29", "2099-12-31", "9999-12-31"])("round-trips %s with four year digits", key => expect(toDateKey(date(key))).toBe(key));
  it.each(["0000-01-01", "10000-01-01", "1900-02-29", "2099-02-29"])("rejects %s", key => expect(parseDateKey(key)).toBeUndefined());
  it("crosses December/January and leap February without normalizing a chosen day", () => {
    expect(toDateKey(datePickerMonth(date("2027-01-31"), date("0001-01-01"), date("9999-12-31")))).toBe("2027-01-01");
    expect(toDateKey(datePickerYearMonth("2027", date("2028-02-29"), date("0001-01-01"), date("9999-12-31"))!)).toBe("2027-02-01");
  });
});
