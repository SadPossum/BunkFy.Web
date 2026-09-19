import { describe, expect, it } from "vitest";
import {
  propertySwitchSearchParams,
  propertySwitchUpdatesRoute,
} from "../src/components/layout/propertySwitchRoute";

describe("property switching route state", () => {
  it("preserves the Spaces task while clearing cross-property targets and provenance", () => {
    const next = propertySwitchSearchParams(
      "/spaces",
      new URLSearchParams("property=a&section=blocks&blockGroup=g&unit=u&focus=g&opReturnFrom=calendar&spacesReturn=blocks"),
      "b",
    );
    expect(next.toString()).toBe("property=b&section=blocks");
  });

  it.each([
    ["/inventory", "room=r&unit=u&blockGroup=g&arrival=2026-09-01&departure=2026-09-02"],
    ["/properties", "room=r&bed=b&edit=bed"],
    ["/reservations", "reservation=r&affected=a&section=guest&new=1"],
    ["/guests", "guest=g&focus=g"],
    ["/staff", "member=m&section=access&page=3&scope=property"],
    ["/integrations", "connection=c&proposal=p&run=r&tab=activity&page=4"],
    ["/privacy-requests", "case=c&page=3&scope=guest&status=2"],
  ])("clears exact %s targets without retaining the prior property", (pathname, query) => {
    const next = propertySwitchSearchParams(
      pathname,
      new URLSearchParams(`property=a&${query}&opReturnFrom=today&spacesReturn=layout`),
      "b",
    );
    expect(next.get("property")).toBe("b");
    expect(next.get("opReturnFrom")).toBeNull();
    expect(next.get("spacesReturn")).toBeNull();
  });

  it.each([
    ["/reservations", "reservation=r&affected=a&section=guest&new=1", "property=b"],
    ["/guests", "guest=g&focus=g", "property=b"],
    ["/staff", "member=m&section=access&page=3&scope=property", "scope=property&property=b"],
    ["/integrations", "connection=c&proposal=p&run=r&tab=activity&page=4", "property=b"],
    ["/privacy-requests", "case=c&page=3&scope=guest&status=2", "scope=guest&status=2&property=b"],
  ])("clears stale %s targets even when the source URL omitted property", (pathname, query, expected) => {
    const current = new URLSearchParams(query);
    expect(propertySwitchUpdatesRoute(pathname, current)).toBe(true);
    expect(propertySwitchSearchParams(pathname, current, "b").toString()).toBe(expected);
  });

  it("leaves routes without property-owned state to the workspace selector", () => {
    expect(propertySwitchUpdatesRoute("/account", new URLSearchParams("section=security"))).toBe(false);
    expect(propertySwitchUpdatesRoute("/workspace", new URLSearchParams("section=members"))).toBe(false);
  });

  it.each([
    ["/spaces/", "property=a&section=blocks&blockGroup=g&unit=u", "property=b&section=blocks"],
    ["/inventory/", "room=r&unit=u&blockGroup=g", "property=b"],
    ["/reservations/", "reservation=r&affected=a&section=guest&new=1", "property=b"],
    ["/guests/", "guest=g&focus=g", "property=b"],
    ["/staff/", "member=m&section=access&page=3&scope=property", "scope=property&property=b"],
    ["/integrations/", "connection=c&proposal=p&run=r&tab=activity&page=4", "property=b"],
    ["/privacy-requests/", "case=c&page=3&scope=guest&status=2", "scope=guest&status=2&property=b"],
  ])("normalizes trailing-slash %s deep links before clearing old-property state", (pathname, query, expected) => {
    const current = new URLSearchParams(query);
    expect(propertySwitchUpdatesRoute(pathname, current)).toBe(true);
    expect(propertySwitchSearchParams(pathname, current, "b").toString()).toBe(expected);
  });

  it("keeps independent queue filters while clearing a privacy case selection", () => {
    const next = propertySwitchSearchParams(
      "/privacy-requests",
      new URLSearchParams("property=a&case=c&page=3&scope=guest&status=2"),
      "b",
    );
    expect(next.toString()).toBe("property=b&scope=guest&status=2");
  });
});
