import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BedDouble, Blocks, Building2, CalendarCheck2, CalendarClock, Plus, Users } from "lucide-react";
import { Link } from "react-router";
import { Navigate } from "react-router";
import type { ReservationListResponse } from "../../api/types";
import { reservationStatusLabel } from "../../api/labels";
import { LIVE_LIST_REFRESH_INTERVAL_MS, reservationNeedsLiveRefresh, reservationStatusKey } from "../../app/liveUpdates";
import { permissions, tenantAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import {
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSourceState,
} from "../../app/compositeSourceState";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { EmptyState, ErrorState, InitialAvatar, LoadingState, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { loadAllManualInventoryBlocks, loadAllRoomInventory } from "../inventory/inventoryApi";
import { loadAllRooms } from "../properties/propertiesApi";

export function DashboardPage() {
  const { request } = useSession();
  const { selectedProperty, selectedPropertyId, selectedWorkspaceId, propertiesLoading, propertiesError } = useWorkspace();
  const tenantScope = selectedWorkspaceId ? tenantAccessScope(selectedWorkspaceId) : "";
  const access = usePermissions(tenantScope ? [
    { permission: permissions.propertiesRead, scope: tenantScope },
    { permission: permissions.inventoryRead, scope: tenantScope },
    { permission: permissions.reservationsRead, scope: tenantScope },
  ] : []);
  const enabled = Boolean(selectedPropertyId);
  const rooms = useQuery({ queryKey: ["rooms", selectedPropertyId], queryFn: (context) => loadAllRooms(request, selectedPropertyId, context.signal), enabled });
  const inventory = useQuery({ queryKey: ["inventory-rooms", selectedPropertyId], queryFn: (context) => loadAllRoomInventory(request, selectedPropertyId!, context.signal), enabled });
  const reservations = useQuery({
    queryKey: ["reservations", selectedPropertyId, "all"],
    queryFn: () => request<ReservationListResponse>(`/api/reservations/properties/${selectedPropertyId}?page=1&pageSize=100`),
    enabled,
    refetchInterval: (query) => query.state.data?.reservations.some((item) => reservationNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const blocks = useQuery({ queryKey: ["blocks", selectedPropertyId, false], queryFn: (context) => loadAllManualInventoryBlocks(request, selectedPropertyId!, false, context.signal), enabled });
  const roomSource = createCompositeSource({ label: "Rooms", hasData: rooms.data !== undefined, isLoading: rooms.isLoading, error: rooms.error, isFetching: rooms.isFetching, refetch: () => rooms.refetch() });
  const inventorySource = createCompositeSource({ label: "Inventory", hasData: inventory.data !== undefined, isLoading: inventory.isLoading, error: inventory.error, isFetching: inventory.isFetching, refetch: () => inventory.refetch() });
  const reservationSource = createCompositeSource({ label: "Reservations", hasData: reservations.data !== undefined, isLoading: reservations.isLoading, error: reservations.error, isFetching: reservations.isFetching, refetch: () => reservations.refetch() });
  const blockSource = createCompositeSource({ label: "Blocks", hasData: blocks.data !== undefined, isLoading: blocks.isLoading, error: blocks.error, isFetching: blocks.isFetching, refetch: () => blocks.refetch() });
  const sources = [roomSource, inventorySource, reservationSource, blockSource];

  if (propertiesLoading || access.isLoading) return <LoadingState />;
  if (access.error) return <ErrorState error={access.error} />;
  if (![permissions.propertiesRead, permissions.inventoryRead, permissions.reservationsRead]
    .every((permission) => access.allows(permission, tenantScope))) {
    return <Navigate to="/properties" replace />;
  }
  if (propertiesError) return <ErrorState error={propertiesError} />;
  if (!selectedProperty) return <EmptyState icon={<Building2 />} title="Start with your first property" description="Add a hostel property, then set up rooms, beds, inventory and reservations." action={<Link className="btn btn-primary" to="/properties"><Plus size={17} />Add property</Link>} />;
  if (sources.every((source) => source.state === "loading")) return <LoadingState label="Preparing today’s overview" />;

  const today = dateKey(new Date());
  const roomsUsable = compositeSourceUsable(roomSource.state);
  const inventoryUsable = compositeSourceUsable(inventorySource.state);
  const reservationsUsable = compositeSourceUsable(reservationSource.state);
  const blocksUsable = compositeSourceUsable(blockSource.state);
  const roomItems = roomsUsable ? rooms.data?.rooms ?? [] : [];
  const inventoryRooms = inventoryUsable ? inventory.data?.rooms ?? [] : [];
  const reservationItems = reservationsUsable ? reservations.data?.reservations ?? [] : [];
  const activeBlocks = blocksUsable ? blocks.data?.blocks ?? [] : [];
  const arrivals = reservationItems.filter((item) => item.arrival === today && reservationStatusKey(item.status) === "confirmed");
  const inHouse = reservationItems.filter((item) => ["checkedIn", "checkoutPending"].includes(reservationStatusKey(item.status)));
  const needsAttention = reservationItems.filter((item) => ["pendingAllocation", "allocationRejected", "cancellationPending", "noShowPending", "checkoutPending"].includes(reservationStatusKey(item.status)));
  const sellableUnits = inventoryRooms.flatMap((room) => room.units).filter((unit) => unit.isSellable && unit.isTopologyActive);
  const upcoming = reservationItems.filter((item) => item.arrival >= today && ["pendingAllocation", "confirmed"].includes(reservationStatusKey(item.status))).sort((a, b) => a.arrival.localeCompare(b.arrival)).slice(0, 6);

  return (
    <>
      <PageHeader eyebrow={formatLongDate(new Date())} title={`Good day at ${selectedProperty.name}`} description="Here’s the operational picture across reservations and inventory." action={<Link to="/reservations?new=1" className="btn btn-primary"><Plus size={17} />New reservation</Link>} />

      <CompositeSourceNotice sources={sources} title="Some overview data is delayed" />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<CalendarClock />} label="Arrivals today" value={reservationsUsable ? arrivals.length : null} detail={sourceDetail(reservationSource.state, arrivals.length ? `${arrivals.reduce((sum, item) => sum + item.guestCount, 0)} guests expected` : "No arrivals scheduled", "Reservation data unavailable")} tone="accent" />
        <StatCard icon={<Users />} label="In house" value={reservationsUsable ? inHouse.length : null} detail={sourceDetail(reservationSource.state, `${inHouse.reduce((sum, item) => sum + item.guestCount, 0)} current guests`, "Reservation data unavailable")} tone="primary" />
        <StatCard icon={<BedDouble />} label="Sellable units" value={inventoryUsable ? sellableUnits.length : null} detail={sourceDetail(inventorySource.state, roomsUsable ? `Across ${roomItems.length} rooms` : roomSource.state === "loading" ? "Room total loading..." : "Room total unavailable", "Inventory data unavailable")} tone="secondary" />
        <StatCard icon={<Blocks />} label="Active blocks" value={blocksUsable ? activeBlocks.length : null} detail={sourceDetail(blockSource.state, activeBlocks.length ? "Review inventory impact" : "Inventory is clear", "Block data unavailable")} tone="warning" />
      </section>

      {reservationsUsable && needsAttention.length > 0 && <Link to="/reservations" className="alert mt-4 border border-warning/25 bg-warning/10 text-base-content transition hover:border-warning/45"><CalendarClock size={19} className="text-warning" /><span><strong>{needsAttention.length} {needsAttention.length === 1 ? "reservation needs" : "reservations need"} attention.</strong> Review allocation or inventory-release progress.</span><ArrowRight size={17} /></Link>}

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body p-0">
            <div className="flex items-center justify-between px-6 pb-4 pt-6"><div><h2 className="font-display text-xl font-semibold">Upcoming stays</h2><p className="mt-1 text-sm text-base-content/50">The next reservations needing attention.</p></div><Link to="/reservations" className="btn btn-ghost btn-sm text-primary">View all <ArrowRight size={16} /></Link></div>
            {!reservationsUsable
              ? <CompositeSourceFallback state={reservationSource.state} label="upcoming stays" />
              : upcoming.length
                ? <div className="divide-y divide-base-300">{upcoming.map((reservation) => <Link to={`/reservations?reservation=${reservation.reservationId}`} key={reservation.reservationId} className="grid gap-3 px-6 py-4 transition hover:bg-base-200 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div className="flex items-center gap-3"><InitialAvatar name={reservation.primaryGuestName} size="sm" /><div><p className="font-semibold">{reservation.primaryGuestName}</p><p className="mt-1 text-xs text-base-content/45">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"} · {reservation.inventoryUnitCount} {reservation.inventoryUnitCount === 1 ? "unit" : "units"}</p></div></div><div className="text-sm"><p className="font-semibold">{formatShortDate(reservation.arrival)} → {formatShortDate(reservation.departure)}</p><p className="mt-1 text-right text-xs text-base-content/45">{nightsBetween(reservation.arrival, reservation.departure)} nights</p></div><StatusBadge status={reservationStatusLabel(reservation.status)} /></Link>)}</div>
                : <div className="px-6 pb-7"><EmptyState icon={<CalendarCheck2 />} title="No upcoming stays" description="New reservations will appear here as soon as they are created." action={<Link className="btn btn-sm btn-primary" to="/reservations?new=1">Add reservation</Link>} /></div>}
          </div>
        </div>

        <div className="card border border-base-300 bg-primary text-primary-content shadow-sm">
          <div className="card-body p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Property pulse</p>
            <h2 className="font-display text-2xl font-semibold">{selectedProperty.name}</h2>
            <p className="text-sm text-primary-content/60">{selectedProperty.code} · {selectedProperty.timeZoneId}</p>
            <div className="my-3 h-px bg-primary-content/10" />
            <div className="space-y-4">
              <PulseRow label="Rooms configured" value={roomsUsable ? roomItems.length : null} state={roomSource.state} />
              <PulseRow label="Inventory modes set" value={inventoryUsable ? inventoryRooms.filter((room) => !String(room.salesMode).toLowerCase().includes("unconfigured") && room.salesMode !== 1).length : null} suffix={inventoryUsable ? `of ${inventoryRooms.length}` : undefined} state={inventorySource.state} />
              <PulseRow label="Reservations on record" value={reservationsUsable ? reservationItems.length : null} state={reservationSource.state} />
            </div>
            <Link to="/properties" className="btn mt-4 border-0 bg-primary-content text-primary hover:bg-primary-content/90"><Building2 size={17} />Manage property</Link>
          </div>
        </div>
      </section>
    </>
  );
}

function StatCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number | null; detail: string; tone: "accent" | "primary" | "secondary" | "warning" }) {
  const tones = { accent: "bg-accent/15 text-accent-content", primary: "bg-primary/12 text-primary", secondary: "bg-secondary/15 text-secondary", warning: "bg-warning/15 text-warning-content" };
  return <div className="card border border-base-300 bg-base-100 shadow-sm"><div className="card-body gap-4 p-5"><div className="flex items-center justify-between"><div className={`grid size-10 place-items-center rounded-xl ${tones[tone]}`}>{icon}</div><span className="min-w-[3ch] text-right text-3xl font-semibold tracking-tight">{value ?? "—"}</span></div><div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-xs text-base-content/45">{detail}</p></div></div></div>;
}

function PulseRow({ label, value, suffix, state }: { label: string; value: number | null; suffix?: string; state: CompositeSourceState }) {
  const displayValue = state === "loading" ? "..." : value ?? "—";
  return <div className="flex items-center justify-between"><span className="text-sm text-primary-content/65">{label}</span><span className="font-display text-xl font-semibold">{displayValue} {value !== null && suffix && <span className="text-sm font-normal text-primary-content/45">{suffix}</span>}</span></div>;
}

function sourceDetail(
  state: CompositeSourceState,
  ready: string,
  unavailable: string,
): string {
  if (state === "loading") return "Loading...";
  if (state === "unavailable") return unavailable;
  return ready;
}

function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function formatLongDate(date: Date) { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function nightsBetween(arrival: string, departure: string) { return Math.max(0, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86_400_000)); }
