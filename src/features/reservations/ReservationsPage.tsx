import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, CalendarDays, ChevronRight, Mail, Phone, Plus, Search, UserRound, UsersRound } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { InventoryAvailabilityResponse, InventoryUnitAvailability, Reservation, ReservationListResponse, ReservationStatus, RoomInventoryListResponse } from "../../api/types";
import { inventoryKindLabel, reservationSourceLabel, reservationSourceValue, reservationStatusLabel } from "../../api/labels";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, FormActions, InitialAvatar, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { groupAvailabilityByRoom, type InventoryRoomGroup } from "./inventoryGrouping";

const statusOptions = ["all", "pendingAllocation", "confirmed", "allocationRejected", "cancellationPending", "cancelled"] as const;

export function ReservationsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const enabled = Boolean(selectedPropertyId);
  const accessScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.reservationsCreate, scope: accessScope },
    { permission: permissions.reservationsCancel, scope: accessScope },
  ] : []);
  const canCreate = access.allows(permissions.reservationsCreate, accessScope);
  const canCancel = access.allows(permissions.reservationsCancel, accessScope);
  const reservations = useQuery({
    queryKey: ["reservations", selectedPropertyId, status],
    queryFn: () => request<ReservationListResponse>(`/api/reservations/properties/${selectedPropertyId}?${status === "all" ? "" : `status=${status}&`}page=1&pageSize=100`),
    enabled,
  });
  const cancelMutation = useMutation({
    mutationFn: (reservation: Reservation) => request<Reservation>(`/api/reservations/properties/${selectedPropertyId}/${reservation.reservationId}/cancel`, { method: "POST", body: JSON.stringify({ expectedVersion: reservation.version }) }),
    onSuccess: async (reservation) => { await queryClient.invalidateQueries({ queryKey: ["reservations", selectedPropertyId] }); setDetail(reservation); },
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (reservations.data?.reservations ?? []).filter((reservation) => !needle || [reservation.primaryGuestName, reservation.email, reservation.phone, reservation.sourceReference].some((value) => value?.toLowerCase().includes(needle)));
  }, [reservations.data, search]);

  if (!selectedProperty) return <EmptyState icon={<CalendarDays />} title="Choose a property first" description="Reservations belong to a property. Create or select one to continue." />;

  return (
    <>
      <PageHeader eyebrow={selectedProperty.name} title="Reservations" description="Create, find and manage stays without losing sight of allocation status." action={canCreate ? <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={17} />New reservation</button> : undefined} />

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-base-300 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="tabs tabs-box w-full overflow-x-auto bg-base-200 p-1 sm:w-auto">{statusOptions.map((option) => <button key={option} className={`tab whitespace-nowrap text-xs font-semibold ${status === option ? "tab-active bg-base-100 shadow-sm" : ""}`} onClick={() => setStatus(option)}>{option === "all" ? "All stays" : labelStatus(option)}</button>)}</div>
          <label className="input input-bordered input-sm flex w-full items-center gap-2 sm:w-64"><Search size={15} className="text-base-content/35" /><input className="grow" aria-label="Search reservations" placeholder="Guest, email or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>

        {reservations.isLoading ? <LoadingState label="Loading reservations" /> : reservations.error ? <div className="p-6"><ErrorState error={reservations.error} /></div> : !visible.length ? <div className="p-6"><EmptyState icon={<CalendarDays />} title={search || status !== "all" ? "No reservations match" : "No reservations yet"} description={search || status !== "all" ? "Try changing the status or search filter." : "Create the first stay and BunkFy will allocate the selected inventory."} action={canCreate && !search && status === "all" ? <button className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>Add reservation</button> : undefined} /></div> : (<>
          <div className="hidden overflow-x-auto lg:block">
            <table className="table">
              <thead><tr className="border-base-300 text-[0.68rem] uppercase tracking-[0.12em] text-base-content/40"><th className="pl-6">Guest</th><th>Stay</th><th>Units</th><th>Status</th><th>Source</th><th className="pr-6" /></tr></thead>
              <tbody>{visible.map((reservation) => <tr key={reservation.reservationId} className="cursor-pointer border-base-300 transition hover:bg-base-200/70" onClick={() => setDetail(reservation)}><td className="pl-6"><div className="flex items-center gap-3"><InitialAvatar name={reservation.primaryGuestName} size="sm" /><div><p className="font-semibold">{reservation.primaryGuestName}</p><p className="mt-1 text-xs text-base-content/40">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"}</p></div></div></td><td><p className="font-medium">{formatDate(reservation.arrival)} → {formatDate(reservation.departure)}</p><p className="mt-1 text-xs text-base-content/40">{nightsBetween(reservation.arrival, reservation.departure)} nights</p></td><td><span className="inline-flex items-center gap-1.5 text-sm"><BedDouble size={15} className="text-base-content/35" />{reservation.inventoryUnitIds.length}</span></td><td><StatusBadge status={reservationStatusLabel(reservation.status)} /></td><td className="text-sm capitalize text-base-content/55">{reservationSourceLabel(reservation.sourceKind)}</td><td className="pr-6 text-right"><button type="button" className="btn btn-circle btn-ghost btn-xs" aria-label={`View reservation for ${reservation.primaryGuestName}`} onClick={(event) => { event.stopPropagation(); setDetail(reservation); }}><ChevronRight size={17} /></button></td></tr>)}</tbody>
            </table>
          </div>
          <div className="divide-y divide-base-300 lg:hidden">
            {visible.map((reservation) => (
              <button key={reservation.reservationId} type="button" className="block w-full p-5 text-left transition hover:bg-base-200/70 focus-visible:bg-base-200/70" onClick={() => setDetail(reservation)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3"><InitialAvatar name={reservation.primaryGuestName} /><div className="min-w-0"><p className="truncate font-semibold">{reservation.primaryGuestName}</p><p className="mt-1 text-xs text-base-content/45">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"}</p></div></div>
                  <StatusBadge status={reservationStatusLabel(reservation.status)} />
                </div>
                <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-4">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/40">Stay</p><p className="mt-1 text-sm font-medium">{formatDate(reservation.arrival)} → {formatDate(reservation.departure)}</p><p className="mt-1 text-xs text-base-content/45">{nightsBetween(reservation.arrival, reservation.departure)} nights · {reservation.inventoryUnitIds.length} {reservation.inventoryUnitIds.length === 1 ? "unit" : "units"}</p></div>
                  <span className="inline-flex items-center gap-1 text-sm capitalize text-base-content/55">{reservationSourceLabel(reservation.sourceKind)}<ChevronRight size={17} /></span>
                </div>
              </button>
            ))}
          </div>
        </>)}
      </section>

      <CreateReservation open={createOpen && canCreate} propertyId={selectedPropertyId} onClose={() => setCreateOpen(false)} onCreated={async () => { await queryClient.invalidateQueries({ queryKey: ["reservations", selectedPropertyId] }); setCreateOpen(false); }} />
      <ReservationDetail reservation={detail} canCancel={canCancel} onClose={() => setDetail(null)} onCancel={(reservation) => cancelMutation.mutate(reservation)} cancelling={cancelMutation.isPending} error={cancelMutation.error} />
    </>
  );
}

function CreateReservation({ open, propertyId, onClose, onCreated }: { open: boolean; propertyId: string; onClose: () => void; onCreated: () => Promise<void> }) {
  const { request } = useSession();
  const initial = defaultRange();
  const [range, setRange] = useState(initial);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [sourceKind, setSourceKind] = useState<"direct" | "external">("direct");
  const availability = useQuery({ queryKey: ["availability", propertyId, range.arrival, range.departure], queryFn: () => request<InventoryAvailabilityResponse>(`/api/inventory/properties/${propertyId}/availability?arrival=${range.arrival}&departure=${range.departure}`), enabled: open && Boolean(range.arrival && range.departure) });
  const roomInventory = useQuery({ queryKey: ["inventory-rooms", propertyId], queryFn: () => request<RoomInventoryListResponse>(`/api/inventory/properties/${propertyId}/rooms?page=1&pageSize=100`), enabled: open });
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => request(`/api/reservations/properties/${propertyId}`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: onCreated,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({ arrival: range.arrival, departure: range.departure, inventoryUnitIds: selectedUnits, primaryGuestName: String(data.get("primaryGuestName")), email: emptyToNull(data.get("email")), phone: emptyToNull(data.get("phone")), guestCount: Number(data.get("guestCount")), sourceKind: reservationSourceValue(sourceKind), sourceSystem: sourceKind === "external" ? emptyToNull(data.get("sourceSystem")) : null, sourceReference: sourceKind === "external" ? emptyToNull(data.get("sourceReference")) : null, notes: emptyToNull(data.get("notes")) });
  }

  const units = availability.data?.units ?? [];
  const groups = useMemo(() => groupAvailabilityByRoom(units, roomInventory.data?.rooms ?? []), [roomInventory.data?.rooms, units]);

  return (
    <Modal open={open} title="New reservation" description="Choose the stay dates first, then select available rooms or beds." onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField label="Arrival" value={range.arrival} onChange={(arrival) => { setRange((current) => ({ ...current, arrival })); setSelectedUnits([]); }} />
          <DateField label="Departure" value={range.departure} onChange={(departure) => { setRange((current) => ({ ...current, departure })); setSelectedUnits([]); }} />
        </div>

        <InventoryPicker
          groups={groups}
          loading={availability.isLoading}
          error={availability.error}
          selectedUnits={selectedUnits}
          onToggle={(inventoryUnitId) => setSelectedUnits((current) => current.includes(inventoryUnitId) ? current.filter((id) => id !== inventoryUnitId) : [...current, inventoryUnitId])}
        />

        <div className="grid gap-4 sm:grid-cols-[1fr_140px]"><TextField label="Primary guest" name="primaryGuestName" placeholder="Guest name" /><TextField label="Guests" name="guestCount" type="number" defaultValue="1" min="1" /></div>
        <div className="grid gap-4 sm:grid-cols-2"><TextField label="Email (optional)" name="email" type="email" required={false} placeholder="guest@example.com" /><TextField label="Phone (optional)" name="phone" type="tel" required={false} placeholder="+1 555 0100" /></div>
        <div><span className="mb-2 block text-sm font-semibold">Booking source</span><div className="join w-full"><button type="button" className={`btn join-item flex-1 ${sourceKind === "direct" ? "btn-primary" : "btn-outline"}`} onClick={() => setSourceKind("direct")}>Direct</button><button type="button" className={`btn join-item flex-1 ${sourceKind === "external" ? "btn-primary" : "btn-outline"}`} onClick={() => setSourceKind("external")}>External</button></div></div>
        {sourceKind === "external" && <div className="grid gap-4 sm:grid-cols-2"><TextField label="Source system" name="sourceSystem" placeholder="Booking.com" /><TextField label="Source reference" name="sourceReference" placeholder="ABC-123" /></div>}
        <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">Notes (optional)</span><textarea className="textarea textarea-bordered min-h-20 w-full" name="notes" placeholder="Arrival details, preferences or staff notes" /></label>
        {mutation.error && <ErrorState error={mutation.error} />}
        <FormActions submitting={mutation.isPending} submitLabel="Create reservation" onCancel={onClose} disabled={!selectedUnits.length} />
        {!selectedUnits.length && <p className="-mt-3 text-right text-xs text-warning">Select at least one available unit.</p>}
      </form>
    </Modal>
  );
}

function InventoryPicker({ groups, loading, error, selectedUnits, onToggle }: {
  groups: InventoryRoomGroup[];
  loading: boolean;
  error: unknown;
  selectedUnits: string[];
  onToggle: (inventoryUnitId: string) => void;
}) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const availableCount = groups.reduce((total, group) => total + group.availableCount, 0);
  const totalCount = groups.reduce((total, group) => total + group.totalCount, 0);
  const unavailableCount = totalCount - availableCount;
  const visibleGroups = groups
    .map((group) => ({ ...group, units: showUnavailable ? group.units : group.units.filter((unit) => unit.isAvailable) }))
    .filter((group) => group.units.length > 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold">Available inventory</span>
          {!loading && !error && totalCount > 0 && <p className="mt-1 text-xs text-base-content/50">{availableCount} available across {groups.length} {groups.length === 1 ? "room" : "rooms"}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedUnits.length > 0 && <span className="badge badge-primary badge-sm">{selectedUnits.length} selected</span>}
          {unavailableCount > 0 && <button type="button" className="btn btn-ghost btn-xs" aria-pressed={showUnavailable} onClick={() => setShowUnavailable((current) => !current)}>{showUnavailable ? "Hide unavailable" : `Show ${unavailableCount} unavailable`}</button>}
        </div>
      </div>

      {loading ? <div className="rounded-xl bg-base-200 p-5 text-center text-sm text-base-content/55"><span className="loading loading-spinner loading-sm mr-2" />Checking inventory</div>
        : error ? <ErrorState error={error} />
          : !groups.length ? <div className="rounded-xl border border-dashed border-base-300 p-5 text-center text-sm text-base-content/55">No sellable inventory is configured for this property.</div>
            : !visibleGroups.length ? <div className="rounded-xl border border-dashed border-base-300 bg-base-200/60 p-5 text-center"><p className="text-sm font-semibold">No units are available for these dates</p><p className="mt-1 text-xs text-base-content/55">Change the stay dates or show unavailable inventory to review conflicts.</p></div>
              : <div className="max-h-72 space-y-3 overflow-y-auto pr-1">{visibleGroups.map((group) => <InventoryRoomSection key={group.roomId} group={group} selectedUnits={selectedUnits} onToggle={onToggle} />)}</div>}
    </div>
  );
}

function InventoryRoomSection({ group, selectedUnits, onToggle }: {
  group: InventoryRoomGroup;
  selectedUnits: string[];
  onToggle: (inventoryUnitId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-base-300" aria-label={group.roomName}>
      <div className="flex items-center justify-between gap-3 bg-base-200/75 px-3 py-2.5">
        <p className="text-sm font-semibold">{group.roomName}</p>
        <p className="text-xs font-medium text-base-content/55">{group.availableCount} of {group.totalCount} available</p>
      </div>
      <div className="grid gap-2 p-2 sm:grid-cols-2">{group.units.map((unit) => <InventoryUnitOption key={unit.unit.inventoryUnitId} item={unit} selected={selectedUnits.includes(unit.unit.inventoryUnitId)} onToggle={onToggle} />)}</div>
    </section>
  );
}

function InventoryUnitOption({ item, selected, onToggle }: {
  item: InventoryUnitAvailability;
  selected: boolean;
  onToggle: (inventoryUnitId: string) => void;
}) {
  const { unit, isAvailable } = item;
  return (
    <label className={`flex items-center gap-3 rounded-lg border p-3 transition ${selected ? "border-primary bg-primary/8" : isAvailable ? "cursor-pointer border-transparent bg-base-200 hover:border-primary/30" : "cursor-not-allowed border-base-300 bg-base-200/80"}`}>
      <input type="checkbox" className="checkbox checkbox-primary checkbox-sm" checked={selected} disabled={!isAvailable} onChange={() => onToggle(unit.inventoryUnitId)} />
      <div><p className={`text-sm font-semibold ${isAvailable ? "" : "text-base-content/70"}`}>{unit.label}</p><p className={`text-xs capitalize ${isAvailable ? "font-semibold text-success" : "font-medium text-base-content/60"}`}>{inventoryKindLabel(unit.kind)} · {isAvailable ? "Available" : "Unavailable"}</p></div>
    </label>
  );
}

function ReservationDetail({ reservation, canCancel, onClose, onCancel, cancelling, error }: { reservation: Reservation | null; canCancel: boolean; onClose: () => void; onCancel: (reservation: Reservation) => void; cancelling: boolean; error: unknown }) {
  if (!reservation) return null;
  const resolvedStatus = reservationStatusLabel(reservation.status);
  const cancellable = canCancel && !resolvedStatus.includes("cancel") && !resolvedStatus.includes("rejected");
  return <Modal open title={reservation.primaryGuestName} description={`Reservation ${reservation.reservationId.slice(0, 8).toUpperCase()}`} onClose={onClose}><div className="space-y-5"><div className="flex items-center justify-between rounded-2xl bg-base-200 p-4"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Stay</p><p className="mt-2 font-display text-xl font-semibold">{formatDate(reservation.arrival)} → {formatDate(reservation.departure)}</p><p className="mt-1 text-sm text-base-content/50">{nightsBetween(reservation.arrival, reservation.departure)} nights</p></div><StatusBadge status={resolvedStatus} /></div><div className="grid gap-3 sm:grid-cols-2"><DetailRow icon={<UsersRound />} label="Guests" value={String(reservation.guestCount)} /><DetailRow icon={<BedDouble />} label="Inventory units" value={String(reservation.inventoryUnitIds.length)} /><DetailRow icon={<Mail />} label="Email" value={reservation.email || "Not provided"} /><DetailRow icon={<Phone />} label="Phone" value={reservation.phone || "Not provided"} /><DetailRow icon={<UserRound />} label="Source" value={`${reservationSourceLabel(reservation.sourceKind)}${reservation.sourceSystem ? ` · ${reservation.sourceSystem}` : ""}`} /><DetailRow icon={<CalendarDays />} label="Booked" value={new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(reservation.createdAtUtc))} /></div>{reservation.notes && <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-base-content/40">Notes</p><p className="rounded-xl bg-base-200 p-4 text-sm leading-6 text-base-content/65">{reservation.notes}</p></div>}{Boolean(error) && <ErrorState error={error} />}<div className="flex justify-end gap-3 border-t border-base-300 pt-5"><button className="btn btn-ghost" onClick={onClose}>Close</button>{cancellable && <button className="btn btn-error btn-outline" onClick={() => { if (confirm(`Cancel reservation for ${reservation.primaryGuestName}?`)) onCancel(reservation); }} disabled={cancelling}>{cancelling && <span className="loading loading-spinner loading-sm" />}Cancel reservation</button>}</div></div></Modal>;
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex items-start gap-3 rounded-xl border border-base-300 p-4"><div className="mt-0.5 text-primary">{icon}</div><div className="min-w-0"><p className="text-xs text-base-content/40">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div></div>; }
function TextField({ label, name, type = "text", placeholder, defaultValue, required = true, min }: { label: string; name: string; type?: string; placeholder?: string; defaultValue?: string; required?: boolean; min?: string }) { return <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} required={required} min={min} /></label>; }
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" type="date" value={value} onChange={(event) => onChange(event.target.value)} required /></label>; }
function emptyToNull(value: FormDataEntryValue | null) { const normalized = String(value ?? "").trim(); return normalized || null; }
function defaultRange() { const arrival = new Date(); arrival.setDate(arrival.getDate() + 1); const departure = new Date(arrival); departure.setDate(departure.getDate() + 2); return { arrival: arrival.toISOString().slice(0, 10), departure: departure.toISOString().slice(0, 10) }; }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function nightsBetween(arrival: string, departure: string) { return Math.max(0, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86_400_000)); }
function labelStatus(value: ReservationStatus | string) { return String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()); }
