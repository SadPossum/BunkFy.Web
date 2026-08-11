import { describe, expect, it } from "vitest";
import {
  createConnectionControlRequest,
  resolveConnectionControlAttempt,
  type ConnectionControlPayload,
} from "../src/features/integrations/connectionControlAttempt";

const control: ConnectionControlPayload = {
  propertyId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
  connectionId: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
  action: "disable",
  expectedVersion: 7,
};

describe("connection control attempts", () => {
  it("keeps one operation id for an exact retry", () => {
    const ids = ["operation-1", "operation-2"];
    const nextId = () => ids.shift()!;
    const first = resolveConnectionControlAttempt(null, control, nextId);
    const retry = resolveConnectionControlAttempt(
      first,
      {
        ...control,
        propertyId: control.propertyId.toLowerCase(),
        connectionId: ` ${control.connectionId.toLowerCase()} `,
      },
      nextId,
    );

    expect(retry.operationId).toBe("operation-1");
    expect(ids).toEqual(["operation-2"]);
  });

  it("rotates when the action target or expected version changes", () => {
    let sequence = 0;
    const nextId = () => `operation-${++sequence}`;
    const first = resolveConnectionControlAttempt(null, control, nextId);
    const changedAction = resolveConnectionControlAttempt(
      first,
      { ...control, action: "enable" },
      nextId,
    );
    const changedTarget = resolveConnectionControlAttempt(
      changedAction,
      { ...control, connectionId: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
      nextId,
    );
    const changedVersion = resolveConnectionControlAttempt(
      changedTarget,
      { ...control, expectedVersion: 8 },
      nextId,
    );

    expect([
      first.operationId,
      changedAction.operationId,
      changedTarget.operationId,
      changedVersion.operationId,
    ]).toEqual([
      "operation-1",
      "operation-2",
      "operation-3",
      "operation-4",
    ]);
  });

  it("keeps exact schedule retries and rotates changed schedule input", () => {
    let sequence = 0;
    const nextId = () => `operation-${++sequence}`;
    const schedule: ConnectionControlPayload = {
      ...control,
      action: "configure-schedule",
      intervalSeconds: 300,
      maxAttempts: 3,
    };
    const first = resolveConnectionControlAttempt(null, schedule, nextId);
    const retry = resolveConnectionControlAttempt(first, schedule, nextId);
    const changedInterval = resolveConnectionControlAttempt(
      retry,
      { ...schedule, intervalSeconds: 600 },
      nextId,
    );
    const changedAttempts = resolveConnectionControlAttempt(
      changedInterval,
      { ...schedule, intervalSeconds: 600, maxAttempts: 4 },
      nextId,
    );

    expect(retry.operationId).toBe("operation-1");
    expect(changedInterval.operationId).toBe("operation-2");
    expect(changedAttempts.operationId).toBe("operation-3");
  });

  it("confirms only checkpoint-reset requests", () => {
    expect(createConnectionControlRequest("reset-checkpoint", "operation-1", 7))
      .toEqual({ operationId: "operation-1", expectedVersion: 7, confirmed: true });
    expect(createConnectionControlRequest("disable", "operation-2", 8))
      .toEqual({ operationId: "operation-2", expectedVersion: 8 });
    expect(createConnectionControlRequest("clear-schedule", "operation-3", 9))
      .not.toHaveProperty("confirmed");
  });
});
