import { useState } from "react";
import { Link } from "react-router";
import { shiftDateKey } from "../../app/propertyDate";
import { DatePicker } from "../../components/ui/DatePicker";
import { Modal, ModalActions } from "../../components/ui/primitives";
import { calendarBookingHref, calendarBookingRangeValid, type CalendarBookingContext } from "./calendarBookingRoute";

export function CalendarBookingRange({ context, roomName, unitLabel, current, onClose }: {
  context: CalendarBookingContext & { target: NonNullable<CalendarBookingContext["target"]> };
  roomName: string;
  unitLabel: string;
  current: boolean;
  onClose: () => void;
}) {
  const [departure, setDeparture] = useState(context.target.departure);
  const valid = current && calendarBookingRangeValid(context.target.arrival, departure);
  return <Modal open title="Book this space" description="Choose the stay, then add the guest." onClose={onClose}>
    <div className="space-y-4">
      <div className="min-w-0 border-b border-base-300 pb-3">
        <p className="break-words font-semibold">{roomName} · {unitLabel}</p>
        <p className="mt-1 text-sm text-base-content/65">Arrival: {context.target.arrival}</p>
      </div>
      <label className="block"><span className="mb-1.5 block text-sm font-semibold">Departure date</span>
        <DatePicker value={departure} min={shiftDateKey(context.target.arrival, 1)} onChange={setDeparture} ariaLabel="Departure date" className="w-full" />
      </label>
      <p className="text-sm text-base-content/65" role="status">{!current
        ? "This Calendar context changed or is refreshing. Close and choose the space again when current."
        : !valid ? "Departure must be after arrival."
          : "The full stay will be checked before this bed is selected. Nothing is held yet."}</p>
      <ModalActions><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        {valid ? <Link className="btn btn-primary" to={calendarBookingHref({ ...context, target: { ...context.target, departure } })}>Continue</Link>
          : <button type="button" className="btn btn-primary" disabled>Continue</button>}
      </ModalActions>
    </div>
  </Modal>;
}
