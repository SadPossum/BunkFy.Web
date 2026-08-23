import {
  compositeSourceUsable,
  type CompositeSourceState,
} from "../../app/compositeSourceState";

export type WorkspaceGateMode =
  | "app"
  | "create"
  | "join"
  | "loading"
  | "unavailable";

export function reconcileSelectedWorkspaceId(
  selectedWorkspaceId: string,
  availableWorkspaceIds: string[],
  catalogueCurrent: boolean,
): string {
  if (!catalogueCurrent) return selectedWorkspaceId;
  if (availableWorkspaceIds.includes(selectedWorkspaceId)) {
    return selectedWorkspaceId;
  }

  return availableWorkspaceIds[0] ?? "";
}

export function resolveWorkspaceGateMode(
  pathname: string,
  catalogueState: CompositeSourceState,
  workspaceCount: number,
  selectedWorkspaceKnown: boolean,
  hasSelectedWorkspaceId: boolean,
): WorkspaceGateMode {
  if (pathname === "/join") return "join";
  if (pathname === "/workspace/new") return "create";
  if (catalogueState === "loading") return "loading";
  if (!compositeSourceUsable(catalogueState)) return "unavailable";
  if (workspaceCount === 0) {
    return catalogueState === "stale" && hasSelectedWorkspaceId
      ? "unavailable"
      : "create";
  }
  if (!selectedWorkspaceKnown) {
    return catalogueState === "ready" ? "loading" : "unavailable";
  }
  return "app";
}
