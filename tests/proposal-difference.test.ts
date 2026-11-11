import { expect, it } from "vitest";
import { describeProposalDifference, sameAssignedSpaces } from "../src/features/integrations/proposalDifference";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const baseline = { schemaVersion: 1, arrival: "2026-12-01", departure: "2026-12-03", inventoryUnitIds: [first] };
const incoming = { Kind: 1, Arrival: "2026-12-01", Departure: "2026-12-04", InventoryUnitIds: [first], PrimaryGuestName: "External guest", GuestCount: 1, Email: null, Phone: null };
const diff = (next: object = incoming, before: object | null = baseline) => JSON.stringify({ PreviousOperationalBaseline: before && JSON.stringify(before), IncomingSnapshot: JSON.stringify(next) });

it("reads historical source dates without inventing previous guest details", () => {
  const result = describeProposalDifference(diff());
  expect(result?.baseline?.departure).toBe("2026-12-03");
  expect(result?.kind === "update" && result.incoming.departure).toBe("2026-12-04");
  expect(result?.baseline).not.toHaveProperty("primaryGuestName");
});

it("recognizes cancellation independently of its empty upsert fields", () => {
  const result = describeProposalDifference(diff({ Kind: 2, Arrival: null, Departure: null, InventoryUnitIds: [], PrimaryGuestName: null, GuestCount: null }));
  expect(result?.kind).toBe("cancel");
  expect(result).not.toHaveProperty("incoming");
  expect(result?.baseline?.arrival).toBe("2026-12-01");
});

it("keeps incoming values when the baseline is absent or a future schema", () => {
  for (const before of [null, { ...baseline, schemaVersion: 2 }]) {
    const result = describeProposalDifference(diff(incoming, before));
    expect(result?.baseline).toBeNull();
    expect(result?.kind).toBe("update");
  }
});

it.each([undefined, null, "", "broken", "[]", JSON.stringify({ IncomingSnapshot: "[]" }), diff({ ...incoming, Kind: 99 })])("does not guess from unsupported data: %s", value => {
  expect(describeProposalDifference(value)).toBeNull();
});

it.each([
  { ...incoming, Departure: "2026-02-30" },
  { ...incoming, Departure: "2026-11-30" },
  { ...incoming, InventoryUnitIds: [] },
  { ...incoming, InventoryUnitIds: [first, first.toUpperCase()] },
  { ...incoming, GuestCount: "1" },
  { ...incoming, Email: { secret: "unsupported" } },
])("does not turn invalid source values into a plausible summary", value => {
  expect(describeProposalDifference(diff(value))).toBeNull();
});

it("flags additional fields without discarding the known booking change", () => {
  const result = describeProposalDifference(diff({ ...incoming, FutureCharge: { amount: 20 } }));
  expect(result?.kind).toBe("update");
  expect(result?.hasAdditionalFields).toBe(true);
});

it("compares space sets independently of their order", () => {
  expect(sameAssignedSpaces([first, second], [second, first])).toBe(true);
  expect(sameAssignedSpaces([first], [second])).toBe(false);
});
