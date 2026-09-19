import {
  withoutOperationalPreviewRoute,
  withoutOperationalReturnRoute,
} from "../../features/operational-preview/operationalPreviewRoute";
import { withoutSpacesReturnRoute } from "../../features/spaces/spacesReturnRoute";
import { withoutOperationalSurfaceReturn } from "../../features/operational-preview/operationalSurfaceReturn";
import {
  clearSpacesPropertyTargets,
  parseSpacesSection,
} from "../../features/spaces/spacesSectionRoute";

const routeTargetKeys: Readonly<Record<string, readonly string[]>> = {
  "/reservations": ["reservation", "affected", "section", "new", "focus"],
  "/guests": ["guest", "focus"],
  "/staff": ["member", "section", "page", "focus"],
  "/integrations": [
    "tab",
    "status",
    "page",
    "proposalStatus",
    "proposalPage",
    "activity",
    "source",
    "activityPage",
    "connection",
    "proposal",
    "run",
    "receipt",
    "attempt",
    "focus",
  ],
  "/privacy-requests": ["case", "page", "focus"],
};

const propertyRoutedPathnames = new Set([
  "/spaces",
  "/inventory",
  "/properties",
  ...Object.keys(routeTargetKeys),
]);

export function propertySwitchUpdatesRoute(
  pathname: string,
  current: URLSearchParams,
): boolean {
  return current.has("property") || propertyRoutedPathnames.has(normalizePathname(pathname));
}

export function propertySwitchSearchParams(
  pathname: string,
  current: URLSearchParams,
  propertyId: string,
): URLSearchParams {
  const routePathname = normalizePathname(pathname);
  let next = withoutOperationalPreviewRoute(current);
  next = withoutOperationalReturnRoute(next);
  next = withoutSpacesReturnRoute(next);
  next = withoutOperationalSurfaceReturn(next);

  if (routePathname === "/spaces" || routePathname === "/inventory" || routePathname === "/properties") {
    const section = routePathname === "/spaces" ? parseSpacesSection(next) : null;
    clearSpacesPropertyTargets(next);
    if (section) next.set("section", section);
  } else {
    (routeTargetKeys[routePathname] ?? ["focus"]).forEach((key) => next.delete(key));
  }

  next.set("property", propertyId);
  return next;
}

function normalizePathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}
