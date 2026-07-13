import type { InventoryUnit } from "../../api/types";
import { inventoryKindLabel } from "../../api/labels";

export function sellableInventorySummary(units: InventoryUnit[]): string {
  const sellableUnits = units.filter((unit) => unit.isSellable && unit.isTopologyActive);
  if (sellableUnits.length === 0) return "Not configured for sale";

  const kinds = new Set(sellableUnits.map((unit) => inventoryKindLabel(unit.kind)));
  const kind = kinds.size === 1 ? [...kinds][0] : "unit";
  return `${sellableUnits.length} sellable ${kind}${sellableUnits.length === 1 ? "" : "s"}`;
}
