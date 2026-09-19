import { readFileSync } from "node:fs";
import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectPicker, filterSelectOptions } from "../src/components/ui/SelectPicker";
import { NationalityPicker } from "../src/features/guests/NationalityPicker";
import { nationalityCountryCodes, nationalityOptions, normalizeNationalityValue } from "../src/features/guests/nationalityOptions";

// Actual wrapper and existing searchable control with hook doubles, not native layout/focus proof.
const h = vi.hoisted(() => ({ cursor: 0, ids: 0, slots: [] as unknown[], effects: [] as (() => void)[], dirty: false }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(), useId: () => `nationality-${h.ids++}`,
  useRef: () => ({ current: null }), useEffect: (callback: () => void) => h.effects.push(callback),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
    return [h.slots[i], (value: unknown) => { const next = typeof value === "function" ? value(h.slots[i]) : value; if (!Object.is(next, h.slots[i])) { h.slots[i] = next; h.dirty = true; } }]; },
}));
type Node = ReactElement<Record<string, unknown>>;
type Props = ComponentProps<typeof NationalityPicker>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children)]; }
function render(props: Props) {
  for (let pass = 0; pass < 5; pass++) {
    h.cursor = 0; h.ids = 0; h.dirty = false; h.effects = [];
    const outer = nodes(NationalityPicker(props));
    const picker = outer.find(node => node.type === SelectPicker) as ReactElement<ComponentProps<typeof SelectPicker>>;
    const entry = SelectPicker(picker.props);
    const tree = nodes((entry.type as (p: typeof entry.props) => unknown)(entry.props));
    h.effects.forEach(effect => effect());
    if (!h.dirty) return { outer, tree, picker: picker.props };
  }
  throw new Error("Picker did not settle");
}
const input = (p: Props) => render(p).tree.find(n => n.props.role === "combobox")!;
const popup = (p: Props) => render(p).tree.find(n => typeof n.props.onOpenChange === "function")!;
function search(p: Props, value: string) { (input(p).props.onChange as (e: unknown) => void)({ target: { value } }); }
function key(p: Props, name: string) { const event = { key: name, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() }; (input(p).props.onKeyDown as (e: typeof event) => void)(event); return event; }
beforeEach(() => { h.slots = []; vi.stubGlobal("navigator", { language: "en-GB" }); });
afterEach(() => vi.unstubAllGlobals());

describe("nationality catalog and wire value", () => {
  it("offers unique two-letter suggestions without treating the catalog as a Guest whitelist", () => {
    expect(nationalityCountryCodes).toHaveLength(249); expect(new Set(nationalityCountryCodes).size).toBe(249);
    expect(nationalityCountryCodes.every(code => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect(nationalityOptions("zz")[0]).toMatchObject({ value: "ZZ", label: "Stored code (ZZ)", disabled: false });
    expect(nationalityOptions("XK")[0]).toMatchObject({ value: "XK", disabled: false });
    expect(nationalityOptions("GB").filter(option => option.value === "GB")).toHaveLength(1);
  });
  it.each([["United Kingdom", "GB"], ["UK", "GB"], ["GB", "GB"], ["USA", "US"], ["United States", "US"], ["Deutschland", "DE"], ["Germany", "DE"], ["UAE", "AE"]])("finds %s by localized/English name or canonical alias", (search, expected) => {
    expect(filterSelectOptions(nationalityOptions(null, ["de"]), search)[0]?.value).toBe(expected);
  });
  it("labels in the current locale, keeps English search, and degrades safely without DisplayNames", () => {
    expect(nationalityOptions(null, ["fr"]).find(option => option.value === "DE")?.label).toBe("Allemagne (DE)");
    expect(filterSelectOptions(nationalityOptions(null, ["fr"]), "Germany")[0]?.value).toBe("DE");
    expect(nationalityOptions(null, ["invalid_locale"]).find(option => option.value === "GB")?.label).toBe("United Kingdom (GB)");
    vi.stubGlobal("Intl", { ...Intl, DisplayNames: undefined }); expect(nationalityOptions(null).find(option => option.value === "GB")?.label).toBe("GB");
  });
  it.each([[null, ""], [undefined, ""], ["", ""], [" gb ", "GB"], ["ZZ", "ZZ"]])("normalizes %s without inference", (value, expected) => { expect(normalizeNationalityValue(value)).toBe(expected); });
});

describe("actual shared nationality control", () => {
  it("keeps opening/searching local, commits canonical Enter without submitting, and carries a named form value", () => {
    const change = vi.fn(), p: Props = { value: "ZZ", onChange: change, name: "nationalityCountryCode" };
    (popup(p).props.onOpenChange as (value: boolean) => void)(true); search(p, "UK");
    expect(change).not.toHaveBeenCalled(); expect(render(p).tree.filter(n => n.props.role === "option")).toHaveLength(1);
    const event = key(p, "Enter"); expect(event.preventDefault).toHaveBeenCalled(); expect(event.stopPropagation).toHaveBeenCalled(); expect(change).toHaveBeenCalledExactlyOnceWith("GB");
    p.value = "GB"; expect(popup(p).props.open).toBe(false);
    expect(render(p).tree.find(n => n.type === "input" && n.props.name === "nationalityCountryCode")?.props.value).toBe("GB");
  });
  it("contains no-result Enter and Escape without changing the value", () => {
    const p: Props = { value: "US", onChange: vi.fn() }; (popup(p).props.onOpenChange as (value: boolean) => void)(true);
    search(p, "no such nationality name"); expect(render(p).tree.some(n => n.props.role === "status" && n.props.children === "No matching options")).toBe(true);
    key(p, "Enter"); key(p, "Escape"); expect(p.onChange).not.toHaveBeenCalled(); expect(popup(p).props.open).toBe(false);
  });
  it("clears to empty and keeps its own button mounted; a second clear remains a no-op", () => {
    const p: Props = { value: "ZZ", onChange: value => { p.value = value; } };
    const clear = () => render(p).outer.find(n => n.props["aria-label"] === "Clear nationality")!;
    expect(clear().props.type).toBe("button"); (clear().props.onClick as () => void)(); expect(p.value).toBe("");
    expect(clear().props.disabled).toBe(false); expect(clear().props["aria-disabled"]).toBe(true); (clear().props.onClick as () => void)(); expect(p.value).toBe("");
  });
  it("explicit disabled closes an open portal and blocks selection/clear without losing the stored value", () => {
    const p: Props = { value: "ZZ", onChange: vi.fn() }; (popup(p).props.onOpenChange as (value: boolean) => void)(true);
    p.disabled = true; const view = render(p); expect(popup(p).props.open).toBe(false); expect(view.picker.disabled).toBe(true);
    view.picker.onValueChange("GB"); (view.outer.find(n => n.props["aria-label"] === "Clear nationality")!.props.onClick as () => void)(); expect(p.onChange).not.toHaveBeenCalled();
    p.disabled = false; expect(render(p).picker.value).toBe("ZZ");
  });
  it("keeps all three nationality owners wired with explicit portal authority alongside the new Languages field", () => {
    const read = (file: string) => readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
    const guests = read("features/guests/GuestsPage.tsx"), reservation = read("features/reservations/CreateReservationModal.tsx"), correction = read("features/data-rights/GuestCorrectionForm.tsx");
    expect(guests).toContain('<NationalityPicker name="nationalityCountryCode" value={value} onChange={setValue} disabled={disabled}');
    expect(guests).toContain('defaultValue={guest?.nationalityCountryCode} disabled={fieldsDisabled}');
    expect(guests).toContain('const fieldsDisabled = !authorityCurrent || submitting || Boolean(recovery);');
    expect(reservation).toContain('nationalityDisabled={mutation.isPending || !mayLoadInventory || !canCreateGuests || !canManageGuests}');
    expect(reservation).toContain('value={nationalityCountryCode} onChange={onNationalityChange} disabled={nationalityDisabled}');
    expect(correction).toContain('disabled={fieldsDisabled}');
    for (const owner of [guests, reservation, correction]) expect(owner).toContain('<LanguagePicker');
  });
});
