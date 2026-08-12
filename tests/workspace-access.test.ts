import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
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

  it("waits until visible properties can resolve property-scoped access", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new ApiError("Access denied.", 403, "Properties.AccessDenied"))
      .mockResolvedValueOnce({ items: [], page: 1, pageSize: 1, hasMore: false });

    await waitForWorkspaceAccess(request, "workspace-a", {
      timeoutMs: 1_000,
      retryDelayMs: 0,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      "/api/properties?page=1&pageSize=1",
    );
  });

  it("reports a delayed projection instead of navigating into a denial", async () => {
    const request = vi.fn().mockRejectedValue(
      new ApiError("Access denied.", 403, "Properties.AccessDenied"),
    );

    await expect(waitForWorkspaceAccess(request, "workspace-a", {
      timeoutMs: 0,
      retryDelayMs: 0,
    })).rejects.toThrow("Workspace access is still being prepared");
  });

  it("does not retry authentication or server failures", async () => {
    const request = vi.fn().mockRejectedValue(new ApiError("Signed out.", 401));

    await expect(waitForWorkspaceAccess(request, "workspace-a", {
      timeoutMs: 1_000,
      retryDelayMs: 0,
    })).rejects.toThrow("Signed out.");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
