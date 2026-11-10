import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

const state = vi.hoisted(() => ({
  workspace: {
    selectedWorkspaceId: "workspace-a", properties: [] as { propertyId: string }[],
    propertiesLoaded: true, propertiesLoading: false, propertiesFetching: false,
    propertiesError: null as Error | null, refetchProperties: vi.fn(),
  },
  session: { tenantId: "workspace-a" },
  access: { hasData: true, error: null as Error | null, allows: vi.fn(() => true), refetch: vi.fn() },
  checks: [] as { permission: string; scope: string }[],
}));
vi.mock("../src/app/workspace", () => ({ useWorkspace: () => state.workspace }));
vi.mock("../src/app/session", () => ({ useSession: () => ({ session: state.session }) }));
vi.mock("../src/app/permissions", async importOriginal => ({
  ...await importOriginal<typeof import("../src/app/permissions")>(),
  usePermissions: (checks: typeof state.checks) => { state.checks = checks; return state.access; },
}));
import { PropertyRequiredState } from "../src/features/properties/PropertyRequiredState";

function render() {
  return renderToStaticMarkup(<MemoryRouter basename="/app" initialEntries={["/app/calendar"]}><PropertyRequiredState /></MemoryRouter>);
}
beforeEach(() => {
  Object.assign(state.workspace, { selectedWorkspaceId: "workspace-a", properties: [], propertiesLoaded: true,
    propertiesLoading: false, propertiesFetching: false, propertiesError: null });
  state.session.tenantId = "workspace-a";
  Object.assign(state.access, { hasData: true, error: null });
  state.access.allows.mockReturnValue(true);
});

describe("first-property guidance", () => {
  it("offers setup only with the actual tenant property-management grant and preserves URL prefixes", () => {
    expect(render()).toContain('href="/app/properties"');
    expect(state.checks).toEqual([{ permission: "properties.properties.manage", scope: "tenant:workspace-a" }]);
  });
  it("tells staff who can help without offering a creation command", () => {
    state.access.allows.mockReturnValue(false);
    const html = render();
    expect(html).toContain("Ask a workspace owner");
    expect(html).not.toContain('href="/app/properties"');
  });
  it.each(["loading", "fetching", "error"])("does not infer an empty catalogue from a %s directory", condition => {
    if (condition === "loading") state.workspace.propertiesLoaded = false;
    if (condition === "fetching") state.workspace.propertiesFetching = true;
    if (condition === "error") state.workspace.propertiesError = new Error("Directory unavailable");
    const html = render();
    expect(html).not.toContain("No properties yet");
    expect(html).not.toContain('href="/app/properties"');
  });
  it("keeps missing permission data distinct from denial", () => {
    state.access.hasData = false;
    const html = render();
    expect(html).toContain("Checking property setup access");
    expect(html).not.toContain("Ask a workspace owner");
  });
  it("does not use an old tenant's permission when workspace selection changes", () => {
    state.session.tenantId = "old-workspace";
    expect(render()).not.toContain('href="/app/properties"');
    expect(state.checks).toEqual([]);
  });
  it("preserves property selection when an accessible property already exists", () => {
    state.workspace.properties = [{ propertyId: "property-a" }];
    const html = render();
    expect(html).toContain("Choose a property first");
    expect(html).not.toContain("No properties yet");
    expect(html).not.toContain('href="/app/properties"');
  });
});
