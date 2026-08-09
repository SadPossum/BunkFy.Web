import { describe, expect, it } from "vitest";
import {
  credentialIssuanceOutcomeKey,
  resolveCredentialIssueAttempt,
  resolveCredentialRevokeAttempt,
  type CredentialIssueAttemptPayload,
  type CredentialRevokeAttemptPayload,
} from "../src/features/integrations/credentialMutationAttempt";

const issue: CredentialIssueAttemptPayload = {
  propertyId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
  connectionId: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
  label: "primary",
  expiresAtUtc: "2026-09-09T08:00:00.000Z",
  defaultSourceSystem: "fake.http",
  sourceSystem: null,
};

const revoke: CredentialRevokeAttemptPayload = {
  propertyId: issue.propertyId,
  connectionId: issue.connectionId,
  credentialId: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
  expectedVersion: 1,
};

const issueIntentChanges: Array<[
  string,
  Partial<CredentialIssueAttemptPayload>,
]> = [
  ["property", { propertyId: "property-b" }],
  ["connection", { connectionId: "connection-b" }],
  ["label", { label: "replacement" }],
  ["expiry", { expiresAtUtc: "2026-09-10T08:00:00.000Z" }],
  ["source", { sourceSystem: "provider.other" }],
];

describe("credential mutation attempts", () => {
  it.each([
    [1, "issued"],
    ["Issued", "issued"],
    [2, "already-issued"],
    ["alreadyIssued", "already-issued"],
    ["already-issued", "already-issued"],
    [0, "unknown"],
  ])("normalizes issuance outcome %s", (outcome, expected) => {
    expect(credentialIssuanceOutcomeKey(outcome)).toBe(expected);
  });

  it("keeps issuance identity for normalized equivalent intent", () => {
    const first = resolveCredentialIssueAttempt(
      null,
      issue,
      () => "operation-1",
    );
    const retry = resolveCredentialIssueAttempt(
      first,
      {
        ...issue,
        propertyId: ` ${issue.propertyId.toLowerCase()} `,
        connectionId: issue.connectionId.toLowerCase(),
        label: " primary ",
        expiresAtUtc: "2026-09-09T10:00:00.000+02:00",
        sourceSystem: " FAKE.HTTP ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it.each(issueIntentChanges)("rotates issuance identity when %s intent changes", (_label, change) => {
    const first = resolveCredentialIssueAttempt(
      null,
      issue,
      () => "operation-1",
    );
    const changed = resolveCredentialIssueAttempt(
      first,
      { ...issue, ...change },
      () => "operation-2",
    );

    expect(changed.operationId).toBe("operation-2");
  });

  it("keeps exact revoke retries and rotates changed targets or versions", () => {
    let sequence = 0;
    const nextId = () => `operation-${++sequence}`;
    const first = resolveCredentialRevokeAttempt(null, revoke, nextId);
    const retry = resolveCredentialRevokeAttempt(
      first,
      {
        ...revoke,
        propertyId: revoke.propertyId.toLowerCase(),
        credentialId: ` ${revoke.credentialId.toLowerCase()} `,
      },
      nextId,
    );
    const changedTarget = resolveCredentialRevokeAttempt(
      retry,
      { ...revoke, credentialId: "credential-b" },
      nextId,
    );
    const changedVersion = resolveCredentialRevokeAttempt(
      changedTarget,
      { ...revoke, expectedVersion: 2 },
      nextId,
    );

    expect(retry).toBe(first);
    expect([
      first.operationId,
      changedTarget.operationId,
      changedVersion.operationId,
    ]).toEqual(["operation-1", "operation-2", "operation-3"]);
  });
});
