import { useEffect, useState } from "react";
import { propertyDateKey } from "./propertyDate";

// Check for midnight/resume without rerendering the timeline on every timer tick.
export function usePropertyDate(timeZoneId: string): string | null {
  const [clock, setClock] = useState(() => ({ timeZoneId, date: propertyDateKey(timeZoneId) }));
  useEffect(() => {
    const update = () => {
      const date = propertyDateKey(timeZoneId);
      setClock(previous => previous.timeZoneId === timeZoneId && previous.date === date ? previous : { timeZoneId, date });
    };
    update();
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [timeZoneId]);
  return clock.timeZoneId === timeZoneId ? clock.date : null;
}
