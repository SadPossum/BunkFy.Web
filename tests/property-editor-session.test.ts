import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import type { Property } from "../src/api/types";
import { isPropertyVersionConflict, propertyEditorAttemptCurrent, propertyIdentityRecordEditable } from "../src/features/properties/usePropertyEditor";

describe("property editor completion scope", () => {
  const attempt = { editorContext: "actor-a:property-a", editorSession: 4 };
  it("allows a current response and rejects responses from another property or actor", () => {
    expect(propertyEditorAttemptCurrent(attempt, { ...attempt })).toBe(true);
    expect(propertyEditorAttemptCurrent(attempt, { ...attempt, editorContext: "actor-a:property-b" })).toBe(false);
    expect(propertyEditorAttemptCurrent(attempt, { ...attempt, editorContext: "actor-b:property-a" })).toBe(false);
  });
  it("does not close a reopened editor in the same property after an older response", () => {
    expect(propertyEditorAttemptCurrent(attempt, { ...attempt, editorSession: 5 })).toBe(false);
  });
  it("separates snapshot conflicts from transient and assurance retries", () => {
    expect(isPropertyVersionConflict(new ApiError("Changed", 409, "Properties.VersionConflict"))).toBe(true);
    expect(isPropertyVersionConflict(new ApiError("Unavailable", 503, "Properties.VersionConflict"))).toBe(false);
    expect(isPropertyVersionConflict(new ApiError("Confirm", 403, "Security.InsufficientAuthentication"))).toBe(false);
    expect(isPropertyVersionConflict(new ApiError("Different conflict", 409, "Properties.ManagementOperationConflict"))).toBe(false);
    expect(isPropertyVersionConflict(new Error("Properties.VersionConflict"))).toBe(false);
    expect(isPropertyVersionConflict(null)).toBe(false);
  });
  it("requires the exact active identity record before opening or sending an edit", () => {
    const current = { propertyId: "a", version: 3, status: "active" } as Property;
    expect(propertyIdentityRecordEditable(current, current)).toBe(true);
    expect(propertyIdentityRecordEditable(null, current)).toBe(false);
    expect(propertyIdentityRecordEditable({ ...current, propertyId: "b" }, current)).toBe(false);
    expect(propertyIdentityRecordEditable({ ...current, version: 4 }, current)).toBe(false);
    expect(propertyIdentityRecordEditable({ ...current, status: "retired" }, current)).toBe(false);
    expect(propertyIdentityRecordEditable(current, { ...current, status: "retired" })).toBe(false);
    const retired = { ...current, status: "retired" } as Property;
    expect(propertyIdentityRecordEditable(retired, retired)).toBe(false);
  });
});
