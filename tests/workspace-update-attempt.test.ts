import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceUpdateAttempt,
  type WorkspaceUpdatePayload,
} from "../src/features/workspaces/workspaceUpdateAttempt";

const payload: WorkspaceUpdatePayload = {
  organizationId: "10000000-0000-0000-0000-000000000001",
  expectedVersion: 7,
  name: "Harbor House",
  slug: "harbor-house",
};

describe("workspace update attempts", () => {
  it("keeps one operation id for a normalized retry", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const first = resolveWorkspaceUpdateAttempt(null, payload, allocate);
    const retry = resolveWorkspaceUpdateAttempt(
      first,
      {
        ...payload,
        name: "  Harbor House  ",
        slug: " HARBOR-HOUSE ",
      },
      allocate,
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
    expect(allocations).toBe(1);
  });

  it("allocates a new operation for changed intent or version", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const first = resolveWorkspaceUpdateAttempt(null, payload, allocate);
    const changed = resolveWorkspaceUpdateAttempt(
      first,
      { ...payload, name: "Harbor Annex" },
      allocate,
    );
    const newerVersion = resolveWorkspaceUpdateAttempt(
      changed,
      { ...payload, name: "Harbor Annex", expectedVersion: 8 },
      allocate,
    );

    expect(changed.operationId).toBe("operation-2");
    expect(newerVersion.operationId).toBe("operation-3");
  });
});
