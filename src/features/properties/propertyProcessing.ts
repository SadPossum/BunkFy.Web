import type {
  CountryPolicy,
  CountryPolicyRetention,
  PropertyGovernanceAcknowledgement,
  PropertyGovernancePolicyBinding,
} from "../../api/types";

export type PropertyProcessingActivationInput = {
  operatingCountryCode: string;
  policyId: string;
  policyVersion: number;
  dataRegionId: string;
  transferProfileId: string;
  retentionPolicyId: string;
  retentionPolicyVersion: number;
  acceptedAcknowledgements: PropertyGovernanceAcknowledgement[];
  confirmed: true;
  expectedVersion: number;
};

export function countryPolicyKey(policy: Pick<CountryPolicy, "policyId" | "policyVersion" | "contentSha256">): string {
  return `${policy.policyId}:${policy.policyVersion}:${policy.contentSha256}`;
}

export function availableCountryPolicies(policies: CountryPolicy[], now = new Date()): CountryPolicy[] {
  const timestamp = now.getTime();
  return policies.filter((policy) =>
    policy.launchStatus !== "disabled" &&
    Date.parse(policy.effectiveAtUtc) <= timestamp &&
    timestamp < Date.parse(policy.expiresAtUtc) &&
    policy.accommodationTypes.includes("hostel") &&
    policy.permittedDataRegions.length > 0 &&
    policy.permittedTransferProfiles.length > 0 &&
    policy.retentionPolicies.length > 0
  );
}

export function matchingBoundPolicy(
  policies: CountryPolicy[],
  binding: PropertyGovernancePolicyBinding | null,
): CountryPolicy | undefined {
  if (!binding) return undefined;
  return policies.find((policy) =>
    policy.policyId === binding.policyId &&
    policy.policyVersion === binding.policyVersion &&
    policy.operatingCountryCode === binding.operatingCountryCode &&
    policy.contentSha256 === binding.contentSha256
  );
}

export function choosePolicyCoordinate<T extends string>(
  options: T[],
  current: string | null | undefined,
): T {
  if (current && options.includes(current as T)) return current as T;
  return options[0] ?? "" as T;
}

export function chooseRetentionPolicy(
  policies: CountryPolicyRetention[],
  binding: PropertyGovernancePolicyBinding | null,
): CountryPolicyRetention | undefined {
  return policies.find((policy) =>
    policy.retentionPolicyId === binding?.retentionPolicyId &&
    policy.retentionPolicyVersion === binding.retentionPolicyVersion
  ) ?? policies[0];
}

export function buildPropertyProcessingActivation(
  policy: CountryPolicy,
  dataRegionId: string,
  transferProfileId: string,
  retentionPolicy: CountryPolicyRetention,
  expectedVersion: number,
): PropertyProcessingActivationInput {
  return {
    operatingCountryCode: policy.operatingCountryCode,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    dataRegionId,
    transferProfileId,
    retentionPolicyId: retentionPolicy.retentionPolicyId,
    retentionPolicyVersion: retentionPolicy.retentionPolicyVersion,
    acceptedAcknowledgements: policy.requiredAcknowledgements.map((acknowledgement) => ({ ...acknowledgement })),
    confirmed: true,
    expectedVersion,
  };
}

export function propertyProcessingMessage(status: string): string {
  switch (status) {
    case "enabled":
      return "Guest, reservation and adapter processing is enabled under the bound country policy.";
    case "suspended":
      return "New guest, reservation and adapter processing is paused. Existing records remain available for managed operations.";
    case "expired":
      return "The bound country policy has expired. New processing is blocked until another configured policy is selected.";
    case "revoked":
      return "The bound country policy is no longer accepted by this deployment. New processing is blocked.";
    default:
      return "Guest, reservation and adapter processing remains blocked until a country policy is configured.";
  }
}
