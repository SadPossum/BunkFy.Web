import { describe, expect, it } from "vitest";
import { canReplaceJoinSource, isActiveJoinSource, joinSourceStatusLabel } from "../src/features/workspaces/workspaceJoinSources";

describe("workspace join source lifecycle", () => {
  it("labels every published source status", () => {
    expect(Array.from({ length: 8 }, (_, status) => joinSourceStatusLabel(status as 0))).toEqual([
      "unknown",
      "active",
      "accepted",
      "revoked",
      "superseded",
      "expired",
      "disabled",
      "capacity reached",
    ]);
  });

  it("does not replace accepted invitations", () => {
    expect(canReplaceJoinSource(1, 2)).toBe(false);
    expect(canReplaceJoinSource(1, 3)).toBe(true);
  });

  it("allows exhausted enrollment links to be replaced", () => {
    expect(canReplaceJoinSource(2, 7)).toBe(true);
    expect(isActiveJoinSource(1)).toBe(true);
    expect(isActiveJoinSource(6)).toBe(false);
  });
});
