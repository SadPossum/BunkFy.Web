import { describe, expect, it } from "vitest";
import {
  resolveTopologyRetirementRequestAttempt,
  resolveTopologyRetirementRetryAttempt,
  topologyRetirementRequestPayload,
} from "../src/features/properties/topologyRetirementMutationAttempt";

describe("topology retirement mutation attempts", () => {
  it("keeps the request operation id for a normalized exact retry", () => {
    const first = resolveTopologyRetirementRequestAttempt(
      null,
      {
        propertyId: "PROPERTY-A",
        targetKind: "bed",
        roomId: "ROOM-A",
        targetId: "BED-A",
        reason: "  Damaged frame  ",
      },
      () => "operation-1",
    );
    const retry = resolveTopologyRetirementRequestAttempt(
      first,
      {
        propertyId: "property-a",
        targetKind: "bed",
        roomId: "room-a",
        targetId: "bed-a",
        reason: "Damaged frame",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("builds an explicitly confirmed request without changing retry identity", () => {
    const attempt = resolveTopologyRetirementRequestAttempt(
      null,
      {
        propertyId: "property-a",
        targetKind: "room",
        roomId: "room-a",
        targetId: "room-a",
        reason: "Renovation",
      },
      () => "operation-1",
    );

    expect(topologyRetirementRequestPayload(attempt, "  Renovation  ")).toEqual({
      operationId: "operation-1",
      confirmed: true,
      reason: "Renovation",
    });
  });

  it("rotates request identity when the intended retirement changes", () => {
    const first = resolveTopologyRetirementRequestAttempt(
      null,
      {
        propertyId: "property-a",
        targetKind: "room",
        roomId: "room-a",
        targetId: "room-a",
        reason: "Renovation",
      },
      () => "operation-1",
    );
    const changedReason = resolveTopologyRetirementRequestAttempt(
      first,
      {
        propertyId: "property-a",
        targetKind: "room",
        roomId: "room-a",
        targetId: "room-a",
        reason: "Permanent closure",
      },
      () => "operation-2",
    );
    const changedRoom = resolveTopologyRetirementRequestAttempt(
      first,
      {
        propertyId: "property-a",
        targetKind: "room",
        roomId: "room-b",
        targetId: "room-b",
        reason: "Renovation",
      },
      () => "operation-3",
    );

    expect(changedReason.operationId).toBe("operation-2");
    expect(changedRoom.operationId).toBe("operation-3");
  });

  it("keeps exact retry identity and rotates it for a newer process version", () => {
    const first = resolveTopologyRetirementRetryAttempt(
      null,
      {
        propertyId: "PROPERTY-A",
        targetKind: "bed",
        topologyChangeId: "CHANGE-A",
        expectedVersion: 3,
      },
      () => "operation-1",
    );
    const retry = resolveTopologyRetirementRetryAttempt(
      first,
      {
        propertyId: "property-a",
        targetKind: "bed",
        topologyChangeId: "change-a",
        expectedVersion: 3,
      },
      () => "operation-2",
    );
    const advanced = resolveTopologyRetirementRetryAttempt(
      first,
      {
        propertyId: "property-a",
        targetKind: "bed",
        topologyChangeId: "change-a",
        expectedVersion: 4,
      },
      () => "operation-3",
    );

    expect(retry).toBe(first);
    expect(advanced.operationId).toBe("operation-3");
  });
});
