import type { Reservation } from "../../api/types";
import { shiftDateKey } from "../../app/propertyDate";
import type { ReservationLifecycleAction } from "./reservationLifecycleAttempt";

export function defaultReservationBusinessDate(
  action: ReservationLifecycleAction,
  reservation: Pick<Reservation, "arrival" | "departure" | "checkedInBusinessDate">,
  propertyToday: string,
): string {
  const currentDate = propertyToday || reservation.arrival;
  if (action === "check-in") {
    return maxDate(
      reservation.arrival,
      minDate(currentDate, shiftDateKey(reservation.departure, -1)),
    );
  }
  if (action === "check-out") {
    return maxDate(
      currentDate,
      reservation.checkedInBusinessDate || reservation.arrival,
    );
  }
  if (action === "no-show") return maxDate(currentDate, reservation.arrival);
  return "";
}

function maxDate(left: string, right: string): string {
  return left > right ? left : right;
}

function minDate(left: string, right: string): string {
  return left < right ? left : right;
}
