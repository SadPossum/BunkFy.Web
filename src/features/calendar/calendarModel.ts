import type { ReservationListItem } from "../../api/types";
import { reservationStatusKey } from "../../app/liveUpdates";
import { parseDateKey, toDateKey } from "../../components/ui/DatePicker";

export const WEEK_WINDOW_DAYS = 7;

export type CalendarEventKind = "arrival" | "departure" | "stay" | "attention" | "completed";

export function isCalendarCompletedReservation(reservation: ReservationListItem) {
  return reservationStatusKey(reservation.status) === "checkedOut";
}

export type CalendarDay = {
  date: Date;
  key: string;
  reservations: ReservationListItem[];
};

export type CalendarDayMovementCounts = {
  arrivals: number;
  departures: number;
  attention: number;
};

export function weekWindow(anchor: Date) {
  const mondayOffset = (anchor.getDay() + 6) % 7;
  const start = addDays(anchor, -mondayOffset);
  const days = Array.from({ length: WEEK_WINDOW_DAYS }, (_, index) => addDays(start, index));

  return {
    days,
    from: toDateKey(start),
    to: toDateKey(addDays(start, WEEK_WINDOW_DAYS)),
  };
}

export function calendarSelectedDay(anchor: Date, requestedDayKey: string | null) {
  const requestedDay = parseDateKey(requestedDayKey ?? "");
  const window = weekWindow(anchor);
  const requestedKey = requestedDay ? toDateKey(requestedDay) : "";
  return requestedKey >= window.from && requestedKey < window.to
    ? requestedKey
    : toDateKey(anchor);
}

export function reservationsForCalendarDay(items: ReservationListItem[], day: string) {
  return items
    .filter((reservation) => !isCalendarCompletedReservation(reservation)
      && reservation.arrival <= day && reservation.departure >= day)
    .sort((left, right) => {
      const leftAttention = reservationCalendarEventKind(left, day) === "attention" ? 0 : 1;
      const rightAttention = reservationCalendarEventKind(right, day) === "attention" ? 0 : 1;
      return leftAttention - rightAttention
        || left.arrival.localeCompare(right.arrival)
        || left.primaryGuestName.localeCompare(right.primaryGuestName);
    });
}

export function reservationCalendarEventKind(
  reservation: ReservationListItem,
  day: string,
): CalendarEventKind {
  if (isCalendarCompletedReservation(reservation)) return "completed";
  if (["allocationRejected", "cancellationPending", "noShowPending", "checkoutPending"]
    .includes(reservationStatusKey(reservation.status))) {
    return "attention";
  }
  if (reservation.arrival === day) return "arrival";
  if (reservation.departure === day) return "departure";
  return "stay";
}

export function calendarDayMovementCounts(
  reservations: ReservationListItem[],
  day: string,
): CalendarDayMovementCounts {
  return reservations.reduce<CalendarDayMovementCounts>((counts, reservation) => {
    if (isCalendarCompletedReservation(reservation)) return counts;
    if (reservation.arrival === day) counts.arrivals += 1;
    if (reservation.departure === day) counts.departures += 1;
    if (reservationCalendarEventKind(reservation, day) === "attention") counts.attention += 1;
    return counts;
  }, { arrivals: 0, departures: 0, attention: 0 });
}

export function reservationMovementLabel(
  reservation: ReservationListItem,
  day: string,
) {
  if (isCalendarCompletedReservation(reservation)) return null;
  if (reservation.arrival === day && reservation.departure === day) return "Arrives and departs";
  if (reservation.arrival === day) return "Arrives";
  if (reservation.departure === day) return "Departs";
  return null;
}

/** Interior date position describes a scheduled stay, not a recorded check-in. */
export function reservationStayPhaseLabel(reservation: ReservationListItem): string {
  switch (reservationStatusKey(reservation.status)) {
    case "confirmed": return "Stay scheduled";
    case "checkedIn": return "In house";
    case "checkoutPending": return "Checkout pending";
    case "pendingAllocation":
    case "allocationRejected": return "Requested — not held";
    case "cancellationPending": return "Cancellation pending";
    case "cancelled": return "Cancelled";
    case "noShowPending": return "No-show pending";
    case "noShow": return "No-show";
    case "checkedOut": return "Completed · scheduled";
    default: return "Status unknown";
  }
}

export function addCalendarDays(date: Date, amount: number) {
  return addDays(date, amount);
}

export function scheduleSpan(
  arrival: string,
  departure: string,
  windowFrom: string,
  windowTo: string,
) {
  const start = Math.max(dateDayNumber(arrival), dateDayNumber(windowFrom));
  const end = Math.min(dateDayNumber(departure), dateDayNumber(windowTo));
  if (end <= start) return null;

  return {
    start: start - dateDayNumber(windowFrom),
    span: end - start,
  };
}

export function occupiesCalendarDay(arrival: string, departure: string, day: string) {
  return arrival <= day && departure > day;
}

function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function dateDayNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}
