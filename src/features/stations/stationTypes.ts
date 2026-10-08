import type { components } from "../../api/contracts.generated";

// Generated from the enabled backend surface; no parallel handwritten wire DTOs.
export type StationCurrent = components["schemas"]["StationCurrentResponse"];
export type StationSession = components["schemas"]["StationSessionSnapshot"];
export type StationRuntime = components["schemas"]["StationRuntimeResponse"];
export type StationRoster = components["schemas"]["StationRosterResponse"];
export type StationArrivals = components["schemas"]["StationArrivalsResponse"];
export type StationArrival = components["schemas"]["StationFirstJobArrival"];
export type StationDeparturesPage = components["schemas"]["StationDeparturesResponse"];
export type StationDeparture = components["schemas"]["StationFirstJobDeparture"];
export type StationManagementResult = components["schemas"]["StationManagementHttpResponse"];
export type StationOwnPinStatus = components["schemas"]["StationOwnPinStatusResponse"];
export type StationManagementRequest = components["schemas"]["StationManagementRequest"];
export type StationList = components["schemas"]["StationListResponse"];
export type StationStaffStatus = components["schemas"]["StationStaffStatusResponse"];

export const stationState = { invalid: 0, locked: 1, active: 2, unavailable: 3, changed: 4, securing: 5 } as const;

export function isStationPath(pathname: string): boolean {
  return pathname === "/station" || pathname.startsWith("/station/");
}
