import type { ReservationListItem } from "../../api/types";
import { reservationStatusKey } from "../../app/liveUpdates";
import { occupiesCalendarDay } from "../calendar/calendarModel";
import { reservationAttentionReason } from "../reservations/reservationOperationalView";

export function buildTodayBoard(
  reservations: ReservationListItem[],
  localDate?: string,
) {
  if (!localDate) return { attention: [], arrivals: [], departures: [], inHouse: [] };
  const attention = reservations.filter((reservation) =>
    reservationAttentionReason(reservation, localDate) !== null);
  const attentionIds = new Set(attention.map((reservation) => reservation.reservationId));
  const arrivals = reservations.filter((reservation) =>
    !attentionIds.has(reservation.reservationId)
    && reservationStatusKey(reservation.status) === "confirmed"
    && reservation.arrival === localDate);
  const departures = reservations.filter((reservation) =>
    !attentionIds.has(reservation.reservationId)
    && reservationStatusKey(reservation.status) === "checkedIn"
    && reservation.departure === localDate);
  const inHouse = reservations.filter((reservation) =>
    !attentionIds.has(reservation.reservationId)
    && reservationStatusKey(reservation.status) === "checkedIn"
    && occupiesCalendarDay(reservation.arrival, reservation.departure, localDate)
    && reservation.departure !== localDate);

  return {
    attention: sortByOperatingTime(attention),
    arrivals: sortByOperatingTime(arrivals),
    departures: sortByOperatingTime(departures, true),
    inHouse: sortByOperatingTime(inHouse, true),
  };
}

export function todayAttentionReason(
  reservation: ReservationListItem,
  localDate?: string,
) {
  return reservationAttentionReason(reservation, localDate);
}

function sortByOperatingTime(items: ReservationListItem[], departure = false) {
  return [...items].sort((left, right) => {
    const leftTime = departure ? left.expectedDepartureTime : left.expectedArrivalTime;
    const rightTime = departure ? right.expectedDepartureTime : right.expectedArrivalTime;
    return Number(leftTime == null) - Number(rightTime == null)
      || (leftTime ?? "").localeCompare(rightTime ?? "")
      || left.primaryGuestName.localeCompare(right.primaryGuestName);
  });
}
