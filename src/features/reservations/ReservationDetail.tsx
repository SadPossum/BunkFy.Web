import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, BedDouble, ChevronRight, Clock3, Edit3, History, Link2, LogIn, LogOut, Save, UserPlus, XCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { inventoryKindLabel, reservationDetailsOriginLabel, reservationSourceLabel, reservationStatusLabel } from "../../api/labels";
import type { GuestListItem, GuestProfile, Reservation, ReservationDetailsHistoryItem, ReservationDetailsHistoryListResponse, ReservationMutationReceipt } from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { LIVE_DETAIL_REFRESH_INTERVAL_MS, reservationNeedsLiveRefresh, reservationStatusKey } from "../../app/liveUpdates";
import { shiftDateKey } from "../../app/propertyDate";
import { useSession } from "../../app/session";
import type { RouteNavigationLease } from "../../app/routeNavigationLease";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { ErrorState, InitialAvatar, InlineFormActions, LoadingState, Modal, StatusBadge } from "../../components/ui/primitives";
import { DatePicker } from "../../components/ui/DatePicker";
import { FormGrid, FormSection, FormSpan } from "../../components/ui/FormLayout";
import { modalIsTopmost } from "../../components/ui/modalFocus";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { TimePicker } from "../../components/ui/TimePicker";
import { GuestRecordPicker } from "./GuestRecordPicker";
import { createAndLinkGuestRecord, guestRecordPayloadFromBooking, resolveReservationGuestRecordAttempt, type ReservationGuestRecordAttempt } from "./guestRecordWorkflow";
import { useReservationDetailsEditor, type BookingDetailsDraft } from "./useReservationDetailsEditor";
import { captureReservationDetailsFocus, finishReservationDetailsFocus, type ReservationDetailsFocusIntent } from "./reservationDetailsFocus";
import { resolveReservationGuestLinkAttempt, type ReservationGuestLinkAttempt } from "./reservationGuestLinkAttempt";
import { defaultReservationBusinessDate } from "./reservationBusinessDate";
import { reservationInventoryPresentation } from "./reservationOperationalView";
import { resolveReservationLifecycleAttempt, type ReservationLifecycleAttempt, type ReservationLifecycleAction } from "./reservationLifecycleAttempt";
import {
  reservationMutationAllowed,
  reservationRecordMatches,
} from "./reservationsMutationAuthority";
import { loadAllRoomInventory, roomInventoryMatchesProperty } from "../inventory/inventoryApi";

export type ReservationCapabilities = {
  manage: boolean;
  manageGuests: boolean;
  readGuests: boolean;
  createGuests: boolean;
  cancel: boolean;
  checkIn: boolean;
  noShow: boolean;
  checkOut: boolean;
};

type DetailTab = "overview" | "guest" | "history";
type ReservationAction = ReservationLifecycleAction;
const HISTORY_PAGE_SIZE = 20;

export function ReservationDetail({ propertyId, reservationId, editorIdentity, navigation, initialTab, capabilities, permissionSource, canReadInventory, businessDateToday, notice, originLink, onDismissNotice, onClose }: {
  propertyId: string;
  reservationId: string | null;
  editorIdentity: string;
  navigation: RouteNavigationLease;
  initialTab?: DetailTab;
  capabilities: ReservationCapabilities;
  permissionSource: CompositeSource;
  canReadInventory: boolean;
  businessDateToday: string;
  notice?: string | null;
  originLink?: ReactNode;
  onDismissNotice?: () => void;
  onClose: () => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(initialTab === "history");
  const [guestOpen, setGuestOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ReservationAction | null>(null);
  const [pendingActionVersion, setPendingActionVersion] = useState<number | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const observedVersion = useRef<{ reservationId: string; version: number } | null>(null);
  const lifecycleAttempt = useRef<ReservationLifecycleAttempt | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const detailsArea = useRef<HTMLElement>(null);
  const restoreDetailsFocus = useRef<ReservationDetailsFocusIntent | null>(null);
  const enterDetailsFocus = useRef<ReservationDetailsFocusIntent | null>(null);
  const permissionsCurrent = compositeSourceCurrent(permissionSource);

  useEffect(() => {
    setHistoryOpen(initialTab === "history");
    setGuestOpen(false);
    setPendingAction(null);
    setPendingActionVersion(null);
    lifecycleAttempt.current = null;
    setHistoryPage(1);
  }, [initialTab, propertyId, reservationId]);

  const reservation = useQuery({
    queryKey: ["reservation", propertyId, reservationId],
    queryFn: async ({ signal }) => {
      const current = await request<Reservation>(`/api/reservations/properties/${propertyId}/${reservationId}`, { signal });
      if (current.propertyId !== propertyId || current.reservationId !== reservationId) throw new Error("The reservation response did not match the requested property and booking.");
      return current;
    },
    enabled: Boolean(reservationId) && permissionsCurrent,
    refetchInterval: (query) => reservationNeedsLiveRefresh(query.state.data?.status)
      ? LIVE_DETAIL_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const history = useQuery({
    queryKey: ["reservation-history", propertyId, reservationId, historyPage],
    queryFn: ({ signal }) => request<ReservationDetailsHistoryListResponse>(`/api/reservations/properties/${propertyId}/${reservationId}/details-history?page=${historyPage}&pageSize=${HISTORY_PAGE_SIZE}`, { signal }),
    enabled: Boolean(reservationId) && permissionsCurrent && historyOpen,
  });

  const inventory = useQuery({
    queryKey: ["inventory-rooms", propertyId],
    queryFn: ({ signal }) => loadAllRoomInventory(request, propertyId, signal),
    enabled: Boolean(reservationId) && permissionsCurrent && canReadInventory,
    staleTime: 30_000,
  });
  const reservationSource = createCompositeSource({
    label: "Reservation details",
    hasData: reservation.data !== undefined,
    isLoading: reservation.isLoading,
    error: reservation.error,
    isFetching: reservation.isFetching,
    refetch: () => reservation.refetch(),
  });
  const historySource = createCompositeSource({
    label: "Reservation history",
    hasData: history.data !== undefined && !(history.error instanceof ApiError && history.error.status === 403),
    isLoading: history.isLoading,
    error: history.error,
    isFetching: history.isFetching,
    refetch: () => history.refetch(),
  });
  const inventorySource = createCompositeSource({
    label: "Inventory labels",
    hasData: inventory.data !== undefined,
    isLoading: inventory.isLoading,
    error: inventory.error,
    isFetching: inventory.isFetching,
    refetch: () => inventory.refetch(),
  });
  const reservationCurrent = permissionsCurrent && compositeSourceCurrent(reservationSource)
    && reservation.data?.propertyId === propertyId && reservation.data.reservationId === reservationId;
  const reservationReadDenied = reservation.error instanceof ApiError && reservation.error.status === 403;
  const reservationUsable = Boolean(reservationId) && !reservationReadDenied && compositeSourceUsable(reservationSource.state)
    && reservation.data?.propertyId === propertyId && reservation.data.reservationId === reservationId;
  const inventoryLabelsCurrent = permissionsCurrent && canReadInventory && compositeSourceCurrent(inventorySource)
    && inventory.data !== undefined && roomInventoryMatchesProperty(inventory.data.rooms, propertyId);
  const inventoryLabelState: InventoryLabelState = !permissionsCurrent ? "access-unconfirmed"
    : !canReadInventory ? "access-unavailable"
    : inventory.isLoading || inventory.isFetching ? "loading"
    : inventoryLabelsCurrent ? "current" : "unconfirmed";
  const item = reservationUsable ? reservation.data : undefined;
  const reservationDescription = item
    ? `Reservation ${item.reservationId.slice(0, 8).toUpperCase()}`
    : reservationSource.state === "unavailable"
      ? "The requested reservation is unavailable"
      : "Loading reservation details";
  const lifecycleAuthorityCurrent = reservationMutationAllowed("lifecycle", {
    permissionsCurrent,
    reservationCurrent,
  });
  const detailsAuthorityCurrent = capabilities.manage && reservationMutationAllowed(
    "update-details",
    { permissionsCurrent, reservationCurrent },
  );
  const pendingActionRecordCurrent = !pendingAction ||
    lifecycleAttempt.current !== null ||
    item?.version === pendingActionVersion;
  const lifecycleCommandAuthorityCurrent = lifecycleAuthorityCurrent &&
    Boolean(item && reservationRecordMatches(reservation.data, item)) &&
    pendingActionRecordCurrent;

  useEffect(() => {
    if (compositeSourceCurrent(historySource) && history.data && historyPage > 1 && history.data.items.length === 0) {
      setHistoryPage((current) => Math.max(1, current - 1));
    }
  }, [history.data, historyPage, historySource]);

  useEffect(() => {
    if (!permissionsCurrent) return;
    if (pendingAction && !lifecyclePermissionAllowed(pendingAction, capabilities)) {
      lifecycleAttempt.current = null;
      setPendingAction(null);
      setPendingActionVersion(null);
    }
  }, [capabilities, pendingAction, permissionsCurrent]);

  async function refresh(updated?: ReservationMutationReceipt) {
    if (updated && reservationId) {
      observedVersion.current = { reservationId: updated.reservationId, version: updated.version };
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reservation", propertyId, reservationId], exact: true }),
      queryClient.invalidateQueries({ queryKey: ["reservations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation-operations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation-history", propertyId, reservationId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-stays", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["beds", propertyId] }),
    ]);
  }

  useEffect(() => {
    const current = reservation.data;
    if (!current) return;
    const previous = observedVersion.current;
    observedVersion.current = { reservationId: current.reservationId, version: current.version };
    if (!previous || previous.reservationId !== current.reservationId || previous.version === current.version) return;

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reservations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation-operations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation-history", propertyId, current.reservationId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-stays", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["beds", propertyId] }),
    ]);
  }, [propertyId, queryClient, reservation.data]);

  const actionMutation = useMutation({
    mutationFn: ({ action, date, current }: { action: ReservationAction; date: string; current: Reservation }) => {
      if (!lifecycleAuthorityCurrent ||
        !lifecyclePermissionAllowed(action, capabilities) ||
        (lifecycleAttempt.current === null && pendingActionVersion !== current.version) ||
        !reservationRecordMatches(reservation.data, current)) {
        throw new Error("Current reservation and access evidence is required before changing the stay lifecycle.");
      }
      const attempt = resolveReservationLifecycleAttempt(
        lifecycleAttempt.current,
        {
          propertyId,
          reservationId: current.reservationId,
          action,
          businessDate: action === "cancel" ? null : date,
          expectedVersion: current.version,
        },
      );
      lifecycleAttempt.current = attempt;
      const requestPayload = attempt.payload;
      return request<ReservationMutationReceipt>(
        `/api/reservations/properties/${requestPayload.propertyId}/${requestPayload.reservationId}/${requestPayload.action}`,
        {
          method: "POST",
          body: JSON.stringify(requestPayload.action === "cancel"
            ? { operationId: attempt.operationId, expectedVersion: requestPayload.expectedVersion }
            : {
                operationId: attempt.operationId,
                businessDate: requestPayload.businessDate,
                expectedVersion: requestPayload.expectedVersion,
              }),
        },
      );
    },
    onSuccess: async (updated) => {
      lifecycleAttempt.current = null;
      setPendingAction(null);
      setPendingActionVersion(null);
      await refresh(updated);
    },
  });

  const details = useReservationDetailsEditor({ identity: editorIdentity, propertyId, reservationId,
    current: reservation.data, authorityCurrent: detailsAuthorityCurrent,
    authorityLost: !reservationId || reservationReadDenied || (permissionsCurrent && !capabilities.manage),
    navigation, onSaved: refresh });
  useLayoutEffect(() => () => {
    enterDetailsFocus.current?.cancel(); enterDetailsFocus.current = null;
    restoreDetailsFocus.current?.cancel(); restoreDetailsFocus.current = null;
  }, [editorIdentity]);
  useLayoutEffect(() => {
    if (details.editor && enterDetailsFocus.current) {
      finishReservationDetailsFocus(enterDetailsFocus.current,
        detailsArea.current?.querySelector<HTMLInputElement>('input[name="primaryGuestName"]') ?? null, editorIdentity, detailsAuthorityCurrent);
      enterDetailsFocus.current = null;
    }
    if (!details.editor) {
      finishReservationDetailsFocus(restoreDetailsFocus.current, editButton.current, editorIdentity, detailsAuthorityCurrent);
      restoreDetailsFocus.current = null;
    } else if (!details.editor.sending) {
      // A rejected/uncertain save keeps the editor; it is not a focus-return event.
      restoreDetailsFocus.current?.cancel(); restoreDetailsFocus.current = null;
    }
  }, [details.editor, detailsAuthorityCurrent, editorIdentity]);

  function beginAction(action: ReservationAction, current: Reservation) {
    if (!lifecycleAuthorityCurrent ||
      !lifecyclePermissionAllowed(action, capabilities) ||
      !reservationRecordMatches(reservation.data, current)) return;
    lifecycleAttempt.current = null;
    setPendingAction(action);
    setPendingActionVersion(current.version);
    setBusinessDate(defaultReservationBusinessDate(action, current, businessDateToday));
    actionMutation.reset();
  }

  const inventoryLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const room of inventoryLabelsCurrent ? inventory.data?.rooms ?? [] : []) {
      for (const unit of room.units) {
        labels.set(
          unit.inventoryUnitId,
          inventoryKindLabel(unit.kind) === "room"
            ? room.roomName
            : `${room.roomName} · ${unit.label}`,
        );
      }
    }
    return labels;
  }, [inventory.data, inventoryLabelsCurrent]);

  return (
    <>
      <Modal open={Boolean(reservationId)} size="lg" title={item?.primaryGuestName || "Reservation"} description={reservationDescription} onClose={onClose}>
        {originLink}
        <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
          <CompositeSourceNotice className="mb-0" sources={[permissionSource, reservationSource]} title="Some reservation details are delayed" />
          {notice && <div className="alert border border-warning/25 bg-warning/10 text-base-content"><AlertTriangle size={19} className="text-warning" /><span className="text-sm">{notice}</span>{onDismissNotice && <button type="button" className="btn btn-ghost btn-xs" onClick={onDismissNotice}>Dismiss</button>}</div>}
          {navigation.paused && <section aria-label="Paused booking navigation" className="rounded-lg border border-warning/30 p-3 text-sm">
            <p role="status">Navigation is paused while you edit this booking. {details.unresolved ? "Resolve the pending save before leaving." : "Your draft is kept here."}</p>
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={navigation.review}>Review navigation</button>
          </section>}
          {item ? <>
            <section aria-label="Stay summary" className="min-w-0 space-y-4 border-b border-base-300 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-bold uppercase text-base-content/60">Stay</h3>
                  <p className="mt-2 font-display text-lg font-semibold sm:text-xl">{formatStayEndpoint(item.arrival, item.expectedArrivalTime)} → {formatStayEndpoint(item.departure, item.expectedDepartureTime)}</p>
                  <p className="mt-1 text-sm text-base-content/65">{nightsBetween(item.arrival, item.departure)} nights · {item.guestCount} {item.guestCount === 1 ? "guest" : "guests"} · property local time</p>
                </div>
                <StatusBadge status={reservationStatusLabel(item.status)} />
              </div>
              <ReservationOverview reservation={item} inventoryLabels={inventoryLabels} inventoryLabelState={inventoryLabelState} inventoryLabelSource={inventorySource} />
              <ReservationActions reservation={item} editorIdentity={editorIdentity} capabilities={capabilities} authorityCurrent={lifecycleCommandAuthorityCurrent && !details.editor}
                pendingAction={pendingAction} businessDate={businessDate} submitting={actionMutation.isPending} error={actionMutation.error}
                onBegin={beginAction} onDateChange={setBusinessDate}
                onConfirm={() => pendingAction && !details.editor && lifecycleCommandAuthorityCurrent && actionMutation.mutate({ action: pendingAction, date: businessDate, current: item })}
                onCancel={() => { lifecycleAttempt.current = null; setPendingAction(null); setPendingActionVersion(null); actionMutation.reset(); }} />
            </section>
          </> : <CompositeSourceFallback error={reservation.error} retry={() => void reservation.refetch()} state={reservationSource.state} label="reservation details" title="Reservation could not be opened" />}

          <section ref={detailsArea} className="min-w-0 border-b border-base-300 pb-5" aria-labelledby="booking-details-heading">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><h3 id="booking-details-heading" className="text-base font-semibold">Booking details</h3><p className="mt-1 text-sm text-base-content/60">Booking contact and staff notes. Guest Record is separate.</p></div>
              {capabilities.manage && !details.editor && item && <button ref={editButton} type="button" className="btn btn-outline btn-sm min-h-11" disabled={!detailsAuthorityCurrent || Boolean(pendingAction)} onClick={(event) => {
                enterDetailsFocus.current?.cancel(); enterDetailsFocus.current = null;
                if (event.detail === 0 && document.activeElement === editButton.current) enterDetailsFocus.current = captureReservationDetailsFocus(detailsArea.current, editorIdentity);
                details.begin();
              }}><Edit3 size={15} />Edit booking details</button>}
            </div>
            {details.editor ? <GuestDetailsForm details={details} current={item} authorityCurrent={detailsAuthorityCurrent}
              onRefresh={() => void reservation.refetch()} onCancel={() => {
                restoreDetailsFocus.current?.cancel(); restoreDetailsFocus.current = null;
                if (!details.unresolved) restoreDetailsFocus.current = captureReservationDetailsFocus(detailsArea.current, editorIdentity);
                details.cancel();
              }} onSubmitIntent={() => {
                restoreDetailsFocus.current?.cancel();
                restoreDetailsFocus.current = captureReservationDetailsFocus(detailsArea.current, editorIdentity);
              }} /> : item ? <GuestDetailsReadOnly reservation={item} /> : null}
          </section>
          {item && <ReservationActivity reservation={item} />}

          <section className="min-w-0 border-t border-base-300 pt-2">
            <button type="button" className="btn btn-ghost min-h-11 w-full justify-between whitespace-normal px-0 text-left text-base font-semibold" aria-expanded={historyOpen} aria-controls="booking-details-history" onClick={() => setHistoryOpen(!historyOpen)}><span>Booking details history</span><ChevronRight size={17} className={historyOpen ? "rotate-90 shrink-0" : "shrink-0"} /></button>
            {historyOpen && <div id="booking-details-history" className="mt-3"><p className="mb-3 text-sm text-base-content/60">Ordinary booking-details changes, not a complete lifecycle audit.</p><ReservationHistory query={history} source={historySource} page={historyPage} onPageChange={setHistoryPage} /></div>}
          </section>
          <section className="min-w-0 border-t border-base-300 pt-2">
            <button type="button" className="btn btn-ghost min-h-11 w-full justify-between whitespace-normal px-0 text-left text-base font-semibold" aria-expanded={guestOpen} aria-controls="booking-guest-record" onClick={() => setGuestOpen(!guestOpen)}><span>Guest record</span><ChevronRight size={17} className={guestOpen ? "rotate-90 shrink-0" : "shrink-0"} /></button>
            {guestOpen && <div id="booking-guest-record" className="mt-3">{!capabilities.readGuests ? <p className="text-sm text-base-content/65">Guest Record access is not assigned. Booking contact remains separate.</p> : item ? <LinkedGuestRecord propertyId={propertyId} reservation={item} currentReservation={reservation.data} permissionsCurrent={permissionsCurrent} reservationCurrent={reservationCurrent} canRead={capabilities.readGuests} canCreate={capabilities.createGuests} canManage={capabilities.manageGuests} onUpdated={refresh} /> : <p className="text-sm">Refresh current reservation details before opening its Guest Record.</p>}</div>}
          </section>
          <div className="flex justify-end border-t border-base-300 pt-4"><button type="button" className="btn btn-ghost min-h-11" onClick={onClose}>Close</button></div>
        </div>
      </Modal>
      <Modal open={Boolean(reservationId) && navigation.paused && navigation.expanded} title="Keep editing this booking?" onClose={navigation.stay}>
        <p>Your requested destination is waiting. {details.unresolved ? "This change has been sent; resolve its result before leaving. It has not been cancelled." : "Stay with this draft, or discard it and continue to the requested destination."}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost min-h-11" onClick={navigation.stay}>Stay editing</button>
          <button type="button" className="btn btn-error min-h-11" disabled={details.unresolved} onClick={() => navigation.discard()}>Discard and continue</button>
        </div>
      </Modal>
    </>
  );
}

function ReservationActions({ reservation, editorIdentity, capabilities, authorityCurrent, pendingAction, businessDate, submitting, error, onBegin, onDateChange, onConfirm, onCancel }: {
  reservation: Reservation;
  editorIdentity: string;
  capabilities: ReservationCapabilities;
  authorityCurrent: boolean;
  pendingAction: ReservationAction | null;
  businessDate: string;
  submitting: boolean;
  error: unknown;
  onBegin: (action: ReservationAction, reservation: Reservation) => void;
  onDateChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const actionButtons = useRef(new Map<ReservationAction, HTMLButtonElement>());
  const returnFocus = useRef<{ action: ReservationAction; intent: ReservationDetailsFocusIntent } | null>(null);
  useLayoutEffect(() => () => {
    returnFocus.current?.intent.cancel(); returnFocus.current = null;
  }, [editorIdentity]);
  useLayoutEffect(() => {
    if (pendingAction || !returnFocus.current) return;
    const { action, intent } = returnFocus.current;
    returnFocus.current = null;
    finishReservationDetailsFocus(intent, actionButtons.current.get(action) ?? null, editorIdentity, authorityCurrent && !submitting);
  }, [pendingAction, editorIdentity, authorityCurrent, submitting]);
  const status = reservationStatusKey(reservation.status);
  const actions: { action: ReservationAction; label: string; icon: ReactNode; tone: string }[] = [];
  if (status === "confirmed" && capabilities.checkIn) actions.push({ action: "check-in", label: "Check in", icon: <LogIn size={16} />, tone: "btn-primary" });
  if (status === "confirmed" && capabilities.noShow) actions.push({ action: "no-show", label: "Mark no-show", icon: <XCircle size={16} />, tone: "btn-outline" });
  if (status === "checkedIn" && capabilities.checkOut) actions.push({ action: "check-out", label: "Check out", icon: <LogOut size={16} />, tone: "btn-primary" });
  if (["pendingAllocation", "confirmed", "allocationRejected"].includes(status) && capabilities.cancel) actions.push({ action: "cancel", label: "Cancel", icon: <XCircle size={16} />, tone: "btn-ghost text-error" });

  if (pendingAction) {
    const copy = actionCopy(pendingAction, reservation);
    return (
      <section className="rounded-lg border border-warning/30 bg-warning/8 p-4">
        <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-warning" size={19} /><div><h3 className="font-semibold">{copy.title}</h3><p className="mt-1 text-sm leading-6 text-base-content/60">{copy.description}</p></div></div>
        {pendingAction !== "cancel" && <div className="form-control mt-4 block max-w-xs"><span className="label-text mb-1.5 block text-sm font-semibold">Business date</span><DatePicker className="w-full" value={businessDate} min={pendingAction === "check-out" ? reservation.checkedInBusinessDate || reservation.arrival : reservation.arrival} max={pendingAction === "check-in" ? dateBefore(reservation.departure) : undefined} onChange={onDateChange} ariaLabel="Business date" required disabled={!authorityCurrent || submitting} /></div>}
        {Boolean(error) && <div className="mt-4"><ErrorState error={error} /></div>}
        {!authorityCurrent && <p className="mt-4 text-sm font-medium text-warning">Refresh current reservation access and details before confirming.</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={event => {
          returnFocus.current?.intent.cancel(); returnFocus.current = null;
          if (event.detail === 0 && document.activeElement === event.currentTarget) {
            const intent = captureReservationDetailsFocus(event.currentTarget, editorIdentity);
            if (intent) returnFocus.current = { action: pendingAction, intent };
          }
          onCancel();
        }} disabled={submitting}>Keep reservation</button><button type="button" className={`btn btn-sm ${pendingAction === "cancel" || pendingAction === "no-show" ? "btn-error" : "btn-primary"}`} onClick={onConfirm} disabled={submitting || !authorityCurrent || (pendingAction !== "cancel" && !businessDate)}>{submitting && <span className="loading loading-spinner loading-xs" />}{copy.confirmLabel}</button></div>
      </section>
    );
  }

  if (!actions.length) {
    if (["cancellationPending", "noShowPending", "checkoutPending", "pendingAllocation"].includes(status)) return <div className="flex items-center gap-2 rounded-lg border border-info/20 bg-info/8 px-4 py-3 text-sm text-base-content/65"><Clock3 size={17} className="text-info" />BunkFy is processing this reservation. Actions will appear when it finishes.</div>;
    return null;
  }

  return <div className="flex flex-wrap gap-2" aria-label="Reservation actions">{actions.map(({ action, label, icon, tone }) => <button key={action} ref={button => { if (button) actionButtons.current.set(action, button); else actionButtons.current.delete(action); }} type="button" className={`btn btn-sm ${tone}`} disabled={!authorityCurrent} onClick={() => onBegin(action, reservation)}>{icon}{label}</button>)}</div>;
}

type InventoryLabelState = "current" | "access-unavailable" | "access-unconfirmed" | "loading" | "unconfirmed";
export function ReservationOverview({ reservation, inventoryLabels, inventoryLabelState, inventoryLabelSource }: {
  reservation: Reservation; inventoryLabels: Map<string, string>; inventoryLabelState: InventoryLabelState; inventoryLabelSource?: CompositeSource;
}) {
  const inventoryState = reservationInventoryPresentation({ status: reservation.status, holdsInventory: reservation.holdsInventory, inventoryUnitCount: reservation.inventoryUnitIds.length });
  const namedUnits = inventoryLabelState === "current" ? reservation.inventoryUnitIds.filter(id => inventoryLabels.get(id)?.trim()) : [];
  const missingNames = reservation.inventoryUnitIds.length > namedUnits.length;
  const namesUnconfirmed = missingNames && (inventoryLabelState === "current" || inventoryLabelState === "unconfirmed");
  return <section className="min-w-0" aria-label="Stay inventory">
    <h3 className="text-sm font-semibold">{inventoryState.heading}</h3>
    <p className="mt-1 text-sm font-medium">{inventoryState.summary}</p>
    {inventoryState.explanation && <p className="mt-1 text-sm leading-5 text-base-content/65">{inventoryState.explanation}</p>}
    <div className="mt-2 flex min-w-0 flex-wrap gap-2">
      {namedUnits.map(id => <span key={id} className="inline-flex min-h-8 max-w-full items-center gap-2 rounded bg-base-200 px-3 py-1 text-sm font-semibold [overflow-wrap:anywhere]"><BedDouble size={16} className="shrink-0" />{inventoryLabels.get(id)}</span>)}
      {!reservation.inventoryUnitIds.length && <span className="text-sm text-base-content/65">No room or bed recorded</span>}
    </div>
    {reservation.inventoryUnitIds.length > 0 && inventoryLabelState === "access-unavailable" && <p className="mt-2 text-sm text-base-content/65">Room or bed names unavailable — inventory access is not assigned.</p>}
    {reservation.inventoryUnitIds.length > 0 && inventoryLabelState === "access-unconfirmed" && <p className="mt-2 text-sm text-base-content/65">Room or bed names are unconfirmed while access is checked.</p>}
    {reservation.inventoryUnitIds.length > 0 && inventoryLabelState === "loading" && <p role="status" className="mt-2 text-sm text-base-content/65">Confirming current room or bed names…</p>}
    {namesUnconfirmed && (inventoryLabelSource ? <CompositeSourceNotice className="mt-2 mb-0" sources={[{ ...inventoryLabelSource, label: "Room or bed names", state: "unavailable" }]} title={namedUnits.length ? "Some room or bed names are unconfirmed" : "Room or bed names are unconfirmed"} /> : <p className="mt-2 text-sm text-base-content/65">Room or bed names are unconfirmed.</p>)}
  </section>;
}

export function GuestDetailsReadOnly({ reservation }: { reservation: Reservation }) {
  return <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
    <BookingFact label="Email" value={reservation.email || "Not provided"} href={reservation.email ? `mailto:${reservation.email}` : undefined} />
    <BookingFact label="Phone" value={reservation.phone || "Not provided"} href={reservation.phone ? `tel:${reservation.phone}` : undefined} />
    <div className="min-w-0 sm:col-span-2"><dt className="text-sm text-base-content/60">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{reservation.notes || "No notes"}</dd></div>
  </dl>;
}

function ReservationActivity({ reservation }: { reservation: Reservation }) {
  return <section className="min-w-0">
    <h3 className="mb-3 text-base font-semibold">Source and stay activity</h3>
    <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
      <BookingFact label="Booking source" value={`${reservationSourceLabel(reservation.sourceKind)}${reservation.sourceSystem ? ` · ${reservation.sourceSystem}` : ""}`} />
      <BookingFact label="Booked" value={formatDateTime(reservation.createdAtUtc)} />
      {reservation.sourceReference && <BookingFact label="Source reference" value={reservation.sourceReference} />}
      {reservation.checkedInBusinessDate && <BookingFact label="Checked in" value={formatDate(reservation.checkedInBusinessDate)} />}
      {reservation.pendingStayBusinessDate && <BookingFact label="Pending business date" value={formatDate(reservation.pendingStayBusinessDate)} />}
      {reservation.noShowBusinessDate && <BookingFact label="No-show recorded" value={formatDate(reservation.noShowBusinessDate)} />}
      {reservation.checkedOutBusinessDate && <BookingFact label="Checked out" value={formatDate(reservation.checkedOutBusinessDate)} />}
    </dl>
  </section>;
}

function BookingFact({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="min-w-0"><dt className="text-sm text-base-content/60">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm font-medium [overflow-wrap:anywhere]">{href ? <a className="text-primary underline-offset-2 hover:underline" href={href}>{value}</a> : value}</dd></div>;
}

type DetailsEditor = ReturnType<typeof useReservationDetailsEditor>;
export function GuestDetailsForm({ details, current, authorityCurrent, onRefresh, onCancel = details.cancel, onSubmitIntent }: { details: DetailsEditor; current?: Reservation; authorityCurrent: boolean; onRefresh: () => void; onCancel?: () => void; onSubmitIntent?: () => void }) {
  const owner = details.editor;
  const form = useRef<HTMLFormElement>(null);
  const editing = Boolean(owner);
  useEffect(() => {
    const editor = form.current, modal = editor?.closest<HTMLElement>("[data-bunkfy-modal-box]");
    if (!editing || !authorityCurrent || details.unresolved || !editor || !modal) return;
    let port = editor.parentElement;
    while (port && port !== modal && !/^(auto|scroll)$/.test(getComputedStyle(port).overflowY)) port = port.parentElement;
    if (!port || port === modal) return;
    const scrollport = port;
    let width = window.innerWidth, height = window.innerHeight;
    let visibleField: HTMLElement | null = null;
    let pointerDown = false;
    const remember = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !editor.contains(active)
        || !active.matches("input, textarea, select") || active.matches(":disabled, [readonly]")) { visibleField = null; return; }
      const rect = active.getBoundingClientRect(), bounds = scrollport.getBoundingClientRect();
      visibleField = rect.top >= bounds.top && rect.bottom <= bounds.bottom ? active : null;
    };
    const shrink = () => {
      const smaller = window.innerWidth < width || window.innerHeight < height;
      width = window.innerWidth; height = window.innerHeight;
      const target = visibleField;
      if (smaller && !pointerDown && target?.isConnected && editor.isConnected && document.activeElement === target && modalIsTopmost(modal)) {
        const rect = target.getBoundingClientRect(), bounds = scrollport.getBoundingClientRect();
        const top = bounds.top + 8, bottom = bounds.bottom - 8;
        scrollport.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
      }
      remember();
    };
    const startPointer = () => { pointerDown = true; };
    const endPointer = () => { pointerDown = false; remember(); };
    const clear = () => { visibleField = null; };
    remember();
    editor.addEventListener("focusin", remember); editor.addEventListener("focusout", clear);
    scrollport.addEventListener("scroll", remember, { passive: true });
    scrollport.addEventListener("pointerdown", startPointer);
    document.addEventListener("pointerup", endPointer); document.addEventListener("pointercancel", endPointer);
    window.addEventListener("resize", shrink);
    return () => {
      editor.removeEventListener("focusin", remember); editor.removeEventListener("focusout", clear);
      scrollport.removeEventListener("scroll", remember); scrollport.removeEventListener("pointerdown", startPointer);
      document.removeEventListener("pointerup", endPointer); document.removeEventListener("pointercancel", endPointer);
      window.removeEventListener("resize", shrink);
    };
  }, [editing, authorityCurrent, details.unresolved]);
  if (!owner) return null;
  const disabled = !authorityCurrent || details.unresolved;
  const text = (field: keyof BookingDetailsDraft, label: string, type = "text", required = false) => <label className="form-control block min-w-0"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full min-w-0" name={field} type={type} value={owner.draft[field]} onChange={event => details.change(field, event.target.value)} required={required} min={type === "number" ? 1 : undefined} disabled={disabled} /></label>;
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); onSubmitIntent?.(); void details.submit(); }
  return <form ref={form} className="min-w-0 space-y-4" onSubmit={submit}>
    <div className="divide-y divide-base-300">
      <FormSection title="Guest and contact" headingLevel={4}><FormGrid>
        <FormSpan><FormGrid layout="primaryCompact">{text("primaryGuestName", "Primary guest", "text", true)}{text("guestCount", "Guests", "number", true)}</FormGrid></FormSpan>
        {text("email", "Email", "email")}{text("phone", "Phone", "tel")}
      </FormGrid></FormSection>
      <FormSection title="Expected stay times" headingLevel={4}><FormGrid><TimeField label="Expected arrival time (optional)" value={owner.draft.expectedArrivalTime} onChange={value => details.change("expectedArrivalTime", value)} disabled={disabled} /><TimeField label="Expected departure time (optional)" value={owner.draft.expectedDepartureTime} onChange={value => details.change("expectedDepartureTime", value)} disabled={disabled} /></FormGrid></FormSection>
      <FormSection><label className="form-control block min-w-0"><span className="label-text mb-1.5 block text-sm font-semibold">Notes</span><textarea className="textarea textarea-bordered min-h-24 w-full min-w-0" name="notes" value={owner.draft.notes} onChange={event => details.change("notes", event.target.value)} disabled={disabled} /></label></FormSection>
    </div>
    {!authorityCurrent && <p role="status" className="text-sm text-base-content">Current reservation access or details are delayed. Your draft stays here; saving is disabled.</p>}
    {details.unresolved && <p role="status" className="text-sm font-medium">{owner.sending ? "Saving these booking details. Wait for the result before leaving." : "This change was sent, but its result is not confirmed. Retry the same change; do not start a replacement save."}</p>}
    {details.revisionChanged && !details.unresolved && <div className="rounded border border-warning/30 p-3 text-sm"><p>Booking details changed while you were editing. Your draft has not been replaced. Review the current reservation before a new save.</p>{current && <details className="mt-3"><summary className="cursor-pointer py-2 font-semibold">Review current booking details</summary><dl className="my-3 grid min-w-0 gap-3 sm:grid-cols-2"><BookingFact label="Primary guest" value={current.primaryGuestName} /><BookingFact label="Guests" value={String(current.guestCount)} /><BookingFact label="Expected arrival" value={current.expectedArrivalTime ? formatTime(current.expectedArrivalTime) : "Not scheduled"} /><BookingFact label="Expected departure" value={current.expectedDepartureTime ? formatTime(current.expectedDepartureTime) : "Not scheduled"} /></dl><GuestDetailsReadOnly reservation={current} /></details>}<button type="button" className="btn btn-outline btn-sm mt-2 min-h-11 whitespace-normal" disabled={!authorityCurrent} onClick={details.useCurrentDetails}>Replace draft with current details</button></div>}
    {Boolean(owner.error) && <ErrorState error={owner.error} />}
    {(!authorityCurrent || Boolean(owner.error) || details.revisionChanged) && <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={owner.sending} onClick={onRefresh}>Refresh current details</button>}
    <InlineFormActions><button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={onCancel} disabled={details.unresolved}>Cancel</button><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={owner.sending || !authorityCurrent || (!details.unresolved && (details.revisionChanged || !details.dirty))}>{owner.sending ? <span className="loading loading-spinner loading-xs" /> : <Save size={15} />}{details.unresolved ? "Retry same change" : "Save booking details"}</button></InlineFormActions>
  </form>;
}

function LinkedGuestRecord({ propertyId, reservation, currentReservation, permissionsCurrent, reservationCurrent, canRead, canCreate, canManage, onUpdated }: { propertyId: string; reservation: Reservation; currentReservation?: Reservation; permissionsCurrent: boolean; reservationCurrent: boolean; canRead: boolean; canCreate: boolean; canManage: boolean; onUpdated: (updated?: ReservationMutationReceipt) => Promise<void> }) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const currentLink = reservation.guests.find((guest) => guest.role === 1 || String(guest.role).toLowerCase() === "primary");
  const [choosing, setChoosing] = useState(!currentLink);
  const [candidate, setCandidate] = useState<GuestListItem | null>(null);
  const [candidateCurrent, setCandidateCurrent] = useState(false);
  const linkAttempt = useRef<ReservationGuestLinkAttempt | null>(null);
  const createAttempt = useRef<ReservationGuestRecordAttempt | null>(null);
  useEffect(() => { linkAttempt.current = null; createAttempt.current = null; setChoosing(!currentLink); setCandidate(null); setCandidateCurrent(false); }, [propertyId, reservation.reservationId, currentLink?.guestId]);
  const currentGuest = useQuery({
    queryKey: ["guest", propertyId, currentLink?.guestId],
    queryFn: async ({ signal }) => {
      const profile = await request<GuestProfile>(`/api/guests/properties/${propertyId}/${currentLink?.guestId}`, { signal });
      if (profile.guestId !== currentLink?.guestId) throw new Error("The linked Guest Record did not match this reservation.");
      return profile;
    },
    enabled: permissionsCurrent && canRead && Boolean(currentLink?.guestId),
  });
  const currentGuestSource = createCompositeSource({
    label: "Linked Guest Record",
    hasData: currentGuest.data !== undefined,
    isLoading: currentGuest.isLoading,
    error: currentGuest.error,
    isFetching: currentGuest.isFetching,
    refetch: () => currentGuest.refetch(),
  });
  const currentGuestUsable = canRead && !(currentGuest.error instanceof ApiError && currentGuest.error.status === 403) && compositeSourceUsable(currentGuestSource.state);
  const reservationRecordCurrent = reservationCurrent &&
    reservationRecordMatches(currentReservation, reservation);
  const createAuthorityCurrent = canCreate && canManage &&
    reservationMutationAllowed("create-and-link-guest", {
      permissionsCurrent,
      reservationCurrent: reservationRecordCurrent,
    });
  const linkAuthorityCurrent = canRead && canManage && Boolean(candidate) &&
    reservationMutationAllowed("link-existing-guest", {
      permissionsCurrent,
      reservationCurrent: reservationRecordCurrent,
      guestDirectoryCurrent: candidateCurrent,
    });
  const linkMutation = useMutation({
    mutationFn: (guest: GuestListItem) => {
      if (!linkAuthorityCurrent || candidate?.guestId !== guest.guestId ||
        !reservationRecordMatches(currentReservation, reservation)) {
        throw new Error("Current reservation, Guest Record, and access evidence is required before linking this guest.");
      }
      const attempt = resolveReservationGuestLinkAttempt(linkAttempt.current, { propertyId, reservationId: reservation.reservationId, guestId: guest.guestId, role: 1, replaceExistingRole: Boolean(currentLink), expectedVersion: reservation.version });
      linkAttempt.current = attempt;
      const { propertyId: requestPropertyId, reservationId: requestReservationId, ...payload } = attempt.payload;
      return request<ReservationMutationReceipt>(`/api/reservations/properties/${requestPropertyId}/${requestReservationId}/guests`, { method: "PUT", body: JSON.stringify(payload) });
    },
    onSuccess: async (updated) => { linkAttempt.current = null; setChoosing(false); setCandidate(null); await queryClient.invalidateQueries({ queryKey: ["guest", propertyId] }); await onUpdated(updated); },
  });
  const createMutation = useMutation({
    mutationFn: () => {
      if (!createAuthorityCurrent ||
        !reservationRecordMatches(currentReservation, reservation)) {
        throw new Error("Current reservation and access evidence is required before creating a Guest Record.");
      }
      const profile = guestRecordPayloadFromBooking(reservation);
      createAttempt.current = resolveReservationGuestRecordAttempt(
        createAttempt.current,
        propertyId,
        reservation,
        profile,
      );
      return createAndLinkGuestRecord(request, propertyId, reservation, {
        operationId: createAttempt.current.operationId,
        expectedReservationVersion:
          createAttempt.current.expectedReservationVersion,
        profile,
      });
    },
    onSuccess: async (created) => {
      createAttempt.current = null;
      setChoosing(false);
      setCandidate(null);
      await onUpdated(created.reservation);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guest", propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-detail", propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-list", propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-picker", propertyId] }),
      ]);
    },
  });
  return (
    <section className="rounded-lg border border-base-300 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-display text-lg font-semibold">Canonical Guest Record</h3><p className="mt-1 text-xs leading-5 text-base-content/50">Linking keeps this stay in the guest’s history without replacing the booking contact details.</p></div>{currentLink && canManage && !choosing && <button type="button" className="btn btn-ghost btn-sm text-primary" disabled={!reservationRecordCurrent || !permissionsCurrent} onClick={() => { if (!reservationRecordCurrent || !permissionsCurrent) return; linkAttempt.current = null; setChoosing(true); linkMutation.reset(); }}><Link2 size={15} />Replace</button>}</div>
      {currentLink && canRead && <CompositeSourceNotice className="mb-3" sources={[currentGuestSource]} title="Linked Guest Record is delayed" />}
      {currentLink && !choosing ? currentGuestSource.state === "loading" ? <div className="flex items-center gap-2 rounded-lg bg-base-200 p-4 text-sm text-base-content/55"><span className="loading loading-spinner loading-sm" />Loading linked guest</div> : currentGuestUsable && currentGuest.data ? <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center"><InitialAvatar name={currentGuest.data.displayName} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{currentGuest.data.displayName}</p><p className="truncate text-xs text-base-content/50">{currentGuest.data.email || currentGuest.data.phone || "Guest record linked"}</p></div><div className="flex shrink-0 items-center gap-2"><span className="badge border-0 bg-primary text-primary-content">Linked</span><Link className="btn btn-ghost btn-sm text-primary" to={`/guests?${new URLSearchParams({ property: propertyId, guest: currentLink.guestId, focus: currentLink.guestId })}`}>Open profile<ArrowUpRight size={15} /></Link></div></div> : <div className="rounded-lg bg-base-200 p-4 text-sm text-base-content/55">A guest record is linked, but its profile is not available with your current access.</div> : canManage ? <div className="space-y-3"><GuestRecordPicker propertyId={propertyId} selectedGuest={candidate} onSelect={(guest) => { linkAttempt.current = null; setCandidate(guest); linkMutation.reset(); }} onSelectionAuthorityChange={setCandidateCurrent} disabled={!canRead} selectionEnabled={permissionsCurrent && reservationRecordCurrent} label={currentLink ? "Replacement guest record" : "Guest record"} />{!currentLink && canCreate && <div className="flex flex-col gap-3 border-y border-primary/15 bg-primary/5 p-4 sm:flex-row sm:items-center"><UserPlus size={19} className="shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">No existing profile?</p><p className="mt-1 text-xs leading-5 text-base-content/55">Create and link a guest record using {reservation.primaryGuestName}&apos;s booking contact details.</p></div><button type="button" className="btn btn-primary btn-sm shrink-0" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !createAuthorityCurrent}>{createMutation.isPending ? <span className="loading loading-spinner loading-xs" /> : <UserPlus size={15} />}Create and link</button></div>}{linkMutation.error && <ErrorState error={linkMutation.error} />}{createMutation.error && <ErrorState error={createMutation.error} />}{choosing && currentLink && <div className="flex justify-end"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { linkAttempt.current = null; setChoosing(false); setCandidate(null); setCandidateCurrent(false); linkMutation.reset(); createMutation.reset(); }}>Keep current guest</button></div>}{candidate && <div className="flex justify-end"><button type="button" className="btn btn-primary btn-sm" onClick={() => linkMutation.mutate(candidate)} disabled={linkMutation.isPending || createMutation.isPending || !linkAuthorityCurrent}>{linkMutation.isPending && <span className="loading loading-spinner loading-xs" />}{currentLink ? "Replace primary guest" : "Link guest record"}</button></div>}</div> : <div className="rounded-lg border border-dashed border-base-300 p-4 text-sm text-base-content/55">No canonical guest record is linked to this reservation.</div>}
    </section>
  );
}


function ReservationHistory({ query, source, page, onPageChange }: { query: { isFetching: boolean; data?: ReservationDetailsHistoryListResponse }; source: CompositeSource; page: number; onPageChange: (page: number) => void }) {
  const usable = compositeSourceUsable(source.state);
  if (source.state === "loading") return <LoadingState label="Loading change history" />;
  if (!usable) return <div><CompositeSourceNotice className="mb-3" sources={[source]} title="Reservation history is delayed" /><CompositeSourceFallback state={source.state} label="reservation history" /></div>;
  if (!query.data?.items.length) return <div><CompositeSourceNotice className="mb-3" sources={[source]} title="Reservation history is delayed" /><div className="rounded-lg border border-dashed border-base-300 p-8 text-center"><History className="mx-auto text-base-content/30" /><h3 className="mt-3 font-display text-lg font-semibold">No detail changes yet</h3><p className="mt-1 text-sm text-base-content/50">Edits to expected times, booking contact and notes will appear here.</p></div></div>;
  return <div><CompositeSourceNotice className="mb-3" sources={[source]} title="Reservation history is delayed" /><div className="space-y-3">{query.data.items.map((item) => <article key={item.changeId} className="rounded-lg border border-base-300 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{formatChangedFields(item.changedFields)}</p><p className="mt-1 text-xs text-base-content/50">Revision {item.fromRevision} → {item.toRevision} · {reservationDetailsOriginLabel(item.origin)}</p></div><time className="text-xs text-base-content/45" dateTime={item.occurredAtUtc}>{formatDateTime(item.occurredAtUtc)}</time></div><p className="mt-3 text-sm text-base-content/60">Changed by {formatActor(item.actorId, item.origin)}.</p><HistoryValues item={item} /></article>)}</div><PaginationBar page={page} pageSize={HISTORY_PAGE_SIZE} itemCount={query.data.items.length} itemLabel="change" hasMore={query.data.hasMore} disabled={query.isFetching} onPageChange={onPageChange} /></div>;
}

function HistoryValues({ item }: { item: ReservationDetailsHistoryItem }) {
  const fields = item.changedFields.map((field) => field.toLowerCase());
  const values: { label: string; before: string; after: string }[] = [];
  if (fields.includes("primaryguestname")) values.push({ label: "Guest", before: item.before?.primaryGuestName || "—", after: item.after.primaryGuestName });
  if (fields.includes("email")) values.push({ label: "Email", before: item.before?.email || "—", after: item.after.email || "—" });
  if (fields.includes("phone")) values.push({ label: "Phone", before: item.before?.phone || "—", after: item.after.phone || "—" });
  if (fields.includes("guestcount")) values.push({ label: "Guests", before: String(item.before?.guestCount ?? "—"), after: String(item.after.guestCount) });
  if (fields.includes("notes")) values.push({ label: "Notes", before: item.before?.notes || "—", after: item.after.notes || "—" });
  if (fields.includes("expectedarrivaltime")) values.push({ label: "Arrival", before: item.before?.expectedArrivalTime ? formatTime(item.before.expectedArrivalTime) : "—", after: item.after.expectedArrivalTime ? formatTime(item.after.expectedArrivalTime) : "—" });
  if (fields.includes("expecteddeparturetime")) values.push({ label: "Departure", before: item.before?.expectedDepartureTime ? formatTime(item.before.expectedDepartureTime) : "—", after: item.after.expectedDepartureTime ? formatTime(item.after.expectedDepartureTime) : "—" });
  if (!values.length) return null;
  return <div className="mt-3 min-w-0 space-y-3 rounded-lg bg-base-200 p-3">{values.map((value) => <div key={value.label} className="grid min-w-0 gap-1 text-sm sm:grid-cols-[80px_minmax(0,1fr)_auto_minmax(0,1fr)]"><span className="font-semibold text-base-content/60">{value.label}</span><span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{value.before}</span><span aria-hidden="true" className="text-base-content/50">→</span><span className="min-w-0 whitespace-pre-wrap font-medium [overflow-wrap:anywhere]">{value.after}</span></div>)}</div>;
}

function TimeField({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) { return <div className="form-control block min-w-0"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><TimePicker className="w-full" value={value} onChange={onChange} ariaLabel={label} disabled={disabled} /></div>; }

function actionCopy(action: ReservationAction, reservation: Reservation) {
  if (action === "check-in") return { title: `Check in ${reservation.primaryGuestName}?`, description: "Confirm the property business date. This marks the guest as in house.", confirmLabel: "Confirm check-in" };
  if (action === "no-show") return { title: `Mark ${reservation.primaryGuestName} as a no-show?`, description: "This releases the allocated inventory and cannot be undone from this screen.", confirmLabel: "Confirm no-show" };
  if (action === "check-out") return { title: `Check out ${reservation.primaryGuestName}?`, description: "Confirm the property business date. BunkFy will release the occupied inventory.", confirmLabel: "Confirm checkout" };
  return { title: `Cancel ${reservation.primaryGuestName}’s reservation?`, description: "BunkFy will release the allocated inventory. This action cannot be undone from this screen.", confirmLabel: "Cancel reservation" };
}
function lifecyclePermissionAllowed(action: ReservationAction, capabilities: ReservationCapabilities) {
  if (action === "check-in") return capabilities.checkIn;
  if (action === "no-show") return capabilities.noShow;
  if (action === "check-out") return capabilities.checkOut;
  return capabilities.cancel;
}
function dateBefore(value: string) { return shiftDateKey(value, -1); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatStayEndpoint(date: string, time?: string | null) { return time ? `${formatDate(date)}, ${formatTime(time)}` : formatDate(date); }
function formatTime(value: string) { const [hours, minutes] = value.split(":").map(Number); return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes)); }
function nightsBetween(arrival: string, departure: string) { return Math.max(0, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86_400_000)); }
function formatChangedFields(fields: string[]) { return fields.map((field) => field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())).join(", "); }
function formatActor(actorId: string | null | undefined, origin: ReservationDetailsHistoryItem["origin"]) { const originLabel = reservationDetailsOriginLabel(origin); if (!actorId) return originLabel; if (originLabel === "integration") return "the connected integration"; if (originLabel === "system") return "BunkFy"; if (originLabel === "administrator") return "an administrator"; return "a staff user"; }
