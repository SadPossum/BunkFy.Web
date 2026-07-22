import { describe, expect, it } from "vitest";
import {
  filterSelectOptions,
  normalizeSelectValue,
  type SelectPickerOption,
} from "../src/components/ui/SelectPicker";

const options: SelectPickerOption[] = [
  { value: "asia-ho-chi-minh", label: "Asia / Ho Chi Minh" },
  { value: "europe-moscow", label: "Europe / Moscow" },
  { value: "front-desk", label: "Front desk", description: "Reservations and guests" },
];

describe("select picker", () => {
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
});
