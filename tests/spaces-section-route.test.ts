import { describe, expect, it } from "vitest";
import { withOperationalReturnRoute } from "../src/features/operational-preview/operationalPreviewRoute";
import { withOperationalSurfaceReturn } from "../src/features/operational-preview/operationalSurfaceReturn";
import { withRetirementReturn } from "../src/features/properties/topologyRetirementRoutes";
import {
  clearSpacesPropertyTargets,
  parseSpacesSection,
  withSpacesSection,
  withSpacesFocusedSurface,
  spacesFocusedBackParams,
  spacesContextIssue,
  spacesNavigationAuthorityKey,
  spacesNavigationLabel,
  spacesRouteIsPaused,
} from "../src/features/spaces/spacesSectionRoute";

describe("Spaces section route", () => {
  it("holds only one valid actor/property authority and ignores equivalent parameter order", () => {
    const params = new URLSearchParams("property=p&room=r&bed=d");
    expect(spacesNavigationAuthorityKey("actor-a", params, "fallback")).toBe(JSON.stringify(["actor-a", "p"]));
    expect(spacesNavigationAuthorityKey("actor-a", new URLSearchParams("room=r"), "p")).toBe(JSON.stringify(["actor-a", "p"]));
    expect(spacesNavigationAuthorityKey("actor-b", params, "p")).not.toBe(spacesNavigationAuthorityKey("actor-a", params, "p"));
    for (const invalid of ["property=", "property=p&property=q", "property=p&room=bad%2Froom", "property=p&arrival=2026-09-07"]) {
      expect(spacesNavigationAuthorityKey("actor-a", new URLSearchParams(invalid), "p")).toBe("");
    }
    expect(spacesRouteIsPaused(null, params.toString())).toBe(false);
    expect(spacesRouteIsPaused(params.toString(), "bed=d&room=r&property=p")).toBe(false);
    expect(spacesRouteIsPaused(params.toString(), "property=p&room=r&bed=e")).toBe(true);
  });

  it("names the pending space or focused job and exact requested dates without a replacement target", () => {
    const rooms = [{ roomId: "r", name: "Dorm 104", inventoryUnits: [{ inventoryUnitId: "u-e", bedId: "e", label: "104-E" }] }];
    expect(spacesNavigationLabel(new URLSearchParams("room=r&bed=e&unit=u-e&arrival=2026-09-07&departure=2026-09-09"), rooms)).toBe("104-E (2026-09-07 to 2026-09-09)");
    expect(spacesNavigationLabel(new URLSearchParams("section=property"), rooms)).toBe("Property settings");
    expect(spacesNavigationLabel(new URLSearchParams("section=blocks"), rooms)).toBe("All holds");
    expect(spacesNavigationLabel(new URLSearchParams("room=missing"), rooms)).toBe("the requested room");
  });
  it("allowlists four sections and defaults unknown values to Layout", () => {
    for (const section of ["layout", "availability", "blocks", "property"] as const) {
      expect(parseSpacesSection(new URLSearchParams(`section=${section}`))).toBe(section);
    }
    expect(parseSpacesSection(new URLSearchParams("section=accounting"))).toBe("layout");
  });

  it("preserves origin state while switching jobs", () => {
    const next = withSpacesSection(
      new URLSearchParams("section=layout&property=p&room=r&opReturnFrom=calendar&focus=r"),
      "availability",
    );
    expect(next.get("section")).toBe("availability");
    expect(next.get("opReturnFrom")).toBe("calendar");
    expect(next.has("focus")).toBe(false);
  });

  it("clears every property-specific target without clearing the section or origin", () => {
    const next = new URLSearchParams("section=blocks&property=old&room=r&bed=b&unit=u&blockGroup=g&history=all&arrival=2026-09-01&departure=2026-09-02&q=OldDorm&spacesSurfaceFrom=availability&spacesSurfaceHistory=active&opReturnFrom=today");
    clearSpacesPropertyTargets(next);
    expect(next.toString()).toBe("section=blocks&property=old&opReturnFrom=today");
  });

  it.each(["property", "blocks"] as const)("round-trips exact selected dates/history/filter through focused %s", (surface) => {
    for (const history of ["", "&history=all"]) {
      const before = new URLSearchParams("section=availability&property=p&room=r&bed=b&unit=u&blockGroup=g&arrival=2026-09-01&departure=2026-09-03&q=Dorm+104" + history);
      const opened = withSpacesFocusedSurface(before, surface)!;
      expect(opened.get("section")).toBe(surface);
      expect(opened.get("spacesSurfaceFrom")).toBe("availability");
      expect(spacesFocusedBackParams(opened)!.toString()).toBe(before.toString());
      expect(before.has("spacesSurfaceFrom")).toBe(false);
    }
  });

  it("preserves a new released-group receipt while restoring the original selected history choice", () => {
    const opened = withSpacesFocusedSurface(new URLSearchParams("section=layout&property=p&room=r&unit=u&q=Other&arrival=2026-09-01&departure=2026-09-03"), "blocks")!;
    opened.set("blockGroup", "released-exact");
    const back = spacesFocusedBackParams(opened)!;
    expect(back.get("blockGroup")).toBe("released-exact"); expect(back.get("q")).toBe("Other");
    expect(back.get("unit")).toBe("u"); expect(back.has("history")).toBe(false);
  });

  it("keeps legacy focused entry reversible with exact identities and no invented origin", () => {
    const back = spacesFocusedBackParams(new URLSearchParams("section=blocks&property=p&room=r&bed=b&unit=u&history=all"))!;
    expect(back.toString()).toBe("section=layout&property=p&room=r&bed=b&unit=u&history=all");
  });

  it.each(["property", "room", "bed", "unit", "blockGroup", "arrival", "departure", "q", "section", "spacesSurfaceFrom", "spacesSurfaceHistory"])("rejects duplicate %s without accepting a first value", (key) => {
    const route = new URLSearchParams("section=layout&property=p&room=r&bed=b&unit=u&blockGroup=g&arrival=2026-09-01&departure=2026-09-03&q=Dorm&spacesSurfaceFrom=layout&spacesSurfaceHistory=active");
    route.append(key, route.get(key)!);
    expect(spacesContextIssue(route)).toBeTruthy();
    expect(withSpacesFocusedSurface(route, "property")).toBeNull();
    expect(spacesFocusedBackParams(route)).toBeNull();
  });

  it("rejects incomplete dates, invalid identities and conflicting/cross-property origins", () => {
    for (const query of ["property=p&arrival=2026-09-01", "property=p&room=bad%2Froom", "property=p&opReturnFrom=calendar", "property=p&surfaceReturn=today&surfaceReturnProperty=other&surfaceReturnView=visual", "property=p&retirementReturn=https%3A%2F%2Fexample.com", "property=p&spacesSurfaceFrom=property"]) {
      expect(withSpacesFocusedSurface(new URLSearchParams(query), "blocks")).toBeNull();
    }
  });

  it("retains the supported operational and retirement origins byte-for-byte through focused surfaces", () => {
    const propertyId = "11111111-1111-4111-8111-111111111111", roomId = "22222222-2222-4222-8222-222222222222", unitId = "33333333-3333-4333-8333-333333333333";
    const base = new URLSearchParams({ section: "layout", property: propertyId, room: roomId, unit: unitId, q: "exact filter", arrival: "2026-09-07", departure: "2026-09-09" });
    const retired = withRetirementReturn(base, "/spaces", new URLSearchParams({ property: propertyId, room: roomId, retire: "room" }));
    const propertyRetired = new URLSearchParams(base);
    propertyRetired.set("propertyRetirementReturn", "/spaces?" + new URLSearchParams({ property: propertyId, section: "property", retire: "property" }));
    const origins = [
      withOperationalReturnRoute(base, { selection: { kind: "inventoryUnit", propertyId, inventoryUnitId: unitId, roomId, date: "2026-09-07", observedState: "available" }, origin: { surface: "calendar", propertyId, date: "2026-09-07", day: "2026-09-07" } }),
      withOperationalSurfaceReturn(base, { surface: "today", propertyId, view: "operations" }),
      retired, propertyRetired,
    ];
    for (const origin of origins) {
      const focused = withSpacesFocusedSurface(origin, "blocks");
      expect(focused).not.toBeNull();
      expect(spacesFocusedBackParams(focused!)!.toString()).toBe(origin.toString());
    }
  });
});
