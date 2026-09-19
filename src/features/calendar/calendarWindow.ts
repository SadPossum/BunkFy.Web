import type { ManualBlock, ReservationListItem } from "../../api/types";
import { shiftDateKey } from "../../app/propertyDate";
import { weekWindow } from "./calendarModel";
import { parseDateKey } from "../../components/ui/DatePicker";

export const CALENDAR_SEGMENT_DAYS = 21;
export const CALENDAR_MAX_SEGMENTS = 3;
export const CALENDAR_DAY_WIDTH = 112;
export const CALENDAR_RESOURCE_WIDTH = 240;
export type CalendarViewport = { date: string; offset: number };
export type CalendarSegment = { from: string; to: string; reservationFrom: string };
export type CalendarCoverage = { from: string; to: string; current: boolean; reservationsCurrent: boolean; blocksCurrent: boolean; label: string; conflict: boolean; retry: () => void };

export function realCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function calendarDateDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function calendarSegmentFor(date: string): CalendarSegment {
  const distance = calendarDateDistance("1970-01-05", date);
  const from = shiftDateKey(date, -((distance % CALENDAR_SEGMENT_DAYS + CALENDAR_SEGMENT_DAYS) % CALENDAR_SEGMENT_DAYS));
  return { from, to: shiftDateKey(from, CALENDAR_SEGMENT_DAYS), reservationFrom: shiftDateKey(from, -1) };
}

export function calendarWindowDays(segments: readonly CalendarSegment[]): Date[] {
  if (!segments.length) return [];
  const from = segments[0].from;
  return Array.from({ length: calendarDateDistance(from, segments[segments.length - 1].to) }, (_, index) => parseDateKey(shiftDateKey(from, index))!);
}

export function calendarInitialWindow(anchor: string, ownedDay?: string): CalendarSegment[] {
  const first = calendarSegmentFor(anchor);
  if (!ownedDay) return [first];
  const owned = calendarSegmentFor(ownedDay);
  if (first.from === owned.from) return [first];
  // A distant hand-edited preference cannot displace an action's real date.
  if (Math.abs(calendarDateDistance(first.from, owned.from)) > CALENDAR_SEGMENT_DAYS * 2) return [owned];
  const start = first.from < owned.from ? first : owned, end = first.from < owned.from ? owned : first;
  const result = [start];
  while (result[result.length - 1].to <= end.from) result.push(calendarSegmentFor(result[result.length - 1].to));
  return result;
}

export function extendCalendarWindow(segments: readonly CalendarSegment[], direction: -1 | 1, frozen: boolean): CalendarSegment[] {
  if (frozen || !segments.length) return [...segments];
  const edge = direction < 0 ? shiftDateKey(segments[0].from, -1) : segments[segments.length - 1].to;
  const next = calendarSegmentFor(edge);
  if (![next.from, next.to, next.reservationFrom].every(realCalendarDate)) return [...segments];
  const result = direction < 0 ? [next, ...segments] : [...segments, next];
  return direction < 0 ? result.slice(0, CALENDAR_MAX_SEGMENTS) : result.slice(-CALENDAR_MAX_SEGMENTS);
}

// Schema v1: ISO local date + integer thousandths of a day column. No data or authority.
export function readCalendarViewport(params: URLSearchParams, prefix = "calView"): { valid: boolean; viewport?: CalendarViewport } {
  const dateKey = `${prefix}Date`, offsetKey = `${prefix}Offset`;
  const keys = [...params.keys()].filter((key) => key.startsWith(prefix));
  if (!keys.length) return { valid: true };
  const date = params.get(dateKey) ?? "", offset = params.get(offsetKey) ?? "";
  if (keys.some((key) => key !== dateKey && key !== offsetKey)
    || params.getAll(dateKey).length !== 1 || params.getAll(offsetKey).length !== 1
    || !realCalendarDate(date) || !/^(0|[1-9]\d{0,2})$/.test(offset)) return { valid: false };
  return { valid: true, viewport: { date, offset: Number(offset) } };
}

export function writeCalendarViewport(params: URLSearchParams, viewport?: CalendarViewport, prefix = "calView") {
  [...params.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => params.delete(key));
  if (!viewport) return;
  if (!realCalendarDate(viewport.date) || !Number.isInteger(viewport.offset) || viewport.offset < 0 || viewport.offset > 999) return;
  params.set(`${prefix}Date`, viewport.date);
  params.set(`${prefix}Offset`, String(viewport.offset));
}

export function calendarActionDate(date: string, day: string): string {
  const anchor = parseDateKey(date);
  if (!anchor) return day;
  const week = weekWindow(anchor);
  return day >= week.from && day < week.to ? date : day;
}

export function calendarViewportAt(from: string, scrollLeft: number): CalendarViewport {
  const column = Math.max(0, scrollLeft) / CALENDAR_DAY_WIDTH;
  return { date: shiftDateKey(from, Math.floor(column)), offset: Math.min(999, Math.round((column % 1) * 1000)) };
}

export function calendarViewportScroll(from: string, viewport: CalendarViewport): number {
  return (calendarDateDistance(from, viewport.date) + viewport.offset / 1000) * CALENDAR_DAY_WIDTH;
}

export function calendarDayCoverage(coverage: readonly CalendarCoverage[], day: string) {
  return coverage.find((segment) => segment.from <= day && day < segment.to);
}

export type CalendarSegmentSnapshot = { segment: CalendarSegment; reservations: ReservationListItem[]; blocks: ManualBlock[]; reservationsCurrent?: boolean; blocksCurrent?: boolean };
export function mergeCalendarSegments(snapshots: readonly CalendarSegmentSnapshot[]) {
  const conflicts = new Set<string>();
  const conflictIds = new Set<string>();
  function merge<T extends ReservationListItem | ManualBlock>(kind: "reservation" | "block", values: (snapshot: CalendarSegmentSnapshot) => T[], id: (item: T) => string, projection: (item: T) => string): T[] {
    const records = new Map<string, Array<{ item: T; from: string; projection: string }>>();
    for (const snapshot of snapshots) for (const item of values(snapshot)) {
      // The leading fetch day is context, never another display owner.
      if (item.arrival >= snapshot.segment.to || (kind === "block" ? item.departure <= snapshot.segment.from : item.departure < snapshot.segment.from)) continue;
      const key = id(item), entries = records.get(key) ?? [];
      entries.push({ item, from: snapshot.segment.from, projection: projection(item) });
      records.set(key, entries);
    }
    const result: T[] = [];
    for (const [id, entries] of records) {
      const missingOwners = snapshots.filter((snapshot) => (kind === "reservation" ? snapshot.reservationsCurrent : snapshot.blocksCurrent)
        && entries.some(({ item }) => item.arrival < snapshot.segment.to && (kind === "block" ? item.departure > snapshot.segment.from : item.departure >= snapshot.segment.from))
        && !entries.some((entry) => entry.from === snapshot.segment.from));
      if (new Set(entries.map((entry) => entry.projection)).size > 1 || missingOwners.length > 0) {
        conflictIds.add(`${kind}:${id}`);
        for (const { item, from } of entries) {
          conflicts.add(from);
          for (const snapshot of snapshots) if (item.arrival < snapshot.segment.to && item.departure >= snapshot.segment.from) conflicts.add(snapshot.segment.from);
        }
      } else result.push(entries[0].item);
    }
    return result;
  }
  const reservations = merge<ReservationListItem>("reservation", (snapshot) => snapshot.reservations, (item) => item.reservationId,
    (item) => JSON.stringify([item.propertyId, item.arrival, item.departure, item.holdsInventory, item.status, [...item.inventoryUnitIds].sort(), item.inventoryUnitCount, item.primaryGuestName, item.guestCount, item.sourceKind, item.expectedArrivalTime, item.expectedDepartureTime]));
  const blocks = merge<ManualBlock>("block", (snapshot) => snapshot.blocks, (item) => item.blockId,
    (item) => JSON.stringify([item.propertyId, item.blockGroupId, item.inventoryUnitId, item.arrival, item.departure, item.status, item.version, item.reason, item.releasedAtUtc]));
  return { reservations, blocks, conflicts, conflictIds: [...conflictIds].sort() };
}

export function calendarReconciliationNeeded(generation: string, previous: string, hasConflict: boolean, fetching: boolean, enabled: boolean) {
  return enabled && hasConflict && !fetching && previous !== generation;
}
