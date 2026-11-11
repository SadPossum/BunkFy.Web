import { useEffect, useRef, useState } from "react";
import type { Bed, Room, RoomInventory } from "../../api/types";
import { useNetworkStatus } from "../../app/networkStatus";

const readbackDelays = [500, 1500, 3000];

export function inventoryTopologyNeedsRefresh(propertyId: string, room: Room | null, beds: readonly Bed[], inventory: readonly RoomInventory[]): boolean {
  if (!room || room.propertyId !== propertyId || room.status !== "active") return false;
  const matches = inventory.filter(item => item.propertyId === propertyId && item.roomId === room.roomId);
  if (matches.length !== 1) return true;
  // Configuration revisions and physical revisions are independent. Compare
  // their shared identities and copied facts instead of the version counters.
  if ((matches[0].roomName ?? "") !== (room.name ?? "") ||
    (matches[0].buildingLabel ?? "") !== (room.buildingLabel ?? "") ||
    (matches[0].floorLabel ?? "") !== (room.floorLabel ?? "")) return true;
  const units = matches[0].units ?? [];
  const scopedUnits = units.filter(unit => unit.propertyId === propertyId && unit.roomId === room.roomId);
  if (!scopedUnits.some(unit => (unit.kind === "room" || unit.kind === 1) && !unit.bedId)) return true;
  return beds.some(bed => bed.propertyId === propertyId && bed.roomId === room.roomId && bed.status === "active" &&
    !scopedUnits.some(unit => (unit.kind === "bed" || unit.kind === 2) && unit.bedId === bed.bedId && (unit.label ?? "") === (bed.label ?? "")));
}

// A successful read may precede topology projection. Retry only this owned,
// confirmed physical target, with a finite budget independent of fetch churn.
export function useSpacesInventoryReadback({ owner, needed, current, refresh }: {
  owner: string;
  needed: boolean;
  current: boolean;
  refresh: () => Promise<unknown>;
}) {
  const { isOffline } = useNetworkStatus();
  const latest = useRef({ owner, needed, current, refresh, isOffline });
  latest.current = { owner, needed, current, refresh, isOffline };
  const [budget, setBudget] = useState({ owner, attempts: 0 });
  const attempts = budget.owner === owner ? budget.attempts : 0;
  useEffect(() => {
    if (!needed || !current || isOffline || attempts >= readbackDelays.length) return;
    const timer = window.setTimeout(() => {
      const active = latest.current;
      if (active.owner !== owner || !active.needed || !active.current || active.isOffline) return;
      setBudget({ owner, attempts: attempts + 1 });
      void active.refresh().catch(() => { /* The scoped source owns read failures. */ });
    }, readbackDelays[attempts]);
    return () => window.clearTimeout(timer);
  }, [owner, needed, current, attempts, isOffline]);
  return { needed, exhausted: current && attempts >= readbackDelays.length, isOffline, refresh: () => {
    const active = latest.current;
    return active.owner === owner && active.needed && active.current && !active.isOffline
      ? active.refresh() : Promise.resolve();
  } };
}
