import { describe, expect, it } from "vitest";
import type { CountryPolicy, PropertyGovernancePolicyBinding } from "../src/api/types";
import {
  availableCountryPolicies,
  buildPropertyProcessingActivation,
  choosePolicyCoordinate,
  chooseRetentionPolicy,
  countryPolicyKey,
  matchingBoundPolicy,
  propertyProcessingMessage,
} from "../src/features/properties/propertyProcessing";

const now = new Date("2026-07-22T12:00:00Z");

describe("property processing policy selection", () => {
  it("offers only current, enabled hostel policies with complete coordinates", () => {
    const current = policy();
    const policies = [
      current,
      policy({ policyId: "disabled", launchStatus: "disabled" }),
      policy({ policyId: "expired", expiresAtUtc: "2026-07-22T12:00:00Z" }),
      policy({ policyId: "future", effectiveAtUtc: "2026-07-23T00:00:00Z" }),
      policy({ policyId: "hotel-only", accommodationTypes: ["hotel"] }),
      policy({ policyId: "missing-region", permittedDataRegions: [] }),
    ];

    expect(availableCountryPolicies(policies, now)).toEqual([current]);
  });

  it("matches a persisted binding only when country, identity, version and digest agree", () => {
    const current = policy();
    const binding = governanceBinding();

    expect(matchingBoundPolicy([current], binding)).toBe(current);
    expect(matchingBoundPolicy([current], { ...binding, contentSha256: "b".repeat(64) })).toBeUndefined();
    expect(matchingBoundPolicy([current], null)).toBeUndefined();
  });

  it("keeps valid bound coordinates and otherwise chooses deterministic first options", () => {
    const binding = governanceBinding();

    expect(choosePolicyCoordinate(["eu-west-1", "eu-west-2"], binding.dataRegionId)).toBe("eu-west-2");
    expect(choosePolicyCoordinate(["eu-west-1"], binding.dataRegionId)).toBe("eu-west-1");
    expect(chooseRetentionPolicy(policy().retentionPolicies, binding)?.retentionPolicyId).toBe("guest-operational");
  });

  it("builds an exact, confirmed activation payload without sharing acknowledgement objects", () => {
    const selected = policy();
    const input = buildPropertyProcessingActivation(
      selected,
      "eu-west-2",
      "uk-no-transfer",
      selected.retentionPolicies[0],
      7,
    );

    expect(input).toEqual({
      operatingCountryCode: "GB",
      policyId: "gb-hostel",
      policyVersion: 1,
      dataRegionId: "eu-west-2",
      transferProfileId: "uk-no-transfer",
      retentionPolicyId: "guest-operational",
      retentionPolicyVersion: 1,
      acceptedAcknowledgements: [{ acknowledgementId: "operator-notice", acknowledgementVersion: 1 }],
      confirmed: true,
      expectedVersion: 7,
    });
    expect(input.acceptedAcknowledgements[0]).not.toBe(selected.requiredAcknowledgements[0]);
  });

  it("keeps every effective state actionable and explicit", () => {
    for (const status of ["unconfigured", "enabled", "suspended", "expired", "revoked"]) {
      expect(propertyProcessingMessage(status)).not.toHaveLength(0);
    }
    expect(propertyProcessingMessage("expired")).toContain("expired");
    expect(propertyProcessingMessage("revoked")).toContain("no longer accepted");
  });

  it("uses digest-qualified policy keys so rebinding cannot collapse different artifacts", () => {
    expect(countryPolicyKey(policy())).toBe(`gb-hostel:1:${"a".repeat(64)}`);
  });
});

function policy(overrides: Partial<CountryPolicy> = {}): CountryPolicy {
  return {
    policyId: "gb-hostel",
    policyVersion: 1,
    operatingCountryCode: "GB",
    launchStatus: "approved",
    approvalState: "approved",
    effectiveAtUtc: "2026-01-01T00:00:00Z",
    expiresAtUtc: "2027-01-01T00:00:00Z",
    contentSha256: "a".repeat(64),
    accommodationTypes: ["hostel"],
    permittedDataRegions: ["eu-west-2"],
    permittedTransferProfiles: ["uk-no-transfer"],
    retentionPolicies: [{ retentionPolicyId: "guest-operational", retentionPolicyVersion: 1 }],
    requiredAcknowledgements: [{ acknowledgementId: "operator-notice", acknowledgementVersion: 1 }],
    ...overrides,
  };
}

function governanceBinding(): PropertyGovernancePolicyBinding {
  return {
    operatingCountryCode: "GB",
    policyId: "gb-hostel",
    policyVersion: 1,
    dataRegionId: "eu-west-2",
    transferProfileId: "uk-no-transfer",
    retentionPolicyId: "guest-operational",
    retentionPolicyVersion: 1,
    contentSha256: "a".repeat(64),
    policyEffectiveAtUtc: "2026-01-01T00:00:00Z",
    policyExpiresAtUtc: "2027-01-01T00:00:00Z",
    activatedAtUtc: "2026-07-22T12:00:00Z",
    acknowledgements: [{ acknowledgementId: "operator-notice", acknowledgementVersion: 1 }],
  };
}
