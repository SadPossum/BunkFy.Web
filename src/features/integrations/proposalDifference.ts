type SourceStay = {
  arrival: string;
  departure: string;
  inventoryUnitIds: string[];
};

type IncomingBooking = SourceStay & {
  primaryGuestName: string | null;
  guestCount: number | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  expectedArrivalTime: string | null;
  expectedDepartureTime: string | null;
};

export type ProposalDifferenceModel = {
  baseline: SourceStay | null;
  hasAdditionalFields: boolean;
} & ({ kind: "update"; incoming: IncomingBooking } | { kind: "cancel" });

const incomingKeys = ["Kind", "SourceSequence", "Arrival", "Departure", "InventoryUnitIds",
  "PrimaryGuestName", "GuestCount", "Email", "Phone", "Notes", "ExpectedArrivalTime", "ExpectedDepartureTime"];
const baselineKeys = ["schemaVersion", "arrival", "departure", "inventoryUnitIds"];

/** Read the recorded source snapshots; current reservation data is not a historical baseline. */
export function describeProposalDifference(value: string | null | undefined): ProposalDifferenceModel | null {
  if (!value || value.length > 512 * 1024) return null;
  const envelope = objectFromJson(value);
  if (!envelope || typeof envelope.IncomingSnapshot !== "string") return null;
  const incoming = objectFromJson(envelope.IncomingSnapshot);
  if (!incoming) return null;
  const previous = typeof envelope.PreviousOperationalBaseline === "string"
    ? objectFromJson(envelope.PreviousOperationalBaseline) : null;
  const baseline = previous?.schemaVersion === 1
    ? stay(previous.arrival, previous.departure, previous.inventoryUnitIds) : null;
  const hasAdditionalFields = extraKeys(envelope, ["PreviousOperationalBaseline", "IncomingSnapshot"])
    || extraKeys(incoming, incomingKeys)
    || Boolean(previous && extraKeys(previous, baselineKeys));
  if (incoming.Kind === 2) return { kind: "cancel", baseline, hasAdditionalFields };
  if (incoming.Kind !== 1) return null;
  const incomingStay = stay(incoming.Arrival, incoming.Departure, incoming.InventoryUnitIds);
  const nullableKeys = ["PrimaryGuestName", "Email", "Phone", "Notes", "ExpectedArrivalTime", "ExpectedDepartureTime"];
  if (!incomingStay || nullableKeys.some(key => incoming[key] != null && typeof incoming[key] !== "string")
    || (incoming.GuestCount != null && (!Number.isSafeInteger(incoming.GuestCount) || Number(incoming.GuestCount) <= 0))) return null;
  return {
    kind: "update", baseline, hasAdditionalFields,
    incoming: {
      ...incomingStay,
      primaryGuestName: text(incoming.PrimaryGuestName), guestCount: incoming.GuestCount as number | null ?? null,
      email: text(incoming.Email), phone: text(incoming.Phone), notes: text(incoming.Notes),
      expectedArrivalTime: text(incoming.ExpectedArrivalTime), expectedDepartureTime: text(incoming.ExpectedDepartureTime),
    },
  };
}

export function sameAssignedSpaces(left: readonly string[], right: readonly string[]): boolean {
  const orderedRight = [...right].sort();
  return left.length === right.length && [...left].sort().every((id, index) => id === orderedRight[index]);
}

function objectFromJson(value: string): Record<string, unknown> | null {
  try {
    const result: unknown = JSON.parse(value);
    return result !== null && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown> : null;
  } catch { return null; }
}

function stay(arrival: unknown, departure: unknown, ids: unknown): SourceStay | null {
  if (!date(arrival) || !date(departure) || departure <= arrival || !Array.isArray(ids) || !ids.length
    || ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
      || /^0{8}(-0{4}){3}-0{12}$/.test(id))) return null;
  const inventoryUnitIds = (ids as string[]).map(id => id.toLowerCase());
  if (new Set(inventoryUnitIds).size !== inventoryUnitIds.length) return null;
  return { arrival, departure, inventoryUnitIds };
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function text(value: unknown): string | null { return typeof value === "string" ? value : null; }
function extraKeys(value: Record<string, unknown>, known: string[]): boolean {
  return Object.keys(value).some(key => !known.includes(key));
}
