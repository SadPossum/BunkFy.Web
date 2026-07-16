import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, CalendarDays, ChevronRight, Plus, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Reservation, ReservationListResponse, ReservationStatus } from "../../api/types";
import { reservationSourceLabel, reservationStatusLabel } from "../../api/labels";
import { LIVE_LIST_REFRESH_INTERVAL_MS, reservationNeedsLiveRefresh } from "../../app/liveUpdates";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { focusedResourceClass, useTargetProperty, useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, InitialAvatar, LoadingState, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { CreateReservationModal } from "./CreateReservationModal";
import { ReservationDetail, type ReservationCapabilities } from "./ReservationDetail";

const PAGE_SIZE = 30;
const statusFilters = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "inHouse", label: "In house" },
  { value: "attention", label: "Needs attention" },
  { value: "closed", label: "Closed" },
] as const;
type StatusFilter = (typeof statusFilters)[number]["value"];
const statusesByFilter: Record<Exclude<StatusFilter, "all">, ReservationStatus[]> = {
  upcoming: [1, 2],
  inHouse: [6],
  attention: [3, 4, 7, 9],
  closed: [5, 8, 10],
};

export function ReservationsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedReservationId = searchParams.get("reservation");
  const affectedReservationIds = useMemo(
    () => [...new Set((searchParams.get("affected") ?? "").split(",").filter(Boolean))].slice(0, 25),
    [searchParams],
  );
  const reservationInitialTab = searchParams.get("section") === "guest" ? "guest" : undefined;
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
    { permission: permissions.guestsCreate, scope: accessScope },
  ] : []);
  const canCreate = access.allows(permissions.reservationsCreate, accessScope);
  const capabilities: ReservationCapabilities = {
    manage: access.allows(permissions.reservationsManage, accessScope),
    manageGuests: access.allows(permissions.reservationsManageGuests, accessScope),
    readGuests: access.allows(permissions.guestsRead, accessScope),
    createGuests: access.allows(permissions.guestsCreate, accessScope),
    cancel: access.allows(permissions.reservationsCancel, accessScope),
    checkIn: access.allows(permissions.reservationsCheckIn, accessScope),
    noShow: access.allows(permissions.reservationsNoShow, accessScope),
    checkOut: access.allows(permissions.reservationsCheckOut, accessScope),
  };
  const reservationParams = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    order: status === "closed" ? "2" : "1",
  });
  if (deferredSearch) reservationParams.set("search", deferredSearch);
  if (status !== "all") {
    statusesByFilter[status].forEach((value) => reservationParams.append("status", String(value)));
  }
  const reservations = useQuery({
    queryKey: ["reservations", selectedPropertyId, "directory", status, deferredSearch, page],
    queryFn: () => request<ReservationListResponse>(`/api/reservations/properties/${selectedPropertyId}?${reservationParams}`),
    enabled: enabled && affectedReservationIds.length === 0,
    refetchInterval: (query) => query.state.data?.reservations.some((item) => reservationNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const affectedReservations = useQueries({
    queries: affectedReservationIds.map((reservationId) => ({
      queryKey: ["reservation", selectedPropertyId, reservationId],
      queryFn: () => request<Reservation>(`/api/reservations/properties/${selectedPropertyId}/${reservationId}`),
      enabled,
    })),
  });

  useEffect(() => setPage(1), [selectedPropertyId]);
  useEffect(() => {
    if (reservations.data && page > Math.max(1, Math.ceil(reservations.data.totalCount / PAGE_SIZE))) {
      setPage(Math.max(1, Math.ceil(reservations.data.totalCount / PAGE_SIZE)));
    }
  }, [page, reservations.data]);

  const visible = useMemo(() => {
    if (affectedReservationIds.length > 0) {
      return affectedReservations
        .map((query) => query.data)
        .filter((reservation): reservation is Reservation => Boolean(reservation));
    }
    return reservations.data?.reservations ?? [];
  }, [affectedReservationIds.length, affectedReservations, reservations.data]);

  const listLoading = affectedReservationIds.length > 0
    ? affectedReservations.some((query) => query.isLoading)
    : reservations.isLoading;
  const listError = affectedReservationIds.length > 0
    ? affectedReservations.find((query) => query.error)?.error
    : reservations.error;
  const focusedReservationId = useTransientResourceFocus(!listLoading);

  function clearAffectedFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete("affected");
    next.delete("focus");
    next.delete("reservation");
    setSearchParams(next, { replace: true });
  }

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
        {affectedReservationIds.length > 0 && <div className="flex items-center justify-between gap-4 border-b border-primary/15 bg-primary/5 px-5 py-3 sm:px-6"><div><p className="text-sm font-semibold">Reservations affected by the inventory change</p><p className="mt-1 text-xs text-base-content/50">Showing {affectedReservationIds.length} linked {affectedReservationIds.length === 1 ? "reservation" : "reservations"}.</p></div><button type="button" className="btn btn-circle btn-ghost btn-sm" onClick={clearAffectedFilter} aria-label="Clear affected reservations filter"><X size={16} /></button></div>}
        <div className="flex flex-col gap-4 border-b border-base-300 p-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <SegmentedTabs value={status} options={statusFilters} ariaLabel="Reservation status" onValueChange={(value) => { setStatus(value); setPage(1); }} />
          <label className="input input-bordered input-sm flex w-full items-center gap-2 xl:w-72"><Search size={15} className="text-base-content/35" /><input className="grow" aria-label="Search reservations" placeholder="Guest, contact or reference" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        </div>

        {listLoading ? <LoadingState label="Loading reservations" /> : listError ? <div className="p-6"><ErrorState error={listError} retry={() => affectedReservationIds.length > 0 ? void Promise.all(affectedReservations.map((query) => query.refetch())) : void reservations.refetch()} /></div> : !visible.length ? <div className="p-6"><EmptyState icon={<CalendarDays />} title={affectedReservationIds.length > 0 ? "Affected reservations are unavailable" : search || status !== "all" ? "No reservations match" : "No reservations yet"} description={affectedReservationIds.length > 0 ? "The linked reservations may have moved or no longer be accessible." : search || status !== "all" ? "Try changing the status or search filter." : "Create the first stay and BunkFy will allocate the selected inventory."} action={canCreate && !search && status === "all" && affectedReservationIds.length === 0 ? <button className="btn btn-sm btn-primary" onClick={() => setParam("new", "1")}>Add reservation</button> : undefined} /></div> : (<>
          <div className="hidden overflow-x-auto lg:block">
            <table className="table">
              <thead><tr className="border-base-300 text-[0.68rem] uppercase tracking-[0.12em] text-base-content/40"><th className="pl-6">Guest</th><th>Stay</th><th>Units</th><th>Status</th><th>Source</th><th className="pr-6" /></tr></thead>
              <tbody>{visible.map((reservation) => <tr key={reservation.reservationId} className={`cursor-pointer border-base-300 transition hover:bg-base-200/70 ${reservation.reservationId === focusedReservationId ? focusedResourceClass : ""}`} onClick={() => setParam("reservation", reservation.reservationId)}><td className="pl-6"><div className="flex items-center gap-3"><InitialAvatar name={reservation.primaryGuestName} size="sm" /><div><p className="font-semibold">{reservation.primaryGuestName}</p><p className="mt-1 text-xs text-base-content/40">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"}</p></div></div></td><td><p className="font-medium">{formatStayEndpoint(reservation.arrival, reservation.expectedArrivalTime)} → {formatStayEndpoint(reservation.departure, reservation.expectedDepartureTime)}</p><p className="mt-1 text-xs text-base-content/40">{nightsBetween(reservation.arrival, reservation.departure)} nights</p></td><td><span className="inline-flex items-center gap-1.5 text-sm"><BedDouble size={15} className="text-base-content/35" />{reservation.inventoryUnitIds.length}</span></td><td><StatusBadge status={reservationStatusLabel(reservation.status)} /></td><td className="text-sm capitalize text-base-content/55">{reservationSourceLabel(reservation.sourceKind)}</td><td className="pr-6 text-right"><button type="button" className="btn btn-circle btn-ghost btn-xs" aria-label={`View reservation for ${reservation.primaryGuestName}`} onClick={(event) => { event.stopPropagation(); setParam("reservation", reservation.reservationId); }}><ChevronRight size={17} /></button></td></tr>)}</tbody>
            </table>
          </div>
          <div className="divide-y divide-base-300 lg:hidden">
            {visible.map((reservation) => <button key={reservation.reservationId} type="button" className={`block w-full p-5 text-left transition hover:bg-base-200/70 focus-visible:bg-base-200/70 ${reservation.reservationId === focusedReservationId ? focusedResourceClass : ""}`} onClick={() => setParam("reservation", reservation.reservationId)}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><InitialAvatar name={reservation.primaryGuestName} /><div className="min-w-0"><p className="truncate font-semibold">{reservation.primaryGuestName}</p><p className="mt-1 text-xs text-base-content/45">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"}</p></div></div><StatusBadge status={reservationStatusLabel(reservation.status)} /></div><div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/40">Stay</p><p className="mt-1 text-sm font-medium">{formatStayEndpoint(reservation.arrival, reservation.expectedArrivalTime)} → {formatStayEndpoint(reservation.departure, reservation.expectedDepartureTime)}</p><p className="mt-1 text-xs text-base-content/45">{nightsBetween(reservation.arrival, reservation.departure)} nights · {reservation.inventoryUnitIds.length} {reservation.inventoryUnitIds.length === 1 ? "unit" : "units"}</p></div><span className="inline-flex items-center gap-1 text-sm capitalize text-base-content/55">{reservationSourceLabel(reservation.sourceKind)}<ChevronRight size={17} /></span></div></button>)}
          </div>
          {affectedReservationIds.length === 0 && <PaginationBar page={page} pageSize={PAGE_SIZE} itemCount={visible.length} totalCount={reservations.data?.totalCount} itemLabel="reservation" disabled={reservations.isFetching} onPageChange={setPage} />}
        </>)}
      </section>

      {createOpen && (
        <CreateReservationModal
          propertyId={selectedPropertyId}
          canReadGuests={capabilities.readGuests}
          canCreateGuests={capabilities.createGuests}
          canManageGuests={capabilities.manageGuests}
          onClose={() => setParam("new", null)}
          onCreated={async (created, warning) => {
            await queryClient.invalidateQueries({ queryKey: ["reservations", selectedPropertyId] });
            setNotice(warning);

            const next = new URLSearchParams(searchParams);
            next.delete("new");
            next.set("reservation", created.reservationId);
            setSearchParams(next, { replace: true });
          }}
        />
      )}
      <ReservationDetail propertyId={selectedPropertyId} reservationId={selectedReservationId} initialTab={reservationInitialTab} capabilities={capabilities} notice={notice} onDismissNotice={() => setNotice(null)} onClose={() => { setNotice(null); const next = new URLSearchParams(searchParams); next.delete("reservation"); next.delete("section"); setSearchParams(next, { replace: true }); }} />
    </>
  );
}

function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function formatStayEndpoint(date: string, time?: string | null) { return time ? `${formatDate(date)}, ${formatTime(time)}` : formatDate(date); }
function formatTime(value: string) { const [hours, minutes] = value.split(":").map(Number); return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes)); }
function nightsBetween(arrival: string, departure: string) { return Math.max(0, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86_400_000)); }
