import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceCreationAttempt,
  type WorkspaceCreationPayload,
} from "../src/features/workspaces/workspaceCreationAttempt";

const payload: WorkspaceCreationPayload = {
  name: "Harbor House",
  slug: "harbor-house",
};

describe("workspace creation attempt", () => {
  it("reuses one operation id for a normalized equivalent retry", () => {
    const first = resolveWorkspaceCreationAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolveWorkspaceCreationAttempt(
      first,
      { name: "  Harbor House  ", slug: " HARBOR-HOUSE " },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("allocates a new operation id when normalized intent changes", () => {
    const first = resolveWorkspaceCreationAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const changedName = resolveWorkspaceCreationAttempt(
      first,
      { ...payload, name: "Harbor Annex" },
      () => "operation-2",
    );
    const changedSlug = resolveWorkspaceCreationAttempt(
      changedName,
      { ...payload, name: "Harbor Annex", slug: "harbor-annex" },
      () => "operation-3",
    );

    expect(changedName.operationId).toBe("operation-2");
    expect(changedSlug.operationId).toBe("operation-3");
  });
});
