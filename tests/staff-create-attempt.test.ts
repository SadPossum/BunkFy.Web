import { describe, expect, it } from "vitest";
import {
  resolveStaffCreateAttempt,
  type StaffCreatePayload,
} from "../src/features/staff/staffCreateAttempt";

const payload: StaffCreatePayload = {
  displayName: "Maya Chen",
  legalName: "Maya Q. Chen",
  workEmail: "maya@example.test",
  workPhone: "+44 20 1234 5678",
  employeeNumber: "EMP-42",
  jobTitle: "Manager",
  department: "Operations",
};

describe("staff create attempt", () => {
  it("reuses one operation id for a normalized equivalent retry", () => {
    const first = resolveStaffCreateAttempt(null, payload, () => "operation-1");
    const retry = resolveStaffCreateAttempt(
      first,
      {
        ...payload,
        displayName: "  Maya Chen  ",
        workEmail: " MAYA@EXAMPLE.TEST ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("allocates a new operation id when normalized profile data changes", () => {
    const first = resolveStaffCreateAttempt(null, payload, () => "operation-1");
    const changed = resolveStaffCreateAttempt(
      first,
      { ...payload, jobTitle: "Supervisor" },
      () => "operation-2",
    );

    expect(changed.operationId).toBe("operation-2");
  });
});
