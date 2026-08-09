import { describe, expect, it } from "vitest";
import {
  resolveConnectionCreateAttempt,
  type ConnectionCreatePayload,
} from "../src/features/integrations/connectionCreateAttempt";

const payload: ConnectionCreatePayload = {
  propertyId: "property-a",
  adapterType: "fake.http",
  executionMode: 1,
  conflictPolicy: 1,
  configurationReference: "configuration://main",
  secretReference: "secret://main",
};

const intentChanges: Array<[string, Partial<ConnectionCreatePayload>]> = [
  ["property", { propertyId: "property-b" }],
  ["adapter", { adapterType: "imap.reservation-mail" }],
  ["mode", { executionMode: 2 }],
  ["policy", { conflictPolicy: 2 }],
  ["configuration", { configurationReference: "configuration://other" }],
  ["secret", { secretReference: null }],
];

describe("connection create attempt", () => {
  it("reuses one operation id for a normalized equivalent retry", () => {
    const first = resolveConnectionCreateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolveConnectionCreateAttempt(
      first,
      {
        ...payload,
        propertyId: " PROPERTY-A ",
        adapterType: " FAKE.HTTP ",
        configurationReference: " configuration://main ",
        secretReference: " secret://main ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it.each(intentChanges)("rotates identity when %s intent changes", (_label, change) => {
    const first = resolveConnectionCreateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const changed = resolveConnectionCreateAttempt(
      first,
      { ...payload, ...change },
      () => "operation-2",
    );

    expect(changed.operationId).toBe("operation-2");
  });
});
