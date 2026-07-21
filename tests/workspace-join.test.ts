import { describe, expect, it } from "vitest";
import {
  isWorkspaceStaffOnboardingInProgress,
  isWorkspaceStaffOnboardingTerminallyDenied,
  parseWorkspaceJoinSecret,
  resolveEnrollmentJoin,
  workspaceJoinSourceKind,
} from "../src/features/workspaces/workspaceJoin";

describe("workspace enrollment outcomes", () => {
  it("keeps approval-required claims pending without pretending access exists", () => {
    expect(
      resolveEnrollmentJoin({
        claim: { organizationId: "workspace-pending" },
        membership: null,
      }),
    ).toEqual({
      kind: "pending-approval",
      workspaceId: "workspace-pending",
    });
  });

  it("uses the provisioned membership workspace after approval", () => {
    expect(
      resolveEnrollmentJoin({
        claim: { organizationId: "stale-preview" },
        membership: {
          organization: { organizationId: "workspace-approved" },
        },
      }),
    ).toEqual({
      kind: "joined",
      workspaceId: "workspace-approved",
    });
  });

  it("maps product join sources to their API contract values", () => {
    expect(workspaceJoinSourceKind("invitation")).toBe(1);
    expect(workspaceJoinSourceKind("enrollment")).toBe(2);
  });

  it("parses invitation secrets from URL fragments without accepting incomplete links", () => {
    expect(parseWorkspaceJoinSecret("#invitation=one-time-token")).toEqual({
      kind: "invitation",
      token: "one-time-token",
    });
    expect(parseWorkspaceJoinSecret("#enrollment=team-token")).toEqual({
      kind: "enrollment",
      token: "team-token",
    });
    expect(parseWorkspaceJoinSecret("#invitation=%20")).toBeNull();
  });

  it("separates recoverable progress from terminal denial", () => {
    expect([1, 2, 3, 4].every(isWorkspaceStaffOnboardingInProgress)).toBe(true);
    expect(isWorkspaceStaffOnboardingInProgress(6)).toBe(false);
    expect(isWorkspaceStaffOnboardingTerminallyDenied(7)).toBe(true);
    expect(isWorkspaceStaffOnboardingTerminallyDenied(8)).toBe(true);
    expect(isWorkspaceStaffOnboardingTerminallyDenied(5)).toBe(false);
  });
});
