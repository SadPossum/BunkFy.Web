import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { OperationalOriginLink } from "../operational-preview/OperationalOriginLink";
import { parseSpacesReturnRoute, spacesReturnHref } from "./spacesReturnRoute";
import { parseRetirementReturn } from "../properties/topologyRetirementRoutes";
import { parsePropertyRetirementReturn } from "../properties/propertyRetirementRoutes";

export function OwnerOriginLink({ className = "mb-4", params }: { className?: string; params?: URLSearchParams }) {
  const [routerParams] = useSearchParams();
  const searchParams = params ?? routerParams;
  const retirement = parsePropertyRetirementReturn(searchParams, searchParams.get("property")) ?? parseRetirementReturn(searchParams, searchParams.get("property"));
  if (retirement) return <Link to={retirement.href} data-retirement-origin-link
    className={`${className} inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary`}>
    <ArrowLeft size={16} />{retirement.label}
  </Link>;
  const route = parseSpacesReturnRoute(searchParams, searchParams.get("property"));

  if (!route) return <OperationalOriginLink className={className} params={searchParams} />;

  return (
    <Link
      to={spacesReturnHref(route, searchParams)}
      className={`${className} inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary transition hover:bg-primary/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
      data-spaces-origin-link
    >
      <ArrowLeft size={16} />
      Back to Spaces / {sectionLabel(route.section)}
    </Link>
  );
}

function sectionLabel(section: string): string {
  return `${section.slice(0, 1).toUpperCase()}${section.slice(1)}`;
}
