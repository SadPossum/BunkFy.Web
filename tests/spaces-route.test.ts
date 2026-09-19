import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("Spaces foundation route", () => {
  it("adds one primary Spaces destination while retaining legacy owner routes", () => {
    const app = source("app/App.tsx");
    const shell = source("components/layout/AppShell.tsx");

    expect(app).toContain('<Route path="/spaces" element={<SpacesPage />} />');
    expect(app).toContain('<Route path="/properties" element={<PropertiesPage />} />');
    expect(app).toContain('<Route path="/inventory" element={<InventoryPage />} />');
    expect(shell).toContain('{ to: "/spaces?section=layout", label: "Spaces"');
    expect(shell).toContain('required: [permissions.propertiesRead]');
    expect(shell).not.toContain('{ to: "/inventory", label: "Inventory"');
    expect(shell).not.toContain('{ to: "/properties", label: "Properties"');
  });

  it("shares permission-shaped bulk reads while keeping Property editing secondary and controller-owned", () => {
    const page = source("features/spaces/SpacesPage.tsx");
    const property = source("features/spaces/SpacesPropertySection.tsx");
    const processing = source("features/properties/PropertyProcessingPanel.tsx");

    expect(page).not.toContain("useMutation");
    expect(page).not.toContain('method: "POST"');
    expect(page).not.toContain('method: "PUT"');
    expect(page).not.toContain('method: "DELETE"');
    expect(page).toContain("enabled: canLoadProperty && layoutOpen");
    expect(page).toContain("enabled: canLoadProperty && mayReadInventory && (layoutOpen || availabilityOpen || blocksOpen)");
    expect(page).toContain("mayReadInventory && availabilityOpen && availabilityRangeValid");
    expect(page).toContain("mayReadInventory && blocksOpen");
    expect(page).toContain("{propertyOpen && <SpacesPropertySection");
    expect(property).toContain("usePropertyEditor({");
    expect(property).toContain('<PropertyEditorForms editor={editor} inline kind="identity"');
    expect(property).toContain('<PropertyEditorForms editor={editor} inline kind="timezone"');
    expect(property).toContain("<PropertyProcessingPanel embedded");
    expect(property).toContain("permissionsCurrent && propertyCurrent && mayManageIdentity");
    expect(property).toContain("permissionsCurrent && propertyCurrent && mayManageTimeZone");
    expect(processing).toContain("enabled: permissionsCurrent");
    expect(processing).toContain("enabled: permissionsCurrent && canManage");
    expect(processing).toContain("propertyProcessingStateMatchesProperty(");
    expect(page).not.toContain("country-policies");
    expect(page).toContain("selectedRoom!.roomId");
    expect(page).toContain("no other room has been substituted");
    expect(page).not.toContain("Manage topology");
    expect(page).toContain("useTopologyEditor({");
    expect(page).toContain("useTopologyRetirementEditor({");
    expect(page).toContain(">Retire room</button>");
    expect(page).toContain(">Retire bed</button>");
    expect(page).not.toContain("Retire room or bed");
    expect(page).toContain('useSalesModeEditor({');
    expect(page).toContain('mayConfigure: mayConfigureInventory && (layoutOpen || availabilityOpen)');
    expect(page).not.toContain('ownerHref("/properties"');
    expect(page).toContain('parsePropertyRetirementReturn(searchParams, targetPropertyId)');
    expect(page).not.toContain('ownerHref("/inventory"');
    expect(page).toContain('Edit selling setup');
    expect(page).toContain('hidden={focusedSurfaceOpen}');
    expect(page).toContain('if (!context.has("property")) context.set("property", targetPropertyId)');
    expect(page).toContain('const { params: searchParams, setParams: setSearchParams } = navigation');
    expect(page.indexOf('params: searchParams')).toBeLessThan(page.indexOf('const topologyEditor = useTopologyEditor'));
    expect(page).toContain('const visibleSection = section');
    expect(page).toContain('const blockReadView = blockView === "all" || searchParams.has("blockGroup")');
  });

  it("makes URL targets authoritative and keeps role-shaped owner handoffs", () => {
    const page = source("features/spaces/SpacesPage.tsx");
    const shell = source("components/layout/AppShell.tsx");
    const propertySwitch = source("components/layout/propertySwitchRoute.ts");
    const preview = source("features/operational-preview/operationalPreviewModel.ts");
    const ownerOrigin = source("features/spaces/OwnerOriginLink.tsx");
    const inventory = source("features/inventory/InventoryPage.tsx");

    expect(page).toContain('searchParams.has("property")');
    expect(page).toContain('searchParams.has("room")');
    expect(page).not.toContain("previousSelectedPropertyRef");
    expect(page).toContain('editor={topologyEditor}');
    expect(page).toContain('mayManageRooms: layoutOpen && mayManageRooms, mayManageBeds: layoutOpen && mayManageBeds');
    expect(page).toContain('mayConfigureInventory={mayConfigureInventory}');
    expect(page).toContain('disabled={!salesEditor.canOpen(salesRoom)');
    expect(page).toContain('unitSelection.status === "unconfirmed"');
    expect(shell).toContain("propertySwitchSearchParams(location.pathname, current, value)");
    expect(propertySwitch).toContain("parseSpacesSection(next)");
    expect(propertySwitch).toContain("clearSpacesPropertyTargets(next)");
    expect(propertySwitch).toContain('routePathname === "/spaces"');
    expect(propertySwitch).toContain("normalizePathname(pathname)");
    expect(preview.match(/return `\/spaces\?\$\{withOrigin\.toString\(\)\}`/g)).toHaveLength(2);
    expect(ownerOrigin).toContain('parseSpacesReturnRoute(searchParams, searchParams.get("property"))');
    expect(ownerOrigin).toContain("if (!route) return <OperationalOriginLink");
    expect(inventory).toContain("function InventoryPageFrame");
    expect(inventory).toContain("<OwnerOriginLink />");
    expect(inventory.match(/<InventoryPageFrame>/g)).toHaveLength(4);
    expect(inventory).toContain('const hasRequestedProperty = searchParams.has("property")');
    expect(inventory).toContain("workspace.properties.find");
    expect(inventory).toContain("const focusedTargetReady = targetBlockGroupId ? blocksUsable : inventoryUsable");
  });

  it("keeps room and unit identities fully readable instead of ellipsizing them", () => {
    const page = source("features/spaces/SpacesPage.tsx");
    const inventory = source("features/inventory/InventoryPage.tsx");

    expect(page).not.toContain('className="block truncate font-semibold">{unit.label}');
    const workspace = source("features/spaces/SpacesRoomWorkspace.tsx");
    expect(workspace).toContain('break-words font-medium">{unit.label}');
    expect(workspace).toContain('<th scope="row"');
    expect(workspace).toContain('key={unit.key}');
    expect(inventory).toContain('whitespace-normal break-words font-semibold leading-5">{room.roomName}');
    expect(inventory).not.toContain('<p className="truncate font-semibold">{room.roomName}</p>');
  });
});
