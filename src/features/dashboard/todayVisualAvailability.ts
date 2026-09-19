import type { InventoryUnit, InventoryUnitAvailability } from "../../api/types";
import type { CompositeSourceState } from "../../app/compositeSourceState";
import { resolveUnitState } from "../operational-preview/operationalPreviewModel";
import type { OperationalUnitState } from "../operational-preview/operationalPreviewRoute";

export type UnitVisualState = OperationalUnitState;

export function visualUnitState(
  unit: InventoryUnit,
  availability: InventoryUnitAvailability | undefined,
  sourceState: CompositeSourceState,
): UnitVisualState {
  return resolveUnitState(unit, availability, sourceState === "ready", "unknown").state;
}

export function stateCount(states: UnitVisualState[], state: UnitVisualState, sourceState: CompositeSourceState) {
  return sourceState === "ready" ? states.filter((item) => item === state).length : "—";
}
