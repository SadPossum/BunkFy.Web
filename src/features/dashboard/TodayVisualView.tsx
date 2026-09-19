import { ArrowRight, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import type { InventoryAvailabilityResponse, InventoryUnit, ManualBlock, ReservationListItem, RoomInventory } from "../../api/types";
import { reservationStatusLabel } from "../../api/labels";
import { compositeSourceUsable, type CompositeSourceState } from "../../app/compositeSourceState";
import { reservationAttentionReason } from "../reservations/reservationOperationalView";
import { useOperationalPreview, type OperationalInventoryContext } from "../operational-preview/OperationalPreviewProvider";
import { operationalPreviewTriggerKey, readTodayRoomsContext, writeTodayRoomsContext, type OperationalPreviewRoute, type TodayRoomsContext, type TodayRoomsFilter } from "../operational-preview/operationalPreviewRoute";
import { todayVisualSpacesHref } from "../operational-preview/operationalSurfaceReturn";
import { buildTodayRooms, filterTodayRooms, roomLocation, todayMovement, todaySearchText, type TodayRoomRow } from "./todayRoomsModel";

const filters: { value: TodayRoomsFilter; label: string }[] = [
  { value: "all", label: "All spaces" }, { value: "attention", label: "Needs attention" },
  { value: "movements", label: "Arrivals / departures" }, { value: "available", label: "Available tonight" }, { value: "blocked", label: "Blocked tonight" },
];
const tonightLabels = { available: "Available tonight", occupied: "Reserved tonight", blocked: "Blocked tonight", unavailable: "Not sellable", unknown: "Tonight unconfirmed" };
const actionClass = "flex min-h-[44px] w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1 text-left text-[14px] leading-[20px] hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function displayDate(value: string) { return dateFormatter.format(new Date(`${value}T12:00:00Z`)); }

export function TodayVisualView({ propertyId, propertyName, rooms, roomState, availability, availabilityState, reservations, reservationState, blocks, blockState, localDate, current = false, canOpenSpaces = false, reservationCurrent = false, conflictCount = 0, routineRefresh = false, sourceStatus }: {
  propertyId: string; propertyName: string; rooms: RoomInventory[]; roomState: CompositeSourceState;
  availability?: InventoryAvailabilityResponse; availabilityState: CompositeSourceState; reservations: ReservationListItem[];
  reservationState: CompositeSourceState; blocks: ManualBlock[]; blockState: CompositeSourceState; localDate?: string;
  current?: boolean; canOpenSpaces?: boolean; reservationCurrent?: boolean; conflictCount?: number;
  routineRefresh?: boolean; sourceStatus?: ReactNode;
}) {
  const { activeRoute, openPreview } = useOperationalPreview();
  const [params, setParams] = useSearchParams();
  // Guest search never enters URLs, router state, logs or persistent storage.
  const [search, setSearch] = useState("");
  const [pinnedUnit, setPinnedUnit] = useState<string>();
  const [pinnedReservation, setPinnedReservation] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const parsed = readTodayRoomsContext(params), context = parsed.context, filter = context.filter ?? "all";
  const roomExists = !context.roomId || rooms.some(room => room.roomId === context.roomId);
  const contextValid = parsed.valid && (roomState !== "ready" || roomExists);
  const completePresentation = (current || routineRefresh) && [roomState, availabilityState, reservationState, blockState].every(state => state === "ready") && Boolean(localDate) && !conflictCount;
  const reservationPresentation = reservationCurrent || (routineRefresh && reservationState === "ready" && !conflictCount);
  // Matching cached facts remain readable through routine refresh. The shared
  // notice qualifies them as last known; this never authorizes a command.
  const availabilityUsable = [roomState, availabilityState, reservationState, blockState].every(compositeSourceUsable) && Boolean(localDate && availability) && !conflictCount;
  const model = useMemo(() => buildTodayRooms({ rooms, reservations, blocks, availability, localDate, current: availabilityUsable }), [rooms, reservations, blocks, availability, localDate, availabilityUsable]);
  const scoped = context.roomId ? model.groups.filter(group => group.room.roomId === context.roomId) : model.groups;
  const visible = contextValid ? filterTodayRooms(scoped, search, filter, localDate) : [];
  const selectedUnit = activeRoute?.origin.surface === "today" && activeRoute.origin.view === "visual" && activeRoute.selection.propertyId === propertyId ? activeRoute.selection.inventoryUnitId : pinnedUnit;
  // Retain a current selected row for exact preview return if its lifecycle changes.
  // Deliberate search/filter changes clear the pin; missing/denied records never reappear.
  if (contextValid && selectedUnit && !visible.some(group => group.rows.some(row => row.unit.inventoryUnitId === selectedUnit))) {
    const group = scoped.find(group => group.rows.some(row => row.unit.inventoryUnitId === selectedUnit));
    if (group) {
      const row = group.rows.find(row => row.unit.inventoryUnitId === selectedUnit)!;
      const present = visible.find(item => item.room.roomId === group.room.roomId);
      if (present) present.rows.push(row); else visible.push({ room: group.room, rows: [row] });
    }
  }
  const unitRooms = new Map(rooms.flatMap(room => room.units.map(unit => [unit.inventoryUnitId, room] as const)));
  const unassigned = contextValid ? model.unassigned.filter(item => {
    if (context.roomId && !item.inventoryUnitIds.some(id => unitRooms.get(id)?.roomId === context.roomId)) return false;
    const names = item.inventoryUnitIds.map(id => {
      const room = unitRooms.get(id);
      return room ? room.roomName + " " + room.units.find(unit => unit.inventoryUnitId === id)?.label : "";
    }).join(" ");
    return item.reservationId === pinnedReservation || (todaySearchText(item.primaryGuestName + " " + names).includes(todaySearchText(search))
      && (filter === "all" || (filter === "attention" && reservationAttentionReason(item, localDate) !== null) || (filter === "movements" && (item.arrival === localDate || item.departure === localDate))));
  }) : [];
  const visibleUnits = visible.reduce((sum, group) => sum + group.rows.length, 0);
  const filterControlsId = `today-room-filters-${propertyId}`;
  const roomSummary = context.roomId ? rooms.find(room => room.roomId === context.roomId)?.roomName ?? "Requested room" : "All rooms";
  const filterSummary = filters.find(item => item.value === filter)?.label ?? "Filter unavailable";
  const origin = { surface: "today" as const, propertyId, view: "visual" as const, ...(Object.keys(context).length ? { rooms: context } : {}) };

  function setContext(next: TodayRoomsContext) {
    setPinnedUnit(undefined); setPinnedReservation(undefined);
    const updated = new URLSearchParams(params); updated.set("property", propertyId); writeTodayRoomsContext(updated, next); setParams(updated);
  }
  function inventoryContext(room: RoomInventory, unit: InventoryUnit): OperationalInventoryContext {
    const privateRoom = room.salesMode === 2 || room.salesMode === "roomLevel";
    return { inventoryUnitId: unit.inventoryUnitId, roomId: room.roomId, bedId: unit.bedId ?? undefined, roomName: room.roomName, unitLabel: privateRoom ? "Whole room" : unit.label, unitDetail: privateRoom ? "Private room" : "Bed" };
  }
  function reservationRoute(item: ReservationListItem, inventory?: OperationalInventoryContext): OperationalPreviewRoute {
    return { selection: { kind: "reservation", propertyId, reservationId: item.reservationId, inventoryUnitId: inventory?.inventoryUnitId, roomId: inventory?.roomId, bedId: inventory?.bedId }, origin };
  }
  function openReservation(item: ReservationListItem, inventory: OperationalInventoryContext | undefined, event: MouseEvent<HTMLButtonElement>) {
    if (!localDate) return;
    setPinnedUnit(inventory?.inventoryUnitId); setPinnedReservation(item.reservationId);
    openPreview({ route: reservationRoute(item, inventory), seed: { kind: "reservation", reservation: item, inventory }, trigger: event.currentTarget });
  }
  function recordButton(item: ReservationListItem, inventory?: OperationalInventoryContext) {
    const key = operationalPreviewTriggerKey(reservationRoute(item, inventory));
    return <button key={item.reservationId} type="button" className={actionClass} disabled={!localDate} data-operational-preview-trigger={key} aria-controls="operational-preview" aria-describedby="today-source-status" aria-expanded={activeRoute ? operationalPreviewTriggerKey(activeRoute) === key : false} onClick={event => openReservation(item, inventory, event)}>
      <span className="min-w-0 break-words"><strong className="block">{item.primaryGuestName}</strong>
        <span className="block text-[13px] leading-[18px] text-base-content/75">{!reservationPresentation ? "Last known · " : ""}{reservationStatusLabel(item.status)} · {localDate ? todayMovement(item, localDate) : "Date unconfirmed"}</span>
        <span className="block text-[13px] text-base-content/65">{displayDate(item.arrival)} → {displayDate(item.departure)}{!item.holdsInventory ? " · Requested, not held" : ""}</span>
      </span><ArrowRight size={16} className="shrink-0" aria-hidden="true" />
    </button>;
  }
  function tonight(room: RoomInventory, row: TodayRoomRow) {
    const inventory = inventoryContext(room, row.unit);
    const route: OperationalPreviewRoute = { selection: { kind: "inventoryUnit", propertyId, inventoryUnitId: row.unit.inventoryUnitId, roomId: room.roomId, bedId: row.unit.bedId ?? undefined, date: localDate ?? "", observedState: row.tonight }, origin };
    const key = operationalPreviewTriggerKey(route);
    return <div className="min-w-0">
      <button type="button" disabled={!localDate} className={actionClass + " font-medium " + (row.tonight === "available" ? "bg-success/10" : row.tonight === "blocked" ? "bg-warning/15" : "bg-base-200/70")} data-operational-preview-trigger={key} aria-controls="operational-preview" aria-describedby="today-source-status" aria-expanded={activeRoute ? operationalPreviewTriggerKey(activeRoute) === key : false} onClick={event => {
        setPinnedUnit(row.unit.inventoryUnitId);
        openPreview({ route, seed: { kind: "inventoryUnit", inventory, state: row.tonight, stateReason: row.tonight === "occupied" ? "Reservation allocation for tonight; not proof of physical presence or cleaning readiness." : row.tonight === "unknown" ? "Current sources are unconfirmed; check before relying on availability." : undefined }, trigger: event.currentTarget });
      }}><span>{tonightLabels[row.tonight]}</span><ArrowRight size={16} className="shrink-0" aria-hidden="true" /></button>
      {row.inconsistent && <p className="mt-1 text-[13px]">Sources differ. Open to confirm.</p>}
      {row.blocks.map(block => {
        const blockRoute: OperationalPreviewRoute = { selection: { kind: "inventoryBlock", propertyId, blockGroupId: block.blockGroupId || block.blockId, blockId: block.blockId, inventoryUnitId: row.unit.inventoryUnitId, roomId: room.roomId, bedId: row.unit.bedId ?? undefined, date: localDate }, origin };
        const blockKey = operationalPreviewTriggerKey(blockRoute);
        return <button type="button" key={block.blockId} disabled={!localDate} className={actionClass} data-operational-preview-trigger={blockKey} aria-controls="operational-preview" aria-describedby="today-source-status" aria-expanded={activeRoute ? operationalPreviewTriggerKey(activeRoute) === blockKey : false} onClick={event => {
          setPinnedUnit(row.unit.inventoryUnitId); openPreview({ route: blockRoute, seed: { kind: "inventoryBlock", block, inventory }, trigger: event.currentTarget });
        }}><span className="break-words text-[13px]">{blockState !== "ready" ? "Last known block · " : "Block · "}{block.reason || "Reason not provided"}</span><ArrowRight size={16} className="shrink-0" aria-hidden="true" /></button>;
      })}
    </div>;
  }

  return <div role="tabpanel" aria-label="Today Rooms" aria-describedby="today-source-status today-night-meaning" className="min-w-0 space-y-2 text-[14px] leading-[20px]">
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(12rem,1fr)_minmax(9rem,0.55fr)_minmax(11rem,0.65fr)]">
      <label className="min-w-0 text-[13px] leading-[18px] font-medium">Find room, bed or guest
        <span className="mt-1 flex items-center gap-2 rounded border border-base-300 bg-base-100 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
          <Search size={17} aria-hidden="true" /><input type="search" value={search} onChange={event => { setSearch(event.target.value); setPinnedUnit(undefined); setPinnedReservation(undefined); }} className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[14px] leading-[20px] outline-none" />
        </span>
      </label>
      <button type="button" aria-controls={filterControlsId} aria-expanded={filtersOpen} className="inline-flex min-h-[44px] items-center gap-1 self-end rounded border border-base-300 bg-base-100 px-3 text-[14px] leading-[20px] font-medium hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:hidden" onClick={event => {
        if (filtersOpen) event.currentTarget.focus();
        setFiltersOpen(!filtersOpen);
      }}><SlidersHorizontal size={16} aria-hidden="true" />Filters</button>
      {/* Keep the native controls mounted. Focus latches them open even at wide
          widths, so shrinking cannot hide focus; blur never reverses a click. */}
      <div id={filterControlsId} className={(filtersOpen ? "grid" : "hidden") + " col-span-2 min-w-0 grid-cols-2 gap-2 sm:grid sm:grid-cols-[minmax(9rem,0.55fr)_minmax(11rem,0.65fr)]"} onFocusCapture={() => setFiltersOpen(true)}>
      <label className="min-w-0 text-[13px] leading-[18px] font-medium">Room<select value={context.roomId ?? ""} onChange={event => setContext({ ...context, roomId: event.target.value || undefined })} className="mt-1 block min-h-[44px] w-full min-w-0 rounded border border-base-300 bg-base-100 px-2 text-[14px] leading-[20px]"><option value="">All rooms</option>{rooms.map(room => <option key={room.roomId} value={room.roomId}>{room.roomName}</option>)}</select></label>
      <label className="min-w-0 text-[13px] leading-[18px] font-medium">Show<select value={filter} onChange={event => setContext({ ...context, filter: event.target.value as TodayRoomsFilter })} className="mt-1 block min-h-[44px] w-full min-w-0 rounded border border-base-300 bg-base-100 px-2 text-[14px] leading-[20px]">{filters.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
    </div>
    <p data-today-active-filters className="break-words text-[13px] leading-[18px] text-base-content/70 sm:sr-only">{contextValid ? `${roomSummary} · ${filterSummary}` : "Room or filter unavailable"}</p>
    <div data-today-result-actions className="grid min-h-[44px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 text-[13px] leading-[18px]">
      <div className="min-w-0">
        <p>{completePresentation ? visibleUnits + (visibleUnits === 1 ? " space" : " spaces") : "Coverage incomplete"}</p>
        <p id="today-source-status" role="status" aria-live="polite" className="min-h-[40px] text-[13px] leading-[20px] text-base-content/70 sm:min-h-[20px]">{sourceStatus}</p>
      </div>
      <button type="button" className="min-h-[44px] min-w-[44px] rounded px-1 text-[14px] leading-[20px] underline underline-offset-4 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { setSearch(""); setContext({}); }}>Clear</button>
      {canOpenSpaces && <Link className="inline-flex min-h-[44px] items-center gap-1 text-primary underline underline-offset-4" to={todayVisualSpacesHref(propertyId, context.roomId, context)}><SlidersHorizontal size={16} aria-hidden="true" />Manage rooms</Link>}
    </div>
    <p id="today-night-meaning" className="text-[13px] leading-[18px] text-base-content/65">Tonight’s availability is not presence or cleanliness.</p>
    {!completePresentation && <p role="status" className="rounded border border-warning/40 bg-warning/10 p-3 text-[14px] leading-[20px]">{availabilityUsable ? "Last known availability and guest records are shown while current coverage is unconfirmed. Open a row to recheck current details." : "Current coverage is unconfirmed. Missing results do not mean no work or available inventory."}{conflictCount > 0 ? " " + conflictCount + " conflicting reservation records are withheld; use Retry above." : ""}</p>}
    {!contextValid ? <div role="status" className="rounded border border-base-300 p-3">This room or filter is not available for the current property. Use Clear to show this property’s rooms.</div>
      : !rooms.length && roomState !== "ready" ? <p role="status" className="py-3">{roomState === "loading" ? "Loading room layout…" : "Room layout is unconfirmed. Use Retry above."}</p>
        : <>
          {visible.map(({ room, rows }) => <section key={room.roomId} aria-labelledby={"today-room-" + room.roomId} className="min-w-0 overflow-hidden rounded border border-base-300 bg-base-100">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-base-300 bg-base-200/55 px-3 py-2"><h2 id={"today-room-" + room.roomId} className="break-words text-[16px] font-semibold">{room.roomName}</h2><p className="break-words text-[13px] leading-[18px] text-base-content/70">{roomLocation(room) || propertyName}{room.salesMode === 2 || room.salesMode === "roomLevel" ? " · Private room" : ""}</p></header>
            {rows.length ? <>
              <div data-today-room-columns aria-hidden="true" className="hidden gap-2 border-b border-base-300 px-3 py-1 text-[13px] leading-[18px] font-medium text-base-content/65 md:grid md:grid-cols-[minmax(6rem,0.45fr)_minmax(10rem,0.9fr)_minmax(0,1.5fr)]"><span>Space</span><span>Tonight · {localDate ? displayDate(localDate) : "date unconfirmed"}</span><span>Guest movements</span></div>
              <ul className="divide-y divide-base-300">{rows.map(row => <li key={row.unit.inventoryUnitId} className="grid min-w-0 grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] items-start gap-2 px-3 py-2 md:grid-cols-[minmax(6rem,0.45fr)_minmax(10rem,0.9fr)_minmax(0,1.5fr)]">
                <div className="flex min-h-[44px] min-w-0 items-center"><h3 className="break-words text-[14px] leading-[20px] font-semibold">{inventoryContext(room, row.unit).unitLabel}</h3></div>
                <div className="min-w-0"><p className="sr-only">Tonight · {localDate ? displayDate(localDate) : "date unconfirmed"}</p>{tonight(room, row)}</div>
                <div className="col-span-2 min-w-0 md:col-span-1"><p className="sr-only">Guest movements</p>{row.reservations.length ? row.reservations.map(item => recordButton(item, inventoryContext(room, row.unit))) : <p className="px-2 py-1 text-base-content/65">{reservationPresentation ? "No guest movement in these records" : "Guest context unconfirmed"}</p>}</div>
              </li>)}</ul>
            </> : <p className="p-3">Inventory not configured.{canOpenSpaces && <> <Link className="inline-flex min-h-[44px] items-center text-primary underline" to={todayVisualSpacesHref(propertyId, room.roomId, context)}>Configure this room in Spaces</Link></>}</p>}
          </section>)}
          {!visible.length && !unassigned.length && <p role="status" className="rounded border border-base-300 p-3">{completePresentation ? rooms.length ? "No matching rooms, beds or guests. Try another search or Clear." : "No rooms configured for this property." : "No matches in the currently available data. Retry missing sources before concluding there is no work."}</p>}
        </>}
    {unassigned.length > 0 && <section className="rounded border border-base-300 bg-base-100 p-3" aria-label="Reservations needing space review"><h2 className="text-[16px] font-semibold">Reservations needing space review · {unassigned.length}</h2><p className="mb-2 text-[13px] leading-[18px] text-base-content/70">Some requested rooms or beds could not be confirmed here. Open the reservation to review its assignment.</p>{unassigned.map(item => recordButton(item))}</section>}
    <p className="text-[13px] leading-[18px] text-base-content/60">Guest search stays in this view and clears when you leave. Room and Show filters return from Spaces.</p>
  </div>;
}
