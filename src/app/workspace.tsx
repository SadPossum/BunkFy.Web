import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Property, PropertyListResponse } from "../api/types";
import { useSession } from "./session";

type WorkspaceValue = {
  properties: Property[];
  propertiesLoading: boolean;
  propertiesError: unknown;
  selectedProperty: Property | null;
  selectedPropertyId: string;
  setSelectedPropertyId: (id: string) => void;
  refetchProperties: () => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { request, session } = useSession();
  const storageKey = `bunkfy.property.${session?.tenantId ?? "default"}`;
  const [selectedPropertyId, setSelectedPropertyIdState] = useState(() => localStorage.getItem(storageKey) ?? "");
  const query = useQuery({
    queryKey: ["properties", session?.tenantId],
    queryFn: () => request<PropertyListResponse>("/api/properties?page=1&pageSize=100"),
  });
  const properties = query.data?.properties ?? [];

  useEffect(() => {
    if (!selectedPropertyId && properties[0]) setSelectedPropertyIdState(properties[0].propertyId);
    if (selectedPropertyId && properties.length && !properties.some((property) => property.propertyId === selectedPropertyId)) {
      setSelectedPropertyIdState(properties[0]?.propertyId ?? "");
    }
  }, [properties, selectedPropertyId]);

  useEffect(() => {
    if (selectedPropertyId) localStorage.setItem(storageKey, selectedPropertyId);
  }, [selectedPropertyId, storageKey]);

  const value = useMemo<WorkspaceValue>(() => ({
    properties,
    propertiesLoading: query.isLoading,
    propertiesError: query.error,
    selectedProperty: properties.find((property) => property.propertyId === selectedPropertyId) ?? null,
    selectedPropertyId,
    setSelectedPropertyId: setSelectedPropertyIdState,
    refetchProperties: () => { void query.refetch(); },
  }), [properties, query.error, query.isLoading, query.refetch, selectedPropertyId]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}
