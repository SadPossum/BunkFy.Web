import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, UserPlus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { GuestProfile, InventoryAvailabilityResponse, Reservation, RoomInventoryListResponse } from "../../api/types";
import { reservationSourceValue } from "../../api/labels";
import { useSession } from "../../app/session";
import { DatePicker } from "../../components/ui/DatePicker";
import { ErrorState, Modal, ModalActions } from "../../components/ui/primitives";
import { TimePicker } from "../../components/ui/TimePicker";
import { GuestRecordPicker } from "./GuestRecordPicker";
import {
  createAndLinkGuestRecord,
  GuestRecordLinkError,
  linkGuestRecord,
  type GuestRecordProfileDetails,
} from "./guestRecordWorkflow";
import { groupAvailabilityByRoom } from "./inventoryGrouping";
import { ReservationInventoryPicker } from "./ReservationInventoryPicker";

type ReservationStep = "reservation" | "guest";

export function CreateReservationModal({
  propertyId,
  canReadGuests,
  canCreateGuests,
  canManageGuests,
  onClose,
  onCreated,
}: {
  propertyId: string;
  canReadGuests: boolean;
  canCreateGuests: boolean;
  canManageGuests: boolean;
  onClose: () => void;
  onCreated: (reservation: Reservation, warning: string | null) => Promise<void>;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<ReservationStep>("reservation");
  const [range, setRange] = useState(defaultRange);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [sourceKind, setSourceKind] = useState<"direct" | "external">("direct");
  const [sourceSystem, setSourceSystem] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [selectedGuest, setSelectedGuest] = useState<GuestProfile | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestCount, setGuestCount] = useState("1");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [expectedArrivalTime, setExpectedArrivalTime] = useState("");
  const [expectedDepartureTime, setExpectedDepartureTime] = useState("");
  const [reservationNotes, setReservationNotes] = useState("");
  const [saveGuestRecord, setSaveGuestRecord] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [nationalityCountryCode, setNationalityCountryCode] = useState("");
  const [preferredLanguageTag, setPreferredLanguageTag] = useState("");
  const [guestNotes, setGuestNotes] = useState("");

  const availability = useQuery({
    queryKey: ["availability", propertyId, range.arrival, range.departure],
    queryFn: () => request<InventoryAvailabilityResponse>(`/api/inventory/properties/${propertyId}/availability?arrival=${range.arrival}&departure=${range.departure}`),
    enabled: Boolean(range.arrival && range.departure && range.arrival < range.departure),
  });
  const roomInventory = useQuery({
    queryKey: ["inventory-rooms", propertyId],
    queryFn: () => request<RoomInventoryListResponse>(`/api/inventory/properties/${propertyId}/rooms?page=1&pageSize=100`),
  });
  const units = availability.data?.units ?? [];
  const groups = useMemo(
    () => groupAvailabilityByRoom(units, roomInventory.data?.rooms ?? []),
    [roomInventory.data?.rooms, units],
  );
  const invalidDates = !range.arrival || !range.departure || range.arrival >= range.departure;
  const invalidExternalSource = sourceKind === "external" && (!sourceSystem.trim() || !sourceReference.trim());
  const invalidGuestCount = !Number.isInteger(Number(guestCount)) || Number(guestCount) < 1;
  const reservationStepInvalid = !selectedUnits.length || !guestName.trim() || invalidGuestCount || invalidDates || invalidExternalSource;
  const canOfferGuestSave = !selectedGuest && canReadGuests && canCreateGuests && canManageGuests;

  const mutation = useMutation({
    mutationFn: async ({ profileDetails, selectedGuestId }: {
      profileDetails: GuestRecordProfileDetails | null;
      selectedGuestId: string | null;
    }) => {
      const created = await request<Reservation>(`/api/reservations/properties/${propertyId}`, {
        method: "POST",
        body: JSON.stringify({
          arrival: range.arrival,
          departure: range.departure,
          expectedArrivalTime: emptyToNull(expectedArrivalTime),
          expectedDepartureTime: emptyToNull(expectedDepartureTime),
          inventoryUnitIds: selectedUnits,
          primaryGuestName: guestName.trim(),
          email: emptyToNull(email),
          phone: emptyToNull(phone),
          guestCount: Number(guestCount),
          sourceKind: reservationSourceValue(sourceKind),
          sourceSystem: sourceKind === "external" ? emptyToNull(sourceSystem) : null,
          sourceReference: sourceKind === "external" ? emptyToNull(sourceReference) : null,
          notes: emptyToNull(reservationNotes),
        }),
      });

      if (profileDetails) {
        try {
          const saved = await createAndLinkGuestRecord(request, propertyId, created, {
            profile: {
              displayName: guestName.trim(),
              legalName: emptyToNull(profileDetails.legalName),
              email: emptyToNull(email),
              phone: emptyToNull(phone),
              dateOfBirth: emptyToNull(profileDetails.dateOfBirth),
              nationalityCountryCode: emptyToNull(profileDetails.nationalityCountryCode)?.toUpperCase() ?? null,
              preferredLanguageTag: emptyToNull(profileDetails.preferredLanguageTag),
              notes: emptyToNull(profileDetails.notes),
            },
          });
          return { reservation: saved.reservation, warning: null, guestCreated: true };
        } catch (error) {
          return {
            reservation: created,
            warning: error instanceof GuestRecordLinkError
              ? error.message
              : `The reservation was created, but its Guest Record could not be created: ${errorMessage(error)}`,
            guestCreated: true,
          };
        }
      }

      if (selectedGuestId) {
        try {
          const linked = await linkGuestRecord(request, propertyId, created, selectedGuestId);
          return { reservation: linked, warning: null, guestCreated: false };
        } catch (error) {
          return {
            reservation: created,
            warning: `The reservation was created, but the Guest Record could not be linked: ${errorMessage(error)}`,
            guestCreated: false,
          };
        }
      }

      return { reservation: created, warning: null, guestCreated: false };
    },
    onSuccess: async ({ reservation, warning, guestCreated }) => {
      if (guestCreated) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["guest-list", propertyId] }),
          queryClient.invalidateQueries({ queryKey: ["guest-picker", propertyId] }),
        ]);
      }
      await onCreated(reservation, warning);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "reservation" && saveGuestRecord) {
      if (!reservationStepInvalid) setStep("guest");
      return;
    }

    mutation.mutate({
      profileDetails: saveGuestRecord ? {
        legalName,
        dateOfBirth,
        nationalityCountryCode,
        preferredLanguageTag,
        notes: guestNotes,
      } : null,
      selectedGuestId: selectedGuest?.guestId ?? null,
    });
  }

  function chooseGuest(guest: GuestProfile | null) {
    setSelectedGuest(guest);
    if (!guest) return;
    setSaveGuestRecord(false);
    setGuestName(guest.displayName);
    setEmail(guest.email || "");
    setPhone(guest.phone || "");
  }

  return (
    <Modal
      open
      size="md"
      title="New reservation"
      description={step === "reservation" ? "Choose the stay, inventory and booking details." : "Complete the Guest Record details."}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {saveGuestRecord && <ReservationStepIndicator step={step} />}

        {step === "reservation" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <DateField label="Arrival date" value={range.arrival} min={localDateKey(new Date())} onChange={(arrival) => { setRange((current) => ({ ...current, arrival })); setSelectedUnits([]); }} />
                <TimeField label="Expected arrival time (optional)" value={expectedArrivalTime} onChange={setExpectedArrivalTime} />
              </div>
              <div className="space-y-3">
                <DateField label="Departure date" value={range.departure} min={nextDate(range.arrival)} onChange={(departure) => { setRange((current) => ({ ...current, departure })); setSelectedUnits([]); }} />
                <TimeField label="Expected departure time (optional)" value={expectedDepartureTime} onChange={setExpectedDepartureTime} />
              </div>
            </div>
            {invalidDates && <p className="text-sm text-error">Departure must be after arrival.</p>}

            <ReservationInventoryPicker
              groups={groups}
              loading={availability.isLoading}
              error={availability.error}
              selectedUnits={selectedUnits}
              onToggle={(inventoryUnitId) => setSelectedUnits((current) => current.includes(inventoryUnitId) ? current.filter((id) => id !== inventoryUnitId) : [...current, inventoryUnitId])}
            />

            <GuestRecordPicker propertyId={propertyId} selectedGuest={selectedGuest} onSelect={chooseGuest} disabled={!canReadGuests || !canManageGuests} />
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <ControlledTextField label="Primary guest" value={guestName} onChange={setGuestName} placeholder="Guest name" autoComplete="name" />
              <ControlledTextField label="Guests" type="number" min="1" value={guestCount} onChange={setGuestCount} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ControlledTextField label="Email (optional)" type="email" required={false} value={email} onChange={setEmail} placeholder="guest@example.com" autoComplete="email" />
              <ControlledTextField label="Phone (optional)" type="tel" required={false} value={phone} onChange={setPhone} placeholder="+1 555 0100" autoComplete="tel" />
            </div>
            <div>
              <span className="mb-2 block text-sm font-semibold">Booking source</span>
              <div className="join w-full">
                <button type="button" className={`btn join-item flex-1 ${sourceKind === "direct" ? "btn-primary" : "btn-outline"}`} onClick={() => setSourceKind("direct")}>Direct</button>
                <button type="button" className={`btn join-item flex-1 ${sourceKind === "external" ? "btn-primary" : "btn-outline"}`} onClick={() => setSourceKind("external")}>External</button>
              </div>
            </div>
            {sourceKind === "external" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <ControlledTextField label="Source system" value={sourceSystem} onChange={setSourceSystem} placeholder="Booking.com" />
                <ControlledTextField label="Source reference" value={sourceReference} onChange={setSourceReference} placeholder="ABC-123" />
              </div>
            )}
            <ControlledTextArea label="Reservation notes (optional)" value={reservationNotes} onChange={setReservationNotes} placeholder="Arrival details, preferences or booking notes" />

            {canOfferGuestSave && (
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${saveGuestRecord ? "border-primary/30 bg-primary/5" : "border-base-300 hover:border-primary/25"}`}>
                <input type="checkbox" className="checkbox checkbox-primary checkbox-sm mt-0.5" checked={saveGuestRecord} onChange={(event) => setSaveGuestRecord(event.target.checked)} />
                <UserPlus size={19} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold">Save as a Guest Record</span>
                  <span className="mt-1 block text-xs leading-5 text-base-content/55">Keep this guest available for future stays and link this reservation to their history.</span>
                </span>
              </label>
            )}
          </>
        ) : (
          <GuestProfileStep
            guestName={guestName}
            email={email}
            phone={phone}
            legalName={legalName}
            dateOfBirth={dateOfBirth}
            nationalityCountryCode={nationalityCountryCode}
            preferredLanguageTag={preferredLanguageTag}
            notes={guestNotes}
            onLegalNameChange={setLegalName}
            onDateOfBirthChange={setDateOfBirth}
            onNationalityChange={setNationalityCountryCode}
            onLanguageChange={setPreferredLanguageTag}
            onNotesChange={setGuestNotes}
          />
        )}

        {mutation.error && <ErrorState error={mutation.error} />}
        <ReservationFormActions
          step={step}
          saveGuestRecord={saveGuestRecord}
          submitting={mutation.isPending}
          disabled={reservationStepInvalid}
          onBack={() => setStep("reservation")}
          onCancel={onClose}
        />
        {step === "reservation" && !selectedUnits.length && <p className="-mt-3 text-right text-xs text-warning">Select at least one available unit.</p>}
      </form>
    </Modal>
  );
}

function ReservationStepIndicator({ step }: { step: ReservationStep }) {
  return (
    <ol className="grid grid-cols-2 overflow-hidden rounded-lg border border-base-300 bg-base-200/65" aria-label="Reservation creation progress">
      <li className={`flex items-center gap-2 px-3 py-2.5 text-sm font-semibold ${step === "reservation" ? "bg-base-100 text-primary shadow-sm" : "text-base-content/55"}`}>
        <span className={`grid size-6 place-items-center rounded-full text-xs ${step === "guest" ? "bg-primary text-primary-content" : "bg-primary/12 text-primary"}`}>{step === "guest" ? <Check size={14} /> : "1"}</span>
        Reservation
      </li>
      <li className={`flex items-center gap-2 px-3 py-2.5 text-sm font-semibold ${step === "guest" ? "bg-base-100 text-primary shadow-sm" : "text-base-content/55"}`}>
        <span className="grid size-6 place-items-center rounded-full bg-primary/12 text-xs text-primary">2</span>
        Guest Record
      </li>
    </ol>
  );
}

function GuestProfileStep({
  guestName,
  email,
  phone,
  legalName,
  dateOfBirth,
  nationalityCountryCode,
  preferredLanguageTag,
  notes,
  onLegalNameChange,
  onDateOfBirthChange,
  onNationalityChange,
  onLanguageChange,
  onNotesChange,
}: {
  guestName: string;
  email: string;
  phone: string;
  legalName: string;
  dateOfBirth: string;
  nationalityCountryCode: string;
  preferredLanguageTag: string;
  notes: string;
  onLegalNameChange: (value: string) => void;
  onDateOfBirthChange: (value: string) => void;
  onNationalityChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-base-300 pb-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-content">{guestName.trim().slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{guestName}</p>
          <p className="mt-1 truncate text-xs text-base-content/50">{email || phone || "No contact details"}</p>
        </div>
      </div>
      <ControlledTextField label="Legal name (optional)" value={legalName} onChange={onLegalNameChange} placeholder="As shown on identification" autoComplete="name" required={false} maxLength={256} />
      <div className="grid gap-4 sm:grid-cols-3">
        <DateField label="Date of birth (optional)" value={dateOfBirth} max={localDateKey(new Date())} required={false} onChange={onDateOfBirthChange} />
        <ControlledTextField label="Nationality (optional)" value={nationalityCountryCode} onChange={(value) => onNationalityChange(value.toUpperCase())} placeholder="GB" autoComplete="country" required={false} maxLength={2} />
        <ControlledTextField label="Language (optional)" value={preferredLanguageTag} onChange={onLanguageChange} placeholder="en-GB" autoComplete="language" required={false} maxLength={35} />
      </div>
      <ControlledTextArea label="Guest notes (optional)" value={notes} onChange={onNotesChange} placeholder="Preferences or operational notes visible to staff" maxLength={4000} />
    </div>
  );
}

function ReservationFormActions({
  step,
  saveGuestRecord,
  submitting,
  disabled,
  onBack,
  onCancel,
}: {
  step: ReservationStep;
  saveGuestRecord: boolean;
  submitting: boolean;
  disabled: boolean;
  onBack: () => void;
  onCancel: () => void;
}) {
  const submitLabel = step === "reservation" && saveGuestRecord ? "Continue" : "Create reservation";

  return (
    <ModalActions>
      {step === "guest" && <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onBack}><ArrowLeft size={16} />Back</button>}
      <span className="flex-1" />
      <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn btn-primary btn-sm min-w-24 sm:btn-md sm:min-w-40" disabled={submitting || (step === "reservation" && disabled)}>
        {submitting && <span className="loading loading-spinner loading-sm" />}
        <span className="sm:hidden">{submitLabel === "Create reservation" ? "Create" : submitLabel}</span>
        <span className="hidden sm:inline">{submitLabel}</span>
      </button>
    </ModalActions>
  );
}

function ControlledTextField({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  required = true,
  min,
  maxLength,
  autoComplete,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  min?: string;
  maxLength?: number;
  autoComplete?: string;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      <input className="input input-bordered w-full" type={type} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} required={required} min={min} maxLength={maxLength} autoComplete={autoComplete} />
    </label>
  );
}

function ControlledTextArea({ label, value, onChange, placeholder, maxLength }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; maxLength?: number }) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      <textarea className="textarea textarea-bordered min-h-20 w-full" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} />
    </label>
  );
}

function DateField({ label, value, min, max, required = true, onChange }: { label: string; value: string; min?: string; max?: string; required?: boolean; onChange: (value: string) => void }) {
  return <div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><DatePicker className="w-full" value={value} min={min} max={max} onChange={onChange} ariaLabel={label} required={required} /></div>;
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><TimePicker className="w-full" value={value} onChange={onChange} ariaLabel={label} /></div>;
}

function emptyToNull(value: string | null | undefined) {
  return value?.trim() || null;
}

function defaultRange() {
  const arrival = new Date();
  arrival.setDate(arrival.getDate() + 1);
  const departure = new Date(arrival);
  departure.setDate(departure.getDate() + 2);
  return { arrival: localDateKey(arrival), departure: localDateKey(departure) };
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextDate(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return localDateKey(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
