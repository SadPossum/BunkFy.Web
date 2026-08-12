import { describe, expect, it } from "vitest";
import {
  navigationItemAllowed,
  navigationScopes,
} from "../src/components/layout/navigationAccess";

describe("navigation access", () => {
  const tenant = "tenant:workspace";
  const property = `${tenant}/property:allowed`;

  it("includes the selected property for operational navigation", () => {
    expect(navigationScopes("tenant-or-property", tenant, property)).toEqual([
      tenant,
      property,
    ]);
  });

  it("shows a property-scoped page without granting tenant-wide access", () => {
    const granted = new Set([`properties.read@${property}`]);

    expect(navigationItemAllowed(
      ["properties.read"],
      navigationScopes("tenant-or-property", tenant, property),
      (permission, scope) => granted.has(`${permission}@${scope}`),
    )).toBe(true);
    expect(navigationItemAllowed(
      ["reservations.read"],
      navigationScopes("tenant-or-property", tenant, property),
      (permission, scope) => granted.has(`${permission}@${scope}`),
    )).toBe(false);
  });

  it("requires every permission for a composite navigation item", () => {
    const granted = new Set([
      `properties.read@${property}`,
      `reservations.read@${property}`,
    ]);

    expect(navigationItemAllowed(
      ["properties.read", "inventory.read", "reservations.read"],
      [tenant, property],
      (permission, scope) => granted.has(`${permission}@${scope}`),
    )).toBe(false);
  });

  it("keeps tenant-only settings independent of property selection", () => {
    expect(navigationScopes("tenant", tenant, property)).toEqual([tenant]);
    expect(navigationItemAllowed([], [tenant], () => false)).toBe(true);
  });

  it("does not turn property access into a tenant-wide Staff grant", () => {
    const granted = new Set([`staff.read@${property}`]);

    expect(navigationItemAllowed(
      ["staff.read"],
      navigationScopes("tenant", tenant, property),
      (permission, scope) => granted.has(`${permission}@${scope}`),
    )).toBe(false);
  });
});
