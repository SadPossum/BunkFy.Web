import { describe, expect, it } from "vitest";
import {
  resolveConnectionUpdateAttempt,
  type ConnectionUpdatePayload,
} from "../src/features/integrations/connectionUpdateAttempt";

const payload: ConnectionUpdatePayload = {
  propertyId: "property-a",
  connectionId: "connection-a",
  expectedVersion: 4,
  executionMode: 1,
  conflictPolicy: 1,
  configurationReference: "configuration://main",
  secretReference: null,
  clearSecretReference: false,
};

const intentChanges: Array<[string, Partial<ConnectionUpdatePayload>]> = [
  ["property", { propertyId: "property-b" }],
  ["connection", { connectionId: "connection-b" }],
  ["expected version", { expectedVersion: 5 }],
  ["execution mode", { executionMode: 2 }],
  ["conflict policy", { conflictPolicy: 2 }],
  ["configuration", { configurationReference: "configuration://other" }],
  ["secret replacement", { secretReference: "secret://main" }],
  ["secret clearing", { clearSecretReference: true }],
];

describe("connection update attempt", () => {
  it("reuses one operation id for a normalized equivalent retry", () => {
    const first = resolveConnectionUpdateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolveConnectionUpdateAttempt(
      first,
      {
        ...payload,
        propertyId: " PROPERTY-A ",
        connectionId: " CONNECTION-A ",
        configurationReference: " configuration://main ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it.each(intentChanges)("rotates identity when %s intent changes", (_label, change) => {
    const first = resolveConnectionUpdateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const changed = resolveConnectionUpdateAttempt(
      first,
      { ...payload, ...change },
      () => "operation-2",
    );

    expect(changed.operationId).toBe("operation-2");
  });

  it("normalizes replacement references and gives clear intent precedence", () => {
    const replacement = resolveConnectionUpdateAttempt(
      null,
      { ...payload, secretReference: " secret://main " },
      () => "operation-1",
    );
    const replacementRetry = resolveConnectionUpdateAttempt(
      replacement,
      { ...payload, secretReference: "secret://main" },
      () => "operation-2",
    );
    const clear = resolveConnectionUpdateAttempt(
      null,
      { ...payload, secretReference: null, clearSecretReference: true },
      () => "operation-3",
    );
    const clearRetry = resolveConnectionUpdateAttempt(
      clear,
      {
        ...payload,
        secretReference: "ignored-while-clearing",
        clearSecretReference: true,
      },
      () => "operation-4",
    );

    expect(replacementRetry).toBe(replacement);
    expect(clearRetry).toBe(clear);
  });
});
