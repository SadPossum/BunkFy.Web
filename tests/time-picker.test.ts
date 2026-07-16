import { describe, expect, it } from "vitest";
import {
  formatTimeValue,
  parseTimeValue,
  shiftTimeParts,
  timePartsToValue,
} from "../src/components/ui/TimePicker";

describe("time picker", () => {
  it("parses a stored 24-hour value for a 12-hour picker", () => {
    expect(parseTimeValue("23:59", true)).toEqual({
      hour: "11",
      minute: "59",
      period: "PM",
    });
  });

  it("converts midnight and noon without ambiguity", () => {
    expect(timePartsToValue({ hour: "12", minute: "05", period: "AM" }, true)).toBe("00:05");
    expect(timePartsToValue({ hour: "12", minute: "05", period: "PM" }, true)).toBe("12:05");
  });

  it("rejects incomplete and out-of-range input", () => {
    expect(timePartsToValue({ hour: "", minute: "15", period: "PM" }, true)).toBeNull();
    expect(timePartsToValue({ hour: "13", minute: "15", period: "PM" }, true)).toBeNull();
    expect(timePartsToValue({ hour: "11", minute: "60", period: "PM" }, true)).toBeNull();
  });

  it("steps minutes across the hour and period boundary", () => {
    expect(shiftTimeParts({ hour: "11", minute: "59", period: "PM" }, 5, true)).toEqual({
      hour: "12",
      minute: "04",
      period: "AM",
    });
  });

  it("formats both supported clock styles", () => {
    expect(formatTimeValue("15:30", true)).toBe("03:30 PM");
    expect(formatTimeValue("15:30", false)).toBe("15:30");
  });
});
