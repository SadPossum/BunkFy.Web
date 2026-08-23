import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Property, StaffDirectoryMember, StaffMember } from "../src/api/types";
import {
  staffLifecycleActionMatches,
  staffMutationAllowed,
  staffPropertyTargetMatches,
  staffRecordMatches,
  staffSensitiveRecordMatches,
} from "../src/features/staff/staffMutationAuthority";

const repositoryRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("staff source authority recovery", () => {
  it("requires only the current evidence consumed by each Staff command", () => {
    expect(staffMutationAllowed("create", {
      permissionsCurrent: true,
    })).toBe(true);

    for (const action of ["update-profile", "lifecycle", "account-link"] as const) {
      expect(staffMutationAllowed(action, {
        permissionsCurrent: true,
        memberCurrent: true,
      })).toBe(true);
      expect(staffMutationAllowed(action, {
        permissionsCurrent: true,
        memberCurrent: false,
      })).toBe(false);
    }

    expect(staffMutationAllowed("property-assignment", {
      permissionsCurrent: true,
      memberCurrent: true,
      propertyCurrent: true,
    })).toBe(true);
    expect(staffMutationAllowed("property-assignment", {
      permissionsCurrent: true,
      memberCurrent: true,
      propertyCurrent: false,
    })).toBe(false);

    for (const action of [
      "create",
      "update-profile",
      "lifecycle",
      "account-link",
      "property-assignment",
    ] as const) {
      expect(staffMutationAllowed(action, {
        permissionsCurrent: false,
        memberCurrent: true,
        propertyCurrent: true,
      })).toBe(false);
    }
  });

  it("rejects Staff commands when their exact record or sensitive state advances", () => {
    const directory = directoryMember();
    const sensitive = staffMember();

    expect(staffRecordMatches(directory, directory)).toBe(true);
    expect(staffRecordMatches({ ...directory, version: 8 }, directory)).toBe(false);
    expect(staffRecordMatches({ ...directory, status: "suspended" }, directory)).toBe(false);
    expect(staffRecordMatches({ ...directory, staffMemberId: "staff-b" }, directory)).toBe(false);

    expect(staffSensitiveRecordMatches(sensitive, sensitive)).toBe(true);
    expect(staffSensitiveRecordMatches({
      ...sensitive,
      lastChangedAtUtc: "2026-08-23T10:01:00Z",
    }, sensitive)).toBe(false);
    expect(staffSensitiveRecordMatches({
      ...sensitive,
      authSubjectId: "subject-b",
    }, sensitive)).toBe(false);
  });

  it("requires the same current property and valid lifecycle transition", () => {
    const property = currentProperty();

    expect(staffPropertyTargetMatches([property], property)).toBe(true);
    expect(staffPropertyTargetMatches([{ ...property, version: 8 }], property)).toBe(false);
    expect(staffPropertyTargetMatches([{ ...property, status: "retired" }], property)).toBe(false);
    expect(staffPropertyTargetMatches([{ ...property, processingStatus: "suspended" }], property)).toBe(false);
    expect(staffPropertyTargetMatches([], property)).toBe(false);

    expect(staffLifecycleActionMatches(directoryMember("active"), "suspend")).toBe(true);
    expect(staffLifecycleActionMatches(directoryMember("active"), "depart")).toBe(true);
    expect(staffLifecycleActionMatches(directoryMember("suspended"), "resume")).toBe(true);
    expect(staffLifecycleActionMatches(directoryMember("suspended"), "depart")).toBe(true);
    expect(staffLifecycleActionMatches(directoryMember("departed"), "resume")).toBe(false);
    expect(staffLifecycleActionMatches(directoryMember("departed"), "depart")).toBe(false);
  });

  it("keeps tenant, directory, sensitive profile, property, and permission evidence independent", () => {
    const page = source("features/staff/StaffPage.tsx");
    const detail = source("features/staff/StaffDetail.tsx");
    const assignments = source("features/staff/StaffAssignmentsPanel.tsx");

    expect(page).toContain("const tenantAccess = usePermissions(");
    expect(page).toContain("const assignmentAccess = usePermissions(");
    expect(page).toContain("const permissionSource = createCompositeSource({");
    expect(page).toContain("const assignmentPermissionSource = selectedProperty");
    expect(page).toContain("const propertySource = createCompositeSource({");
    expect(page).toContain("queryKey: [\"staff-members\", tenantId, deferredSearch, status, page]");
    expect(page).toContain("tenantIdRef.current !== targetTenantId");
    expect(page).toContain("if (tenantId) previousTenantIdRef.current = tenantId;");
    expect(page).toContain("disabled={!createAuthorityCurrent}");
    expect(page).not.toContain("tenantAccess.error ?");

    expect(detail).toContain("queryKey: [\"staff-member\", memberId, tenantId, \"directory\"]");
    expect(detail).toContain("queryKey: [\"staff-member\", memberId, tenantId, \"profile\"]");
    expect(detail).toContain("const directorySource = createCompositeSource({");
    expect(detail).toContain("const profileSource = createCompositeSource({");
    expect(detail).toContain("staffSensitiveRecordMatches(profile.data, member)");
    expect(detail).toContain("scopeKeyRef.current === `${targetTenantId}:${member.staffMemberId}`");
    expect(detail).toContain("<RecentAuthenticationPrompt");
    expect(detail).toContain("setEditingTarget(null);");
    expect(detail).toContain("authSubjectAttempt.current = null;");
    expect(detail).not.toContain("if (profile.error)");

    expect(assignments).toContain("staffPropertyTargetMatches(properties, target.property)");
    expect(assignments).toContain("staffRecordMatches(currentMember, targetMember)");
    expect(assignments).toContain("scopeKeyRef.current === `${targetTenantId}:${targetMember.staffMemberId}:${property.propertyId}`");
    expect(assignments).toContain("(target?.member ?? member).assignments.some");
  });
});

function directoryMember(
  status: StaffDirectoryMember["status"] = "active",
): StaffDirectoryMember {
  return {
    staffMemberId: "staff-a",
    displayName: "Maya Chen",
    jobTitle: "Manager",
    department: "Operations",
    status,
    version: 7,
    assignments: [],
  };
}

function staffMember(): StaffMember {
  return {
    ...directoryMember(),
    legalName: "Maya Q. Chen",
    workEmail: "maya@example.test",
    workPhone: null,
    employeeNumber: "EMP-42",
    authSubjectId: "subject-a",
    createdAtUtc: "2026-08-23T09:00:00Z",
    lastChangedAtUtc: "2026-08-23T10:00:00Z",
    assignments: [],
  };
}

function currentProperty(): Property {
  return {
    propertyId: "property-a",
    name: "Like Hostel",
    code: "LIKE",
    timeZoneId: "Europe/Moscow",
    status: "active",
    processingStatus: "enabled",
    version: 7,
  } as unknown as Property;
}
