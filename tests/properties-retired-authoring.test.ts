import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bed, Property, Room } from "../src/api/types";
import { PropertiesPage } from "../src/features/properties/PropertiesPage";

const fixture = vi.hoisted(() => ({ property: null as Property | null, manage: true, current: true }));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: vi.fn(), session: null }) }));
vi.mock("../src/app/workspace", () => ({ useWorkspace: () => ({
  properties: fixture.property ? [fixture.property] : [], selectedPropertyId: fixture.property?.propertyId ?? "",
  propertiesLoaded: true, propertiesLoading: false, propertiesFetching: !fixture.current,
  propertiesError: null, refetchProperties: vi.fn(), setSelectedPropertyId: vi.fn(),
}) }));
vi.mock("../src/app/permissions", async (original) => ({
  ...await original<typeof import("../src/app/permissions")>(),
  usePermissions: () => ({ hasData: true, isLoading: false, isFetching: false, error: null,
    refetch: vi.fn(), allows: () => fixture.manage }),
}));

const property = { propertyId: "11111111-1111-4111-8111-111111111111", name: "QA property", code: "QA",
  status: "active", processingStatus: "unconfigured", timeZoneId: "Etc/UTC", timeZoneStatus: "canonical", version: 3 } as Property;
const room = { propertyId: property.propertyId, roomId: "22222222-2222-4222-8222-222222222222",
  name: "QA room", buildingLabel: null, floorLabel: null, status: "active", version: 1 } as Room;
const bed = { propertyId: property.propertyId, roomId: room.roomId, bedId: "33333333-3333-4333-8333-333333333333",
  label: "QA bed", status: "active", version: 1, roomVersion: 1 } as Bed;

function render(status: Property["status"], rooms: Room[] = [], beds: Bed[] = []) {
  fixture.property = { ...property, status };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  client.setQueryData(["rooms", property.propertyId], { rooms, hasMore: false });
  client.setQueryData(["beds", property.propertyId, room.roomId], { beds, hasMore: false });
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(MemoryRouter, { initialEntries: [`/properties?property=${property.propertyId}`] }, createElement(PropertiesPage))));
  } finally { client.clear(); }
}
afterEach(() => { fixture.manage = true; fixture.current = true; });

describe("legacy retired-property authoring entries", () => {
  it("removes both dead Add room controls and contradictory retired empty guidance, preserving New property", () => {
    const html = render("retired");
    expect(html).not.toContain("Add room</button>");
    expect(html).not.toContain("Add the first room");
    expect(html).toContain("This retired property has no room records. Rooms cannot be added.");
    expect(html).toContain("New property</button>");
  });

  it("keeps existing room/bed facts readable without authoring or retirement toolbar entries", () => {
    const html = render("retired", [room], [bed]);
    expect(html).toContain("QA room");
    expect(html).toContain("QA bed");
    expect(html).not.toContain("Actions for QA room");
    expect(html).not.toContain("Actions for QA bed");
    expect(html).not.toMatch(/Add (room|bed|beds)<\/button>/);
    expect(html).not.toContain("Retire</button>");
    expect(html).toContain("New property</button>");
  });

  it("replaces retired empty-bed instructions without suggesting selling configuration", () => {
    const html = render("retired", [room]);
    expect(html).toContain("No bed records are stored for this room. Beds cannot be added to a retired property.");
    expect(html).not.toContain("Add beds for bed-level sales");
    expect(html).not.toMatch(/Add beds?<\/button>/);
  });

  it("retains active-property add/edit entries and independent tenant creation", () => {
    expect(render("active").match(/Add room<\/button>/g)).toHaveLength(2);
    const html = render("active", [room], [bed]);
    expect(html).toContain("Edit room</button>");
    expect(html).toContain("Actions for QA bed");
    expect(html).toContain("Add bed</button>");
    expect(html).toContain("New property</button>");
    fixture.current = false;
    const stale = render("active", [room], [bed]);
    // Room creation consumes the property version; other existing command
    // evidence requirements are unchanged by this presentation correction.
    expect(stale).not.toContain("Add room</button>");
    expect(stale).toContain("New property</button>");
    fixture.current = true; fixture.manage = false;
    expect(render("active", [room], [bed])).not.toMatch(/(?:Add (?:room|bed|beds)|New property)<\/button>/);
  });
});
