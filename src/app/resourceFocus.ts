import { useEffect } from "react";
import { useSearchParams } from "react-router";
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

export function useScrollToTransientResourceFocus(
  focusedResourceId: string | null,
  ready = true,
) {
  useEffect(() => {
    if (!focusedResourceId || !ready) return;
    let frame = 0;
    const focusVisibleTarget = () => {
      const target = Array.from(document.querySelectorAll<HTMLElement>(`.${focusedResourceClass}`))
        .find((candidate) => candidate.getClientRects().length > 0);
      if (!target) return;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.focus({ preventScroll: true });
    };
    const scheduleFocus = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(focusVisibleTarget);
    };
    scheduleFocus();
    window.addEventListener("resize", scheduleFocus);
    return () => {
      window.removeEventListener("resize", scheduleFocus);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [focusedResourceId, ready]);
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
