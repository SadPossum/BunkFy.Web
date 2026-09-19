import { spacesReturnHref } from "../spaces/spacesReturnRoute";
import { retirementUuid } from "./topologyRetirementEditorModel";

export function propertyRetirementLayoutHref(propertyId: string, params: URLSearchParams, pathname = "/spaces"): string {
  const destination = new URL(spacesReturnHref({ section: "layout", propertyId }, params), "https://property-retirement.invalid");
  const origin = new URLSearchParams(params);
  origin.set("property", propertyId); origin.set("retire", "property");
  origin.delete("propertyRetirementReturn");
  if (pathname === "/spaces") origin.set("section", "property");
  if (pathname === "/spaces" || pathname === "/properties") destination.searchParams.set("propertyRetirementReturn", pathname + "?" + origin);
  return destination.pathname + destination.search;
}
export function parsePropertyRetirementReturn(params: URLSearchParams, propertyId: string | null | undefined): { href: string; label: string } | null {
  const value = params.get("propertyRetirementReturn");
  if (!value || value.length > 4000 || !retirementUuid(propertyId)) return null;
  try {
    const url = new URL(value, "https://property-retirement.invalid");
    if (url.origin !== "https://property-retirement.invalid" || url.hash || (url.pathname !== "/spaces" && url.pathname !== "/properties")
      || url.searchParams.get("property") !== propertyId || url.searchParams.get("retire") !== "property"
      || (url.pathname === "/spaces" && url.searchParams.get("section") !== "property") || url.searchParams.has("propertyRetirementReturn")) return null;
    return { href: url.pathname + url.search, label: "Back to Property / retirement" };
  } catch { return null; }
}
