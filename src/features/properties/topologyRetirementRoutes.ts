import { retirementUuid, type RetirementCoordinates } from "./topologyRetirementEditorModel";

export function retirementTargetFromRoute(params: URLSearchParams, propertyId: string): RetirementCoordinates | null {
  const kind = params.get("retire");
  const roomId = params.get("room");
  const bedId = params.get("bed");
  if ((kind !== "room" && kind !== "bed") || !retirementUuid(propertyId) || !retirementUuid(roomId) || (kind === "bed" && !retirementUuid(bedId))) return null;
  return { propertyId, roomId, kind, ...(kind === "bed" ? { bedId: bedId! } : {}) };
}
export function withRetirementTarget(current: URLSearchParams, target: RetirementCoordinates, processId?: string) {
  const next = new URLSearchParams(current);
  next.set("property", target.propertyId); next.set("room", target.roomId); next.set("retire", target.kind);
  next.delete("edit"); next.delete("unit"); next.delete("focus");
  if (target.bedId) next.set("bed", target.bedId); else next.delete("bed");
  if (processId && retirementUuid(processId)) next.set("retirement", processId); else next.delete("retirement");
  return next;
}
export function withoutRetirementTarget(current: URLSearchParams) {
  const next = new URLSearchParams(current);
  next.delete("retire"); next.delete("retirement");
  return next;
}
export function withRetirementReturn(destination: URLSearchParams, pathname: string, current: URLSearchParams) {
  const next = new URLSearchParams(destination);
  const saved = new URLSearchParams(current);
  saved.delete("retirementReturn");
  if (pathname === "/spaces" || pathname === "/properties") next.set("retirementReturn", pathname + "?" + saved.toString());
  return next;
}
export function parseRetirementReturn(params: URLSearchParams, propertyId: string | null): { href: string; label: string } | null {
  const value = params.get("retirementReturn");
  if (!value || value.length > 4000 || !propertyId || !/^\/(spaces|properties)\?/.test(value)) return null;
  try {
    const url = new URL(value, "https://retirement.invalid");
    if (url.origin !== "https://retirement.invalid" || url.hash || url.searchParams.get("property") !== propertyId
      || !retirementTargetFromRoute(url.searchParams, propertyId)
      || (url.searchParams.has("retirement") && !retirementUuid(url.searchParams.get("retirement")))) return null;
    return { href: url.pathname + url.search, label: url.pathname === "/spaces" ? "Back to Spaces / retirement" : "Back to Properties / retirement" };
  } catch { return null; }
}
