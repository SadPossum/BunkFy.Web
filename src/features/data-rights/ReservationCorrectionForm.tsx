import { useMemo, useState, type FormEvent } from "react";
import type {
  DataRightsCorrectionExecutionDetails,
  Reservation,
  ReservationDataRightsCorrectionRequest,
} from "../../api/types";
import { TimePicker } from "../../components/ui/TimePicker";
import {
  CorrectionError,
  CorrectionFormHeader,
  CorrectionPickerField,
  CorrectionSubmit,
  CorrectionTextArea,
  CorrectionTextInput,
} from "./CorrectionFormFields";
import {
  buildReservationCorrectionRequest,
  reservationCorrectionChanged,
  reservationCorrectionValues,
} from "./dataRightsCorrectionWorkflow";

export function ReservationCorrectionForm({
  reservation,
  execution,
  disabled,
  pending,
  error,
  onSubmit,
}: {
  reservation: Reservation;
  execution: DataRightsCorrectionExecutionDetails;
  disabled: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (body: ReservationDataRightsCorrectionRequest) => void;
}) {
  const initial = useMemo(
    () => reservationCorrectionValues(reservation),
    [reservation],
  );
  const [values, setValues] = useState(initial);
  const request = buildReservationCorrectionRequest(reservation, execution, values);
  const changed = reservationCorrectionChanged(reservation, values);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(request);
  }

  return (
    <form className="space-y-4 rounded-lg border border-base-300 p-4 sm:p-5" onSubmit={submit}>
      <CorrectionFormHeader
        title="Reservation guest details"
        revision={execution.subject.recordVersion}
        detail={`Details revision ${reservation.detailsRevision}`}
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
        <CorrectionTextInput
          label="Primary guest"
          value={values.primaryGuestName}
          onChange={(primaryGuestName) =>
            setValues((current) => ({ ...current, primaryGuestName }))}
          disabled={disabled}
          required
          maxLength={256}
        />
        <CorrectionTextInput
          label="Guests"
          type="number"
          value={values.guestCount}
          onChange={(guestCount) => setValues((current) => ({ ...current, guestCount }))}
          disabled={disabled}
          required
          min={1}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CorrectionTextInput
          label="Email"
          type="email"
          value={values.email}
          onChange={(email) => setValues((current) => ({ ...current, email }))}
          disabled={disabled}
          maxLength={320}
        />
        <CorrectionTextInput
          label="Phone"
          type="tel"
          value={values.phone}
          onChange={(phone) => setValues((current) => ({ ...current, phone }))}
          disabled={disabled}
          maxLength={64}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CorrectionPickerField label="Expected arrival time">
          <TimePicker
            className="w-full"
            value={values.expectedArrivalTime}
            onChange={(expectedArrivalTime) =>
              setValues((current) => ({ ...current, expectedArrivalTime }))}
            ariaLabel="Expected arrival time"
            disabled={disabled}
          />
        </CorrectionPickerField>
        <CorrectionPickerField label="Expected departure time">
          <TimePicker
            className="w-full"
            value={values.expectedDepartureTime}
            onChange={(expectedDepartureTime) =>
              setValues((current) => ({ ...current, expectedDepartureTime }))}
            ariaLabel="Expected departure time"
            disabled={disabled}
          />
        </CorrectionPickerField>
      </div>
      <CorrectionTextArea
        label="Reservation notes"
        value={values.notes}
        onChange={(notes) => setValues((current) => ({ ...current, notes }))}
        disabled={disabled}
      />
      {Boolean(error) && <CorrectionError error={error} />}
      <CorrectionSubmit
        disabled={
          disabled ||
          !changed ||
          !request.primaryGuestName ||
          request.guestCount < 1
        }
        pending={pending}
      />
    </form>
  );
}
