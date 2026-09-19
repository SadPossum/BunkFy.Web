import { describe, expect, it } from "vitest";
import {
  defaultPropertyStayRange,
  propertyDateKey,
  shiftDateKey,
  validStayDateRange,
} from "../src/app/propertyDate";

describe("property dates", () => {
  it("derives defaults from the property's date instead of the operator device date", () => {
    const instant = new Date("2026-08-25T23:30:00Z");

    expect(propertyDateKey("Pacific/Kiritimati", instant)).toBe("2026-08-26");
    expect(defaultPropertyStayRange("Pacific/Kiritimati", instant)).toEqual({
      arrival: "2026-08-27",
      departure: "2026-08-29",
    });
    expect(propertyDateKey("America/Adak", instant)).toBe("2026-08-25");
  });

  it("shifts date keys without depending on the runtime time zone", () => {
    expect(shiftDateKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDateKey("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("rejects unsupported zones and invalid stay ranges", () => {
    expect(defaultPropertyStayRange("Mars/Olympus", new Date())).toBeNull();
    expect(validStayDateRange({ arrival: "2026-08-10", departure: "2026-08-10" })).toBe(false);
    expect(validStayDateRange({ arrival: "2026-08-10", departure: "2026-08-11" })).toBe(true);
    expect(validStayDateRange({ arrival: "2026-02-30", departure: "2026-03-02" })).toBe(false);
    expect(validStayDateRange({ arrival: "2026-13-01", departure: "2027-01-02" })).toBe(false);
  });
});
