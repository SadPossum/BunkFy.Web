import { describe, expect, it } from "vitest";
import {
  resolvePropertyCreateAttempt,
  type PropertyCreatePayload,
} from "../src/features/properties/propertyCreateAttempt";

const payload: PropertyCreatePayload = {
  name: "Harbour House",
  code: "harbour-house",
  timeZoneId: "UTC",
};

describe("property create attempt", () => {
  it("reuses one operation id for a normalized equivalent retry", () => {
    const first = resolvePropertyCreateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolvePropertyCreateAttempt(
      first,
      {
        name: "  Harbour House  ",
        code: " HARBOUR-HOUSE ",
        timeZoneId: " UTC ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("allocates a new operation id when normalized details change", () => {
    const first = resolvePropertyCreateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const changed = resolvePropertyCreateAttempt(
      first,
      { ...payload, timeZoneId: "Europe/London" },
      () => "operation-2",
    );

    expect(changed.operationId).toBe("operation-2");
  });
});
