import { describe, expect, it } from "vitest";
import {
  createDefaultBedLabels,
  duplicateBedLabel,
  timeZoneDescription,
  timeZoneLabel,
} from "../src/features/properties/propertyFormOptions";

describe("property form options", () => {
  it("formats IANA time zone identifiers for the picker", () => {
    expect(timeZoneLabel("Asia/Ho_Chi_Minh")).toBe("Asia / Ho Chi Minh");
  });

  it("adds human search terms for legacy IANA names", () => {
    expect(timeZoneDescription("Asia/Saigon")).toBe("Ho Chi Minh City, Vietnam");
  });

  it("creates numbered bed labels after existing numbers", () => {
    expect(createDefaultBedLabels(3, ["1", "3", "Window"])).toEqual(["2", "4", "5"]);
  });

  it("preserves custom bed labels when the count grows", () => {
    expect(createDefaultBedLabels(3, ["1"], ["Lower", "Upper"])).toEqual(["Lower", "Upper", "2"]);
  });

  it("detects duplicate labels after trimming", () => {
    expect(duplicateBedLabel(["1", " Window ", "Window"])).toBe("Window");
    expect(duplicateBedLabel(["1", "2"])).toBeNull();
  });

  it.each([1, 50, 51, 100])("prepares exactly %i distinct customizable labels", (count) => {
    const labels = createDefaultBedLabels(count, ["1", "402-A"], ["Window"]);
    expect(labels).toHaveLength(count);
    expect(labels[0]).toBe("Window");
    expect(new Set(labels).size).toBe(count);
    expect(labels).not.toContain("1");
  });
  it("bounds invalid counts and preserves custom labels through shrinking and regrowth", () => {
    for (const count of [0, -1, Number.NaN]) expect(createDefaultBedLabels(count, [])).toHaveLength(1);
    expect(createDefaultBedLabels(101, [])).toHaveLength(100);
    expect(createDefaultBedLabels(Infinity, [])).toHaveLength(100);
    expect(createDefaultBedLabels(2.8, [])).toHaveLength(2);
    const smaller = createDefaultBedLabels(1, [], ["Window", "Door"]);
    expect(createDefaultBedLabels(3, [], smaller)).toEqual(["Window", "1", "2"]);
  });
});
