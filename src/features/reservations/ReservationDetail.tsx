import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BedDouble, CalendarDays, CheckCircle2, Clock3, Edit3, History, Link2, LogIn, LogOut, Mail, Phone, Save, StickyNote, UserRound, UsersRound, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { reservationDetailsOriginLabel, reservationSourceLabel, reservationStatusLabel } from "../../api/labels";
import type { GuestProfile, Reservation, ReservationDetailsHistoryItem, ReservationStatus, RoomInventoryListResponse } from "../../api/types";
import { useSession } from "../../app/session";
import { ErrorState, InitialAvatar, LoadingState, Modal, StatusBadge } from "../../components/ui/primitives";
import { GuestRecordPicker } from "./GuestRecordPicker";

export type ReservationCapabilities = {
  manage: boolean;
  manageGuests: boolean;
  readGuests: boolean;
  cancel: boolean;
  checkIn: boolean;
  noShow: boolean;
  checkOut: boolean;
};

type DetailTab = "overview" | "guest" | "history";
type ReservationAction = "cancel" | "check-in" | "no-show" | "check-out";

export function ReservationDetail({ propertyId, reservationId, capabilities, notice, onDismissNotice, onClose }: {
  propertyId: string;
  reservationId: string | null;
  capabilities: ReservationCapabilities;
  notice?: string | null;
  onDismissNotice?: () => void;
  onClose: () => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [pendingAction, setPendingAction] = useState<ReservationAction | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);

  useEffect(() => {
    setTab("overview");
    setPendingAction(null);
    setEditingDetails(false);
  }, [reservationId]);

  const reservation = useQuery({
    queryKey: ["reservation", propertyId, reservationId],
    queryFn: () => request<Reservation>(`/api/reservations/properties/${propertyId}/${reservationId}`),
    enabled: Boolean(reservationId),
  });
  const history = useQuery({
    queryKey: ["reservation-history", propertyId, reservationId],
    queryFn: () => request<ReservationDetailsHistoryItem[]>(`/api/reservations/properties/${propertyId}/${reservationId}/details-history`),
    enabled: Boolean(reservationId) && tab === "history",
  });
  const inventory = useQuery({
    queryKey: ["inventory-rooms", propertyId],
    queryFn: () => request<RoomInventoryListResponse>(`/api/inventory/properties/${propertyId}/rooms?page=1&pageSize=100`),
    enabled: Boolean(reservationId),
    staleTime: 30_000,
  });

  async function refresh(updated?: Reservation) {
    if (updated && reservationId) queryClient.setQueryData(["reservation", propertyId, reservationId], updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reservations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation-history", propertyId, reservationId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-stays", propertyId] }),
    ]);
  }

  const actionMutation = useMutation({
    mutationFn: ({ action, date, current }: { action: ReservationAction; date: string; current: Reservation }) => request<Reservation>(
      `/api/reservations/properties/${propertyId}/${current.reservationId}/${action}`,
      {
        method: "POST",
        body: JSON.stringify(action === "cancel"
          ? { expectedVersion: current.version }
          : { businessDate: date, expectedVersion: current.version }),
      },
    ),
    onSuccess: async (updated) => {
      setPendingAction(null);
      await refresh(updated);
    },
  });

  const detailsMutation = useMutation({
    mutationFn: ({ current, payload }: { current: Reservation; payload: Record<string, unknown> }) => request<Reservation>(
      `/api/reservations/properties/${propertyId}/${current.reservationId}/guest-details`,
      { method: "PUT", body: JSON.stringify(payload) },
    ),
    onSuccess: async (updated) => {
      setEditingDetails(false);
      await refresh(updated);
    },
  });

  function beginAction(action: ReservationAction, current: Reservation) {
    setPendingAction(action);
    setBusinessDate(defaultBusinessDate(action, current));
    actionMutation.reset();
  }

  const item = reservation.data;
  const inventoryLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const room of inventory.data?.rooms ?? []) {
      for (const unit of room.units) labels.set(unit.inventoryUnitId, `${room.roomName} · ${unit.label}`);
    }
    return labels;
  }, [inventory.data]);

  return (
    <Modal open={Boolean(reservationId)} size="lg" title={item?.primaryGuestName || "Reservation"} description={item ? `Reservation ${item.reservationId.slice(0, 8).toUpperCase()}` : "Loading reservation details"} onClose={onClose}>
      {reservation.isLoading ? <LoadingState label="Loading reservation" /> : reservation.error ? <ErrorState error={reservation.error} retry={() => void reservation.refetch()} /> : item ? (
        <div className="space-y-5">
          {notice && <div className="alert border border-warning/25 bg-warning/10 text-base-content"><AlertTriangle size={19} className="text-warning" /><span className="text-sm">{notice}</span>{onDismissNotice && <button type="button" className="btn btn-ghost btn-xs" onClick={onDismissNotice}>Dismiss</button>}</div>}

          <div className="rounded-2xl bg-base-200 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Stay</p>
              <p className="mt-2 font-display text-xl font-semibold">{formatDate(item.arrival)} → {formatDate(item.departure)}</p>
              <p className="mt-1 text-sm text-base-content/50">{nightsBetween(item.arrival, item.departure)} nights · {item.guestCount} {item.guestCount === 1 ? "guest" : "guests"}</p>
            </div>
            <div className="mt-3 sm:mt-0"><StatusBadge status={reservationStatusLabel(item.status)} /></div>
          </div>

          <ReservationActions reservation={item} capabilities={capabilities} pendingAction={pendingAction} businessDate={businessDate} submitting={actionMutation.isPending} error={actionMutation.error} onBegin={beginAction} onDateChange={setBusinessDate} onConfirm={() => pendingAction && actionMutation.mutate({ action: pendingAction, date: businessDate, current: item })} onCancel={() => { setPendingAction(null); actionMutation.reset(); }} />

          <div role="tablist" aria-label="Reservation details" className="tabs tabs-box grid grid-cols-3 bg-base-200 p-1">
            {(["overview", "guest", "history"] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} className={`tab gap-1.5 text-xs font-semibold sm:text-sm ${tab === value ? "tab-active bg-base-100 shadow-sm" : ""}`} onClick={() => setTab(value)}>{value === "overview" ? <CalendarDays size={15} /> : value === "guest" ? <UserRound size={15} /> : <History size={15} />}{value === "guest" ? "Guest & notes" : capitalize(value)}</button>)}
          </div>

          {tab === "overview" && <ReservationOverview reservation={item} inventoryLabels={inventoryLabels} />}
          {tab === "guest" && (
            <div className="space-y-5">
              <section className="rounded-2xl border border-base-300 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div><h3 className="font-display text-lg font-semibold">Booking guest details</h3><p className="mt-1 text-xs text-base-content/50">Contact and notes stored on this reservation.</p></div>
                  {capabilities.manage && !editingDetails && <button type="button" className="btn btn-ghost btn-sm text-primary" onClick={() => { setEditingDetails(true); detailsMutation.reset(); }}><Edit3 size={15} />Edit</button>}
                </div>
                {editingDetails ? <GuestDetailsForm reservation={item} submitting={detailsMutation.isPending} error={detailsMutation.error} onSubmit={(payload) => detailsMutation.mutate({ current: item, payload })} onCancel={() => { setEditingDetails(false); detailsMutation.reset(); }} /> : <GuestDetailsReadOnly reservation={item} />}
              </section>
              <LinkedGuestRecord propertyId={propertyId} reservation={item} canRead={capabilities.readGuests} canManage={capabilities.manageGuests} onUpdated={refresh} />
            </div>
          )}
          {tab === "history" && <ReservationHistory query={history} />}

          <div className="flex justify-end border-t border-base-300 pt-5"><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div>
        </div>
      ) : null}
    </Modal>
  );
}

function ReservationActions({ reservation, capabilities, pendingAction, businessDate, submitting, error, onBegin, onDateChange, onConfirm, onCancel }: {
  reservation: Reservation;
  capabilities: ReservationCapabilities;
  pendingAction: ReservationAction | null;
  businessDate: string;
  submitting: boolean;
  error: unknown;
  onBegin: (action: ReservationAction, reservation: Reservation) => void;
  onDateChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const status = reservationStatusKey(reservation.status);
  const actions: { action: ReservationAction; label: string; icon: ReactNode; tone: string }[] = [];
  if (status === "confirmed" && capabilities.checkIn) actions.push({ action: "check-in", label: "Check in", icon: <LogIn size={16} />, tone: "btn-primary" });
  if (status === "confirmed" && capabilities.noShow) actions.push({ action: "no-show", label: "Mark no-show", icon: <XCircle size={16} />, tone: "btn-outline" });
  if (status === "checkedIn" && capabilities.checkOut) actions.push({ action: "check-out", label: "Check out", icon: <LogOut size={16} />, tone: "btn-primary" });
  if (["pendingAllocation", "confirmed", "allocationRejected"].includes(status) && capabilities.cancel) actions.push({ action: "cancel", label: "Cancel", icon: <XCircle size={16} />, tone: "btn-ghost text-error" });

  if (pendingAction) {
    const copy = actionCopy(pendingAction, reservation);
    return (
      <section className="rounded-2xl border border-warning/30 bg-warning/8 p-4">
        <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-warning" size={19} /><div><h3 className="font-semibold">{copy.title}</h3><p className="mt-1 text-sm leading-6 text-base-content/60">{copy.description}</p></div></div>
        {pendingAction !== "cancel" && <label className="form-control mt-4 block max-w-xs"><span className="label-text mb-2 block text-sm font-semibold">Business date</span><input className="input input-bordered w-full" type="date" value={businessDate} min={pendingAction === "check-out" ? reservation.checkedInBusinessDate || reservation.arrival : reservation.arrival} max={pendingAction === "check-in" ? dateBefore(reservation.departure) : undefined} onChange={(event) => onDateChange(event.target.value)} required /></label>}
        {Boolean(error) && <div className="mt-4"><ErrorState error={error} /></div>}
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={submitting}>Keep reservation</button><button type="button" className={`btn btn-sm ${pendingAction === "cancel" || pendingAction === "no-show" ? "btn-error" : "btn-primary"}`} onClick={onConfirm} disabled={submitting || (pendingAction !== "cancel" && !businessDate)}>{submitting && <span className="loading loading-spinner loading-xs" />}{copy.confirmLabel}</button></div>
      </section>
    );
  }

  if (!actions.length) {
    if (["cancellationPending", "noShowPending", "checkoutPending", "pendingAllocation"].includes(status)) return <div className="flex items-center gap-2 rounded-xl border border-info/20 bg-info/8 px-4 py-3 text-sm text-base-content/65"><Clock3 size={17} className="text-info" />BunkFy is processing this reservation. Actions will appear when it finishes.</div>;
    return null;
  }

  return <div className="flex flex-wrap gap-2" aria-label="Reservation actions">{actions.map(({ action, label, icon, tone }) => <button key={action} type="button" className={`btn btn-sm ${tone}`} onClick={() => onBegin(action, reservation)}>{icon}{label}</button>)}</div>;
}

function ReservationOverview({ reservation, inventoryLabels }: { reservation: Reservation; inventoryLabels: Map<string, string> }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailRow icon={<UsersRound />} label="Guests" value={String(reservation.guestCount)} />
        <DetailRow icon={<BedDouble />} label="Inventory" value={`${reservation.inventoryUnitIds.length} ${reservation.inventoryUnitIds.length === 1 ? "unit" : "units"}`} />
        <DetailRow icon={<Mail />} label="Email" value={reservation.email || "Not provided"} href={reservation.email ? `mailto:${reservation.email}` : undefined} />
        <DetailRow icon={<Phone />} label="Phone" value={reservation.phone || "Not provided"} href={reservation.phone ? `tel:${reservation.phone}` : undefined} />
        <DetailRow icon={<UserRound />} label="Source" value={`${reservationSourceLabel(reservation.sourceKind)}${reservation.sourceSystem ? ` · ${reservation.sourceSystem}` : ""}`} />
        <DetailRow icon={<CalendarDays />} label="Booked" value={formatDateTime(reservation.createdAtUtc)} />
      </div>
      <section>
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-base-content/40">Assigned inventory</h3>
        <div className="mt-3 flex flex-wrap gap-2">{reservation.inventoryUnitIds.map((id) => <span key={id} className="badge badge-ghost h-auto min-h-7 py-1 font-medium">{inventoryLabels.get(id) || `Unit ${id.slice(0, 8)}`}</span>)}</div>
      </section>
      {(reservation.sourceReference || reservation.checkedInBusinessDate || reservation.pendingStayBusinessDate || reservation.noShowBusinessDate || reservation.checkedOutBusinessDate) && (
        <section className="rounded-2xl border border-base-300 p-4">
          <h3 className="font-display text-lg font-semibold">Operational timeline</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {reservation.sourceReference && <TimelineItem label="Source reference" value={reservation.sourceReference} />}
            {reservation.checkedInBusinessDate && <TimelineItem label="Checked in" value={formatDate(reservation.checkedInBusinessDate)} />}
            {reservation.pendingStayBusinessDate && <TimelineItem label="Pending business date" value={formatDate(reservation.pendingStayBusinessDate)} />}
            {reservation.noShowBusinessDate && <TimelineItem label="No-show recorded" value={formatDate(reservation.noShowBusinessDate)} />}
            {reservation.checkedOutBusinessDate && <TimelineItem label="Checked out" value={formatDate(reservation.checkedOutBusinessDate)} />}
          </div>
        </section>
      )}
    </div>
  );
}

function GuestDetailsReadOnly({ reservation }: { reservation: Reservation }) {
  return <div className="grid gap-3 sm:grid-cols-2"><DetailRow icon={<UserRound />} label="Primary guest" value={reservation.primaryGuestName} /><DetailRow icon={<UsersRound />} label="Guest count" value={String(reservation.guestCount)} /><DetailRow icon={<Mail />} label="Email" value={reservation.email || "Not provided"} /><DetailRow icon={<Phone />} label="Phone" value={reservation.phone || "Not provided"} />{reservation.notes && <div className="sm:col-span-2"><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-base-content/40"><StickyNote size={14} />Notes</p><p className="rounded-xl bg-base-200 p-4 text-sm leading-6 text-base-content/65">{reservation.notes}</p></div>}</div>;
}

function GuestDetailsForm({ reservation, submitting, error, onSubmit, onCancel }: { reservation: Reservation; submitting: boolean; error: unknown; onSubmit: (payload: Record<string, unknown>) => void; onCancel: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({ primaryGuestName: String(data.get("primaryGuestName") ?? "").trim(), email: emptyToNull(data.get("email")), phone: emptyToNull(data.get("phone")), guestCount: Number(data.get("guestCount")), notes: emptyToNull(data.get("notes")), expectedDetailsRevision: reservation.detailsRevision });
  }
  return <form key={reservation.detailsRevision} className="space-y-4" onSubmit={submit}><div className="grid gap-4 sm:grid-cols-[1fr_140px]"><TextField label="Primary guest" name="primaryGuestName" defaultValue={reservation.primaryGuestName} /><TextField label="Guests" name="guestCount" type="number" min="1" defaultValue={String(reservation.guestCount)} /></div><div className="grid gap-4 sm:grid-cols-2"><TextField label="Email" name="email" type="email" required={false} defaultValue={reservation.email || ""} /><TextField label="Phone" name="phone" type="tel" required={false} defaultValue={reservation.phone || ""} /></div><label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">Notes</span><textarea className="textarea textarea-bordered min-h-24 w-full" name="notes" defaultValue={reservation.notes || ""} /></label>{Boolean(error) && <ErrorState error={error} />}<div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={submitting}>Cancel</button><button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>{submitting ? <span className="loading loading-spinner loading-xs" /> : <Save size={15} />}Save details</button></div></form>;
}

function LinkedGuestRecord({ propertyId, reservation, canRead, canManage, onUpdated }: { propertyId: string; reservation: Reservation; canRead: boolean; canManage: boolean; onUpdated: (updated?: Reservation) => Promise<void> }) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const currentLink = reservation.guests.find((guest) => guest.role === 1 || String(guest.role).toLowerCase() === "primary");
  const [choosing, setChoosing] = useState(!currentLink);
  const [candidate, setCandidate] = useState<GuestProfile | null>(null);
  useEffect(() => { setChoosing(!currentLink); setCandidate(null); }, [reservation.reservationId, currentLink?.guestId]);
  const currentGuest = useQuery({
    queryKey: ["guest", propertyId, currentLink?.guestId],
    queryFn: () => request<GuestProfile>(`/api/guests/properties/${propertyId}/${currentLink?.guestId}`),
    enabled: canRead && Boolean(currentLink?.guestId),
  });
  const linkMutation = useMutation({
    mutationFn: (guest: GuestProfile) => request<Reservation>(`/api/reservations/properties/${propertyId}/${reservation.reservationId}/guests`, { method: "PUT", body: JSON.stringify({ guestId: guest.guestId, role: 1, replaceExistingRole: Boolean(currentLink), expectedVersion: reservation.version }) }),
    onSuccess: async (updated) => { setChoosing(false); setCandidate(null); await queryClient.invalidateQueries({ queryKey: ["guest", propertyId] }); await onUpdated(updated); },
  });
  return (
    <section className="rounded-2xl border border-base-300 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-display text-lg font-semibold">Canonical Guest Record</h3><p className="mt-1 text-xs leading-5 text-base-content/50">Linking keeps this stay in the guest’s history without replacing the booking contact details.</p></div>{currentLink && canManage && !choosing && <button type="button" className="btn btn-ghost btn-sm text-primary" onClick={() => setChoosing(true)}><Link2 size={15} />Replace</button>}</div>
      {currentLink && !choosing ? currentGuest.isLoading ? <div className="flex items-center gap-2 rounded-xl bg-base-200 p-4 text-sm text-base-content/55"><span className="loading loading-spinner loading-sm" />Loading linked guest</div> : currentGuest.data ? <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4"><InitialAvatar name={currentGuest.data.displayName} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{currentGuest.data.displayName}</p><p className="truncate text-xs text-base-content/50">{currentGuest.data.email || currentGuest.data.phone || "Guest Record linked"}</p></div><span className="badge border-0 bg-primary text-primary-content">Linked</span></div> : <div className="rounded-xl bg-base-200 p-4 text-sm text-base-content/55">A Guest Record is linked, but its profile is not available with your current access.</div> : canManage ? <div className="space-y-3"><GuestRecordPicker propertyId={propertyId} selectedGuest={candidate} onSelect={setCandidate} disabled={!canRead} label={currentLink ? "Replacement Guest Record" : "Guest Record"} />{linkMutation.error && <ErrorState error={linkMutation.error} />}{choosing && currentLink && <div className="flex justify-end"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setChoosing(false); setCandidate(null); linkMutation.reset(); }}>Keep current guest</button></div>}{candidate && <div className="flex justify-end"><button type="button" className="btn btn-primary btn-sm" onClick={() => linkMutation.mutate(candidate)} disabled={linkMutation.isPending}>{linkMutation.isPending && <span className="loading loading-spinner loading-xs" />}{currentLink ? "Replace primary guest" : "Link Guest Record"}</button></div>}</div> : <div className="rounded-xl border border-dashed border-base-300 p-4 text-sm text-base-content/55">No canonical Guest Record is linked to this reservation.</div>}
    </section>
  );
}

function ReservationHistory({ query }: { query: { isLoading: boolean; error: unknown; data?: ReservationDetailsHistoryItem[]; refetch: () => Promise<unknown> } }) {
  if (query.isLoading) return <LoadingState label="Loading change history" />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data?.length) return <div className="rounded-2xl border border-dashed border-base-300 p-8 text-center"><History className="mx-auto text-base-content/30" /><h3 className="mt-3 font-display text-lg font-semibold">No detail changes yet</h3><p className="mt-1 text-sm text-base-content/50">Edits to guest contact details and notes will appear here.</p></div>;
  return <div className="space-y-3">{query.data.map((item) => <article key={item.changeId} className="rounded-2xl border border-base-300 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{formatChangedFields(item.changedFields)}</p><p className="mt-1 text-xs text-base-content/50">Revision {item.fromRevision} → {item.toRevision} · {reservationDetailsOriginLabel(item.origin)}</p></div><time className="text-xs text-base-content/45" dateTime={item.occurredAtUtc}>{formatDateTime(item.occurredAtUtc)}</time></div><p className="mt-3 text-sm text-base-content/60">Changed by {formatActor(item.actorId, item.origin)}.</p><HistoryValues item={item} /></article>)}</div>;
}

function HistoryValues({ item }: { item: ReservationDetailsHistoryItem }) {
  const fields = item.changedFields.map((field) => field.toLowerCase());
  const values: { label: string; before: string; after: string }[] = [];
  if (fields.includes("primaryguestname")) values.push({ label: "Guest", before: item.before?.primaryGuestName || "—", after: item.after.primaryGuestName });
  if (fields.includes("email")) values.push({ label: "Email", before: item.before?.email || "—", after: item.after.email || "—" });
  if (fields.includes("phone")) values.push({ label: "Phone", before: item.before?.phone || "—", after: item.after.phone || "—" });
  if (fields.includes("guestcount")) values.push({ label: "Guests", before: String(item.before?.guestCount ?? "—"), after: String(item.after.guestCount) });
  if (fields.includes("notes")) values.push({ label: "Notes", before: item.before?.notes || "—", after: item.after.notes || "—" });
  if (!values.length) return null;
  return <div className="mt-3 space-y-2 rounded-xl bg-base-200 p-3">{values.map((value) => <div key={value.label} className="grid gap-1 text-xs sm:grid-cols-[80px_1fr_auto_1fr]"><span className="font-semibold text-base-content/50">{value.label}</span><span className="truncate">{value.before}</span><span aria-hidden="true" className="text-base-content/30">→</span><span className="truncate font-medium">{value.after}</span></div>)}</div>;
}

function DetailRow({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href?: string }) { return <div className="flex items-start gap-3 rounded-xl border border-base-300 p-4"><div className="mt-0.5 text-primary">{icon}</div><div className="min-w-0"><p className="text-xs text-base-content/40">{label}</p>{href ? <a className="mt-1 block truncate text-sm font-semibold text-primary hover:underline" href={href}>{value}</a> : <p className="mt-1 truncate text-sm font-semibold">{value}</p>}</div></div>; }
function TimelineItem({ label, value }: { label: string; value: string }) { return <div className="flex items-center gap-3"><CheckCircle2 size={16} className="shrink-0 text-primary" /><div><p className="text-xs text-base-content/45">{label}</p><p className="text-sm font-semibold">{value}</p></div></div>; }
function TextField({ label, name, type = "text", defaultValue, required = true, min }: { label: string; name: string; type?: string; defaultValue?: string; required?: boolean; min?: string }) { return <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} type={type} defaultValue={defaultValue} required={required} min={min} /></label>; }

function reservationStatusKey(status: ReservationStatus): string {
  if (typeof status === "string") return status.replace(/[- ](.)/g, (_, letter: string) => letter.toUpperCase());
  return ({ 1: "pendingAllocation", 2: "confirmed", 3: "allocationRejected", 4: "cancellationPending", 5: "cancelled", 6: "checkedIn", 7: "noShowPending", 8: "noShow", 9: "checkoutPending", 10: "checkedOut" } as Record<number, string>)[status] ?? "unknown";
}
function actionCopy(action: ReservationAction, reservation: Reservation) {
  if (action === "check-in") return { title: `Check in ${reservation.primaryGuestName}?`, description: "Confirm the property business date. This marks the guest as in house.", confirmLabel: "Confirm check-in" };
  if (action === "no-show") return { title: `Mark ${reservation.primaryGuestName} as a no-show?`, description: "This releases the allocated inventory and cannot be undone from this screen.", confirmLabel: "Confirm no-show" };
  if (action === "check-out") return { title: `Check out ${reservation.primaryGuestName}?`, description: "Confirm the property business date. BunkFy will release the occupied inventory.", confirmLabel: "Confirm checkout" };
  return { title: `Cancel ${reservation.primaryGuestName}’s reservation?`, description: "BunkFy will release the allocated inventory. This action cannot be undone from this screen.", confirmLabel: "Cancel reservation" };
}
function defaultBusinessDate(action: ReservationAction, reservation: Reservation) {
  const today = localDateKey(new Date());
  if (action === "check-in") return maxDate(reservation.arrival, minDate(today, dateBefore(reservation.departure)));
  if (action === "check-out") return maxDate(today, reservation.checkedInBusinessDate || reservation.arrival);
  if (action === "no-show") return maxDate(today, reservation.arrival);
  return "";
}
function dateBefore(value: string) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() - 1); return localDateKey(date); }
function maxDate(a: string, b: string) { return a > b ? a : b; }
function minDate(a: string, b: string) { return a < b ? a : b; }
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function emptyToNull(value: FormDataEntryValue | null) { const normalized = String(value ?? "").trim(); return normalized || null; }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function nightsBetween(arrival: string, departure: string) { return Math.max(0, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86_400_000)); }
function capitalize(value: string) { return value.slice(0, 1).toUpperCase() + value.slice(1); }
function formatChangedFields(fields: string[]) { return fields.map((field) => field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())).join(", "); }
function formatActor(actorId: string | null | undefined, origin: ReservationDetailsHistoryItem["origin"]) { const originLabel = reservationDetailsOriginLabel(origin); if (!actorId) return originLabel; if (originLabel === "integration") return "the connected integration"; if (originLabel === "system") return "BunkFy"; if (originLabel === "administrator") return "an administrator"; return "a staff user"; }
