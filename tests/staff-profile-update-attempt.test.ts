import { describe, expect, it } from "vitest";
import {
  clearStaffProfileUpdateAttempt,
  readStaffProfileUpdateAttempt,
  resolveDurableStaffProfileUpdateAttempt,
  resolveStaffProfileUpdateAttempt,
  saveStaffProfileUpdateAttempt,
  type StaffProfileUpdatePayload,
} from "../src/features/staff/staffProfileUpdateAttempt";

const payload: StaffProfileUpdatePayload = {
  displayName: "Maya Chen",
  legalName: "Maya Q. Chen",
  workEmail: "maya@example.test",
  workPhone: "+44 20 1234 5678",
  employeeNumber: "EMP-42",
  jobTitle: "Manager",
  department: "Operations",
};

describe("staff profile update attempt", () => {
  it("reuses one operation id for normalized equivalent input and version", async () => {
    const first = await resolveStaffProfileUpdateAttempt(
      null,
      "member-1",
      4,
      payload,
      () => "10000000-0000-4000-8000-000000000001",
    );
    const retry = await resolveStaffProfileUpdateAttempt(
      first,
      "member-1",
      4,
      {
        ...payload,
        displayName: "  Maya Chen  ",
        workEmail: " MAYA@EXAMPLE.TEST ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe(
      "10000000-0000-4000-8000-000000000001",
    );
  });

  it("rotates the operation when profile, target, or expected version changes", async () => {
    const first = await resolveStaffProfileUpdateAttempt(
      null,
      "member-1",
      4,
      payload,
      () => "operation-1",
    );
    const changed = await resolveStaffProfileUpdateAttempt(
      first,
      "member-1",
      4,
      { ...payload, jobTitle: "Supervisor" },
      () => "operation-2",
    );
    const newVersion = await resolveStaffProfileUpdateAttempt(
      first,
      "member-1",
      5,
      payload,
      () => "operation-3",
    );
    const newTarget = await resolveStaffProfileUpdateAttempt(
      first,
      "member-2",
      4,
      payload,
      () => "operation-4",
    );

    expect(changed.operationId).toBe("operation-2");
    expect(newVersion.operationId).toBe("operation-3");
    expect(newTarget.operationId).toBe("operation-4");
  });

  it("keeps the original version for a durable retry after the server advances", async () => {
    const first = await resolveDurableStaffProfileUpdateAttempt(
      null,
      "member-1",
      4,
      payload,
      () => "operation-1",
    );
    const retry = await resolveDurableStaffProfileUpdateAttempt(
      first,
      "member-1",
      5,
      payload,
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.expectedVersion).toBe(4);
  });

  it("stores only hashed equivalence metadata and validates the target", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const attempt = await resolveStaffProfileUpdateAttempt(
      null,
      "member-1",
      4,
      payload,
      () => "10000000-0000-4000-8000-000000000001",
    );

    saveStaffProfileUpdateAttempt(attempt, storage);

    expect(readStaffProfileUpdateAttempt("member-1", storage)).toEqual(attempt);
    expect(readStaffProfileUpdateAttempt("member-2", storage)).toBeNull();
    expect([...values.values()].join()).not.toContain("Maya");

    values.set(
      "bunkfy.onboarding.staff-profile-update.v1:member-1",
      JSON.stringify({ ...attempt, expectedVersion: 0 }),
    );
    expect(readStaffProfileUpdateAttempt("member-1", storage)).toBeNull();

    values.set(
      "bunkfy.onboarding.staff-profile-update.v1:member-1",
      JSON.stringify({ ...attempt, operationId: "not-a-guid" }),
    );
    expect(readStaffProfileUpdateAttempt("member-1", storage)).toBeNull();

    clearStaffProfileUpdateAttempt("member-1", storage);
    expect(readStaffProfileUpdateAttempt("member-1", storage)).toBeNull();
  });
});
