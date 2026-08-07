import { describe, expect, it } from "vitest";
import { resolveStaffAuthSubjectChangeAttempt } from "../src/features/staff/staffAuthSubjectChangeAttempt";

describe("staff auth-subject change attempt", () => {
  it("keeps one operation and the selected version for a normalized retry", async () => {
    const first = await resolveStaffAuthSubjectChangeAttempt(
      null,
      "member-1",
      4,
      " account-maya ",
      () => "operation-1",
    );
    const retryAfterLiveRefresh = await resolveStaffAuthSubjectChangeAttempt(
      first,
      "member-1",
      5,
      "account-maya",
      () => "operation-2",
    );

    expect(retryAfterLiveRefresh).toBe(first);
    expect(retryAfterLiveRefresh.operationId).toBe("operation-1");
    expect(retryAfterLiveRefresh.expectedVersion).toBe(4);
  });

  it("treats blank and null as the same unlink request", async () => {
    const first = await resolveStaffAuthSubjectChangeAttempt(
      null,
      "member-1",
      4,
      null,
      () => "operation-1",
    );
    const retry = await resolveStaffAuthSubjectChangeAttempt(
      first,
      "member-1",
      4,
      "   ",
      () => "operation-2",
    );

    expect(retry).toBe(first);
  });

  it("rotates the operation for another value or Staff member", async () => {
    const first = await resolveStaffAuthSubjectChangeAttempt(
      null,
      "member-1",
      4,
      "account-maya",
      () => "operation-1",
    );
    const changed = await resolveStaffAuthSubjectChangeAttempt(
      first,
      "member-1",
      4,
      "account-lee",
      () => "operation-2",
    );
    const anotherMember = await resolveStaffAuthSubjectChangeAttempt(
      first,
      "member-2",
      4,
      "account-maya",
      () => "operation-3",
    );

    expect(changed.operationId).toBe("operation-2");
    expect(anotherMember.operationId).toBe("operation-3");
  });
});
