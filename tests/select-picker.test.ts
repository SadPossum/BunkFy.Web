import { describe, expect, it } from "vitest";
import {
  containPickerEscape,
  filterSelectOptions,
  normalizeSelectValue,
  nextEligibleOptionIndex,
  handleSelectPickerKey,
  type SelectPickerOption,
} from "../src/components/ui/SelectPicker";

const options: SelectPickerOption[] = [
  { value: "asia-ho-chi-minh", label: "Asia / Ho Chi Minh" },
  { value: "europe-moscow", label: "Europe / Moscow" },
  { value: "front-desk", label: "Front desk", description: "Reservations and guests" },
];

describe("select picker", () => {
  it("searches raw IANA values, accents and unordered tokens, ranking exact values first", () => {
    const zones = [
      { value: "Europe/London", label: "London", description: "United Kingdom", searchTerms: ["GB", "UK", "Britain"] },
      { value: "Europe/Paris", label: "Paris", description: "London travel office" },
      { value: "America/Sao_Paulo", label: "São Paulo" },
    ];
    expect(filterSelectOptions(zones, "Europe/London")[0]).toBe(zones[0]);
    expect(filterSelectOptions(zones, "London Europe")).toEqual([zones[0], zones[1]]);
    expect(filterSelectOptions(zones, "sao paulo")).toEqual([zones[2]]);
    expect(filterSelectOptions(zones, "GB")).toEqual([zones[0]]);
    expect(filterSelectOptions(zones, "Europe/Paris")[0]).toBe(zones[1]);
  });

  it("skips disabled options in either direction and safely handles empty/stale lists", () => {
    const choices = [{ value: "x", label: "Unavailable", disabled: true }, ...options, { value: "y", label: "Unavailable", disabled: true }];
    expect(nextEligibleOptionIndex(choices, -1, 1)).toBe(1);
    expect(nextEligibleOptionIndex(choices, 1, -1)).toBe(1);
    expect(nextEligibleOptionIndex(choices, -1, -1)).toBe(3);
    expect(nextEligibleOptionIndex(choices, 3, 1)).toBe(3);
    expect(nextEligibleOptionIndex([], 10, -1)).toBe(-1);
    expect(nextEligibleOptionIndex([choices[0]], -1, 1)).toBe(-1);
  });

  it("contains Enter without submitting or choosing disabled/no-result/IME options", () => {
    for (const [choices, index, composing, keyCode] of [
      [[], -1, false, 13],
      [[{ value: "x", label: "Unavailable", disabled: true }], 0, false, 13],
      [options, 0, true, 13],
      [options, 0, false, 229],
    ] as const) {
      let prevented = false; let stopped = false; const selected: string[] = [];
      handleSelectPickerKey({ key: "Enter", preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; }, nativeEvent: { isComposing: composing, keyCode } }, [...choices], index,
        { select: (value) => selected.push(value), close: () => undefined, setActive: () => undefined });
      expect({ prevented, stopped, selected }).toEqual({ prevented: true, stopped: true, selected: [] });
    }
  });

  it("selects enabled Enter, contains Escape, and preserves Home/End text editing", () => {
    const selected: string[] = []; let closed = 0; let active = -1;
    const actions = { select: (value: string) => selected.push(value), close: () => { closed++; }, setActive: (index: number) => { active = index; } };
    for (const key of ["Enter", "Escape", "ArrowDown"]) {
      handleSelectPickerKey({ key, preventDefault: () => undefined, stopPropagation: () => undefined, nativeEvent: { isComposing: false } }, options, 0, actions);
    }
    expect(selected).toEqual([options[0].value]); expect(closed).toBe(1); expect(active).toBe(1);
    for (const key of ["Home", "End"]) {
      let prevented = false;
      handleSelectPickerKey({ key, preventDefault: () => { prevented = true; }, stopPropagation: () => undefined, nativeEvent: { isComposing: false } }, options, 1, actions);
      expect(prevented).toBe(false); expect(active).toBe(1);
    }
  });
  it("matches labels without case sensitivity", () => {
    expect(filterSelectOptions(options, "ho chi minh")).toEqual([options[0]]);
  });

  it("matches option descriptions", () => {
    expect(filterSelectOptions(options, "GUESTS")).toEqual([options[2]]);
  });

  it("preserves all options for an empty search", () => {
    expect(filterSelectOptions(options, "  ")).toBe(options);
  });

  it("keeps an empty selection controlled", () => {
    expect(normalizeSelectValue(undefined)).toBe("");
    expect(normalizeSelectValue("")).toBe("");
    expect(normalizeSelectValue("front-desk")).toBe("front-desk");
  });

  it("contains Escape inside an open picker", () => {
    let stopped = false;

    containPickerEscape({ stopPropagation: () => { stopped = true; } });

    expect(stopped).toBe(true);
  });
});
