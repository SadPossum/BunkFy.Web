import { useCurrentRouteNavigationLease } from "../../app/routeNavigationLease";

// Registration facade only: the single owner lives above Routes so a first-entry
// Back to Calendar/Today cannot unmount a dirty or pending Spaces workspace.
export function useSpacesNavigationGuard() {
  return useCurrentRouteNavigationLease();
}
export type SpacesNavigationGuard = ReturnType<typeof useSpacesNavigationGuard>;
