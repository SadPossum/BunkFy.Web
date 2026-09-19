import { describe, expect, it } from "vitest";
import {
  isWorkspaceStaffOnboardingInProgress,
  isWorkspaceStaffOnboardingExpired,
  isWorkspaceStaffOnboardingTerminallyDenied,
  isWorkspaceStaffOnboardingWithdrawn,
  parseWorkspaceJoinSecret,
  resolveEnrollmentJoin,
  workspaceJoinVerificationCopy,
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

  it("distinguishes recipient-bound invitations from general staff verification", () => {
    expect(workspaceJoinVerificationCopy(true)).toEqual({
      title: "Verify the invited email",
      description:
        "This invitation is restricted to its recipient. Verify the matching active email on this account, then BunkFy will continue joining the workspace.",
    });
    expect(workspaceJoinVerificationCopy(false)).toEqual({
      title: "Verify your account email",
      description:
        "BunkFy requires a verified account email before staff access is created. Verify the active address on this account, then joining will continue automatically.",
    });
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
    expect(isWorkspaceStaffOnboardingExpired(9)).toBe(true);
    expect(isWorkspaceStaffOnboardingExpired(10)).toBe(false);
    expect(isWorkspaceStaffOnboardingWithdrawn(10)).toBe(true);
    expect(isWorkspaceStaffOnboardingWithdrawn(9)).toBe(false);
  });
});
