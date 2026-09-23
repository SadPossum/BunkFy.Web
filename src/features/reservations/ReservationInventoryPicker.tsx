import { ChevronDown } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { InventoryUnitAvailability } from "../../api/types";
import { inventoryKindLabel } from "../../api/labels";
import { ErrorState } from "../../components/ui/primitives";
import { modalIsTopmost } from "../../components/ui/modalFocus";
import type { InventoryRoomGroup } from "./inventoryGrouping";

export function ReservationInventoryPicker({
  groups,
  loading,
  error,
  selectionEnabled,
  selectedUnits,
  onToggle,
  visible = true,
  current = selectionEnabled,
}: {
  groups: InventoryRoomGroup[];
  loading: boolean;
  error: unknown;
  selectionEnabled: boolean;
  selectedUnits: string[];
  onToggle: (inventoryUnitId: string) => void;
  visible?: boolean;
  current?: boolean;
}) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [roomDisclosure, setRoomDisclosure] = useState<Map<string, boolean>>(() => new Map());
  const [completed, setCompleted] = useState(false);
  const headingId = useId();
  const chooserHeading = useRef<HTMLHeadingElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const focusIntent = useRef<"summary" | "chooser" | null>(null);
  const pickerRoot = useRef<HTMLElement>(null);
  const removalFocus = useRef<{ source: HTMLInputElement; roomId: string; modal: HTMLElement } | null>(null);
  const summaryShown = completed && selectedUnits.length > 0;
  useLayoutEffect(() => {
    if (!visible || !focusIntent.current) return;
    const target = focusIntent.current === "summary" ? changeButton.current : chooserHeading.current;
    focusIntent.current = null;
    focusReservationFormTarget(target);
  }, [summaryShown, visible]);
  useLayoutEffect(() => {
    const intent = removalFocus.current;
    removalFocus.current = null;
    if (!intent || !visible || !selectionEnabled || intent.source.isConnected || !intent.modal.isConnected
      || !modalIsTopmost(intent.modal) || (document.activeElement !== document.body && document.activeElement !== intent.modal)) return;
    const roomButton = Array.from(pickerRoot.current?.querySelectorAll<HTMLButtonElement>("button[data-inventory-room]") ?? [])
      .find(button => button.dataset.inventoryRoom === intent.roomId);
    focusReservationFormTarget(roomButton ?? chooserHeading.current);
  }, [selectedUnits, selectionEnabled, visible]);
  // Keep only display preferences across temporary source loss, without retaining inventory DOM.
  if (!visible) return null;
  const availableCount = groups.reduce((total, group) => total + group.availableCount, 0);
  const totalCount = groups.reduce((total, group) => total + group.totalCount, 0);
  const unavailableCount = totalCount - availableCount;
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      units: showUnavailable ? group.units : group.units.filter((unit) => unit.isAvailable || selectedUnits.includes(unit.unit.inventoryUnitId)),
    }))
    .filter((group) => group.units.length > 0);

  function roomExpanded(group: InventoryRoomGroup) {
    return roomDisclosure.get(group.roomId) ?? group.units.some((item) => selectedUnits.includes(item.unit.inventoryUnitId));
  }
  const labelsCurrent = current && !loading && !error;
  const selected = labelsCurrent ? groups.flatMap(group => group.units
    .filter(item => selectedUnits.includes(item.unit.inventoryUnitId))
    .map(item => ({ id: item.unit.inventoryUnitId, label: `${group.roomName} · ${item.unit.label}`, available: item.isAvailable }))) : [];
  const missingCount = selectedUnits.length - selected.length;

  return (
    <section ref={pickerRoot} aria-labelledby={headingId} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} ref={chooserHeading} tabIndex={-1} className="rounded text-base font-semibold outline-none focus:ring-2 focus:ring-primary">Rooms or beds</h3>
            {selectedUnits.length > 0 && (
              <span className="badge badge-sm border-primary/20 bg-primary/8 font-semibold text-primary">
                {selectedUnits.length} selected
              </span>
            )}
          </div>
          {!loading && !error && totalCount > 0 && (
            <p className="mt-0.5 text-xs font-medium text-base-content/55">
              {availableCount} available across {groups.length} {groups.length === 1 ? "room" : "rooms"}
            </p>
          )}
        </div>
        {!summaryShown && unavailableCount > 0 && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5 text-xs font-medium text-base-content/65">
            <span className="whitespace-nowrap">Unavailable</span>
            <span className="min-w-4 text-center tabular-nums text-base-content/45">{unavailableCount}</span>
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={showUnavailable}
              aria-label="Show unavailable inventory"
              onChange={(event) => setShowUnavailable(event.target.checked)}
            />
          </label>
        )}
      </div>

      {summaryShown ? <div className="min-w-0 space-y-3 border-l-2 border-primary/30 pl-3" data-inventory-selection-summary>
        {labelsCurrent ? <>
          <ul className="space-y-1 text-sm leading-6">
            {selected.map(item => <li key={item.id} className="[overflow-wrap:anywhere]">{item.label}{!item.available && <span className="ml-1 text-base-content/65">· Unavailable for a new booking</span>}</li>)}
          </ul>
          {missingCount > 0 && <p className="text-sm" role="status">{missingCount} selected {missingCount === 1 ? "space is" : "spaces are"} not in the current inventory result. Check the selection before creating.</p>}
        </> : <p className="text-sm" role="status">Selected spaces are awaiting current confirmation. Your selection is retained.</p>}
        <button ref={changeButton} type="button" className="btn btn-outline btn-sm min-h-11 h-auto whitespace-normal py-2" onClick={() => { focusIntent.current = "chooser"; setCompleted(false); }}>Change rooms or beds</button>
      </div> : <>
      {groups.length > 0 && !loading && !error && <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={() => setRoomDisclosure(new Map(groups.map(group => [group.roomId, true])))}>Expand all</button>
        <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={() => setRoomDisclosure(new Map(groups.map(group => [group.roomId, false])))}>Collapse all</button>
        {selectedUnits.length > 0 && <button type="button" className="btn btn-outline btn-sm min-h-11" disabled={!labelsCurrent} onClick={() => { focusIntent.current = "summary"; setCompleted(true); }}>Done choosing</button>}
      </div>}
      {loading ? (
        <div className="rounded-lg bg-base-200 p-5 text-center text-sm text-base-content/55">
          <span className="loading loading-spinner loading-sm mr-2" />Checking inventory
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : !groups.length ? (
        <div className="rounded-lg border border-dashed border-base-300 p-5 text-center text-sm text-base-content/55">No sellable inventory is configured for this property.</div>
      ) : !visibleGroups.length ? (
        <div className="rounded-lg border border-dashed border-base-300 bg-base-200/60 p-5 text-center">
          <p className="text-sm font-semibold">No units are available for these dates</p>
          <p className="mt-1 text-xs text-base-content/55">Change the stay dates or show unavailable inventory to review conflicts.</p>
        </div>
      ) : (
        <div className="space-y-2.5 sm:max-h-72 sm:overflow-y-auto sm:pr-1">
          {visibleGroups.map((group) => (
            <InventoryRoomSection
              key={group.roomId}
              group={group}
              collapsed={!roomExpanded(group)}
              selectedUnits={selectedUnits}
              selectionEnabled={selectionEnabled}
              onCollapse={() => setRoomDisclosure(previous => new Map(previous).set(group.roomId, !roomExpanded(group)))}
              onToggle={(id, source) => {
                if (!selectionEnabled) return;
                const modal = source.closest<HTMLElement>("[data-bunkfy-modal-box]");
                if (selectedUnits.includes(id) && document.activeElement === source && modal) removalFocus.current = { source, roomId: group.roomId, modal };
                setCompleted(false);
                onToggle(id);
              }}
            />
          ))}
        </div>
      )}
      </>}
    </section>
  );
}

function InventoryRoomSection({
  group,
  collapsed,
  selectedUnits,
  selectionEnabled,
  onCollapse,
  onToggle,
}: {
  group: InventoryRoomGroup;
  collapsed: boolean;
  selectedUnits: string[];
  selectionEnabled: boolean;
  onCollapse: () => void;
  onToggle: (inventoryUnitId: string, source: HTMLInputElement) => void;
}) {
  const contentId = useId();
  const selectedCount = group.units.filter((unit) => selectedUnits.includes(unit.unit.inventoryUnitId)).length;

  return (
    <section className="overflow-hidden rounded-lg border border-base-300" aria-label={group.roomName}>
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 bg-base-200/65 px-3 py-2 text-left transition hover:bg-base-200 focus-visible:bg-base-200"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        data-inventory-room={group.roomId}
        onClick={onCollapse}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold [overflow-wrap:anywhere]">{group.roomName}</span>
          {selectedCount > 0 && <span className="mt-0.5 block text-xs font-semibold text-primary">{selectedCount} selected</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-semibold text-base-content/55">{availabilityLabel(group.availableCount, group.totalCount)}</span>
          <ChevronDown size={16} className={`transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </span>
      </button>
      {!collapsed && (
        <div id={contentId} className="grid gap-1.5 p-1.5 sm:grid-cols-2">
          {group.units.map((unit) => (
            <InventoryUnitOption
              key={unit.unit.inventoryUnitId}
              item={unit}
              selected={selectedUnits.includes(unit.unit.inventoryUnitId)}
              selectionEnabled={selectionEnabled}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function InventoryUnitOption({
  item,
  selected,
  selectionEnabled,
  onToggle,
}: {
  item: InventoryUnitAvailability;
  selected: boolean;
  selectionEnabled: boolean;
  onToggle: (inventoryUnitId: string, source: HTMLInputElement) => void;
}) {
  const { unit, isAvailable } = item;
  return (
    <label className={`flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 transition ${selected ? "border-primary bg-primary/8" : isAvailable && selectionEnabled ? "cursor-pointer border-transparent bg-base-200 hover:border-primary/30" : "cursor-not-allowed border-base-300 bg-base-200/80"}`}>
      <input type="checkbox" className="checkbox checkbox-primary checkbox-sm" checked={selected} disabled={!selectionEnabled || (!isAvailable && !selected)} onChange={event => { if (selectionEnabled && (isAvailable || selected)) onToggle(unit.inventoryUnitId, event.currentTarget); }} />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className={`block text-sm font-semibold ${isAvailable ? "" : "text-base-content/70"}`}>{unit.label}</span>
        <span className={`block text-xs capitalize ${isAvailable ? "font-semibold text-primary" : "font-medium text-base-content/60"}`}>
          {inventoryKindLabel(unit.kind)} · {isAvailable ? "Available" : "Unavailable"}
        </span>
      </span>
    </label>
  );
}

function availabilityLabel(availableCount: number, totalCount: number) {
  if (availableCount === totalCount) return `${totalCount} available`;
  if (availableCount === 0) return `${totalCount} unavailable`;
  return `${availableCount} of ${totalCount} available`;
}

// These explicit chooser/step transitions reveal only the modal's scrollport.
// scrollIntoView also scrolls overflow-hidden ancestors, hiding fixed chrome.
export function focusReservationFormTarget(target: HTMLElement | null, alignStart = false) {
  if (!target) return;
  target.focus({ preventScroll: true });
  const modal = target.closest("[data-bunkfy-modal-box]");
  for (let port = target.parentElement; port && port !== modal; port = port.parentElement) {
    if (!/^(auto|scroll)$/.test(getComputedStyle(port).overflowY) || port.scrollHeight <= port.clientHeight) continue;
    const top = port.getBoundingClientRect().top + port.clientTop + 16;
    const bottom = top + port.clientHeight - 32;
    const rect = target.getBoundingClientRect();
    const delta = alignStart || rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
    port.scrollTop += delta;
    break;
  }
}
