import { describe, expect, it } from "vitest";
import { resolveStaffAuthSubjectTransition } from "../src/features/staff/staffAuthSubjectTransition";

describe("staff auth-subject transition", () => {
  it("allows only a new link for an active unlinked staff member", () => {
    const state = resolveStaffAuthSubjectTransition(
      "active",
      false,
      true,
      true,
    );

    expect(state.canEdit).toBe(true);
    expect(state.canClear).toBe(false);
    expect(state.canRequestSuspension).toBe(false);
  });

  it("requires suspension before an active link can be cleared", () => {
    const withLifecycle = resolveStaffAuthSubjectTransition(
      "active",
      true,
      true,
      true,
    );
    const withoutLifecycle = resolveStaffAuthSubjectTransition(
      "active",
      true,
      true,
      false,
    );

    expect(withLifecycle.canEdit).toBe(false);
    expect(withLifecycle.canClear).toBe(false);
    expect(withLifecycle.canRequestSuspension).toBe(true);
    expect(withoutLifecycle.canRequestSuspension).toBe(false);
  });

  it("allows only clearing while suspended and linked", () => {
    const linked = resolveStaffAuthSubjectTransition(
      "suspended",
      true,
      true,
      true,
    );
    const unlinked = resolveStaffAuthSubjectTransition(
      "suspended",
      false,
      true,
      true,
    );

    expect(linked.canEdit).toBe(false);
    expect(linked.canClear).toBe(true);
    expect(unlinked.canEdit).toBe(false);
    expect(unlinked.canClear).toBe(false);
  });

  it("keeps departed and unauthorized views read-only", () => {
    const departed = resolveStaffAuthSubjectTransition(
      "departed",
      true,
      true,
      true,
    );
    const unauthorized = resolveStaffAuthSubjectTransition(
      "active",
      false,
      false,
      true,
    );

    expect(departed.canEdit || departed.canClear).toBe(false);
    expect(unauthorized.canEdit || unauthorized.canClear).toBe(false);
    expect(unauthorized.canRequestSuspension).toBe(false);
  });
});
