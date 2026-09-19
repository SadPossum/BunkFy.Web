import { describe, expect, it } from "vitest";
import {
  guestCountryLabel,
  guestIdentitySummary,
  guestLanguageLabel,
} from "../src/features/guests/guestProfilePresentation";

describe("guest profile presentation", () => {
  it("turns stored ISO country codes into readable labels without hiding the code", () => {
    expect(guestCountryLabel("gb")).toBe("United Kingdom (GB)");
    expect(guestCountryLabel("  ")).toBeNull();
  });

  it("turns BCP 47 language tags into readable labels without hiding the tag", () => {
    expect(guestLanguageLabel("en-GB")).toBe("English (United Kingdom) (en-GB)");
    expect(guestLanguageLabel("not_a_tag")).toBe("not_a_tag");
  });

  it("omits unrecorded identity details from compact directory summaries", () => {
    expect(guestIdentitySummary({
      nationalityCountryCode: null,
      preferredLanguageTag: null,
    })).toEqual([]);
    expect(guestIdentitySummary({
      nationalityCountryCode: "VN",
      preferredLanguageTag: "vi",
    })).toEqual(["Vietnam (VN)", "Vietnamese (vi)"]);
  });
});
