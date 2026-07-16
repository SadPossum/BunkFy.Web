import { expect, test } from "vitest";
import { notificationDestination } from "../src/features/notifications/notificationDestination";

test("reservation notifications open the exact reservation in its property", () => {
  const result = notificationDestination({
    name: "reservation-confirmed",
    payload: { PropertyId: "property-a", ReservationId: "reservation-a" },
  });

  expect(result?.actionLabel).toBe("Open reservation");
  expect(result?.path).toBe("/reservations?property=property-a&reservation=reservation-a&focus=reservation-a");
});

test("inventory block notifications preserve the affected group, unit, and stay range", () => {
  const result = notificationDestination({
    name: "manual-inventory-block-created",
    payload: {
      propertyId: "property-a",
      blockGroupId: "group-a",
      inventoryUnitId: "unit-a",
      arrival: "2026-07-15",
      departure: "2026-07-17",
    },
  });

  expect(
    result?.path,
  ).toBe("/inventory?property=property-a&blockGroup=group-a&unit=unit-a&arrival=2026-07-15&departure=2026-07-17&focus=group-a");
});

test("provider attention opens the exact receipt activity tab", () => {
  const result = notificationDestination({
    name: "provider-reservation-operation-needs-attention",
    payload: { propertyId: "property-a", receiptId: "receipt-a", connectionId: "connection-a" },
  });

  expect(
    result?.path,
  ).toBe("/integrations?property=property-a&tab=activity&activity=receipts&receipt=receipt-a");
});

test("unknown notifications remain readable without inventing a destination", () => {
  expect(notificationDestination({ name: "custom-message", payload: {} })).toBeNull();
});

test("released blocks open the all-blocks view so the changed record remains visible", () => {
  const result = notificationDestination({
    name: "manual-inventory-block-released",
    payload: { propertyId: "property-a", blockGroupId: "group-a" },
  });

  expect(result?.path).toBe("/inventory?property=property-a&blockGroup=group-a&history=all&focus=group-a");
});

test("staff notifications open the recipient's accessible workspace profile", () => {
  const result = notificationDestination({
    name: "staff-property-assigned",
    payload: { staffMemberId: "staff-a", propertyId: "property-a" },
  });

  expect(result?.path).toBe("/account?focus=workspace-profile");
});
