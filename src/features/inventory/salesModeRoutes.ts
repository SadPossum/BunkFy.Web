import type { RoomInventoryChangeImpact } from "../../api/types";
import { isOperationalRouteForProperty, parseOperationalReturnRoute, withOperationalReturnRoute } from "../operational-preview/operationalPreviewRoute";
import { parseOperationalSurfaceReturn, withOperationalSurfaceReturn } from "../operational-preview/operationalSurfaceReturn";
import { parseSpacesReturnRoute, withSpacesReturnRoute } from "../spaces/spacesReturnRoute";

function safeOrigin(current: URLSearchParams, propertyId: string) {
  let next = new URLSearchParams({ property: propertyId });
  const spaces = parseSpacesReturnRoute(current, propertyId);
  if (spaces) next = withSpacesReturnRoute(next, spaces);
  const operational = parseOperationalReturnRoute(current);
  if (operational && isOperationalRouteForProperty(operational, propertyId)) next = withOperationalReturnRoute(next, operational);
  const surface = parseOperationalSurfaceReturn(current, propertyId);
  if (surface) next = withOperationalSurfaceReturn(next, surface);
  return next;
}
export function inventorySalesSetupUrl(propertyId: string, roomId: string, current: URLSearchParams) {
  const next = safeOrigin(current, propertyId);
  next.set("room", roomId); next.set("focus", roomId);
  return `/inventory?${next}`;
}
export function affectedSalesReservationsUrl(impact: RoomInventoryChangeImpact | undefined, current: URLSearchParams, mayReadReservations: boolean): string | null {
  if (!mayReadReservations || !impact?.affectedReservationIds.length) return null;
  const next = safeOrigin(current, impact.propertyId);
  next.set("affected", impact.affectedReservationIds.join(","));
  next.set("focus", impact.affectedReservationIds[0]);
  next.set("reservation", impact.affectedReservationIds[0]);
  return `/reservations?${next}`;
}
