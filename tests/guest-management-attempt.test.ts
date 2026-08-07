import { describe, expect, it } from "vitest";
import type { GuestCreatePayload } from "../src/features/guests/guestCreateAttempt";
import {
  resolveGuestArchiveAttempt,
  resolveGuestUpdateAttempt,
} from "../src/features/guests/guestManagementAttempt";

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

describe("guest management attempt", () => {
  it("reuses one update operation id for a normalized equivalent retry", () => {
    const first = resolveGuestUpdateAttempt(
      null,
      "property-1",
      "guest-1",
      4,
      payload,
      () => "operation-1",
    );
    const retry = resolveGuestUpdateAttempt(
      first,
      "property-1",
      "guest-1",
      4,
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

  it("rotates an update operation id when request identity changes", () => {
    const first = resolveGuestUpdateAttempt(
      null,
      "property-1",
      "guest-1",
      4,
      payload,
      () => "operation-1",
    );

    expect(resolveGuestUpdateAttempt(first, "property-1", "guest-1", 5, payload, () => "operation-2").operationId).toBe("operation-2");
    expect(resolveGuestUpdateAttempt(first, "property-1", "guest-2", 4, payload, () => "operation-3").operationId).toBe("operation-3");
    expect(resolveGuestUpdateAttempt(first, "property-1", "guest-1", 4, { ...payload, notes: "Changed" }, () => "operation-4").operationId).toBe("operation-4");
  });

  it("reuses archive retries and separates them from update attempts", () => {
    const archive = resolveGuestArchiveAttempt(
      null,
      "property-1",
      "guest-1",
      4,
      () => "archive-1",
    );
    const retry = resolveGuestArchiveAttempt(
      archive,
      "property-1",
      "guest-1",
      4,
      () => "archive-2",
    );
    const update = resolveGuestUpdateAttempt(
      archive,
      "property-1",
      "guest-1",
      4,
      payload,
      () => "update-1",
    );

    expect(retry).toBe(archive);
    expect(update.operationId).toBe("update-1");
  });
});
