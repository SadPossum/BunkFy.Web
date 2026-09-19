import { describe, expect, it } from "vitest";
import type { Property, PropertyTimeZoneCatalogItem } from "../src/api/types";
import {
  formatUtcOffset,
  initialPropertyTimeZoneTarget,
  propertyTimeZoneHealthCopy,
  propertyTimeZoneOption,
  propertyTimeZoneRequiresConfirmation,
  withStoredTimeZoneOption,
  propertyTimeZoneSearchTerms,
} from "../src/features/properties/propertyTimeZoneCatalog";
import { filterSelectOptions } from "../src/components/ui/SelectPicker";

describe("property time-zone catalogue", () => {
  it("finds server-supported London by country names, codes, city and exact IANA ID", () => {
    const london = propertyTimeZoneOption(timeZone({ timeZoneId: "Europe/London", countries: [{ code: "GB", name: "Britain (UK)" }], comment: "England and Scotland" }));
    for (const search of ["UK", "GB", "Britain", "United Kingdom", "London", "Europe London", "Europe/London", "England"]) {
      expect(filterSelectOptions([london], search), search).toEqual([london]);
    }
    expect(filterSelectOptions([london], "no-such-hostel-zone")).toEqual([]);
  });

  it("adds localized long/short country names without inventing zones or failing on locale metadata", () => {
    const zone = timeZone({ timeZoneId: "Europe/London", countries: [{ code: "GB", name: "Britain (UK)" }, { code: "IE", name: "Ireland" }] });
    expect(propertyTimeZoneSearchTerms(zone, ["ru", "de"])).toEqual(expect.arrayContaining(["GB", "IE", "UK", "United Kingdom", "Великобритания", "Vereinigtes Königreich"]));
    expect(() => propertyTimeZoneSearchTerms(zone, ["invalid_locale"])).not.toThrow();
    expect(propertyTimeZoneOption({ ...zone, runtimeAvailable: false }).disabled).toBe(true);
  });

  it("matches short country codes as whole tokens, not substrings in other countries", () => {
    const zones = [
      propertyTimeZoneOption(timeZone({ timeZoneId: "Australia/Sydney", countries: [{ code: "AU", name: "Australia" }] })),
      propertyTimeZoneOption(timeZone({ timeZoneId: "Europe/Moscow", countries: [{ code: "RU", name: "Russia" }] })),
      propertyTimeZoneOption(timeZone({ timeZoneId: "America/New_York", countries: [{ code: "US", name: "United States" }] })),
      propertyTimeZoneOption(timeZone({ timeZoneId: "Europe/London", countries: [{ code: "GB", name: "Britain (UK)" }] })),
    ];
    expect(filterSelectOptions(zones, "US")).toEqual([zones[2]]);
    expect(filterSelectOptions(zones, "USA")).toEqual([zones[2]]);
    expect(filterSelectOptions(zones, "GB")).toEqual([zones[3]]);
    expect(filterSelectOptions(zones, "UK")).toEqual([zones[3]]);
    expect(filterSelectOptions(zones, "syd")).toEqual([zones[0]]);
    expect(filterSelectOptions(zones, "new US")).toEqual([zones[2]]);
    const offsets = [{ value: "plus", label: "UTC+05:00" }, { value: "minus", label: "UTC-05:00" }];
    expect(filterSelectOptions(offsets, "UTC-05")).toEqual([offsets[1]]);
  });
  it("presents canonical server metadata and disables runtime-unavailable zones", () => {
    const option = propertyTimeZoneOption(timeZone({
      timeZoneId: "Europe/Paris",
      utcOffsetMinutes: 120,
      countries: [{ code: "FR", name: "France" }],
    }));
    const unavailable = propertyTimeZoneOption(timeZone({
      timeZoneId: "Antarctica/Troll",
      runtimeAvailable: false,
    }));

    expect(option).toEqual(expect.objectContaining({
      value: "Europe/Paris",
      label: "Europe / Paris",
      description: "UTC+02:00 · France",
      disabled: false,
    }));
    expect(unavailable.description).toContain("Unavailable on this server");
    expect(unavailable.disabled).toBe(true);
  });

  it("targets an alias's canonical identity without requesting semantic confirmation", () => {
    const property = propertyFixture({
      timeZoneId: "US/Eastern",
      timeZoneStatus: "alias",
      canonicalTimeZoneId: "America/New_York",
    });

    expect(initialPropertyTimeZoneTarget(property)).toBe("America/New_York");
    expect(propertyTimeZoneRequiresConfirmation(property, "America/New_York")).toBe(false);
    expect(propertyTimeZoneRequiresConfirmation(property, "Europe/Paris")).toBe(true);
  });

  it("keeps an unknown stored value visible while requiring a selectable replacement", () => {
    const property = propertyFixture({
      timeZoneId: "Legacy/Hostel",
      timeZoneStatus: "legacy",
      canonicalTimeZoneId: null,
    });
    const options = withStoredTimeZoneOption([], property);

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ value: "Legacy/Hostel", disabled: true });
    expect(propertyTimeZoneRequiresConfirmation(property, "Europe/Paris")).toBe(true);
    expect(propertyTimeZoneHealthCopy("runtime-unavailable")).toMatchObject({
      severity: "error",
      label: "Time zone unavailable on this server",
    });
  });

  it("formats positive, negative, and half-hour offsets", () => {
    expect(formatUtcOffset(0)).toBe("UTC+00:00");
    expect(formatUtcOffset(-300)).toBe("UTC-05:00");
    expect(formatUtcOffset(330)).toBe("UTC+05:30");
  });
});

function timeZone(
  overrides: Partial<PropertyTimeZoneCatalogItem>,
): PropertyTimeZoneCatalogItem {
  return {
    timeZoneId: "Etc/UTC",
    countries: [],
    comment: null,
    utcOffsetMinutes: 0,
    runtimeAvailable: true,
    ...overrides,
  };
}

function propertyFixture(overrides: Partial<Property>): Property {
  return {
    propertyId: "property-a",
    name: "Harbour House",
    code: "HBR",
    timeZoneId: "Etc/UTC",
    timeZoneStatus: "canonical",
    canonicalTimeZoneId: "Etc/UTC",
    timeZoneCatalogVersion: "TZDB: 2026c",
    timeZoneObservedAtUtc: "2026-08-25T00:00:00Z",
    timeZoneCorrectionAllowed: false,
    status: "active",
    processingStatus: "unconfigured",
    version: 1,
    ...overrides,
  };
}
