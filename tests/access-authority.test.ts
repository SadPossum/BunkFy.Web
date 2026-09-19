import { describe, expect, it } from "vitest";
import {
  ACCESS_AUTHORITY_REFRESH_INTERVAL_MS,
  accessAuthorityChecksMatchTenant,
  accessAuthorityQuerySurvivesScrub,
  grantedAccessPermissionKeys,
  mergeAccessPermissionChecks,
  revokedAccessPermissionKeys,
} from "../src/app/accessAuthority";

describe("access authority", () => {
  it("batches active permission checks into one stable unique request", () => {
    expect(mergeAccessPermissionChecks([
      [
        { permission: "reservations.read", scope: "tenant:one/property:first" },
        { permission: "inventory.read", scope: "tenant:one/property:first" },
      ],
      [
        { permission: "reservations.read", scope: "tenant:one/property:first" },
        { permission: "reservations.create", scope: "tenant:one/property:first" },
      ],
    ])).toEqual([
      { permission: "inventory.read", scope: "tenant:one/property:first" },
      { permission: "reservations.create", scope: "tenant:one/property:first" },
      { permission: "reservations.read", scope: "tenant:one/property:first" },
    ]);
  });

  it("detects only permissions that were allowed and are still actively observed", () => {
    expect(revokedAccessPermissionKeys(
      new Set(["inventory.read@scope", "reservations.manage@scope", "staff.read@scope"]),
      new Set(["inventory.read@scope"]),
      ["inventory.read@scope", "reservations.manage@scope"],
    )).toEqual(["reservations.manage@scope"]);
  });

  it("detects newly granted permissions only after an earlier authority snapshot", () => {
    expect(grantedAccessPermissionKeys(
      new Set(["inventory.read@scope"]),
      new Set(["inventory.read@scope", "reservations.read@scope"]),
      new Set(["inventory.read@scope", "reservations.read@scope", "staff.read@scope"]),
      ["inventory.read@scope", "reservations.read@scope", "staff.read@scope"],
    )).toEqual(["reservations.read@scope"]);
  });

  it("retains only authority and workspace-catalogue queries after revocation", () => {
    expect(accessAuthorityQuerySurvivesScrub(["access-permissions", "actor"])).toBe(true);
    expect(accessAuthorityQuerySurvivesScrub(["organizations", "mine"])).toBe(true);
    expect(accessAuthorityQuerySurvivesScrub(["organizations", "workspace", "members"])).toBe(false);
    expect(accessAuthorityQuerySurvivesScrub(["staff-members"])).toBe(false);
    expect(accessAuthorityQuerySurvivesScrub(["reservation", "property", "id"])).toBe(false);
  });

  it("converges inside the five-second online revocation contract", () => {
    expect(ACCESS_AUTHORITY_REFRESH_INTERVAL_MS).toBeLessThan(5_000);
  });

  it("does not evaluate checks outside the active tenant boundary", () => {
    expect(accessAuthorityChecksMatchTenant("one", [
      { permission: "staff.read", scope: "tenant:one" },
      { permission: "reservations.read", scope: "tenant:one/property:first" },
    ])).toBe(true);
    expect(accessAuthorityChecksMatchTenant("one", [
      { permission: "staff.read", scope: "tenant:two" },
    ])).toBe(false);
    expect(accessAuthorityChecksMatchTenant("global", [
      { permission: "staff.read", scope: "tenant:one" },
    ])).toBe(false);
  });
});
