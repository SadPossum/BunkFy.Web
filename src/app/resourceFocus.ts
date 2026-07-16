import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useWorkspace } from "./workspace";

export const focusedResourceClass = "resource-focus";
const resourceFocusDurationMs = 5_000;

export function useTransientResourceFocus(ready = true) {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedResourceId = searchParams.get("focus");

  useEffect(() => {
    if (!focusedResourceId || !ready) return;

    const timer = window.setTimeout(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("focus");
        return next;
      }, { replace: true });
    }, resourceFocusDurationMs);

    return () => window.clearTimeout(timer);
  }, [focusedResourceId, ready, setSearchParams]);

  return focusedResourceId;
}

export function useTargetProperty(targetPropertyId: string | null) {
  const { properties, selectedPropertyId, setSelectedPropertyId } = useWorkspace();

  useEffect(() => {
    if (!targetPropertyId || targetPropertyId === selectedPropertyId) return;
    if (properties.some((property) => property.propertyId === targetPropertyId)) {
      setSelectedPropertyId(targetPropertyId);
    }
  }, [properties, selectedPropertyId, setSelectedPropertyId, targetPropertyId]);
}
