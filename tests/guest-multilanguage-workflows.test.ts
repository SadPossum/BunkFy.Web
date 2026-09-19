import { describe, expect, it } from "vitest";
import type { DataRightsCorrectionExecutionDetails, GuestProfile } from "../src/api/types";
import { guestCreateFingerprint, resolveGuestCreateAttempt, type GuestCreatePayload } from "../src/features/guests/guestCreateAttempt";
import { resolveGuestUpdateAttempt } from "../src/features/guests/guestManagementAttempt";
import { guestLanguageIdentity, guestLanguagePayload } from "../src/features/guests/guestLanguageSelection";
import { guestIdentitySummary, guestLanguageLabels } from "../src/features/guests/guestProfilePresentation";
import { buildGuestCorrectionRequest, guestCorrectionChanged, guestCorrectionValues } from "../src/features/data-rights/dataRightsCorrectionWorkflow";
import { guestRecordPayloadFromBooking, resolveReservationGuestRecordAttempt } from "../src/features/reservations/guestRecordWorkflow";

const payload: GuestCreatePayload = { displayName: "QA Multilingual Guest", legalName: null, email: null,
  phone: null, dateOfBirth: null, nationalityCountryCode: "GB", preferredLanguageTag: null, notes: null };
const guest = { ...payload, guestId: "guest-1", originPropertyId: "property-1", version: 4,
  preferredLanguageTag: "EN-gB", languageTags: ["EN-gB", "fr", "sr-Latn", "x-legacy"] } as GuestProfile;
const execution = { executionId: "claim-1", caseId: "case-1", approvalRevision: 7,
  subject: { recordVersion: 4 } } as DataRightsCorrectionExecutionDetails;

describe("Guest multilingual consumer mappings", () => {
  it.each([[], ["en"], ["en", "fr"], ["en", "fr", "de", "ja", "ru", "es", "pt", "it", "sr-Latn", "sr-Cyrl", "zh-Hant", "x-legacy"]].map(languageTags => ({ languageTags })))(
    "carries explicit selections without inventing preference: $languageTags", ({ languageTags }) => {
      const selected = guestLanguagePayload(languageTags);
      expect(selected.ok).toBe(true);
      if (!selected.ok) return;
      const profile = guestRecordPayloadFromBooking({ primaryGuestName: payload.displayName, email: null, phone: null }, selected);
      expect(profile.languageTags).toEqual(selected.languageTags);
      expect(profile.preferredLanguageTag).toBeNull();
      expect(JSON.parse(guestCreateFingerprint("property-1", profile)).languageTags).toBe(JSON.stringify(selected.languageTags.map(guestLanguageIdentity)));
    });
  it("keeps the exact existing preference while its identity remains selected, without mutating the source", () => {
    const before = structuredClone(guest);
    const values = guestCorrectionValues(guest);
    const request = buildGuestCorrectionRequest(guest, execution, { ...values, languageTags: [...values.languageTags, "ja"] });
    expect(request.preferredLanguageTag).toBe("EN-gB");
    expect(request.languageTags).toEqual(["EN-gB", "fr", "ja", "sr-Latn", "x-legacy"]);
    expect(request).toMatchObject({ idempotencyKey: "claim-1", caseId: "case-1", approvalRevision: 7, expectedVersion: 4 });
    expect(guest).toEqual(before);
  });
  it("clears preference when removed, never promoting another selection", () => {
    const values = guestCorrectionValues(guest);
    expect(buildGuestCorrectionRequest(guest, execution, { ...values, languageTags: ["fr"] }))
      .toMatchObject({ preferredLanguageTag: null, languageTags: ["fr"] });
    expect(buildGuestCorrectionRequest(guest, execution, { ...values, languageTags: [] }))
      .toMatchObject({ preferredLanguageTag: null, languageTags: [] });
  });
  it("detects actual correction set changes, not reorder or ASCII case", () => {
    const values = guestCorrectionValues(guest);
    expect(guestCorrectionChanged(guest, values)).toBe(false);
    expect(guestCorrectionChanged(guest, { ...values, languageTags: ["X-LEGACY", "sr-latn", "FR", "en-GB"] })).toBe(false);
    expect(guestCorrectionChanged(guest, { ...values, languageTags: ["EN-gB", "fr"] })).toBe(true);
    expect(guestCorrectionChanged(guest, { ...values, languageTags: [] })).toBe(true);
  });
  it("derives legacy absent/null responses but respects an explicit empty array", () => {
    expect(guestCorrectionValues({ ...guest, languageTags: undefined }).languageTags).toEqual(["EN-gB"]);
    expect(guestCorrectionValues({ ...guest, languageTags: null }).languageTags).toEqual(["EN-gB"]);
    expect(guestCorrectionValues({ ...guest, languageTags: [] }).languageTags).toEqual([]);
  });
  it("shows all regional, script and unknown selections in readable profile and directory output", () => {
    const labels = guestLanguageLabels(guest);
    expect(labels).toHaveLength(4);
    expect(labels[0]).toContain("EN-gB");
    expect(labels[2]).toContain("sr-Latn");
    expect(labels[3]).toBe("x-legacy");
    expect(guestIdentitySummary(guest)).toHaveLength(5);
    expect(guestLanguageLabels({ ...guest, languageTags: [] })).toEqual([]);
  });
  it("refuses an invalid or thirteenth value before a retry fingerprint can be created", () => {
    expect(() => guestCreateFingerprint("property-1", { ...payload, languageTags: ["not_a_tag"] })).toThrow();
    expect(() => guestCreateFingerprint("property-1", { ...payload, languageTags: Array.from({ length: 13 }, (_, i) => `x-${i}`) })).toThrow();
  });
});

describe("Guest multilingual retry identity", () => {
  it("reuses create requests with equivalent case/order and allocates for changed selection", () => {
    const first = resolveGuestCreateAttempt(null, "property-1", { ...payload, languageTags: ["fr", "en"] }, () => "first");
    expect(resolveGuestCreateAttempt(first, "property-1", { ...payload, languageTags: ["EN", "FR"] }, () => "second")).toBe(first);
    expect(resolveGuestCreateAttempt(first, "property-1", { ...payload, languageTags: ["en"] }, () => "second").operationId).toBe("second");
  });
  it("resolves create omission/null to the legacy scalar or empty set", () => {
    for (const preferredLanguageTag of [null, "EN-gB"]) {
      const legacy = { ...payload, preferredLanguageTag };
      const first = resolveGuestCreateAttempt(null, "property-1", legacy, () => "first");
      expect(resolveGuestCreateAttempt(first, "property-1", { ...legacy, languageTags: null }, () => "second")).toBe(first);
      expect(resolveGuestCreateAttempt(first, "property-1", { ...legacy, languageTags: preferredLanguageTag ? [preferredLanguageTag] : [] }, () => "second")).toBe(first);
    }
  });
  it("keeps update omission distinct from explicit empty, retaining scalar identity independently", () => {
    const first = resolveGuestUpdateAttempt(null, "property-1", "guest-1", 4, payload, () => "first");
    expect(resolveGuestUpdateAttempt(first, "property-1", "guest-1", 4, { ...payload, languageTags: null }, () => "second")).toBe(first);
    expect(resolveGuestUpdateAttempt(first, "property-1", "guest-1", 4, { ...payload, languageTags: [] }, () => "second").operationId).toBe("second");
    const values = { ...payload, preferredLanguageTag: "en", languageTags: ["en", "fr"] };
    const explicit = resolveGuestUpdateAttempt(null, "property-1", "guest-1", 4, values, () => "third");
    expect(resolveGuestUpdateAttempt(explicit, "property-1", "guest-1", 4, { ...values, languageTags: ["FR", "EN"] }, () => "fourth")).toBe(explicit);
    expect(resolveGuestUpdateAttempt(explicit, "property-1", "guest-1", 4, { ...values, preferredLanguageTag: null }, () => "fourth").operationId).toBe("fourth");
  });
  it("keeps the reservation follow-on identity and original reservation version through an equivalent retry", () => {
    const values = { ...payload, languageTags: ["en", "fr"] };
    const first = resolveReservationGuestRecordAttempt(null, "property-1", { reservationId: "reservation-1", version: 4 }, values, () => "first");
    const retry = resolveReservationGuestRecordAttempt(first, "property-1", { reservationId: "reservation-1", version: 5 }, { ...values, languageTags: ["FR", "EN"] }, () => "second");
    expect(retry).toBe(first); expect(retry.expectedReservationVersion).toBe(4);
    expect(resolveReservationGuestRecordAttempt(first, "property-1", { reservationId: "reservation-1", version: 5 }, { ...values, languageTags: [] }, () => "second").operationId).toBe("second");
  });
});
