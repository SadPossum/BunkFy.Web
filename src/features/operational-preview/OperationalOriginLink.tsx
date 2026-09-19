import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import {
  permissions,
  propertyAccessScope,
  usePermissions,
} from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import {
  isOperationalRouteForProperty,
  operationalOriginHref,
  operationalOriginLabel,
  parseOperationalReturnRoute,
} from "./operationalPreviewRoute";
import { operationalSurfaceOriginHref, parseOperationalSurfaceReturn } from "./operationalSurfaceReturn";

export function OperationalOriginLink({ className = "mb-4", params }: { className?: string; params?: URLSearchParams }) {
  const [routerParams] = useSearchParams();
  const searchParams = params ?? routerParams;
  const { session } = useSession();
  const { selectedPropertyId } = useWorkspace();
  const route = parseOperationalReturnRoute(searchParams);
  const surfaceOrigin = parseOperationalSurfaceReturn(searchParams);
  const propertyId = route?.selection.propertyId ?? surfaceOrigin?.propertyId ?? "";
  const scope = session && propertyId
    ? propertyAccessScope(session.tenantId, propertyId)
    : "";
  const access = usePermissions(scope ? [
    { permission: permissions.reservationsRead, scope },
    { permission: permissions.inventoryRead, scope },
  ] : []);
  const originReadable = access.hasData
    && !access.error
    && access.allows(permissions.reservationsRead, scope)
    && access.allows(permissions.inventoryRead, scope);

  if (!originReadable || propertyId !== selectedPropertyId
    || (searchParams.has("property") && searchParams.get("property") !== propertyId)) return null;
  if (route && !isOperationalRouteForProperty(route, selectedPropertyId)) return null;
  const origin = route?.origin ?? surfaceOrigin;
  if (!origin) return null;

  return (
    <Link
      to={route ? operationalOriginHref(route) : operationalSurfaceOriginHref(surfaceOrigin!)}
      className={`${className} inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary transition hover:bg-primary/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
      data-operational-origin-link
    >
      <ArrowLeft size={16} />
      {operationalOriginLabel(origin)}
    </Link>
  );
}
