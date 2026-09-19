import {
  ArrowRight,
  BedDouble,
  Blocks,
  Building2,
  CalendarClock,
  CalendarPlus,
  CircleCheck,
  Clock3,
  DoorOpen,
  LogIn,
  LogOut,
  Settings2,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router";
import type {
  ManualBlock,
  ReservationListItem,
  ReservationOperationsSnapshot,
  RoomInventory,
} from "../../api/types";
import { reservationStatusLabel } from "../../api/labels";
import type { CompositeSourceState } from "../../app/compositeSourceState";
import { InitialAvatar, StatusBadge } from "../../components/ui/primitives";
import { buildTodayBoard, todayAttentionReason } from "./todayOperationsModel";
import { useOperationalPreview } from "../operational-preview/OperationalPreviewProvider";
import type { OperationalPreviewRoute } from "../operational-preview/operationalPreviewRoute";
import { operationalSpacesHref } from "../operational-preview/operationalSurfaceReturn";

export function TodayOperationsView({
  propertyId,
  canOpenSpaces,
  snapshot,
  snapshotState,
  inventory,
  inventoryState,
  blocks,
  blockState,
  reservations,
  reservationState,
  reservationCurrent = reservationState === "ready",
  snapshotCurrent = snapshotState === "ready",
  conflictCount = 0,
  routineRefresh = false,
  sourceStatus,
}: {
  propertyId: string;
  canOpenSpaces: boolean;
  snapshot?: ReservationOperationsSnapshot;
  snapshotState: CompositeSourceState;
  inventory: RoomInventory[];
  inventoryState: CompositeSourceState;
  blocks: ManualBlock[];
  blockState: CompositeSourceState;
  reservations: ReservationListItem[];
  reservationState: CompositeSourceState;
  reservationCurrent?: boolean;
  snapshotCurrent?: boolean;
  conflictCount?: number;
  routineRefresh?: boolean;
  sourceStatus?: ReactNode;
}) {
  const { activeRoute, openPreview } = useOperationalPreview();
  const cohorts = snapshot?.cohorts;
  const attention = snapshot?.attention.total;
  const sellableUnits = inventory.flatMap((room) => room.units).filter((unit) => unit.isSellable && unit.isTopologyActive);
  const unconfiguredRooms = inventory.filter((room) => String(room.salesMode) === "1" || String(room.salesMode).toLowerCase().includes("unconfigured"));
  const unitLabels = buildUnitLabels(inventory);
  const board = buildTodayBoard(reservations, snapshot?.localDate);
  const completePresentation = (reservationCurrent && snapshotCurrent) || (routineRefresh && reservationState === "ready" && snapshotState === "ready" && !conflictCount);
  const reservationPresentation = reservationCurrent || (routineRefresh && reservationState === "ready" && !conflictCount);
  const comingUp = snapshot?.upcoming.filter((reservation) => reservation.arrival > snapshot.localDate).slice(0, 3) ?? [];

  function openReservation(
    reservation: ReservationListItem,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    const inventoryContext = reservationInventoryContext(reservation, inventory);
    const route: OperationalPreviewRoute = {
      selection: {
        kind: "reservation",
        propertyId,
        reservationId: reservation.reservationId,
        inventoryUnitId: inventoryContext?.inventoryUnitId,
        roomId: inventoryContext?.roomId,
        bedId: inventoryContext?.bedId,
      },
      origin: { surface: "today", propertyId, view: "operations" },
    };
    openPreview({
      route,
      seed: { kind: "reservation", reservation, inventory: inventoryContext },
      trigger: event.currentTarget,
    });
  }

  return (
    <div role="tabpanel" aria-label="Today operations" className="space-y-5">
      <p id="today-source-status" role="status" aria-live="polite" className="min-h-[20px] text-[13px] leading-[20px] text-base-content/70">{sourceStatus}</p>
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-base-300 bg-base-300 shadow-sm xl:grid-cols-4" aria-label="Today summary">
        <OperationMetric
          icon={<LogIn />}
          label="Arrivals"
          value={sourceValue(snapshotState, cohorts?.confirmedArrivalsOnLocalDate.reservationCount)}
          detail={sourceDetail(snapshotState, `${cohorts?.confirmedArrivalsOnLocalDate.guestCount ?? 0} guests expected`)}
          tone="success"
          to="/reservations?status=upcoming"
        />
        <OperationMetric
          icon={<LogOut />}
          label="Departures"
          value={sourceValue(snapshotState, cohorts?.scheduledDeparturesOnLocalDate.reservationCount)}
          detail={sourceDetail(snapshotState, `${cohorts?.scheduledDeparturesOnLocalDate.guestCount ?? 0} guests leaving`)}
          tone="primary"
          to="/reservations?status=inHouse"
        />
        <OperationMetric
          icon={<UsersRound />}
          label="In house"
          value={sourceValue(snapshotState, cohorts?.currentlyInHouse.reservationCount)}
          detail={sourceDetail(snapshotState, `${cohorts?.currentlyInHouse.guestCount ?? 0} current guests`)}
          tone="secondary"
          to="/reservations?status=inHouse"
        />
        <OperationMetric
          icon={<TriangleAlert />}
          label="Needs attention"
          value={sourceValue(snapshotState, attention?.reservationCount)}
          detail={sourceDetail(snapshotState, attention?.reservationCount ? "Review operational exceptions" : "No open exceptions")}
          tone="warning"
          to="/reservations?status=attention"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.72fr)]">
        <div className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-base-300 px-5 py-4 sm:px-6">
            <div>
              <div className="flex items-center gap-2 text-primary"><CalendarClock size={17} /><p className="text-xs font-semibold uppercase">Current shift</p></div>
              <h2 className="mt-2 font-display text-lg font-semibold">Shift board</h2>
              <p className="mt-1 text-sm text-base-content/55">Decisions and guest movements in the order staff need them.</p>
            </div>
            <Link to="/calendar" className="btn btn-ghost btn-sm shrink-0 text-primary">Calendar <ArrowRight size={16} /></Link>
          </div>
          {!completePresentation && <p role="status" className="border-b border-base-300 px-5 py-3 text-sm">Shift coverage is unconfirmed. Shown details are last known; missing records do not mean no work. Use Retry above for unavailable sources.{conflictCount > 0 ? ` ${conflictCount} conflicting records are withheld.` : ""}</p>}
          {completePresentation && attention && attention.reservationCount !== board.attention.length && <p role="status" className="border-b border-base-300 px-5 py-3 text-sm">Summary and detailed records were read separately and currently differ. The complete detail feed shows {board.attention.length} attention records; refresh both sources before relying on the summary count.</p>}
          {reservationState === "loading" ? (
            <div className="p-5 text-sm text-base-content/50">Preparing the shift board...</div>
          ) : reservationState === "unavailable" || !snapshot ? (
            <div className="p-5 text-sm text-base-content/50">The detailed shift schedule is temporarily unavailable.</div>
          ) : (
            <div className="divide-y divide-base-300">
              <ShiftSection
                icon={<TriangleAlert size={16} />}
                label="Needs attention"
                items={board.attention}
                emptyLabel="No decisions waiting"
                tone="warning"
                kind="attention"
                current={reservationPresentation}
                unitLabels={unitLabels}
                localDate={snapshot.localDate}
                activeRoute={activeRoute}
                inventory={inventory}
                onOpen={openReservation}
              />
              <ShiftSection
                icon={<LogIn size={16} />}
                label="Arrivals"
                items={board.arrivals}
                emptyLabel="No confirmed arrivals today"
                tone="success"
                kind="arrival"
                current={reservationPresentation}
                unitLabels={unitLabels}
                localDate={snapshot.localDate}
                activeRoute={activeRoute}
                inventory={inventory}
                onOpen={openReservation}
              />
              <ShiftSection
                icon={<LogOut size={16} />}
                label="Departures"
                items={board.departures}
                emptyLabel="No departures waiting"
                tone="primary"
                kind="departure"
                current={reservationPresentation}
                unitLabels={unitLabels}
                localDate={snapshot.localDate}
                activeRoute={activeRoute}
                inventory={inventory}
                onOpen={openReservation}
              />
              <ShiftSection
                icon={<UsersRound size={16} />}
                label="Staying tonight"
                items={board.inHouse}
                emptyLabel="No continuing in-house stays"
                tone="secondary"
                kind="inHouse"
                current={reservationPresentation}
                unitLabels={unitLabels}
                localDate={snapshot.localDate}
                activeRoute={activeRoute}
                inventory={inventory}
                onOpen={openReservation}
              />
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
            <div className="border-b border-base-300 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-2 text-primary"><DoorOpen size={17} /><p className="text-xs font-semibold uppercase">Property pulse</p></div>
              <h2 className="mt-2 font-display text-lg font-semibold">Ready for today</h2>
            </div>
            <div className="divide-y divide-base-300 px-5 sm:px-6">
              <PulseRow icon={<Building2 />} label="Rooms configured" value={sourceValue(inventoryState, inventory.length)} />
              <PulseRow icon={<BedDouble />} label="Sellable units" value={sourceValue(inventoryState, sellableUnits.length)} />
              <PulseRow icon={<Blocks />} label="Blocks today" value={sourceValue(blockState, blocks.length)} attention={blocks.length > 0} />
              <PulseRow icon={<Settings2 />} label="Rooms needing setup" value={sourceValue(inventoryState, unconfiguredRooms.length)} attention={unconfiguredRooms.length > 0} />
            </div>
            {canOpenSpaces && <div className="grid grid-cols-2 gap-2 border-t border-base-300 p-4 sm:px-5">
              <Link to={operationalSpacesHref({ surface: "today", propertyId, view: "operations" }, "availability")} className="btn btn-outline btn-sm border-base-300 text-primary"><Blocks size={15} />Availability</Link>
              <Link to={operationalSpacesHref({ surface: "today", propertyId, view: "operations" }, "layout")} className="btn btn-outline btn-sm border-base-300 text-primary"><Building2 size={15} />Rooms & beds</Link>
            </div>}
          </div>

          <div className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-base-300 px-5 py-3.5">
              <div className="flex items-center gap-2 text-primary"><CalendarPlus size={16} /><h2 className="text-sm font-semibold">Coming up</h2></div>
              <Link to="/reservations?status=upcoming" className="text-xs font-semibold text-primary hover:underline">View all</Link>
            </div>
            {snapshotState === "loading" ? (
              <div className="p-4 text-sm text-base-content/50">Loading future arrivals...</div>
            ) : comingUp.length ? (
              <div className="divide-y divide-base-300">
                {comingUp.map((reservation) => (
                  <UpcomingStay
                    key={reservation.reservationId}
                    reservation={reservation}
                    inventory={inventory}
                    activeRoute={activeRoute}
                    onOpen={openReservation}
                  />
                ))}
              </div>
            ) : !snapshotCurrent && !(routineRefresh && snapshotState === "ready") ? (
              <p className="px-5 py-4 text-sm">Future arrivals are unconfirmed.</p>
            ) : (
              <div className="flex items-center gap-3 px-5 py-4 text-sm text-base-content/50"><CircleCheck size={18} className="text-success" />No later arrivals queued.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function OperationMetric({ icon, label, value, detail, tone, to }: {
  icon: ReactNode;
  label: string;
  value: number | string;
  detail: string;
  tone: "success" | "primary" | "secondary" | "warning";
  to: string;
}) {
  const tones = {
    success: "bg-success/10 text-success",
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary/12 text-secondary",
    warning: "bg-warning/22 text-warning-content",
  };
  return (
    <Link to={to} className="group min-w-0 bg-base-100 p-4 transition hover:bg-base-200/65 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>{icon}</span>
        <span className="min-w-[2ch] text-right text-2xl font-semibold leading-none sm:text-3xl">{value}</span>
      </div>
      <p className="mt-4 text-sm font-semibold">{label}</p>
      <p className="mt-1 min-h-8 text-xs leading-4 text-base-content/50 sm:min-h-0 sm:truncate" title={detail}>{detail}</p>
    </Link>
  );
}

type ShiftKind = "attention" | "arrival" | "departure" | "inHouse";

function ShiftSection({
  icon,
  label,
  items,
  emptyLabel,
  tone,
  kind,
  current,
  unitLabels,
  localDate,
  activeRoute,
  inventory,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  items: ReservationListItem[];
  emptyLabel: string;
  tone: "warning" | "success" | "primary" | "secondary";
  kind: ShiftKind;
  current: boolean;
  unitLabels: Map<string, string>;
  localDate: string;
  activeRoute: OperationalPreviewRoute | null;
  inventory: RoomInventory[];
  onOpen: (reservation: ReservationListItem, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const tones = {
    warning: "bg-warning/18 text-warning-content",
    success: "bg-success/10 text-success",
    primary: "bg-primary/9 text-primary",
    secondary: "bg-secondary/12 text-secondary",
  };
  return (
    <section>
      <div className="flex items-center gap-3 bg-base-200/45 px-5 py-2.5 sm:px-6">
        <span className={`grid size-7 shrink-0 place-items-center rounded-md ${tones[tone]}`}>{icon}</span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{label}</h3>
        <span className="min-w-6 rounded-md bg-base-100 px-1.5 py-0.5 text-center text-xs font-semibold text-base-content/55">{current ? items.length : "—"}</span>
      </div>
      {items.length ? (
        <div className="divide-y divide-base-300">
          {items.map((reservation) => (
            <ShiftReservationRow
              key={reservation.reservationId}
              reservation={reservation}
              kind={kind}
              unitLabels={unitLabels}
              localDate={localDate}
              activeRoute={activeRoute}
              inventory={inventory}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-5 py-3 text-xs text-base-content/45 sm:px-6">
          {current && <CircleCheck size={15} className="text-success" />}{current ? emptyLabel : "Current records are unconfirmed"}
        </div>
      )}
    </section>
  );
}

function ShiftReservationRow({
  reservation,
  kind,
  unitLabels,
  localDate,
  activeRoute,
  inventory,
  onOpen,
}: {
  reservation: ReservationListItem;
  kind: ShiftKind;
  unitLabels: Map<string, string>;
  localDate: string;
  activeRoute: OperationalPreviewRoute | null;
  inventory: RoomInventory[];
  onOpen: (reservation: ReservationListItem, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const time = shiftTime(reservation, kind, localDate);
  const inventoryContext = reservationInventoryContext(reservation, inventory);
  const selected = operationalReservationSelected(activeRoute, reservation, inventoryContext?.inventoryUnitId);
  return (
    <button
      type="button"
      className={`grid w-full gap-2 px-5 py-3 text-left transition hover:bg-base-200/55 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center sm:px-6 ${selected ? "bg-primary/8 ring-2 ring-inset ring-primary/35" : ""}`}
      aria-expanded={selected}
      aria-controls="operational-preview"
      data-operational-preview-trigger={todayReservationTriggerKey(reservation.reservationId, inventoryContext?.inventoryUnitId)}
      onClick={(event) => onOpen(reservation, event)}
    >
      <span className="flex min-w-0 items-center gap-3">
        <InitialAvatar name={reservation.primaryGuestName} size="sm" />
        <span className="min-w-0">
          <strong className="block truncate text-sm">{reservation.primaryGuestName}</strong>
          <span className="mt-0.5 block truncate text-xs text-base-content/50">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"} · {reservationUnitLabel(reservation, unitLabels)}</span>
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-xs font-medium text-base-content/60 sm:justify-end"><Clock3 size={14} className="text-primary" />{time}</span>
      <span className="flex items-center justify-between gap-2 sm:justify-end">
        <StatusBadge status={reservationStatusLabel(reservation.status)} />
        <ArrowRight size={15} className="text-base-content/35" />
      </span>
    </button>
  );
}

function UpcomingStay({ reservation, inventory, activeRoute, onOpen }: {
  reservation: ReservationListItem;
  inventory: RoomInventory[];
  activeRoute: OperationalPreviewRoute | null;
  onOpen: (reservation: ReservationListItem, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const inventoryContext = reservationInventoryContext(reservation, inventory);
  const selected = operationalReservationSelected(activeRoute, reservation, inventoryContext?.inventoryUnitId);
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-base-200/55 ${selected ? "bg-primary/8 ring-2 ring-inset ring-primary/35" : ""}`}
      aria-expanded={selected}
      aria-controls="operational-preview"
      data-operational-preview-trigger={todayReservationTriggerKey(reservation.reservationId, inventoryContext?.inventoryUnitId)}
      onClick={(event) => onOpen(reservation, event)}
    >
      <InitialAvatar name={reservation.primaryGuestName} size="sm" />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm">{reservation.primaryGuestName}</strong>
        <span className="mt-0.5 block text-xs text-base-content/50">{formatShortDate(reservation.arrival)} · {reservation.expectedArrivalTime ? formatTime(reservation.expectedArrivalTime) : "Time not set"}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-base-content/35" />
    </button>
  );
}

function buildUnitLabels(inventory: RoomInventory[]) {
  const labels = new Map<string, string>();
  inventory.forEach((room) => room.units.forEach((unit) => {
    labels.set(
      unit.inventoryUnitId,
      isRoomLevel(room.salesMode) ? room.roomName : `${room.roomName} · ${unit.label}`,
    );
  }));
  return labels;
}

function reservationInventoryContext(
  reservation: ReservationListItem,
  inventory: RoomInventory[],
) {
  for (const room of inventory) {
    const unit = room.units.find((candidate) =>
      reservation.inventoryUnitIds.includes(candidate.inventoryUnitId));
    if (!unit) continue;
    const privateRoom = isRoomLevel(room.salesMode);
    return {
      inventoryUnitId: unit.inventoryUnitId,
      roomId: room.roomId,
      bedId: unit.bedId ?? undefined,
      roomName: room.roomName,
      unitLabel: privateRoom ? "Whole room" : unit.label,
      unitDetail: privateRoom ? "Private room" : "Bed",
    };
  }
  return undefined;
}

function operationalReservationSelected(
  route: OperationalPreviewRoute | null,
  reservation: ReservationListItem,
  inventoryUnitId: string | undefined,
) {
  return route?.origin.surface === "today"
    && route.origin.view === "operations"
    && route.selection.kind === "reservation"
    && route.selection.reservationId === reservation.reservationId
    && route.selection.inventoryUnitId === inventoryUnitId;
}

function todayReservationTriggerKey(
  reservationId: string,
  inventoryUnitId: string | undefined,
) {
  return `today:operations:reservation:${reservationId}:${inventoryUnitId ?? "none"}`;
}

function reservationUnitLabel(reservation: ReservationListItem, labels: Map<string, string>) {
  const resolved = reservation.inventoryUnitIds.map((unitId) => labels.get(unitId)).filter(Boolean) as string[];
  const requestedLabel = !resolved.length
    ? "inventory needs review"
    : resolved.length === 1
      ? resolved[0]
      : `${resolved[0]} +${resolved.length - 1}`;
  return reservation.holdsInventory
    ? requestedLabel
    : `Requested — not held · ${requestedLabel}`;
}

function shiftTime(reservation: ReservationListItem, kind: ShiftKind, localDate: string) {
  if (kind === "arrival") return reservation.expectedArrivalTime ? formatTime(reservation.expectedArrivalTime) : "Time not set";
  if (kind === "departure") return reservation.expectedDepartureTime ? formatTime(reservation.expectedDepartureTime) : "Time not set";
  if (kind === "inHouse") return formatShortDate(reservation.departure);
  return todayAttentionReason(reservation, localDate) ?? reservationStatusLabel(reservation.status);
}

function formatTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(new Date(1970, 0, 1, hours, minutes));
}

function isRoomLevel(mode: RoomInventory["salesMode"]) {
  return mode === 2 || String(mode).toLowerCase() === "roomlevel";
}

function PulseRow({ icon, label, value, attention = false }: { icon: ReactNode; label: string; value: number | string; attention?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${attention ? "bg-warning/20 text-warning-content" : "bg-primary/8 text-primary"}`}>{icon}</span>
      <span className="min-w-0 flex-1 text-sm text-base-content/60">{label}</span>
      <strong className="font-display text-lg">{value}</strong>
    </div>
  );
}

function sourceValue(state: CompositeSourceState, value?: number) {
  return state === "loading" ? "..." : state !== "ready" ? "—" : value ?? "—";
}

function sourceDetail(state: CompositeSourceState, value: string) {
  return state === "loading" ? "Loading..." : state !== "ready" ? "Unconfirmed" : value;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}
