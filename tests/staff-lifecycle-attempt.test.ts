import { describe, expect, it } from "vitest";
import { resolveStaffLifecycleAttempt } from "../src/features/staff/staffLifecycleAttempt";

describe("staff lifecycle attempt", () => {
  it("keeps the operation and selected version for an unchanged retry", async () => {
    const first = await resolveStaffLifecycleAttempt(
      null,
      "STAFF-1",
      7,
      "suspend",
      "  Approved leave  ",
      "2026-08-07",
      () => "operation-1",
    );
    const retry = await resolveStaffLifecycleAttempt(
      first,
      "STAFF-1",
      8,
      "suspend",
      "Approved leave",
      "2027-01-01",
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.expectedVersion).toBe(7);
    expect(retry.operationId).toBe("operation-1");
  });

  it("starts a new attempt when lifecycle meaning changes", async () => {
    const first = await resolveStaffLifecycleAttempt(
      null,
      "staff-1",
      7,
      "depart",
      "Contract ended",
      "2026-08-07",
      () => "operation-1",
    );
    const changedDate = await resolveStaffLifecycleAttempt(
      first,
      "staff-1",
      7,
      "depart",
      "Contract ended",
      "2026-08-08",
      () => "operation-2",
    );
    const changedAction = await resolveStaffLifecycleAttempt(
      changedDate,
      "staff-1",
      7,
      "resume",
      "Contract ended",
      "2026-08-08",
      () => "operation-3",
    );

    expect(changedDate.operationId).toBe("operation-2");
    expect(changedAction.operationId).toBe("operation-3");
  });
});
