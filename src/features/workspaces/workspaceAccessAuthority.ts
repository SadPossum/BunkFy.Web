import {
  compositeSourceCurrent,
  type CompositeSource,
} from "../../app/compositeSourceState";

export function workspaceAccessSourcesCurrent(
  sources: readonly CompositeSource[],
): boolean {
  return sources.every(compositeSourceCurrent);
}

export function workspaceAccessActionAllowed(
  action: "grant" | "deny",
  authorityCurrent: boolean,
  recordCurrent: boolean,
): boolean {
  return action === "deny" || (authorityCurrent && recordCurrent);
}
