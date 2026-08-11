// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationMembershipSummary } from "../src/api/types";
import { WorkspaceSettingsPage } from "../src/features/workspaces/WorkspaceSettingsPage";

const testState = vi.hoisted(() => ({
  workspace: null as OrganizationMembershipSummary | null,
  completions: new Map<string, Promise<string>>(),
  request: vi.fn(),
  refetchWorkspaces: vi.fn(async () => undefined),
}));

vi.mock("../src/app/session", () => ({
  useSession: () => ({
    request: testState.request,
    session: {
      subjectId: "30000000-0000-4000-8000-000000000001",
      tenantId: testState.workspace?.organization.organizationId ?? "global",
      username: "owner@example.com",
    },
  }),
}));

vi.mock("../src/app/workspace", () => ({
  useWorkspace: () => ({
    selectedWorkspace: testState.workspace,
    properties: [],
    refetchWorkspaces: testState.refetchWorkspaces,
  }),
}));

vi.mock("../src/app/permissions", () => ({
  permissions: {
    accessProfilesRead: "access-control.profiles.read",
    accessProfilesManage: "access-control.profiles.manage",
    staffManage: "staff.manage",
    retentionRead: "retention.read",
  },
  tenantAccessScope: (tenantId: string) => `tenant:${tenantId}`,
  usePermissions: () => ({
    isLoading: false,
    error: null,
    allows: () => true,
  }),
}));

vi.mock("../src/features/workspaces/WorkspaceInvitesSettings", async () => {
  const { createElement, useEffect, useState } = await import("react");

  return {
    WorkspaceInvitesSettings: ({ workspaceId }: { workspaceId: string }) => {
      const [token, setToken] = useState<string | null>(null);

      useEffect(() => {
        void testState.completions.get(workspaceId)?.then(setToken);
      }, [workspaceId]);

      return createElement(
        "output",
        { "data-testid": "invite-completion" },
        `${workspaceId}:${token ?? "pending"}`,
      );
    },
  };
});

describe("workspace settings recovery boundaries", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    testState.completions.clear();
    testState.request.mockReset();
    testState.refetchWorkspaces.mockReset();
    testState.refetchWorkspaces.mockResolvedValue(undefined);
    testState.workspace = workspace("a");
    window.sessionStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it("ignores a delayed workspace-A completion after switching to workspace B", async () => {
    const completionA = deferred<string>();
    const completionB = deferred<string>();
    testState.completions.set(workspaceId("a"), completionA.promise);
    testState.completions.set(workspaceId("b"), completionB.promise);

    await renderPage();
    await act(async () => {
      inviteTab().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(completionText()).toBe(`${workspaceId("a")}:pending`);

    testState.workspace = workspace("b");
    await renderPage();
    expect(completionText()).toBe(`${workspaceId("b")}:pending`);

    await act(async () => completionA.resolve("token-from-a"));
    expect(completionText()).toBe(`${workspaceId("b")}:pending`);
    expect(container.textContent).not.toContain("token-from-a");

    await act(async () => completionB.resolve("token-from-b"));
    expect(completionText()).toBe(`${workspaceId("b")}:token-from-b`);
  });

  it("replays the same update after PUT succeeds but the authoritative refetch fails", async () => {
    testState.request.mockResolvedValue({
      ...testState.workspace!.organization,
      version: 2,
    });
    testState.refetchWorkspaces
      .mockRejectedValueOnce(new Error("Workspace refresh failed."))
      .mockResolvedValueOnce(undefined);

    await renderPage();
    await clickSave();
    await act(async () => {
      await vi.waitFor(() => {
        expect(testState.request).toHaveBeenCalledTimes(1);
        expect(testState.refetchWorkspaces).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain("Workspace refresh failed.");
      });
    });
    expect(window.sessionStorage.length).toBe(1);

    await clickSave();
    await act(async () => {
      await vi.waitFor(() => {
        expect(testState.request).toHaveBeenCalledTimes(2);
        expect(testState.refetchWorkspaces).toHaveBeenCalledTimes(2);
        expect(container.textContent).not.toContain("Workspace refresh failed.");
      });
    });

    const requestBodies = testState.request.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)) as {
        operationId: string;
        expectedVersion: number;
      });
    expect(requestBodies[1]?.operationId).toBe(requestBodies[0]?.operationId);
    expect(requestBodies.map((body) => body.expectedVersion)).toEqual([1, 1]);
    expect(window.sessionStorage.length).toBe(0);
  });

  async function renderPage() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkspaceSettingsPage />
        </QueryClientProvider>,
      );
    });
  }

  function inviteTab(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent?.includes("Invites"));
    if (!button) throw new Error("Invites tab was not rendered.");
    return button;
  }

  function completionText(): string | null {
    return container.querySelector('[data-testid="invite-completion"]')?.textContent ?? null;
  }

  async function clickSave() {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent?.includes("Save changes"));
    if (!button) throw new Error("Save changes button was not rendered.");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function workspace(suffix: "a" | "b"): OrganizationMembershipSummary {
  const id = workspaceId(suffix);
  return {
    organization: {
      organizationId: id,
      scopeId: id,
      name: `Workspace ${suffix.toUpperCase()}`,
      slug: `workspace-${suffix}`,
      status: "active",
      activeOwnerCount: 1,
      version: 1,
      createdAtUtc: "2026-08-11T00:00:00Z",
      lastChangedAtUtc: "2026-08-11T00:00:00Z",
    },
    membership: {
      membershipId: `20000000-0000-4000-8000-00000000000${suffix === "a" ? "1" : "2"}`,
      organizationId: id,
      subjectId: "30000000-0000-4000-8000-000000000001",
      role: "owner",
      status: "active",
      version: 1,
      joinedAtUtc: "2026-08-11T00:00:00Z",
      lastChangedAtUtc: "2026-08-11T00:00:00Z",
    },
  };
}

function workspaceId(suffix: "a" | "b"): string {
  return `10000000-0000-4000-8000-00000000000${suffix === "a" ? "1" : "2"}`;
}
