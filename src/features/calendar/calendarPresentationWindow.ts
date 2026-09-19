import { shiftDateKey } from "../../app/propertyDate";
import { CALENDAR_DAY_WIDTH, CALENDAR_RESOURCE_WIDTH, calendarDateDistance } from "./calendarWindow";

export type CalendarPresentationWindow = { from: string; to: string };

export const CALENDAR_PRESENTATION_SETTLE_MS = 120;

// Only Book controls and header Tab membership use this bounded date window.
// Occupancy, summaries and interval controls retain every logical date.
export function calendarPresentationWindow({ from, to, scrollLeft, width, current }: {
  from: string;
  to: string;
  scrollLeft: number;
  width: number;
  current?: CalendarPresentationWindow;
}): CalendarPresentationWindow {
  const count = Math.max(1, calendarDateDistance(from, to));
  const left = Math.max(0, Number.isFinite(scrollLeft) ? scrollLeft : 0);
  const dateWidth = width > CALENDAR_RESOURCE_WIDTH ? width - CALENDAR_RESOURCE_WIDTH : CALENDAR_DAY_WIDTH * 9;
  const first = Math.min(count - 1, Math.floor(left / CALENDAR_DAY_WIDTH));
  const end = Math.min(count, Math.max(first + 1, Math.ceil((left + dateWidth) / CALENDAR_DAY_WIDTH)));
  if (current && current.from >= from && current.to <= to) {
    const startIndex = calendarDateDistance(from, current.from);
    const endIndex = calendarDateDistance(from, current.to);
    if (first >= startIndex + (startIndex === 0 ? 0 : 3)
      && end <= endIndex - (endIndex === count ? 0 : 3)) return current;
  }
  const next = { from: shiftDateKey(from, Math.max(0, first - 7)), to: shiftDateKey(from, Math.min(count, end + 7)) };
  return current?.from === next.from && current.to === next.to ? current : next;
}

export function calendarDateHasRichPresentation(window: CalendarPresentationWindow, day: string) {
  return day >= window.from && day < window.to;
}

export function calendarPresentationColumns(from: string, count: number, window: CalendarPresentationWindow | null) {
  if (!window) return { start: 0, end: count };
  const start = Math.max(0, Math.min(count, calendarDateDistance(from, window.from)));
  const end = Math.max(start, Math.min(count, calendarDateDistance(from, window.to)));
  return { start, end };
}

export function calendarTimelineKeyScroll(key: string, left: number, width: number, scrollWidth: number): number | null {
  const page = Math.max(CALENDAR_DAY_WIDTH, Math.floor((width - CALENDAR_RESOURCE_WIDTH) / CALENDAR_DAY_WIDTH) * CALENDAR_DAY_WIDTH);
  const next = key === "ArrowLeft" ? left - CALENDAR_DAY_WIDTH : key === "ArrowRight" ? left + CALENDAR_DAY_WIDTH
    : key === "PageUp" ? left - page : key === "PageDown" ? left + page
      : key === "Home" ? 0 : key === "End" ? scrollWidth - width : null;
  return next === null ? null : Math.max(0, Math.min(Math.max(0, scrollWidth - width), next));
}
