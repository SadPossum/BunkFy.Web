import { describe, expect, it, vi } from "vitest";
import { accessChecksMatchTenant } from "../src/app/permissions";
import { waitForWorkspaceAccess } from "../src/features/workspaces/workspaceAccess";

describe("workspace access readiness", () => {
  it("does not evaluate tenant permissions until the session uses that workspace", () => {
    const checks = [{ permission: "properties.read", scope: "tenant:workspace-a" }];

    expect(accessChecksMatchTenant("global", checks)).toBe(false);
    expect(accessChecksMatchTenant("workspace-b", checks)).toBe(false);
    expect(accessChecksMatchTenant("workspace-a", checks)).toBe(true);
    expect(accessChecksMatchTenant("workspace-a", [{
      permission: "inventory.read",
      scope: "tenant:workspace-a/property:property-a",
    }])).toBe(true);
  });

  it("waits until the access projection grants baseline workspace access", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ permissions: [{ allowed: false }] })
      .mockResolvedValueOnce({ permissions: [{ allowed: true }] });

    await waitForWorkspaceAccess(request, "workspace-a", {
      timeoutMs: 1_000,
      retryDelayMs: 0,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      "/api/access/permissions/evaluate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          checks: [{
            permission: "properties.read",
            scope: "tenant:workspace-a",
          }],
        }),
      }),
    );
  });

  it("reports a delayed projection instead of navigating into a denial", async () => {
    const request = vi.fn().mockResolvedValue({
      permissions: [{ allowed: false }],
    });

    await expect(waitForWorkspaceAccess(request, "workspace-a", {
      timeoutMs: 0,
      retryDelayMs: 0,
    })).rejects.toThrow("Workspace access is still being prepared");
  });
});
