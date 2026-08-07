import { describe, expect, it } from "vitest";
import { resolveStaffPropertyAssignmentAttempt } from "../src/features/staff/staffPropertyAssignmentAttempt";

describe("staff property assignment attempt", () => {
  it("keeps the operation and selected version for an unchanged retry", async () => {
    const first = await resolveStaffPropertyAssignmentAttempt(
      null,
      "STAFF-1",
      "PROPERTY-1",
      7,
      {
        action: "assignment",
        propertyJobTitle: " Duty Manager ",
        isPrimary: true,
        effectiveFrom: "2026-08-07",
      },
      () => "operation-1",
    );
    const retry = await resolveStaffPropertyAssignmentAttempt(
      first,
      "STAFF-1",
      "PROPERTY-1",
      8,
      {
        action: "assignment",
        propertyJobTitle: "Duty Manager",
        isPrimary: true,
        effectiveFrom: "2026-08-07",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.expectedVersion).toBe(7);
    expect(retry.operationId).toBe("operation-1");
  });

  it("starts a new attempt when assignment meaning changes", async () => {
    const first = await resolveStaffPropertyAssignmentAttempt(
      null,
      "staff-1",
      "property-1",
      7,
      {
        action: "unassign",
        effectiveTo: "2026-08-07",
        reason: "Transferred",
      },
      () => "operation-1",
    );
    const changedReason = await resolveStaffPropertyAssignmentAttempt(
      first,
      "staff-1",
      "property-1",
      7,
      {
        action: "unassign",
        effectiveTo: "2026-08-07",
        reason: "Role ended",
      },
      () => "operation-2",
    );
    const changedProperty = await resolveStaffPropertyAssignmentAttempt(
      changedReason,
      "staff-1",
      "property-2",
      7,
      {
        action: "unassign",
        effectiveTo: "2026-08-07",
        reason: "Role ended",
      },
      () => "operation-3",
    );

    expect(changedReason.operationId).toBe("operation-2");
    expect(changedProperty.operationId).toBe("operation-3");
  });
});
