import { describe, expect, it } from "vitest";
import {
  resolveGuestCreateAttempt,
  type GuestCreatePayload,
} from "../src/features/guests/guestCreateAttempt";

const payload: GuestCreatePayload = {
  displayName: "Maya Chen",
  legalName: "Maya Q. Chen",
  email: "maya@example.test",
  phone: "+44 20 1234 5678",
  dateOfBirth: "1990-02-03",
  nationalityCountryCode: "GB",
  preferredLanguageTag: "en-GB",
  notes: "Prefers a lower bunk.",
};

describe("guest create attempt", () => {
  it("reuses one operation id for a normalized equivalent retry", () => {
    const first = resolveGuestCreateAttempt(null, "property-1", payload, () => "operation-1");
    const retry = resolveGuestCreateAttempt(
      first,
      "property-1",
      {
        ...payload,
        displayName: "  Maya Chen  ",
        email: " MAYA@EXAMPLE.TEST ",
        nationalityCountryCode: " gb ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("allocates a new operation id when the profile or property changes", () => {
    const first = resolveGuestCreateAttempt(null, "property-1", payload, () => "operation-1");
    const changedProfile = resolveGuestCreateAttempt(
      first,
      "property-1",
      { ...payload, displayName: "Different Guest" },
      () => "operation-2",
    );
    const changedProperty = resolveGuestCreateAttempt(
      first,
      "property-2",
      payload,
      () => "operation-3",
    );

    expect(changedProfile.operationId).toBe("operation-2");
    expect(changedProperty.operationId).toBe("operation-3");
  });
});
