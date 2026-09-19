import { describe, expect, it } from "vitest";
import {
  parseSpacesReturnRoute,
  spacesReturnHref,
  withSpacesReturnRoute,
} from "../src/features/spaces/spacesReturnRoute";
import {
  parseOperationalReturnRoute,
  withOperationalReturnRoute,
  type OperationalPreviewRoute,
} from "../src/features/operational-preview/operationalPreviewRoute";

describe("Spaces owner return route", () => {
  it("round-trips exact stable targets without accepting an arbitrary pathname", () => {
    const propertyId = "11111111-1111-4111-8111-111111111111";
    const operationalRoute: OperationalPreviewRoute = {
      selection: {
        kind: "inventoryUnit",
        propertyId,
        inventoryUnitId: "22222222-2222-4222-8222-222222222222",
        roomId: "33333333-3333-4333-8333-333333333333",
        date: "2026-09-01",
        observedState: "available",
      },
      origin: {
        surface: "calendar",
        propertyId,
        date: "2026-09-01",
        day: "2026-09-01",
      },
    };
    const owner = withSpacesReturnRoute(withOperationalReturnRoute(new URLSearchParams(), operationalRoute), {
      section: "availability",
      propertyId,
      roomId: "room-a",
      bedId: "bed-a",
      inventoryUnitId: "unit-a",
      arrival: "2026-09-01",
      departure: "2026-09-03",
      filter: "Dorm 104 / quiet",
    });
    const parsed = parseSpacesReturnRoute(owner);

    expect(parsed).toEqual({
      section: "availability",
      propertyId,
      roomId: "room-a",
      bedId: "bed-a",
      inventoryUnitId: "unit-a",
      arrival: "2026-09-01",
      departure: "2026-09-03",
      filter: "Dorm 104 / quiet",
    });
    const returnHref = spacesReturnHref(parsed!, owner);
    const returnParams = new URLSearchParams(returnHref.split("?")[1]);
    expect(returnHref).toContain("/spaces?section=availability");
    expect(parseOperationalReturnRoute(returnParams)).toEqual(operationalRoute);
    expect(returnParams.get("q")).toBe("Dorm 104 / quiet");
  });

  it("rejects incomplete return state", () => {
    expect(parseSpacesReturnRoute(new URLSearchParams("spacesReturn=layout"))).toBeNull();
    expect(parseSpacesReturnRoute(new URLSearchParams("spacesReturnProperty=property-a"))).toBeNull();
  });

  it("rejects a cross-property owner and malformed range", () => {
    const crossProperty = new URLSearchParams("spacesReturn=blocks&spacesReturnProperty=property-a&property=property-b");
    expect(parseSpacesReturnRoute(crossProperty, crossProperty.get("property"))).toBeNull();
    expect(parseSpacesReturnRoute(new URLSearchParams(
      "spacesReturn=availability&spacesReturnProperty=property-a&spacesReturnArrival=2026-09-03&spacesReturnDeparture=2026-09-01",
    ))).toBeNull();
    expect(parseSpacesReturnRoute(new URLSearchParams(
      "spacesReturn=availability&spacesReturnProperty=property-a&spacesReturnArrival=2026-02-30&spacesReturnDeparture=2026-03-01",
    ))).toBeNull();
    expect(parseSpacesReturnRoute(new URLSearchParams(
      "spacesReturn=availability&spacesReturnProperty=property-a&spacesReturnArrival=2026-99-99&spacesReturnDeparture=2026-98-98",
    ))).toBeNull();
    expect(parseSpacesReturnRoute(new URLSearchParams(
      "spacesReturn=availability&spacesReturnProperty=property-a&spacesReturnArrival=2026-09-01",
    ))).toBeNull();
  });

  it("strips incomplete, injected, or cross-property operational return parameters", () => {
    const current = new URLSearchParams("opReturnFrom=calendar&opReturnAnything=unsafe");
    expect(spacesReturnHref({ section: "layout", propertyId: "property-a" }, current)).toBe(
      "/spaces?section=layout&property=property-a",
    );
  });

  it.each(["spacesReturn", "spacesReturnProperty", "spacesReturnRoom", "spacesReturnBed", "spacesReturnUnit", "spacesReturnBlockGroup", "spacesReturnHistory", "spacesReturnArrival", "spacesReturnDeparture", "spacesReturnQuery"])("rejects duplicate focused-return %s", (key) => {
    const route = withSpacesReturnRoute(new URLSearchParams(), { section: "layout", propertyId: "p", roomId: "r", bedId: "b", inventoryUnitId: "u", blockGroupId: "g", history: "all", arrival: "2026-09-01", departure: "2026-09-03", filter: "quiet" });
    route.append(key, route.get(key)!);
    expect(parseSpacesReturnRoute(route)).toBeNull();
  });

  it("rejects malformed optional targets instead of dropping them into a different return", () => {
    for (const extra of ["spacesReturnRoom=bad%2Froom", "spacesReturnQuery=%00", "spacesReturnAnything=injected"]) {
      expect(parseSpacesReturnRoute(new URLSearchParams("spacesReturn=layout&spacesReturnProperty=p&" + extra))).toBeNull();
    }
  });
});
