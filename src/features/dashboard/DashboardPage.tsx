import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BedDouble, Blocks, Building2, CalendarCheck2, CalendarClock, Plus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { ManualBlockListResponse, ReservationListResponse, RoomInventoryListResponse, RoomListResponse } from "../../api/types";
import { reservationStatusLabel } from "../../api/labels";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, InitialAvatar, LoadingState, PageHeader, StatusBadge } from "../../components/ui/primitives";

export function DashboardPage() {
  const { request } = useSession();
  const { selectedProperty, selectedPropertyId, propertiesLoading, propertiesError } = useWorkspace();
  const enabled = Boolean(selectedPropertyId);
  const rooms = useQuery({ queryKey: ["rooms", selectedPropertyId], queryFn: () => request<RoomListResponse>(`/api/properties/${selectedPropertyId}/rooms?page=1&pageSize=100`), enabled });
  const inventory = useQuery({ queryKey: ["inventory-rooms", selectedPropertyId], queryFn: () => request<RoomInventoryListResponse>(`/api/inventory/properties/${selectedPropertyId}/rooms?page=1&pageSize=100`), enabled });
  const reservations = useQuery({ queryKey: ["reservations", selectedPropertyId, "all"], queryFn: () => request<ReservationListResponse>(`/api/reservations/properties/${selectedPropertyId}?page=1&pageSize=100`), enabled });
  const blocks = useQuery({ queryKey: ["blocks", selectedPropertyId, false], queryFn: () => request<ManualBlockListResponse>(`/api/inventory/properties/${selectedPropertyId}/blocks?includeReleased=false&page=1&pageSize=100`), enabled });

  if (propertiesLoading) return <LoadingState />;
  if (propertiesError) return <ErrorState error={propertiesError} />;
  if (!selectedProperty) return <EmptyState icon={<Building2 />} title="Start with your first property" description="Add a hostel property, then set up rooms, beds, inventory and reservations." action={<Link className="btn btn-primary" to="/properties"><Plus size={17} />Add property</Link>} />;
  if ([rooms, inventory, reservations, blocks].some((query) => query.isLoading)) return <LoadingState label="Preparing today’s overview" />;

  const firstError = [rooms.error, inventory.error, reservations.error, blocks.error].find(Boolean);
  if (firstError) return <ErrorState error={firstError} />;

  const today = dateKey(new Date());
  const roomItems = rooms.data?.rooms ?? [];
  const inventoryRooms = inventory.data?.rooms ?? [];
  const reservationItems = reservations.data?.reservations ?? [];
  const activeBlocks = blocks.data?.blocks ?? [];
  const arrivals = reservationItems.filter((item) => item.arrival === today && !reservationStatusLabel(item.status).includes("cancel"));
  const inHouse = reservationItems.filter((item) => item.arrival <= today && item.departure > today && reservationStatusLabel(item.status) === "confirmed");
  const sellableUnits = inventoryRooms.flatMap((room) => room.units).filter((unit) => unit.isSellable && unit.isTopologyActive);
  const upcoming = reservationItems.filter((item) => item.arrival >= today && !reservationStatusLabel(item.status).includes("cancel")).sort((a, b) => a.arrival.localeCompare(b.arrival)).slice(0, 6);

  return (
    <>
      <PageHeader eyebrow={formatLongDate(new Date())} title={`Good day at ${selectedProperty.name}`} description="Here’s the operational picture across reservations and inventory." action={<Link to="/reservations" className="btn btn-primary"><Plus size={17} />New reservation</Link>} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<CalendarClock />} label="Arrivals today" value={arrivals.length} detail={arrivals.length ? `${arrivals.reduce((sum, item) => sum + item.guestCount, 0)} guests expected` : "No arrivals scheduled"} tone="accent" />
        <StatCard icon={<Users />} label="In house" value={inHouse.length} detail={`${inHouse.reduce((sum, item) => sum + item.guestCount, 0)} current guests`} tone="primary" />
        <StatCard icon={<BedDouble />} label="Sellable units" value={sellableUnits.length} detail={`Across ${roomItems.length} rooms`} tone="secondary" />
        <StatCard icon={<Blocks />} label="Active blocks" value={activeBlocks.length} detail={activeBlocks.length ? "Review inventory impact" : "Inventory is clear"} tone="warning" />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body p-0">
            <div className="flex items-center justify-between px-6 pb-4 pt-6"><div><h2 className="font-display text-xl font-semibold">Upcoming stays</h2><p className="mt-1 text-sm text-base-content/50">The next reservations needing attention.</p></div><Link to="/reservations" className="btn btn-ghost btn-sm text-primary">View all <ArrowRight size={16} /></Link></div>
            {upcoming.length ? <div className="divide-y divide-base-300">{upcoming.map((reservation) => <Link to="/reservations" key={reservation.reservationId} className="grid gap-3 px-6 py-4 transition hover:bg-base-200 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div className="flex items-center gap-3"><InitialAvatar name={reservation.primaryGuestName} size="sm" /><div><p className="font-semibold">{reservation.primaryGuestName}</p><p className="mt-1 text-xs text-base-content/45">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"} · {reservation.inventoryUnitIds.length} {reservation.inventoryUnitIds.length === 1 ? "unit" : "units"}</p></div></div><div className="text-sm"><p className="font-semibold">{formatShortDate(reservation.arrival)} → {formatShortDate(reservation.departure)}</p><p className="mt-1 text-right text-xs text-base-content/45">{nightsBetween(reservation.arrival, reservation.departure)} nights</p></div><StatusBadge status={reservationStatusLabel(reservation.status)} /></Link>)}</div> : <div className="px-6 pb-7"><EmptyState icon={<CalendarCheck2 />} title="No upcoming stays" description="New reservations will appear here as soon as they are created." action={<Link className="btn btn-sm btn-primary" to="/reservations">Add reservation</Link>} /></div>}
          </div>
        </div>

        <div className="card border border-base-300 bg-primary text-primary-content shadow-sm">
          <div className="card-body p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Property pulse</p>
            <h2 className="font-display text-2xl font-semibold">{selectedProperty.name}</h2>
            <p className="text-sm text-primary-content/60">{selectedProperty.code} · {selectedProperty.timeZoneId}</p>
            <div className="my-3 h-px bg-primary-content/10" />
            <div className="space-y-4">
              <PulseRow label="Rooms configured" value={roomItems.length} />
              <PulseRow label="Inventory modes set" value={inventoryRooms.filter((room) => !String(room.salesMode).toLowerCase().includes("unconfigured") && room.salesMode !== 1).length} suffix={`of ${inventoryRooms.length}`} />
              <PulseRow label="Reservations on record" value={reservationItems.length} />
            </div>
            <Link to="/properties" className="btn mt-4 border-0 bg-primary-content text-primary hover:bg-primary-content/90"><Building2 size={17} />Manage property</Link>
          </div>
        </div>
      </section>
    </>
  );
}

function StatCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: "accent" | "primary" | "secondary" | "warning" }) {
  const tones = { accent: "bg-accent/15 text-accent-content", primary: "bg-primary/12 text-primary", secondary: "bg-secondary/15 text-secondary", warning: "bg-warning/15 text-warning-content" };
  return <div className="card border border-base-300 bg-base-100 shadow-sm"><div className="card-body gap-4 p-5"><div className="flex items-center justify-between"><div className={`grid size-10 place-items-center rounded-xl ${tones[tone]}`}>{icon}</div><span className="text-3xl font-semibold tracking-tight">{value}</span></div><div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-xs text-base-content/45">{detail}</p></div></div></div>;
}

function PulseRow({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return <div className="flex items-center justify-between"><span className="text-sm text-primary-content/65">{label}</span><span className="font-display text-xl font-semibold">{value} {suffix && <span className="text-sm font-normal text-primary-content/45">{suffix}</span>}</span></div>;
}

function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function formatLongDate(date: Date) { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function nightsBetween(arrival: string, departure: string) { return Math.max(0, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86_400_000)); }
