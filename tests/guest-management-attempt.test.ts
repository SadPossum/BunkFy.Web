import { describe, expect, it } from "vitest";
import type { GuestCreatePayload } from "../src/features/guests/guestCreateAttempt";
import {
  resolveGuestArchiveAttempt,
  resolveGuestUpdateAttempt,
  guestSaveResultUncertain,
  guestUpdateRecoveryAllowed,
} from "../src/features/guests/guestManagementAttempt";
import { ApiError } from "../src/api/client";
import type { GuestProfile } from "../src/api/types";

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
  it.each([[], ["EN-gB", "sr-Latn", "unknown-١"]].map(languageTags => ({ languageTags })))("retains immutable exact update bytes including collection $languageTags across a hidden-success retry", ({ languageTags }) => {
    const values = { ...payload, languageTags };
    const first = resolveGuestUpdateAttempt(null, "p", "g", 1, values, () => "original-operation");
    const body = first.requestBody;
    const decoded = JSON.parse(body);
    expect(decoded).toEqual({ ...values, operationId: "original-operation", expectedVersion: 1 });
    expect(Object.isFrozen(first)).toBe(true);
    values.languageTags = ["changed"];
    expect(first.requestBody).toBe(body);
    const equivalent = resolveGuestUpdateAttempt(first, "p", "g", 1, { ...payload, languageTags: [...decoded.languageTags].reverse() }, () => "must-not-allocate");
    expect(equivalent).toBe(first);
    expect(equivalent.requestBody).toBe(body);
  });
  it("permits only exact recovery with current identity/status/authority, without normal version equality", () => {
    const attempt = resolveGuestUpdateAttempt(null, "p", "g", 1, { ...payload, languageTags: [] }, () => "operation");
    const evidence = { propertyId: "p", guestId: "g", permissionsCurrent: true, mayRead: true, mayManage: true,
      guestCurrent: true, guest: { guestId: "g", status: 1, version: 2 } as GuestProfile };
    expect(guestUpdateRecoveryAllowed(attempt, evidence)).toBe(true);
    expect(guestUpdateRecoveryAllowed(attempt, { ...evidence, guest: { ...evidence.guest, version: 1 } })).toBe(true);
    for (const change of [{ propertyId: "other" }, { guestId: "other" }, { permissionsCurrent: false }, { mayRead: false }, { mayManage: false }, { guestCurrent: false }, { guest: null },
      { guest: { ...evidence.guest, guestId: "other" } }, { guest: { ...evidence.guest, status: 2 as const } }, { guest: { ...evidence.guest, version: 0 } }]) {
      expect(guestUpdateRecoveryAllowed(attempt, { ...evidence, ...change })).toBe(false);
    }
    expect(guestUpdateRecoveryAllowed(null, evidence)).toBe(false);
    expect(JSON.parse(attempt.requestBody)).toMatchObject({ expectedVersion: 1, languageTags: [], operationId: "operation" });
  });
  it.each([0, 408, 500, 502, 503, 504])("retains uncertainty after status %i", status => {
    expect(guestSaveResultUncertain(new ApiError("controlled", status))).toBe(true);
  });
  it.each([400, 401, 403, 404, 409, 410, 422, 429])("does not offer uncertain retry for definitive status %i", status => {
    expect(guestSaveResultUncertain(new ApiError("controlled", status))).toBe(false);
  });
  it("treats a transport failure as uncertain, never as a backend receipt", () => {
    expect(guestSaveResultUncertain(new TypeError("network unavailable"))).toBe(true);
  });
  it.each(["ZZ", null])("keeps %s nationality and all other update fields under the same exact revision/operation", nationalityCountryCode => {
    const values = { ...payload, nationalityCountryCode };
    const first = resolveGuestUpdateAttempt(null, "p", "g", 4, values, () => "first");
    const retry = resolveGuestUpdateAttempt(first, "p", "g", 4, { ...values, nationalityCountryCode: nationalityCountryCode?.toLowerCase() ?? "" }, () => "second");
    expect(retry).toBe(first); const fingerprint = JSON.parse(first.fingerprint);
    expect(fingerprint).toMatchObject({ guestId: "g", expectedVersion: 4 });
    expect(JSON.parse(fingerprint.profile)).toMatchObject({ nationalityCountryCode, preferredLanguageTag: payload.preferredLanguageTag });
  });
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
