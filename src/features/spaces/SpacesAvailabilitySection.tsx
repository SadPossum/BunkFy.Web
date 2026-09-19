import {
  BedDouble,
  CalendarSearch,
  CheckCircle2,
  CircleAlert,
  CircleSlash2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { RoomInventory } from "../../api/types";
import type { StayDateRange } from "../../app/propertyDate";
import { validStayDateRange } from "../../app/propertyDate";
import { focusedResourceClass } from "../../app/resourceFocus";
import type { CompositeSource } from "../../app/compositeSourceState";
import { compositeSourceUsable } from "../../app/compositeSourceState";
import { DatePicker } from "../../components/ui/DatePicker";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { EmptyState } from "../../components/ui/primitives";
import { SalesModeChangeModal, SalesModeNotice } from "../inventory/SalesModeChangeModal";
import type { SalesModeEditor } from "../inventory/useSalesModeEditor";
import type {
  SpacesAvailabilityModel,
  SpacesAvailabilityRow,
} from "./spacesAvailability";

export function SpacesAvailabilitySection({
  range,
  timeZoneId,
  source,
  sourceError,
  sources,
  model,
  evidenceCurrent,
  contextMismatch,
  targetStatus,
  selectedUnitId,
  mayConfigureInventory,
  salesEditor,
  salesRooms,
  salesOrigin,
  mayReadReservations,
  onRangeChange,
}: {
  range: StayDateRange;
  timeZoneId: string;
  source: CompositeSource;
  sourceError: unknown;
  sources: CompositeSource[];
  model: SpacesAvailabilityModel;
  evidenceCurrent: boolean;
  contextMismatch: boolean;
  targetStatus: "none" | "selected" | "unconfirmed" | "unavailable";
  selectedUnitId: string | null;
  mayConfigureInventory: boolean;
  salesEditor: SalesModeEditor;
  salesRooms: RoomInventory[];
  salesOrigin: (roomId: string, unitId?: string, bedId?: string) => URLSearchParams;
  mayReadReservations: boolean;
  onRangeChange: (range: StayDateRange) => void;
}) {
  const [arrival, setArrival] = useState(range.arrival);
  const [departure, setDeparture] = useState(range.departure);
  useEffect(() => {
    setArrival(range.arrival);
    setDeparture(range.departure);
  }, [range.arrival, range.departure]);
  const draft = { arrival, departure };
  const rangeValid = validStayDateRange(draft);
  // Selling setup is room-wide. Offer it once per room, at its selected unit
  // when present, rather than repeating a configuration action on every bed.
  const salesActionUnits = new Map<string, string>();
  for (const row of model.rows) {
    if (row.targetResolved && (!salesActionUnits.has(row.roomId) || row.inventoryUnitId === selectedUnitId)) salesActionUnits.set(row.roomId, row.inventoryUnitId);
  }

  return (
    <section data-sales-region className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm" aria-labelledby="spaces-availability-heading">
      <SalesModeNotice notice={salesEditor.notice} />
      <div className="flex flex-col gap-4 border-b border-base-300 px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 id="spaces-availability-heading" className="font-display text-xl font-semibold">Availability</h2>
          <p className="mt-1 text-sm leading-5 text-base-content/55">
            Compare every sellable room or bed for one half-open stay range.
          </p>
          {timeZoneId && <p className="mt-1 text-xs text-base-content/45">Property dates · {timeZoneId}</p>}
        </div>
      </div>
      <SalesModeChangeModal editor={salesEditor} inline mayReadReservations={mayReadReservations} />

      <form
        className="grid gap-2 border-b border-base-300 bg-base-200/35 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (rangeValid) onRangeChange(draft);
        }}
      >
        <DatePicker value={arrival} onChange={setArrival} ariaLabel="Arrival date" size="sm" className="w-full" required />
        <DatePicker value={departure} onChange={setDeparture} ariaLabel="Departure date" min={arrival} size="sm" className="w-full" required />
        <button className="btn btn-secondary btn-sm text-white" disabled={!rangeValid}>
          <CalendarSearch size={16} />Check dates
        </button>
        {!rangeValid && (
          <p className="text-xs text-error sm:col-span-3" role="alert">Departure must be after arrival. No availability request is sent for this range.</p>
        )}
      </form>

      {compositeSourceUsable(source.state) && (
        <CompositeSourceNotice className="mx-4 mt-4 sm:mx-5" sources={sources} title="Availability evidence is not current" />
      )}

      {targetStatus === "unconfirmed" && (
        <TargetNotice tone="info" title="Confirming the requested space" description="The exact unit remains in the URL. No other room or bed has been substituted while current evidence is delayed." />
      )}
      {targetStatus === "unavailable" && (
        <TargetNotice tone="warning" title="Requested space changed or is unavailable" description="The exact unit is not present in the current availability response. No other room or bed has been selected." />
      )}

      {contextMismatch && (
        <TargetNotice tone="warning" title="Availability response rejected" description="The response did not match the selected property and date range, so no room, bed, or count is shown. Retry before relying on availability." />
      )}

      {!rangeValid ? (
        <div className="p-4 sm:p-5">
          <EmptyState icon={<CalendarSearch />} title="Choose a valid stay range" description="Availability uses arrival-inclusive, departure-exclusive dates." />
        </div>
      ) : contextMismatch ? (
        <div className="p-4 sm:p-5">
          <EmptyState icon={<ShieldCheck />} title="No trusted availability to show" description="BunkFy kept the requested property and dates but rejected mismatched source data." />
        </div>
      ) : !compositeSourceUsable(source.state) ? (
        <CompositeSourceFallback error={sourceError} state={source.state} label="availability" retry={() => void source.refetch()} title="Availability could not be loaded" />
      ) : (
        <>
          <div className="grid gap-px border-b border-base-300 bg-base-300 sm:grid-cols-3">
            <AvailabilityTotal icon={<CheckCircle2 />} label="Reported available" value={model.reportedAvailable} tone="text-success" />
            <AvailabilityTotal icon={<CircleSlash2 />} label="Reported unavailable" value={model.reportedUnavailable} tone="text-error" />
            <AvailabilityTotal icon={<BedDouble />} label="Response total" value={model.total} tone="text-primary" />
          </div>
          {!evidenceCurrent && (
            <div className="flex items-start gap-2 border-b border-warning/25 bg-warning/10 px-4 py-3 text-xs leading-5 text-warning-content" role="status" aria-live="polite">
              <CircleAlert className="mt-0.5 shrink-0" size={16} />
              Counts are the last response, but row status is Unconfirmed until both sales setup and availability finish refreshing.
            </div>
          )}
          {model.unresolvedTargets > 0 && (
            <div className="flex items-start gap-2 border-b border-warning/25 bg-warning/10 px-4 py-3 text-xs leading-5 text-warning-content" role="status">
              <ShieldCheck className="mt-0.5 shrink-0" size={16} />
              {model.unresolvedTargets} returned {model.unresolvedTargets === 1 ? "unit cannot" : "units cannot"} be matched to the current sales setup. IDs are shown without guessed labels.
            </div>
          )}
          {model.rows.length === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState icon={<BedDouble />} title="No sellable spaces returned" description="The current availability response contains no units for this range." />
              {mayConfigureInventory && salesRooms.length > 0 && <label className="mt-3 block text-sm"><span className="mb-2 block font-semibold">Choose a room to set up for sale</span>
                <select className="select select-bordered w-full" value="" disabled={salesEditor.busy || Boolean(salesEditor.target)} onChange={(event) => {
                  const room = salesRooms.find((item) => item.roomId === event.currentTarget.value);
                  if (room) salesEditor.open(room, event.currentTarget, salesOrigin(room.roomId));
                }}><option value="" disabled>Choose a room</option>{salesRooms.map((room) => <option key={room.roomId} value={room.roomId} disabled={!salesEditor.canOpen(room)}>{room.roomName}</option>)}</select>
              </label>}
            </div>
          ) : (
            <AvailabilityRows rows={model.rows} selectedUnitId={selectedUnitId} salesAction={(row) => {
              if (salesActionUnits.get(row.roomId) !== row.inventoryUnitId) return null;
              const room = row.targetResolved ? salesRooms.find((item) => item.roomId === row.roomId) : undefined;
              return mayConfigureInventory && room ? <button type="button" className="btn btn-ghost btn-sm mt-2 h-auto min-h-10 whitespace-normal text-left" disabled={!evidenceCurrent || !salesEditor.canOpen(room) || Boolean(salesEditor.target) || salesEditor.busy} onClick={(event) => salesEditor.open(room, event.currentTarget, salesOrigin(room.roomId, row.inventoryUnitId, row.bedId))}>Change selling setup</button> : null;
            }} />
          )}
        </>
      )}
    </section>
  );
}

function AvailabilityRows({ rows, selectedUnitId, salesAction }: { rows: SpacesAvailabilityRow[]; selectedUnitId: string | null; salesAction: (row: SpacesAvailabilityRow) => React.ReactNode }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-base-200/55 text-xs font-semibold text-base-content/55">
            <tr>
              <th scope="col" className="w-[42%] px-4 py-3 sm:px-5">Room / space</th>
              <th scope="col" className="w-[25%] px-4 py-3">Type</th>
              <th scope="col" className="w-[33%] px-4 py-3 sm:px-5">Stay status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-base-300">
            {rows.map((row) => (
              <tr
                key={row.inventoryUnitId}
                tabIndex={row.inventoryUnitId === selectedUnitId ? -1 : undefined}
                className={row.inventoryUnitId === selectedUnitId ? `bg-primary/8 outline-none ${focusedResourceClass}` : undefined}
              >
                <th scope="row" className="px-4 py-3 font-normal sm:px-5"><AvailabilityIdentity row={row} />{salesAction(row)}</th>
                <td className="px-4 py-3 text-base-content/60">{row.unitKind === "room" ? "Whole room" : row.unitKind === "bed" ? "Bed" : "Unresolved unit"}</td>
                <td className="px-4 py-3 sm:px-5"><AvailabilityState row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-base-300 md:hidden">
        {rows.map((row) => (
          <div
            key={row.inventoryUnitId}
            tabIndex={row.inventoryUnitId === selectedUnitId ? -1 : undefined}
            className={`px-4 py-3 outline-none ${row.inventoryUnitId === selectedUnitId ? `bg-primary/8 ${focusedResourceClass}` : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <AvailabilityIdentity row={row} />
              <AvailabilityState row={row} />
            </div>
            {salesAction(row)}
          </div>
        ))}
      </div>
    </>
  );
}

function AvailabilityIdentity({ row }: { row: SpacesAvailabilityRow }) {
  return (
    <span className="block min-w-0">
      <span className="block whitespace-normal break-words font-semibold leading-5">{row.roomLabel} · {row.unitLabel}</span>
      <span className="mt-0.5 block whitespace-normal break-words text-xs leading-4 text-base-content/45">{row.roomDetail}</span>
    </span>
  );
}

function AvailabilityState({ row }: { row: SpacesAvailabilityRow }) {
  const label = row.state === "unconfirmed"
    ? `Unconfirmed · last reported ${stateLabel(row.lastReportedState).toLowerCase()}`
    : stateLabel(row.state);
  const detail = row.activeBlockCount > 0
    ? `${row.activeBlockCount} ${row.activeBlockCount === 1 ? "block" : "blocks"}`
    : row.activeAllocationCount > 0
      ? `${row.activeAllocationCount} ${row.activeAllocationCount === 1 ? "allocation" : "allocations"}`
      : null;
  return (
    <span className="flex min-w-0 flex-col items-end gap-1 md:items-start">
      <span className={`inline-flex max-w-full rounded-md px-2 py-1 text-xs font-semibold leading-4 ${stateTone(row.state)}`}>{label}</span>
      {detail && <span className="text-[0.68rem] text-base-content/45">{detail}</span>}
    </span>
  );
}

function AvailabilityTotal({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-3 bg-base-100 px-4 py-3 sm:px-5">
      <span className={tone}>{icon}</span>
      <span><strong className="block text-lg leading-5">{value}</strong><span className="text-xs text-base-content/50">{label}</span></span>
    </div>
  );
}

function TargetNotice({ tone, title, description }: { tone: "info" | "warning"; title: string; description: string }) {
  return (
    <div className={`flex gap-3 border-b px-4 py-3 sm:px-5 ${tone === "info" ? "border-info/25 bg-info/8 text-info-content" : "border-warning/25 bg-warning/10 text-warning-content"}`} role={tone === "warning" ? "alert" : "status"}>
      <CircleAlert className="mt-0.5 shrink-0" size={17} />
      <div><p className="text-sm font-semibold">{title}</p><p className="mt-0.5 text-xs leading-5 opacity-80">{description}</p></div>
    </div>
  );
}

function stateLabel(state: SpacesAvailabilityRow["state"]): string {
  return state.slice(0, 1).toUpperCase() + state.slice(1);
}

function stateTone(state: SpacesAvailabilityRow["state"]): string {
  if (state === "available") return "bg-success/12 text-success";
  if (state === "blocked") return "bg-warning/18 text-warning-content";
  if (state === "occupied") return "bg-secondary/12 text-secondary";
  if (state === "unconfirmed") return "bg-base-200 text-base-content/65";
  return "bg-error/10 text-error";
}
