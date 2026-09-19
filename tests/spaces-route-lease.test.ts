import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, NavLink, Outlet, Route, Routes, useLocation, type Location } from "react-router";
import { describe, expect, it } from "vitest";
import { sameLeasedLocation } from "../src/app/routeNavigationLease";

// Real public declarative-router context composition. This proves the location
// input seen by nested consumers, not mounted history, focus or browser pixels.
const spaces: Location = { pathname: "/spaces", search: "?property=p&room=r&bed=d", hash: "", key: "spaces-d", state: null };
function Probe({ label }: { label: string }) {
  const location = useLocation(); return createElement("p", { "data-owner": label }, location.pathname + location.search + ":" + location.key);
}
function Layout() {
  return createElement("main", null, createElement(Probe, { label: "shell" }),
    createElement(NavLink, { to: "/spaces", children: "Spaces navigation" }),
    createElement(Probe, { label: "boundary-and-viewport" }), createElement(Outlet), createElement(Probe, { label: "preview-host" }));
}
describe("Spaces-only lease and stable effective routed layout", () => {
  it.each(["/calendar?property=p", "/?property=p"])("keeps all nested location consumers coherent while raw browser destination is %s", (raw) => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [raw] },
      createElement(Routes, { location: spaces }, createElement(Route, { element: createElement(Layout) },
        createElement(Route, { path: "/spaces", element: createElement(Probe, { label: "spaces-workspace" }) }),
        createElement(Route, { path: "/calendar", element: createElement("p", null, "Queued Calendar") }),
        createElement(Route, { path: "/", element: createElement("p", null, "Queued Today") })))));
    expect(html.match(/\/spaces\?property=p&amp;room=r&amp;bed=d:spaces-d/g)).toHaveLength(4);
    expect(html).toContain('aria-current="page"'); expect(html).not.toContain("Queued Calendar"); expect(html).not.toContain("Queued Today");
  });
  it("compares pathname/hash as well as semantic params, without conflating different origins", () => {
    expect(sameLeasedLocation(spaces, { ...spaces, search: "?bed=d&room=r&property=p", key: "other-entry" })).toBe(true);
    expect(sameLeasedLocation(spaces, { ...spaces, pathname: "/calendar" })).toBe(false);
    expect(sameLeasedLocation(spaces, { ...spaces, hash: "#other" })).toBe(false);
  });
  it("binds existing authority wrappers and every application route around one pathless effective layout", () => {
    const app = readFileSync("src/app/App.tsx", "utf8");
    const paths = [...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]);
    expect(paths).toEqual(["/", "/calendar", "/spaces", "/properties", "/privacy-requests", "/inventory", "/integrations", "/notifications", "/account", "/workspace", "/reservations", "/guests", "/staff", "*"]);
    expect(app).toContain("<Routes location={effectiveLocation}>"); expect(app).toContain("<Route element={<ApplicationRouteLayout />}>");
    expect(app).toMatch(/<WorkspaceProvider>\s*<AccessAuthorityProvider>\s*<WorkspaceGate>\s*<NotificationsProvider>\s*<RouteNavigationLeaseProvider>/);
    const layout = app.slice(app.indexOf("function ApplicationRouteLayout()"), app.indexOf("function RouteViewportReset"));
    for (const owned of ["useLocation()", "<OperationalPreviewProvider>", "<AppShell>", "resetKey={location.key}", "<RouteViewportReset pathname={location.pathname}", "<Outlet />", "<OperationalPreviewHost />"]) expect(layout).toContain(owned);
    const facade = readFileSync("src/features/spaces/useSpacesNavigationGuard.ts", "utf8"); expect(facade).not.toContain("useState"); expect(facade).toContain("useCurrentRouteNavigationLease()");
  });
});
