import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, CalendarDays, ChevronRight, Plus, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { GuestProfile, InventoryAvailabilityResponse, InventoryUnitAvailability, Reservation, ReservationListResponse, ReservationStatus, RoomInventoryListResponse } from "../../api/types";
import { inventoryKindLabel, reservationSourceLabel, reservationSourceValue, reservationStatusLabel } from "../../api/labels";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, FormActions, InitialAvatar, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { GuestRecordPicker } from "./GuestRecordPicker";
import { ReservationDetail, type ReservationCapabilities } from "./ReservationDetail";
import { groupAvailabilityByRoom, type InventoryRoomGroup } from "./inventoryGrouping";

const PAGE_SIZE = 50;
const statusFilters = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "inHouse", label: "In house" },
  { value: "attention", label: "Needs attention" },
  { value: "closed", label: "Closed" },
] as const;
type StatusFilter = (typeof statusFilters)[number]["value"];

export function ReservationsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const selectedReservationId = searchParams.get("reservation");
  const createOpen = searchParams.get("new") === "1";
  const enabled = Boolean(selectedPropertyId);
  const accessScope = session && selectedPropertyId ? propertyAccessScope(session.tenantId, selectedPropertyId) : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.reservationsCreate, scope: accessScope },
    { permission: permissions.reservationsManage, scope: accessScope },
    { permission: permissions.reservationsManageGuests, scope: accessScope },
    { permission: permissions.reservationsCancel, scope: accessScope },
    { permission: permissions.reservationsCheckIn, scope: accessScope },
    { permission: permissions.reservationsNoShow, scope: accessScope },
    { permission: permissions.reservationsCheckOut, scope: accessScope },
    { permission: permissions.guestsRead, scope: accessScope },
  ] : []);
  const canCreate = access.allows(permissions.reservationsCreate, accessScope);
  const capabilities: ReservationCapabilities = {
    manage: access.allows(permissions.reservationsManage, accessScope),
    manageGuests: access.allows(permissions.reservationsManageGuests, accessScope),
    readGuests: access.allows(permissions.guestsRead, accessScope),
    cancel: access.allows(permissions.reservationsCancel, accessScope),
    checkIn: access.allows(permissions.reservationsCheckIn, accessScope),
    noShow: access.allows(permissions.reservationsNoShow, accessScope),
    checkOut: access.allows(permissions.reservationsCheckOut, accessScope),
  };
  const reservations = useInfiniteQuery({
    queryKey: ["reservations", selectedPropertyId, "directory"],
    queryFn: ({ pageParam }) => request<ReservationListResponse>(`/api/reservations/properties/${selectedPropertyId}?page=${pageParam}&pageSize=${PAGE_SIZE}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.reservations.length === PAGE_SIZE ? lastPage.page + 1 : undefined,
    enabled,
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (reservations.data?.pages.flatMap((page) => page.reservations) ?? [])
      .filter((reservation) => matchesStatusFilter(reservation.status, status))
      .filter((reservation) => !needle || [reservation.primaryGuestName, reservation.email, reservation.phone, reservation.sourceReference, reservation.sourceSystem].some((value) => value?.toLowerCase().includes(needle)))
      .sort((left, right) => status === "closed" ? right.departure.localeCompare(left.departure) : left.arrival.localeCompare(right.arrival));
  }, [reservations.data, search, status]);

  function setParam(name: "reservation" | "new", value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value); else next.delete(name);
    setSearchParams(next, { replace: true });
  }

  if (!selectedProperty) return <EmptyState icon={<CalendarDays />} title="Choose a property first" description="Reservations belong to a property. Create or select one to continue." />;

  return (
    <>
      <PageHeader eyebrow={selectedProperty.name} title="Reservations" description="Run the full stay lifecycle, from booking and Guest Record linking through checkout." action={canCreate ? <button className="btn btn-primary" onClick={() => setParam("new", "1")}><Plus size={17} />New reservation</button> : undefined} />

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-base-300 p-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="tabs tabs-box w-full overflow-x-auto bg-base-200 p-1 xl:w-auto">{statusFilters.map((option) => <button key={option.value} className={`tab whitespace-nowrap text-xs font-semibold sm:text-sm ${status === option.value ? "tab-active bg-base-100 shadow-sm" : ""}`} onClick={() => setStatus(option.value)}>{option.label}</button>)}</div>
          <label className="input input-bordered input-sm flex w-full items-center gap-2 xl:w-72"><Search size={15} className="text-base-content/35" /><input className="grow" aria-label="Search loaded reservations" placeholder="Guest, contact or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>

        {reservations.isLoading ? <LoadingState label="Loading reservations" /> : reservations.error ? <div className="p-6"><ErrorState error={reservations.error} retry={() => void reservations.refetch()} /></div> : !visible.length ? <div className="p-6"><EmptyState icon={<CalendarDays />} title={search || status !== "all" ? "No reservations match" : "No reservations yet"} description={search || status !== "all" ? "Try changing the status or search filter." : "Create the first stay and BunkFy will allocate the selected inventory."} action={canCreate && !search && status === "all" ? <button className="btn btn-sm btn-primary" onClick={() => setParam("new", "1")}>Add reservation</button> : undefined} /></div> : (<>
          <div className="hidden overflow-x-auto lg:block">
            <table className="table">
              <thead><tr className="border-base-300 text-[0.68rem] uppercase tracking-[0.12em] text-base-content/40"><th className="pl-6">Guest</th><th>Stay</th><th>Units</th><th>Status</th><th>Source</th><th className="pr-6" /></tr></thead>
              <tbody>{visible.map((reservation) => <tr key={reservation.reservationId} className="cursor-pointer border-base-300 transition hover:bg-base-200/70" onClick={() => setParam("reservation", reservation.reservationId)}><td className="pl-6"><div className="flex items-center gap-3"><InitialAvatar name={reservation.primaryGuestName} size="sm" /><div><p className="font-semibold">{reservation.primaryGuestName}</p><p className="mt-1 text-xs text-base-content/40">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"}</p></div></div></td><td><p className="font-medium">{formatDate(reservation.arrival)} → {formatDate(reservation.departure)}</p><p className="mt-1 text-xs text-base-content/40">{nightsBetween(reservation.arrival, reservation.departure)} nights</p></td><td><span className="inline-flex items-center gap-1.5 text-sm"><BedDouble size={15} className="text-base-content/35" />{reservation.inventoryUnitIds.length}</span></td><td><StatusBadge status={reservationStatusLabel(reservation.status)} /></td><td className="text-sm capitalize text-base-content/55">{reservationSourceLabel(reservation.sourceKind)}</td><td className="pr-6 text-right"><button type="button" className="btn btn-circle btn-ghost btn-xs" aria-label={`View reservation for ${reservation.primaryGuestName}`} onClick={(event) => { event.stopPropagation(); setParam("reservation", reservation.reservationId); }}><ChevronRight size={17} /></button></td></tr>)}</tbody>
            </table>
          </div>
          <div className="divide-y divide-base-300 lg:hidden">
            {visible.map((reservation) => <button key={reservation.reservationId} type="button" className="block w-full p-5 text-left transition hover:bg-base-200/70 focus-visible:bg-base-200/70" onClick={() => setParam("reservation", reservation.reservationId)}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><InitialAvatar name={reservation.primaryGuestName} /><div className="min-w-0"><p className="truncate font-semibold">{reservation.primaryGuestName}</p><p className="mt-1 text-xs text-base-content/45">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"}</p></div></div><StatusBadge status={reservationStatusLabel(reservation.status)} /></div><div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/40">Stay</p><p className="mt-1 text-sm font-medium">{formatDate(reservation.arrival)} → {formatDate(reservation.departure)}</p><p className="mt-1 text-xs text-base-content/45">{nightsBetween(reservation.arrival, reservation.departure)} nights · {reservation.inventoryUnitIds.length} {reservation.inventoryUnitIds.length === 1 ? "unit" : "units"}</p></div><span className="inline-flex items-center gap-1 text-sm capitalize text-base-content/55">{reservationSourceLabel(reservation.sourceKind)}<ChevronRight size={17} /></span></div></button>)}
          </div>
          {reservations.hasNextPage && <div className="flex justify-center border-t border-base-300 p-4"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void reservations.fetchNextPage()} disabled={reservations.isFetchingNextPage}>{reservations.isFetchingNextPage && <span className="loading loading-spinner loading-xs" />}Load more reservations</button></div>}
        </>)}
      </section>

      {createOpen && <CreateReservation propertyId={selectedPropertyId} canReadGuests={capabilities.readGuests} onClose={() => setParam("new", null)} onCreated={async (created, warning) => { await queryClient.invalidateQueries({ queryKey: ["reservations", selectedPropertyId] }); setNotice(warning); const next = new URLSearchParams(searchParams); next.delete("new"); next.set("reservation", created.reservationId); setSearchParams(next, { replace: true }); }} />}
      <ReservationDetail propertyId={selectedPropertyId} reservationId={selectedReservationId} capabilities={capabilities} notice={notice} onDismissNotice={() => setNotice(null)} onClose={() => { setNotice(null); setParam("reservation", null); }} />
    </>
  );
}

function CreateReservation({ propertyId, canReadGuests, onClose, onCreated }: { propertyId: string; canReadGuests: boolean; onClose: () => void; onCreated: (reservation: Reservation, warning: string | null) => Promise<void> }) {
  const { request } = useSession();
  const initial = defaultRange();
  const [range, setRange] = useState(initial);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [sourceKind, setSourceKind] = useState<"direct" | "external">("direct");
  const [selectedGuest, setSelectedGuest] = useState<GuestProfile | null>(null);
  const [guestName, setGuestName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const availability = useQuery({ queryKey: ["availability", propertyId, range.arrival, range.departure], queryFn: () => request<InventoryAvailabilityResponse>(`/api/inventory/properties/${propertyId}/availability?arrival=${range.arrival}&departure=${range.departure}`), enabled: Boolean(range.arrival && range.departure && range.arrival < range.departure) });
  const roomInventory = useQuery({ queryKey: ["inventory-rooms", propertyId], queryFn: () => request<RoomInventoryListResponse>(`/api/inventory/properties/${propertyId}/rooms?page=1&pageSize=100`) });
  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const created = await request<Reservation>(`/api/reservations/properties/${propertyId}`, { method: "POST", body: JSON.stringify(payload) });
      if (!selectedGuest) return { reservation: created, warning: null };
      try {
        const linked = await request<Reservation>(`/api/reservations/properties/${propertyId}/${created.reservationId}/guests`, { method: "PUT", body: JSON.stringify({ guestId: selectedGuest.guestId, role: 1, replaceExistingRole: false, expectedVersion: created.version }) });
        return { reservation: linked, warning: null };
      } catch (error) {
        return { reservation: created, warning: `The reservation was created, but the Guest Record could not be linked: ${errorMessage(error)}` };
      }
    },
    onSuccess: ({ reservation, warning }) => onCreated(reservation, warning),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({ arrival: range.arrival, departure: range.departure, inventoryUnitIds: selectedUnits, primaryGuestName: guestName.trim(), email: emptyStringToNull(email), phone: emptyStringToNull(phone), guestCount: Number(data.get("guestCount")), sourceKind: reservationSourceValue(sourceKind), sourceSystem: sourceKind === "external" ? emptyToNull(data.get("sourceSystem")) : null, sourceReference: sourceKind === "external" ? emptyToNull(data.get("sourceReference")) : null, notes: emptyToNull(data.get("notes")) });
  }
  function chooseGuest(guest: GuestProfile | null) {
    setSelectedGuest(guest);
    if (guest) { setGuestName(guest.displayName); setEmail(guest.email || ""); setPhone(guest.phone || ""); }
  }

  const units = availability.data?.units ?? [];
  const groups = useMemo(() => groupAvailabilityByRoom(units, roomInventory.data?.rooms ?? []), [roomInventory.data?.rooms, units]);
  const invalidDates = !range.arrival || !range.departure || range.arrival >= range.departure;

  return (
    <Modal open size="lg" title="New reservation" description="Choose the stay, inventory and guest. A Guest Record link is optional." onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2"><DateField label="Arrival" value={range.arrival} min={localDateKey(new Date())} onChange={(arrival) => { setRange((current) => ({ ...current, arrival })); setSelectedUnits([]); }} /><DateField label="Departure" value={range.departure} min={nextDate(range.arrival)} onChange={(departure) => { setRange((current) => ({ ...current, departure })); setSelectedUnits([]); }} /></div>
        {invalidDates && <p className="text-sm text-error">Departure must be after arrival.</p>}

        <InventoryPicker groups={groups} loading={availability.isLoading} error={availability.error} selectedUnits={selectedUnits} onToggle={(inventoryUnitId) => setSelectedUnits((current) => current.includes(inventoryUnitId) ? current.filter((id) => id !== inventoryUnitId) : [...current, inventoryUnitId])} />

        <GuestRecordPicker propertyId={propertyId} selectedGuest={selectedGuest} onSelect={chooseGuest} disabled={!canReadGuests} />
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]"><ControlledTextField label="Primary guest" value={guestName} onChange={setGuestName} placeholder="Guest name" /><TextField label="Guests" name="guestCount" type="number" defaultValue="1" min="1" /></div>
        <div className="grid gap-4 sm:grid-cols-2"><ControlledTextField label="Email (optional)" type="email" required={false} value={email} onChange={setEmail} placeholder="guest@example.com" /><ControlledTextField label="Phone (optional)" type="tel" required={false} value={phone} onChange={setPhone} placeholder="+1 555 0100" /></div>
        <div><span className="mb-2 block text-sm font-semibold">Booking source</span><div className="join w-full"><button type="button" className={`btn join-item flex-1 ${sourceKind === "direct" ? "btn-primary" : "btn-outline"}`} onClick={() => setSourceKind("direct")}>Direct</button><button type="button" className={`btn join-item flex-1 ${sourceKind === "external" ? "btn-primary" : "btn-outline"}`} onClick={() => setSourceKind("external")}>External</button></div></div>
        {sourceKind === "external" && <div className="grid gap-4 sm:grid-cols-2"><TextField label="Source system" name="sourceSystem" placeholder="Booking.com" /><TextField label="Source reference" name="sourceReference" placeholder="ABC-123" /></div>}
        <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">Notes (optional)</span><textarea className="textarea textarea-bordered min-h-20 w-full" name="notes" placeholder="Arrival details, preferences or staff notes" /></label>
        {mutation.error && <ErrorState error={mutation.error} />}
        <FormActions submitting={mutation.isPending} submitLabel="Create reservation" onCancel={onClose} disabled={!selectedUnits.length || !guestName.trim() || invalidDates} />
        {!selectedUnits.length && <p className="-mt-3 text-right text-xs text-warning">Select at least one available unit.</p>}
      </form>
    </Modal>
  );
}

function InventoryPicker({ groups, loading, error, selectedUnits, onToggle }: { groups: InventoryRoomGroup[]; loading: boolean; error: unknown; selectedUnits: string[]; onToggle: (inventoryUnitId: string) => void }) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const availableCount = groups.reduce((total, group) => total + group.availableCount, 0);
  const totalCount = groups.reduce((total, group) => total + group.totalCount, 0);
  const unavailableCount = totalCount - availableCount;
  const visibleGroups = groups.map((group) => ({ ...group, units: showUnavailable ? group.units : group.units.filter((unit) => unit.isAvailable) })).filter((group) => group.units.length > 0);
  return <div><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><span className="text-sm font-semibold">Available inventory</span>{!loading && !error && totalCount > 0 && <p className="mt-1 text-xs font-medium text-base-content/65">{availableCount} available across {groups.length} {groups.length === 1 ? "room" : "rooms"}</p>}</div><div className="flex flex-wrap items-center justify-end gap-2">{selectedUnits.length > 0 && <span className="badge border-0 bg-primary text-primary-content">{selectedUnits.length} selected</span>}{unavailableCount > 0 && <button type="button" className="btn btn-ghost btn-xs" aria-pressed={showUnavailable} onClick={() => setShowUnavailable((current) => !current)}>{showUnavailable ? "Hide unavailable" : `Show ${unavailableCount} unavailable`}</button>}</div></div>{loading ? <div className="rounded-xl bg-base-200 p-5 text-center text-sm text-base-content/55"><span className="loading loading-spinner loading-sm mr-2" />Checking inventory</div> : error ? <ErrorState error={error} /> : !groups.length ? <div className="rounded-xl border border-dashed border-base-300 p-5 text-center text-sm text-base-content/55">No sellable inventory is configured for this property.</div> : !visibleGroups.length ? <div className="rounded-xl border border-dashed border-base-300 bg-base-200/60 p-5 text-center"><p className="text-sm font-semibold">No units are available for these dates</p><p className="mt-1 text-xs text-base-content/55">Change the stay dates or show unavailable inventory to review conflicts.</p></div> : <div className="max-h-72 space-y-3 overflow-y-auto pr-1">{visibleGroups.map((group) => <InventoryRoomSection key={group.roomId} group={group} selectedUnits={selectedUnits} onToggle={onToggle} />)}</div>}</div>;
}
function InventoryRoomSection({ group, selectedUnits, onToggle }: { group: InventoryRoomGroup; selectedUnits: string[]; onToggle: (inventoryUnitId: string) => void }) { return <section className="overflow-hidden rounded-xl border border-base-300" aria-label={group.roomName}><div className="flex items-center justify-between gap-3 bg-base-200/75 px-3 py-2.5"><p className="text-sm font-semibold">{group.roomName}</p><p className="text-xs font-semibold text-base-content/65">{group.availableCount} of {group.totalCount} available</p></div><div className="grid gap-2 p-2 sm:grid-cols-2">{group.units.map((unit) => <InventoryUnitOption key={unit.unit.inventoryUnitId} item={unit} selected={selectedUnits.includes(unit.unit.inventoryUnitId)} onToggle={onToggle} />)}</div></section>; }
function InventoryUnitOption({ item, selected, onToggle }: { item: InventoryUnitAvailability; selected: boolean; onToggle: (inventoryUnitId: string) => void }) { const { unit, isAvailable } = item; return <label className={`flex items-center gap-3 rounded-lg border p-3 transition ${selected ? "border-primary bg-primary/8" : isAvailable ? "cursor-pointer border-transparent bg-base-200 hover:border-primary/30" : "cursor-not-allowed border-base-300 bg-base-200/80"}`}><input type="checkbox" className="checkbox checkbox-primary checkbox-sm" checked={selected} disabled={!isAvailable} onChange={() => onToggle(unit.inventoryUnitId)} /><div><p className={`text-sm font-semibold ${isAvailable ? "" : "text-base-content/70"}`}>{unit.label}</p><p className={`text-xs capitalize ${isAvailable ? "font-semibold text-primary" : "font-medium text-base-content/60"}`}>{inventoryKindLabel(unit.kind)} · {isAvailable ? "Available" : "Unavailable"}</p></div></label>; }

function matchesStatusFilter(status: ReservationStatus, filter: StatusFilter) { const key = statusKey(status); if (filter === "all") return true; if (filter === "upcoming") return ["pendingAllocation", "confirmed"].includes(key); if (filter === "inHouse") return key === "checkedIn"; if (filter === "attention") return ["allocationRejected", "cancellationPending", "noShowPending", "checkoutPending"].includes(key); return ["cancelled", "noShow", "checkedOut"].includes(key); }
function statusKey(status: ReservationStatus) { if (typeof status === "string") return status.replace(/[- ](.)/g, (_, letter: string) => letter.toUpperCase()); return ({ 1: "pendingAllocation", 2: "confirmed", 3: "allocationRejected", 4: "cancellationPending", 5: "cancelled", 6: "checkedIn", 7: "noShowPending", 8: "noShow", 9: "checkoutPending", 10: "checkedOut" } as Record<number, string>)[status] ?? "unknown"; }
function TextField({ label, name, type = "text", placeholder, defaultValue, required = true, min }: { label: string; name: string; type?: string; placeholder?: string; defaultValue?: string; required?: boolean; min?: string }) { return <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} required={required} min={min} /></label>; }
function ControlledTextField({ label, type = "text", placeholder, value, onChange, required = true }: { label: string; type?: string; placeholder?: string; value: string; onChange: (value: string) => void; required?: boolean }) { return <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" type={type} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>; }
function DateField({ label, value, min, onChange }: { label: string; value: string; min?: string; onChange: (value: string) => void }) { return <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" type="date" value={value} min={min} onChange={(event) => onChange(event.target.value)} required /></label>; }
function emptyToNull(value: FormDataEntryValue | null) { return emptyStringToNull(String(value ?? "")); }
function emptyStringToNull(value: string) { const normalized = value.trim(); return normalized || null; }
function defaultRange() { const arrival = new Date(); arrival.setDate(arrival.getDate() + 1); const departure = new Date(arrival); departure.setDate(departure.getDate() + 2); return { arrival: localDateKey(arrival), departure: localDateKey(departure) }; }
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function nextDate(value: string) { if (!value) return undefined; const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + 1); return localDateKey(date); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function nightsBetween(arrival: string, departure: string) { return Math.max(0, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86_400_000)); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Unknown error"; }
