import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  Property,
  PropertyTimeZoneCatalogItem,
  PropertyTimeZoneCatalogPage,
  PropertyTimeZoneStatus,
} from "../../api/types";
import {
  compositeSourceCurrent,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import type { SelectPickerOption } from "../../components/ui/SelectPicker";
import { loadAllPropertyTimeZones } from "./propertiesApi";
import { timeZoneLabel } from "./propertyFormOptions";

export type PropertyTimeZoneCatalogState = {
  source: CompositeSource;
  data: PropertyTimeZoneCatalogPage | undefined;
  options: SelectPickerOption[];
  current: boolean;
  isSelectable: (timeZoneId: string) => boolean;
};

export function usePropertyTimeZoneCatalog(
  propertyId: string | null,
  enabled: boolean,
): PropertyTimeZoneCatalogState {
  const { request } = useSession();
  const query = useQuery({
    queryKey: ["property-time-zone-catalog", propertyId ?? "tenant"],
    queryFn: (context) => loadAllPropertyTimeZones(request, propertyId, context.signal),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const source = createCompositeSource({
    label: "Canonical time-zone catalogue",
    hasData: query.data !== undefined,
    isLoading: query.isLoading,
    error: query.error,
    isFetching: query.isFetching,
    refetch: () => query.refetch(),
  });
  const options = useMemo(
    () => (query.data?.timeZones ?? []).map(propertyTimeZoneOption),
    [query.data?.timeZones],
  );
  const selectable = useMemo(
    () => new Set((query.data?.timeZones ?? [])
      .filter((timeZone) => timeZone.runtimeAvailable)
      .map((timeZone) => timeZone.timeZoneId)),
    [query.data?.timeZones],
  );

  return {
    source,
    data: query.data,
    options,
    current: compositeSourceCurrent(source),
    isSelectable: (timeZoneId) => selectable.has(timeZoneId),
  };
}

export function propertyTimeZoneOption(
  timeZone: PropertyTimeZoneCatalogItem,
): SelectPickerOption {
  const countries = timeZone.countries.map((country) => country.name).join(", ");
  const availability = timeZone.runtimeAvailable ? null : "Unavailable on this server";
  return {
    value: timeZone.timeZoneId,
    label: timeZoneLabel(timeZone.timeZoneId),
    description: [
      formatUtcOffset(timeZone.utcOffsetMinutes),
      countries,
      availability,
    ].filter(Boolean).join(" · "),
    disabled: !timeZone.runtimeAvailable,
    searchTerms: propertyTimeZoneSearchTerms(timeZone),
    searchCodes: timeZone.countries.flatMap((country) => [country.code, ...(country.code === "GB" ? ["UK"] : country.code === "US" ? ["USA"] : country.code === "AE" ? ["UAE"] : [])]),
  };
}

// The server owns the selectable IANA catalogue. Intl only enriches country labels;
// it never invents selectable zones or replaces the server's availability decision.
const countryNames = new Map<string, Intl.DisplayNames>();
const commonCountryNames: Record<string, string[]> = {
  GB: ["UK", "United Kingdom", "Britain", "Great Britain"],
  US: ["USA", "United States", "United States of America"],
  AE: ["UAE", "United Arab Emirates"],
};

export function propertyTimeZoneSearchTerms(
  timeZone: PropertyTimeZoneCatalogItem,
  locales: readonly string[] = typeof navigator === "undefined" ? ["en"] : navigator.languages,
): string[] {
  const terms = [timeZone.timeZoneId, timeZone.comment ?? ""];
  for (const country of timeZone.countries) {
    const code = country.code.toUpperCase();
    terms.push(code, country.name, ...(commonCountryNames[code] ?? []));
    for (const locale of new Set(["en", ...locales])) {
      for (const style of ["long", "short"] as const) {
        try {
          const key = `${locale}:${style}`;
          let names = countryNames.get(key);
          if (!names) {
            names = new Intl.DisplayNames([locale], { type: "region", style });
            countryNames.set(key, names);
          }
          const name = names.of(code);
          if (name) terms.push(name);
        } catch {
          // Invalid/unsupported locale metadata cannot hide a valid server option.
        }
      }
    }
  }
  return [...new Set(terms.filter(Boolean))];
}

export function withStoredTimeZoneOption(
  options: SelectPickerOption[],
  property: Property,
): SelectPickerOption[] {
  if (options.some((option) => option.value === property.timeZoneId)) return options;
  return [{
    value: property.timeZoneId,
    label: timeZoneLabel(property.timeZoneId),
    description: "Current stored value · choose a canonical replacement",
    disabled: true,
  }, ...options];
}

export function initialPropertyTimeZoneTarget(property: Property): string {
  if (property.timeZoneStatus === "alias" && property.canonicalTimeZoneId) {
    return property.canonicalTimeZoneId;
  }
  return property.timeZoneId;
}

export function propertyTimeZoneRequiresConfirmation(
  property: Property,
  targetTimeZoneId: string,
): boolean {
  if (!targetTimeZoneId || targetTimeZoneId === property.timeZoneId) return false;
  return !property.canonicalTimeZoneId || targetTimeZoneId !== property.canonicalTimeZoneId;
}

export function propertyTimeZoneHealthCopy(status: PropertyTimeZoneStatus): {
  label: string;
  description: string;
  severity: "warning" | "error";
} | null {
  if (status === "canonical") return null;
  if (status === "alias") return {
    label: "Canonical time zone available",
    description: "Replace the stored alias without changing local-time rules.",
    severity: "warning",
  };
  if (status === "runtime-unavailable") return {
    label: "Time zone unavailable on this server",
    description: "Choose a compatible canonical time zone before relying on local-time operations.",
    severity: "error",
  };
  return {
    label: "Time zone needs correction",
    description: "Choose a canonical IANA time zone before relying on local-time operations.",
    severity: "warning",
  };
}

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60).toString().padStart(2, "0");
  const minutes = (absolute % 60).toString().padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}
