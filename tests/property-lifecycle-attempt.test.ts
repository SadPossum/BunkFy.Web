import { describe, expect, it } from "vitest";
import type { PropertyProcessingActivationInput } from "../src/features/properties/propertyProcessing";
import {
  resolvePropertyActivationAttempt,
  resolvePropertySimpleLifecycleAttempt,
} from "../src/features/properties/propertyLifecycleAttempt";

const activation: PropertyProcessingActivationInput = {
  operatingCountryCode: "GB",
  policyId: "gb-hostel",
  policyVersion: 2,
  dataRegionId: "eu-west-2",
  transferProfileId: "uk-no-transfer",
  retentionPolicyId: "guest-operational",
  retentionPolicyVersion: 1,
  acceptedAcknowledgements: [
    { acknowledgementId: "operator", acknowledgementVersion: 1 },
    { acknowledgementId: "privacy", acknowledgementVersion: 2 },
  ],
  confirmed: true,
  expectedVersion: 7,
};

describe("property lifecycle attempts", () => {
  it("keeps one activation operation across an equivalent acknowledgement order", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const first = resolvePropertyActivationAttempt(
      null,
      "property-1",
      activation,
      allocate,
    );
    const retry = resolvePropertyActivationAttempt(
      first,
      "property-1",
      {
        ...activation,
        acceptedAcknowledgements: [...activation.acceptedAcknowledgements].reverse(),
      },
      allocate,
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
    expect(allocations).toBe(1);
  });

  it("allocates another activation operation when backend-significant input changes", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const first = resolvePropertyActivationAttempt(null, "property-1", activation, allocate);
    const changedPolicy = resolvePropertyActivationAttempt(
      first,
      "property-1",
      { ...activation, policyVersion: 3 },
      allocate,
    );
    const changedVersion = resolvePropertyActivationAttempt(
      changedPolicy,
      "property-1",
      { ...activation, policyVersion: 3, expectedVersion: 8 },
      allocate,
    );
    const changedProperty = resolvePropertyActivationAttempt(
      changedVersion,
      "property-2",
      { ...activation, policyVersion: 3, expectedVersion: 8 },
      allocate,
    );

    expect(changedPolicy.operationId).toBe("operation-2");
    expect(changedVersion.operationId).toBe("operation-3");
    expect(changedProperty.operationId).toBe("operation-4");
  });

  it("keeps simple retries stable and separates lifecycle actions", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const suspension = resolvePropertySimpleLifecycleAttempt(
      null,
      "processing-suspension",
      "property-1",
      7,
      allocate,
    );
    const retry = resolvePropertySimpleLifecycleAttempt(
      suspension,
      "processing-suspension",
      "property-1",
      7,
      allocate,
    );
    const retirement = resolvePropertySimpleLifecycleAttempt(
      retry,
      "retirement",
      "property-1",
      7,
      allocate,
    );
    const newerVersion = resolvePropertySimpleLifecycleAttempt(
      retirement,
      "retirement",
      "property-1",
      8,
      allocate,
    );

    expect(retry).toBe(suspension);
    expect(retirement.operationId).toBe("operation-2");
    expect(newerVersion.operationId).toBe("operation-3");
  });
});
