import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, UserPlus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { GuestListItem, InventoryAvailabilityResponse, ReservationMutationReceipt } from "../../api/types";
import { reservationSourceValue } from "../../api/labels";
import { assertRequestCanStart } from "../../api/requestConnectivity";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import {
  defaultPropertyStayRange,
  propertyDateKey,
  shiftDateKey,
} from "../../app/propertyDate";
import { useSession } from "../../app/session";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { DatePicker } from "../../components/ui/DatePicker";
import { ErrorState, Modal, ModalActions } from "../../components/ui/primitives";
import { TimePicker } from "../../components/ui/TimePicker";
import { GuestRecordPicker } from "./GuestRecordPicker";
import {
  createAndLinkGuestRecord,
  guestRecordPayloadFromBooking,
  GuestRecordLinkError,
  linkGuestRecord,
  resolveReservationGuestRecordAttempt,
  type GuestRecordProfileDetails,
  type ReservationGuestRecordAttempt,
} from "./guestRecordWorkflow";
import { groupAvailabilityByRoom } from "./inventoryGrouping";
import { ReservationInventoryPicker } from "./ReservationInventoryPicker";
import {
  inventorySelectionIsCurrent,
  reservationCreateReceiptMatches,
  reservationCreationSubmitAllowed,
  reservationEditorIdentity,
  reservationEditorCompletionCurrent,
  reservationMutationAllowed,
} from "./reservationsMutationAuthority";
import {
  resolveReservationCreateAttempt,
  reservationCreateFingerprint,
  type ReservationCreateAttempt,
  type ReservationCreatePayload,
} from "./reservationCreateAttempt";
import { loadAllRoomInventory } from "../inventory/inventoryApi";
import { calendarBookingRangeValid, reservationAvailabilityMatchesRange, reservationRoomsMatchProperty, reservationSelectionMatchesRooms, resolveCalendarBookingTarget, type CalendarBookingTarget } from "../calendar/calendarBookingRoute";
import { focusModalRecoveryFeedback } from "../../components/ui/modalFocus";
import { ReservationCreationRecovery } from "./ReservationCreationRecovery";
import { useReservationCreationRecovery } from "./useReservationCreationRecovery";
import { newReservationRecoveryCoordinate, recoveryMatchesSession, reservationRecoveryTargetMatches, storeReservationRecovery, updateReservationRecovery, type ReservationRecoveryCoordinate } from "./reservationCreationRecovery";
import { ReservationAccessResetNotice, type ReservationAccessReset } from "./ReservationAccessResetNotice";
import { completedReservationPreselection, completedReservationStayRange, type CompletedReservationCreateContext, type CompletedReservationCreateSeed } from "./completedReservationCreate";
import { NationalityPicker } from "../guests/NationalityPicker";
import { LanguagePicker } from "../guests/LanguagePicker";
import { guestLanguagePayload } from "../guests/guestLanguageSelection";

type ReservationStep = "reservation" | "guest";

export function CreateReservationModal({
  propertyId,
  propertyTimeZoneId,
  permissionSource,
  canCreateReservation,
  canReadInventory,
  canReadReservations,
  requestedTarget,
  completedSource,
  originLink,
  canReadGuests,
  canCreateGuests,
  canManageGuests,
  accessReset,
  freshAfterAccessReset = false,
  previousSavePending = false,
  onSavePendingChange,
  onClose,
  onCreated,
}: {
  propertyId: string;
  propertyTimeZoneId: string;
  permissionSource: CompositeSource;
  canCreateReservation: boolean;
  canReadInventory: boolean;
  canReadReservations: boolean;
  requestedTarget?: CalendarBookingTarget;
  completedSource?: { context: CompletedReservationCreateContext | null; seed: CompletedReservationCreateSeed | null; source: CompositeSource };
  originLink?: ReactNode;
  canReadGuests: boolean;
  canCreateGuests: boolean;
  canManageGuests: boolean;
  accessReset?: ReservationAccessReset;
  freshAfterAccessReset?: boolean;
  previousSavePending?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
  onClose: () => void;
  onCreated: (reservation: ReservationMutationReceipt, warning: string | null, keepCalendarOrigin?: boolean) => Promise<void>;
}) {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const recovery = useReservationCreationRecovery();
  const ownedOperationId = useRef<string | null>(null);
  const recoveryCoordinate = useRef<ReservationRecoveryCoordinate | null>(null);
  const errorFeedback = useRef<HTMLDivElement>(null);
  const propertyToday = propertyDateKey(propertyTimeZoneId)
    ?? propertyDateKey("UTC")!;
  const [step, setStep] = useState<ReservationStep>("reservation");
  const [range, setRange] = useState(() => requestedTarget
    ? { arrival: requestedTarget.arrival, departure: requestedTarget.departure }
    : completedSource ? completedReservationStayRange(propertyTimeZoneId) ?? { arrival: "", departure: "" } : defaultRange(propertyTimeZoneId));
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [chooseOtherInventory, setChooseOtherInventory] = useState(false);
  const [uncertainAttempt, setUncertainAttempt] = useState(false);
  const [entered, setEntered] = useState(false);
  const preselectedRange = useRef("");
  const identity = reservationEditorIdentity(session, propertyId);
  const instance = useRef({ identity, mounted: true });
  instance.current.identity = identity;
  useLayoutEffect(() => { instance.current.mounted = true; return () => { instance.current.mounted = false; }; }, []);
  const [sourceKind, setSourceKind] = useState<"direct" | "external">("direct");
  const [sourceSystem, setSourceSystem] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [selectedGuest, setSelectedGuest] = useState<GuestListItem | null>(null);
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
  const [languageTags, setLanguageTags] = useState<string[]>([]);
  const [guestNotes, setGuestNotes] = useState("");
  const [selectedGuestCurrent, setSelectedGuestCurrent] = useState(false);
  const [completedSeeded, setCompletedSeeded] = useState(false);
  const createAttempt = useRef<ReservationCreateAttempt | null>(null);
  const guestRecordAttempt = useRef<ReservationGuestRecordAttempt | null>(null);
  const permissionsCurrent = compositeSourceCurrent(permissionSource);
  const mayLoadInventory = permissionsCurrent && canReadInventory && canCreateReservation && Boolean(propertyId);
  useEffect(() => { if (mayLoadInventory) setEntered(true); }, [mayLoadInventory]);

  const availability = useQuery({
    queryKey: ["availability", propertyId, range.arrival, range.departure],
    queryFn: async ({ signal }) => {
      const response = await request<InventoryAvailabilityResponse>(`/api/inventory/properties/${propertyId}/availability?arrival=${range.arrival}&departure=${range.departure}`, { signal });
      if (!reservationAvailabilityMatchesRange(response, propertyId, range.arrival, range.departure)) throw new Error("Availability did not match this property and stay. Retry before selecting inventory.");
      return response;
    },
    enabled: mayLoadInventory && calendarBookingRangeValid(range.arrival, range.departure),
    retry: false,
  });
  const roomInventory = useQuery({
    queryKey: ["inventory-rooms", propertyId],
    queryFn: async ({ signal }) => {
      const response = await loadAllRoomInventory(request, propertyId, signal);
      if (!reservationRoomsMatchProperty(response.rooms, propertyId)) throw new Error("Room labels did not match this property. Retry before selecting inventory.");
      return response;
    },
    enabled: mayLoadInventory,
    retry: false,
  });
  useEffect(() => {
    if (mayLoadInventory) return;
    void queryClient.cancelQueries({ queryKey: ["availability", propertyId, range.arrival, range.departure], exact: true });
    void queryClient.cancelQueries({ queryKey: ["inventory-rooms", propertyId], exact: true });
  }, [mayLoadInventory, propertyId, range.arrival, range.departure, queryClient]);
  const availabilityMatches = reservationAvailabilityMatchesRange(availability.data, propertyId, range.arrival, range.departure);
  const roomInventoryMatches = reservationRoomsMatchProperty(roomInventory.data?.rooms, propertyId);
  const availabilitySource = createCompositeSource({
    label: "Availability",
    hasData: availability.data !== undefined,
    isLoading: availability.isLoading,
    error: availability.error ?? (availability.data && !availabilityMatches ? new Error("Availability context changed. Check this exact property and stay again.") : null),
    isFetching: availability.isFetching,
    refetch: () => availability.refetch(),
  });
  const roomInventorySource = createCompositeSource({
    label: "Room labels",
    hasData: roomInventory.data !== undefined,
    isLoading: roomInventory.isLoading,
    error: roomInventory.error ?? (roomInventory.data && !roomInventoryMatches ? new Error("Room context changed. Check the exact property again.") : null),
    isFetching: roomInventory.isFetching,
    refetch: () => roomInventory.refetch(),
  });
  const availabilityCurrent = mayLoadInventory && compositeSourceCurrent(availabilitySource)
    && !availability.isPaused && reservationAvailabilityMatchesRange(availability.data, propertyId, range.arrival, range.departure);
  const availabilityUsable = mayLoadInventory && compositeSourceUsable(availabilitySource.state)
    && reservationAvailabilityMatchesRange(availability.data, propertyId, range.arrival, range.departure);
  const roomInventoryUsable = mayLoadInventory && compositeSourceUsable(roomInventorySource.state)
    && reservationRoomsMatchProperty(roomInventory.data?.rooms, propertyId);
  const roomInventoryCurrent = roomInventoryUsable && compositeSourceCurrent(roomInventorySource) && !roomInventory.isPaused;
  const units = availabilityUsable ? availability.data?.units ?? [] : [];
  const groups = useMemo(
    () => groupAvailabilityByRoom(
      units,
      roomInventoryUsable ? roomInventory.data?.rooms ?? [] : [],
    ),
    [roomInventory.data?.rooms, roomInventoryUsable, units],
  );
  const inventoryCurrent = availabilityCurrent && roomInventoryCurrent;
  const choosingInventory = !requestedTarget || chooseOtherInventory;
  const showInventoryPicker = choosingInventory && (inventoryCurrent || (availabilityUsable && roomInventoryUsable && groups.length > 0));
  const invalidDates = !calendarBookingRangeValid(range.arrival, range.departure);
  const invalidExternalSource = sourceKind === "external" && (!sourceSystem.trim() || !sourceReference.trim());
  const invalidGuestCount = !Number.isInteger(Number(guestCount)) || Number(guestCount) < 1;
  const reservationStepInvalid = !selectedUnits.length || !guestName.trim() || invalidGuestCount || invalidDates || invalidExternalSource;
  const createAuthorityCurrent = mayLoadInventory && roomInventoryCurrent && reservationMutationAllowed(
    "create-reservation",
    { permissionsCurrent, availabilityCurrent },
  );
  const selectedInventoryCurrent = inventorySelectionIsCurrent(
    propertyId,
    units,
    selectedUnits,
  ) && reservationSelectionMatchesRooms(selectedUnits, roomInventory.data?.rooms ?? [], availability.data);
  const guestIntentCurrent = selectedGuest
    ? canReadGuests && canManageGuests && selectedGuestCurrent
    : saveGuestRecord
      ? canCreateGuests && canManageGuests
      : true;
  const currentGuestIntent = useRef(guestIntentCurrent && permissionsCurrent);
  currentGuestIntent.current = guestIntentCurrent && permissionsCurrent;
  const payload: ReservationCreatePayload = {
    arrival: range.arrival, departure: range.departure,
    expectedArrivalTime: emptyToNull(expectedArrivalTime), expectedDepartureTime: emptyToNull(expectedDepartureTime),
    inventoryUnitIds: selectedUnits, primaryGuestName: guestName.trim(), email: emptyToNull(email), phone: emptyToNull(phone),
    guestCount: Number(guestCount), sourceKind: reservationSourceValue(sourceKind),
    sourceSystem: sourceKind === "external" ? emptyToNull(sourceSystem) : null,
    sourceReference: sourceKind === "external" ? emptyToNull(sourceReference) : null, notes: emptyToNull(reservationNotes),
  };
  const exactReplay = uncertainAttempt && createAttempt.current?.fingerprint === reservationCreateFingerprint(payload);
  const completedCurrent = !completedSource || Boolean(completedSource.context && completedSource.seed
    && compositeSourceCurrent(completedSource.source) && completedReservationStayRange(propertyTimeZoneId));
  const savedRequest = recovery.snapshot.kind === "record" ? recovery.snapshot.record : null;
  const ownsSavedRequest = Boolean(savedRequest && recoveryMatchesSession(savedRequest, session)
    && savedRequest.propertyId === propertyId && savedRequest.operationId === ownedOperationId.current);
  const showReservationForm = !accessReset && (recovery.snapshot.kind === "none" || ownsSavedRequest);
  // An admitted same-authority draft stays mounted during routine source refresh.
  // New dispatch still requires current detail; denial/error/ineligible detail removes the seed.
  const showPersonalFields = showReservationForm && (!completedSource || (completedSeeded
    && completedSource.context && completedSource.seed && completedSource.source.state === "ready"));
  const canSubmit = !accessReset && !previousSavePending && (exactReplay || (completedCurrent && (!completedSource || completedSeeded)))
    && (recovery.snapshot.kind === "none" || (ownsSavedRequest && exactReplay)) && reservationCreationSubmitAllowed({
    formValid: !reservationStepInvalid, guestIntentCurrent, permissionsCurrent,
    canCreate: canCreateReservation, exactReplay,
    freshInventoryCurrent: createAuthorityCurrent && selectedInventoryCurrent,
  });
  const canOfferGuestSave = !selectedGuest && canCreateGuests && canManageGuests;
  const target = requestedTarget && roomInventoryCurrent && availabilityCurrent
    ? resolveCalendarBookingTarget(requestedTarget, roomInventory.data?.rooms ?? [], availability.data) : null;

  useEffect(() => {
    // An opaque previous-save coordinate owns recovery before any new source defaults.
    // Never reseed a mounted edited form on detail version/refetch changes.
    if (!completedSource?.seed || !completedCurrent || completedSeeded || recovery.snapshot.kind !== "none" || accessReset) return;
    const initialRange = completedReservationStayRange(propertyTimeZoneId);
    if (!initialRange) return;
    const seed = completedSource.seed;
    setGuestName(seed.primaryGuestName); setGuestCount(String(seed.guestCount)); setEmail(seed.email); setPhone(seed.phone);
    setRange(initialRange); setSelectedUnits([]); setCompletedSeeded(true);
  }, [completedSource, completedCurrent, completedSeeded, recovery.snapshot.kind, propertyTimeZoneId, accessReset]);

  useEffect(() => {
    if (!completedSource?.seed || !completedCurrent || !completedSeeded || !inventoryCurrent
      || recovery.snapshot.kind !== "none" || uncertainAttempt) return;
    const key = `${range.arrival}:${range.departure}`;
    if (preselectedRange.current === key) return;
    preselectedRange.current = key;
    setSelectedUnits(completedReservationPreselection(completedSource.seed.inventoryUnitIds, propertyId,
      range.arrival, range.departure, roomInventory.data?.rooms, availability.data, inventoryCurrent));
  }, [completedSource, completedCurrent, completedSeeded, inventoryCurrent, recovery.snapshot.kind, uncertainAttempt,
    range.arrival, range.departure, propertyId, roomInventory.data?.rooms, availability.data]);

  useEffect(() => {
    const key = `${range.arrival}:${range.departure}`;
    const selection = requestedReservationPreselection({ requestedUnitId: requestedTarget?.inventoryUnitId,
      choosingOther: chooseOtherInventory, available: target?.available === true, exactReplay,
      rangeKey: key, initializedRange: preselectedRange.current });
    if (!selection) return;
    preselectedRange.current = key;
    setSelectedUnits(selection);
  }, [requestedTarget, chooseOtherInventory, target?.available, range.arrival, range.departure, exactReplay]);

  useEffect(() => {
    if (!permissionsCurrent) return;
    if (!canCreateGuests || !canManageGuests) setSaveGuestRecord(false);
  }, [canCreateGuests, canManageGuests, permissionsCurrent]);

  const mutation = useMutation({
    onMutate: () => { onSavePendingChange?.(true); },
    onSettled: () => { onSavePendingChange?.(false); },
    mutationFn: async (variables: {
      profileDetails: GuestRecordProfileDetails | null;
      selectedGuestId: string | null;
      submittedPayload: ReservationCreatePayload;
      operationId: string;
      editorIdentity: string;
      dispatched: boolean;
    }) => {
      const { profileDetails, selectedGuestId, submittedPayload, operationId, editorIdentity } = variables;
      if (!canSubmit || !reservationEditorCompletionCurrent(editorIdentity, instance.current.identity, instance.current.mounted)) {
        throw new Error("Current reservation, availability, and access evidence is required before creating this reservation.");
      }
      assertRequestCanStart({ method: "POST" });
      const coordinate = ownsSavedRequest && savedRequest ? savedRequest
        : newReservationRecoveryCoordinate(session, propertyId, operationId, Boolean(profileDetails || selectedGuestId));
      ownedOperationId.current = operationId;
      storeReservationRecovery(coordinate);
      recoveryCoordinate.current = coordinate;
      variables.dispatched = true;
      const created = await request<ReservationMutationReceipt>(`/api/reservations/properties/${propertyId}`, {
        method: "POST",
        body: JSON.stringify({
          ...submittedPayload,
          operationId,
        }),
      });
      if (!reservationCreateReceiptMatches(created, propertyId) || created.reservationId !== operationId) throw new Error("The creation response could not be matched to this property and request. Retry the same request to recover its result.");
      recoveryCoordinate.current = updateReservationRecovery(coordinate, "primary-confirmed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reservations", propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["reservation-operations", propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["reservation-calendar", propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["availability", propertyId] }),
      ]);
      if (!reservationEditorCompletionCurrent(editorIdentity, instance.current.identity, instance.current.mounted)) {
        return { reservation: created, warning: null, guestCreated: false };
      }
      if ((profileDetails || selectedGuestId) && !currentGuestIntent.current) {
        return { reservation: created, warning: "The reservation request was recorded. Guest Record linking was not attempted because its current access or record could not be confirmed.", guestCreated: false };
      }

      if (profileDetails) {
        recoveryCoordinate.current = updateReservationRecovery(recoveryCoordinate.current!, "follow-on-unknown");
        const profile = guestRecordPayloadFromBooking({ primaryGuestName: guestName, email, phone }, profileDetails);
        guestRecordAttempt.current = resolveReservationGuestRecordAttempt(
          guestRecordAttempt.current,
          propertyId,
          created,
          profile,
        );
        try {
          const saved = await createAndLinkGuestRecord(request, propertyId, created, {
            operationId: guestRecordAttempt.current.operationId,
            expectedReservationVersion:
              guestRecordAttempt.current.expectedReservationVersion,
            profile,
          });
          recoveryCoordinate.current = updateReservationRecovery(recoveryCoordinate.current!, "complete", false);
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
        recoveryCoordinate.current = updateReservationRecovery(recoveryCoordinate.current!, "follow-on-unknown");
        try {
          const linked = await linkGuestRecord(request, propertyId, created, selectedGuestId);
          recoveryCoordinate.current = updateReservationRecovery(recoveryCoordinate.current!, "complete", false);
          return { reservation: linked, warning: null, guestCreated: false };
        } catch (error) {
          return {
            reservation: created,
            warning: `The reservation was created, but the Guest Record could not be linked: ${errorMessage(error)}`,
            guestCreated: false,
          };
        }
      }

      recoveryCoordinate.current = updateReservationRecovery(recoveryCoordinate.current!, "complete", false);
      return { reservation: created, warning: null, guestCreated: false };
    },
    onSuccess: async ({ reservation, warning, guestCreated }, variables) => {
      if (!reservationEditorCompletionCurrent(variables.editorIdentity, instance.current.identity, instance.current.mounted)) return;
      createAttempt.current = null;
      setUncertainAttempt(false);
      guestRecordAttempt.current = null;
      if (guestCreated) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["guest-list", propertyId] }),
          queryClient.invalidateQueries({ queryKey: ["guest-picker", propertyId] }),
        ]);
      }
      await onCreated(reservation, warning);
    },
    onError: (_error, variables) => {
      if (variables.dispatched && instance.current.mounted && instance.current.identity === variables.editorIdentity) setUncertainAttempt(true);
    },
  });
  const savePending = mutation.isPending || previousSavePending;
  useLayoutEffect(() => { if (mutation.error) focusModalRecoveryFeedback(errorFeedback.current); }, [mutation.error]);
  useEffect(() => {
    if (recovery.snapshot.kind !== "none" || mutation.isPending || ownedOperationId.current === null) return;
    ownedOperationId.current = null; recoveryCoordinate.current = null; createAttempt.current = null; guestRecordAttempt.current = null;
    setUncertainAttempt(false);
  }, [recovery.snapshot.kind, mutation.isPending]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "reservation" && saveGuestRecord) {
      if (canSubmit) setStep("guest");
      return;
    }

    if (!canSubmit || mutation.isPending) return;

    const languages = guestLanguagePayload(languageTags);
    if (!languages.ok) return; // Picker prevents invalid selections before reservation dispatch.

    createAttempt.current = resolveReservationCreateAttempt(createAttempt.current, payload);

    mutation.mutate({
      submittedPayload: payload,
      operationId: createAttempt.current.operationId,
      editorIdentity: identity,
      dispatched: false,
      profileDetails: saveGuestRecord ? {
        legalName,
        dateOfBirth,
        nationalityCountryCode,
        preferredLanguageTag: languages.preferredLanguageTag,
        languageTags: languages.languageTags,
        notes: guestNotes,
      } : null,
      selectedGuestId: selectedGuest?.guestId ?? null,
    });
  }

  function chooseGuest(guest: GuestListItem | null) {
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
      title={completedSource ? "Extend as new reservation" : "New reservation"}
      description={accessReset ? "Check access before continuing." : completedSource ? "Create a separate reservation. The completed stay is unchanged." : step === "reservation" ? "Choose the stay, inventory and booking details." : "Complete the Guest Record details."}
      onClose={onClose}
      closeDisabled={savePending}
    >
      <form onSubmit={submit} className="space-y-4">
        {!savePending && originLink}
        {accessReset && <ReservationAccessResetNotice recovery={accessReset} hasSaveRecovery={recovery.snapshot.kind !== "none"} pending={savePending} />}
        {freshAfterAccessReset && showReservationForm && <p className="rounded border border-base-300 p-3 text-sm" role="status">Fresh reservation form. The previous guest details were cleared after reservation access changed. Re-enter the booking details.</p>}
        <ReservationCreationRecovery
          snapshot={recovery.snapshot}
          propertyId={propertyId}
          mayReadCurrent={permissionsCurrent && canReadReservations}
          contextReady={!requestedTarget || !mayLoadInventory || (!roomInventory.isFetching && !roomInventory.isLoading)}
          pending={savePending}
          autoCheck={!ownsSavedRequest}
          refresh={recovery.refresh}
          onRecovered={async (reservation, warning) => {
            const preserveOrigin = completedSource?.context ? reservation.propertyId === completedSource.context.propertyId
              : reservationRecoveryTargetMatches(reservation, propertyId, requestedTarget, roomInventory.data?.rooms, roomInventoryCurrent);
            await onCreated(reservation, warning, preserveOrigin);
          }}
        />
        {completedSource && !accessReset && recovery.snapshot.kind === "none" && !completedCurrent && (
          <div className="rounded border border-base-300 p-3 text-sm" role="status" data-completed-source-state>
            <p>{completedSource.source.state === "loading" || completedSource.source.isFetching
              ? "Checking completed reservation" : "Completed reservation unavailable. Current guest details cannot be reused. Retry or return to the source."}</p>
            <button type="button" className="btn btn-outline mt-2 min-h-11" disabled={completedSource.source.isFetching}
              onClick={() => void completedSource.source.refetch()}>Check completed reservation</button>
          </div>
        )}
        {showReservationForm && saveGuestRecord && <ReservationStepIndicator step={step} />}
        {!accessReset && <CompositeSourceNotice
          className="mb-0"
          sources={mayLoadInventory
            ? invalidDates ? [permissionSource, roomInventorySource] : [permissionSource, availabilitySource, roomInventorySource]
            : [permissionSource]}
          title="Some reservation context is delayed"
        />}
        {!accessReset && !mayLoadInventory && <p className="rounded border border-warning/30 bg-warning/10 p-3 text-sm" role="status">
          {permissionsCurrent ? "Reservation creation and inventory access are required for this property." : entered ? "Checking current access. Your draft stays here while access recovers." : "Checking current access before opening the reservation form."}
        </p>}
        {showReservationForm && exactReplay && <p className="rounded border border-warning/30 p-3 text-sm" role="status">The previous creation result is unconfirmed. Retry the same reservation to recover it without a duplicate, even if its bed is now held. Check or acknowledge the previous save before sending any changed booking.</p>}

        <fieldset className="min-w-0 space-y-4" disabled={mutation.isPending || !mayLoadInventory}>
        {showPersonalFields && (entered || mayLoadInventory) && (step === "reservation" ? (
          <>
            {completedSource && <p className="rounded border border-base-300 p-3 text-sm" data-completed-space-hint>
              {inventoryCurrent && !selectedUnits.length ? "Previous spaces could not all be selected. Choose available rooms or beds below." : "Review the spaces for this new stay. You can change the dates, rooms or beds."}
            </p>}
            {requestedTarget && <div className="min-w-0 rounded border border-base-300 p-3" data-calendar-booking-target>
              <p className="text-xs font-semibold uppercase text-base-content/55">From Calendar</p>
              <p className="mt-1 break-words font-semibold">{target?.room && target.unit ? `${target.room.roomName} · ${target.unit.label}` : "Requested room and bed — identity awaiting current confirmation"}</p>
              <p className="mt-1 text-sm">{range.arrival} → {range.departure}</p>
              <p className="mt-1 text-sm" role="status">{chooseOtherInventory ? "Choosing different inventory for this reservation."
                : !target ? "Checking the exact space and full stay. Nothing is held yet."
                  : !target.unit ? "The requested space is no longer present. No other space has been selected."
                    : !target.available ? "This space is not available for the full stay. Change dates or choose another space."
                      : "Available for the full stay. Nothing is held until allocation is confirmed."}</p>
              <button type="button" className="btn btn-ghost btn-sm mt-2 min-h-10" onClick={() => {
                if (chooseOtherInventory) { setSelectedUnits([]); preselectedRange.current = ""; }
                setChooseOtherInventory((value) => !value);
              }}>{chooseOtherInventory ? "Back to requested space" : "Change inventory"}</button>
            </div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <DateField label="Arrival date" value={range.arrival} min={propertyToday} onChange={(arrival) => { setRange((current) => ({ ...current, arrival })); setSelectedUnits([]); preselectedRange.current = ""; }} />
                <TimeField label="Expected arrival time (optional)" value={expectedArrivalTime} onChange={setExpectedArrivalTime} />
              </div>
              <div className="space-y-3">
                <DateField label="Departure date" value={range.departure} min={nextDate(range.arrival)} onChange={(departure) => { setRange((current) => ({ ...current, departure })); setSelectedUnits([]); preselectedRange.current = ""; }} />
                <TimeField label="Expected departure time (optional)" value={expectedDepartureTime} onChange={setExpectedDepartureTime} />
              </div>
            </div>
            {invalidDates && <p className="text-sm text-error">Departure must be after arrival.</p>}

            <div className="space-y-3" hidden={!choosingInventory || !mayLoadInventory}>
              {choosingInventory && mayLoadInventory && !inventoryCurrent && <p className="rounded border border-base-300 p-3 text-sm" role="status">{invalidDates
                ? "Choose a departure date after arrival to check available rooms and beds."
                : "Inventory is not currently confirmed. Any rooms and availability shown below are from the last matching result. Selection and new creation are disabled until current information is available."}</p>}
              {/* Keep only the preference owner through source loss; new editor/stay keys reset its choices. */}
              <ReservationInventoryPicker
                key={`${identity}:${range.arrival}:${range.departure}`}
                visible={showInventoryPicker}
                groups={showInventoryPicker ? groups : []}
                loading={false}
                error={null}
                selectionEnabled={showInventoryPicker && createAuthorityCurrent}
                selectedUnits={showInventoryPicker ? selectedUnits : []}
                onToggle={(inventoryUnitId) => {
                  if (!showInventoryPicker || !createAuthorityCurrent) return;
                  setSelectedUnits((current) => current.includes(inventoryUnitId) ? current.filter((id) => id !== inventoryUnitId) : [...current, inventoryUnitId]);
                }}
              />
            </div>

            {permissionsCurrent && canReadGuests ? <GuestRecordPicker
              propertyId={propertyId}
              selectedGuest={selectedGuest}
              onSelect={chooseGuest}
              onSelectionAuthorityChange={setSelectedGuestCurrent}
              disabled={!permissionsCurrent || !canReadGuests}
              selectionEnabled={permissionsCurrent && canManageGuests}
            /> : <p className="text-sm text-base-content/55">Guest Record access is not currently confirmed. Entering a guest name does not save a profile.</p>}
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <ControlledTextField label="Primary guest" value={guestName} onChange={setGuestName} placeholder="Guest name" autoComplete="name" />
              <ControlledTextField label="Guests" type="number" min="1" value={guestCount} onChange={setGuestCount} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ControlledTextField label="Email (optional)" type="email" required={false} value={email} onChange={setEmail} placeholder="guest@example.com" autoComplete="email" />
              <ControlledTextField label="Phone (optional)" type="tel" required={false} value={phone} onChange={setPhone} placeholder="+1 555 0100" autoComplete="tel" />
            </div>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-semibold">Booking source</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["direct", "external"] as const).map((kind) => <label key={kind} className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm font-semibold focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${sourceKind === kind ? "border-primary bg-primary/10 text-primary" : "border-base-300"}`}>
                  <input type="radio" name="reservation-booking-source" value={kind} className="radio radio-primary radio-sm shrink-0" checked={sourceKind === kind} onChange={() => setSourceKind(kind)} />
                  {kind === "direct" ? "Direct" : "External"}
                </label>)}
              </div>
            </fieldset>
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
            nationalityDisabled={mutation.isPending || !mayLoadInventory || !canCreateGuests || !canManageGuests}
            guestName={guestName}
            email={email}
            phone={phone}
            legalName={legalName}
            dateOfBirth={dateOfBirth}
            nationalityCountryCode={nationalityCountryCode}
            languageTags={languageTags}
            notes={guestNotes}
            maximumDateOfBirth={propertyToday}
            onLegalNameChange={setLegalName}
            onDateOfBirthChange={setDateOfBirth}
            onNationalityChange={setNationalityCountryCode}
            onLanguageChange={setLanguageTags}
            onNotesChange={setGuestNotes}
          />
        ))}
        </fieldset>

        {mutation.error && <div ref={errorFeedback} tabIndex={-1} className="rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"><ErrorState error={mutation.error} /></div>}
        <ReservationFormActions
          showReservationForm={showReservationForm}
          step={step}
          saveGuestRecord={saveGuestRecord}
          submitting={savePending}
          disabled={!canSubmit}
          retrying={exactReplay}
          onBack={() => setStep("reservation")}
          onCancel={onClose}
        />
        {showReservationForm && step === "reservation" && availabilityUsable && !selectedUnits.length && <p className="-mt-3 text-right text-xs text-warning">Select at least one available unit.</p>}
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
  nationalityDisabled,
  guestName,
  email,
  phone,
  legalName,
  dateOfBirth,
  nationalityCountryCode,
  languageTags,
  notes,
  maximumDateOfBirth,
  onLegalNameChange,
  onDateOfBirthChange,
  onNationalityChange,
  onLanguageChange,
  onNotesChange,
}: {
  nationalityDisabled: boolean;
  guestName: string;
  email: string;
  phone: string;
  legalName: string;
  dateOfBirth: string;
  nationalityCountryCode: string;
  languageTags: string[];
  notes: string;
  maximumDateOfBirth: string;
  onLegalNameChange: (value: string) => void;
  onDateOfBirthChange: (value: string) => void;
  onNationalityChange: (value: string) => void;
  onLanguageChange: (value: string[]) => void;
  onNotesChange: (value: string) => void;
}) {
  const recoveryHeading = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-4">
      <div ref={recoveryHeading} tabIndex={-1} className="flex items-center gap-3 rounded border-b border-base-300 pb-4 outline-none focus:ring-2 focus:ring-primary">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-content">{guestName.trim().slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{guestName}</p>
          <p className="mt-1 truncate text-xs text-base-content/50">{email || phone || "No contact details"}</p>
        </div>
      </div>
      <ControlledTextField label="Legal name (optional)" value={legalName} onChange={onLegalNameChange} placeholder="As shown on identification" autoComplete="name" required={false} maxLength={256} />
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField label="Date of birth (optional)" value={dateOfBirth} max={maximumDateOfBirth} required={false} onChange={onDateOfBirthChange} />
        <div className="form-control min-w-0"><span className="label-text mb-1.5 block text-sm font-semibold">Nationality (optional)</span><NationalityPicker value={nationalityCountryCode} onChange={onNationalityChange} disabled={nationalityDisabled} /></div>
      </div>
      <LanguagePicker value={languageTags} onChange={onLanguageChange} disabled={nationalityDisabled}
        onDisabledClose={() => recoveryHeading.current?.focus()} />
      <ControlledTextArea label="Guest notes (optional)" value={notes} onChange={onNotesChange} placeholder="Preferences or operational notes visible to staff" maxLength={4000} />
    </div>
  );
}

function ReservationFormActions({
  showReservationForm,
  step,
  saveGuestRecord,
  submitting,
  disabled,
  onBack,
  onCancel,
  retrying,
}: {
  showReservationForm: boolean;
  step: ReservationStep;
  saveGuestRecord: boolean;
  submitting: boolean;
  disabled: boolean;
  onBack: () => void;
  onCancel: () => void;
  retrying: boolean;
}) {
  const submitLabel = retrying ? "Retry same reservation" : step === "reservation" && saveGuestRecord ? "Continue" : "Create reservation";

  return (
    <ModalActions>
      {showReservationForm && step === "guest" && <button type="button" className="btn btn-ghost btn-sm sm:btn-md" disabled={submitting} onClick={onBack}><ArrowLeft size={16} />Back</button>}
      <span className="flex-1" />
      <button type="button" className="btn btn-ghost btn-sm sm:btn-md" disabled={submitting} onClick={onCancel}>Cancel</button>
      {showReservationForm && <button type="submit" className="btn btn-primary btn-sm min-w-24 sm:btn-md sm:min-w-40" disabled={submitting || disabled}>
        {submitting && <span className="loading loading-spinner loading-sm" />}
        <span className="sm:hidden">{submitLabel === "Create reservation" ? "Create" : submitLabel}</span>
        <span className="hidden sm:inline">{submitLabel}</span>
      </button>}
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

function defaultRange(timeZoneId: string) {
  return defaultPropertyStayRange(timeZoneId)
    ?? defaultPropertyStayRange("UTC")!;
}

function nextDate(value: string) {
  return value ? shiftDateKey(value, 1) : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export function requestedReservationPreselection({ requestedUnitId, choosingOther, available, exactReplay, rangeKey, initializedRange }: {
  requestedUnitId?: string;
  choosingOther: boolean;
  available: boolean;
  exactReplay: boolean;
  rangeKey: string;
  initializedRange: string;
}): string[] | null {
  return requestedUnitId && !choosingOther && available && !exactReplay && rangeKey !== initializedRange
    ? [requestedUnitId] : null;
}
