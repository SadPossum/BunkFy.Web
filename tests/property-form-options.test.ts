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
});
