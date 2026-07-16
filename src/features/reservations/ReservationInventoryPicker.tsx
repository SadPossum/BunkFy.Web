import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { InventoryUnitAvailability } from "../../api/types";
import { inventoryKindLabel } from "../../api/labels";
import { ErrorState } from "../../components/ui/primitives";
import type { InventoryRoomGroup } from "./inventoryGrouping";

export function ReservationInventoryPicker({
  groups,
  loading,
  error,
  selectedUnits,
  onToggle,
}: {
  groups: InventoryRoomGroup[];
  loading: boolean;
  error: unknown;
  selectedUnits: string[];
  onToggle: (inventoryUnitId: string) => void;
}) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(() => new Set());
  const availableCount = groups.reduce((total, group) => total + group.availableCount, 0);
  const totalCount = groups.reduce((total, group) => total + group.totalCount, 0);
  const unavailableCount = totalCount - availableCount;
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      units: showUnavailable ? group.units : group.units.filter((unit) => unit.isAvailable),
    }))
    .filter((group) => group.units.length > 0);

  function toggleRoom(roomId: string) {
    setCollapsedRooms((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Inventory</span>
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
        {unavailableCount > 0 && (
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

      {loading ? (
        <div className="rounded-xl bg-base-200 p-5 text-center text-sm text-base-content/55">
          <span className="loading loading-spinner loading-sm mr-2" />Checking inventory
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : !groups.length ? (
        <div className="rounded-xl border border-dashed border-base-300 p-5 text-center text-sm text-base-content/55">No sellable inventory is configured for this property.</div>
      ) : !visibleGroups.length ? (
        <div className="rounded-xl border border-dashed border-base-300 bg-base-200/60 p-5 text-center">
          <p className="text-sm font-semibold">No units are available for these dates</p>
          <p className="mt-1 text-xs text-base-content/55">Change the stay dates or show unavailable inventory to review conflicts.</p>
        </div>
      ) : (
        <div className="space-y-2.5 sm:max-h-72 sm:overflow-y-auto sm:pr-1">
          {visibleGroups.map((group) => (
            <InventoryRoomSection
              key={group.roomId}
              group={group}
              collapsed={collapsedRooms.has(group.roomId)}
              selectedUnits={selectedUnits}
              onCollapse={() => toggleRoom(group.roomId)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryRoomSection({
  group,
  collapsed,
  selectedUnits,
  onCollapse,
  onToggle,
}: {
  group: InventoryRoomGroup;
  collapsed: boolean;
  selectedUnits: string[];
  onCollapse: () => void;
  onToggle: (inventoryUnitId: string) => void;
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
        onClick={onCollapse}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{group.roomName}</span>
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
  onToggle,
}: {
  item: InventoryUnitAvailability;
  selected: boolean;
  onToggle: (inventoryUnitId: string) => void;
}) {
  const { unit, isAvailable } = item;
  return (
    <label className={`flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 transition ${selected ? "border-primary bg-primary/8" : isAvailable ? "cursor-pointer border-transparent bg-base-200 hover:border-primary/30" : "cursor-not-allowed border-base-300 bg-base-200/80"}`}>
      <input type="checkbox" className="checkbox checkbox-primary checkbox-sm" checked={selected} disabled={!isAvailable} onChange={() => onToggle(unit.inventoryUnitId)} />
      <span>
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
