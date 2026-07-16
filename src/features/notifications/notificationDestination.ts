import type { NotificationHistoryItem } from "../../api/types";

export type NotificationDestination = {
  path: string;
  actionLabel: string;
  contextLabel: string;
  resourceLabel: string;
};

export function notificationDestination(
  item: Pick<NotificationHistoryItem, "name" | "payload">,
): NotificationDestination | null {
  const payload = payloadRecord(item.payload);
  const propertyId = payloadValue(payload, "propertyId");
  const reservationId = payloadValue(payload, "reservationId");

  if (item.name.startsWith("reservation-") && propertyId && reservationId) {
    return destination("/reservations", {
      property: propertyId,
      reservation: reservationId,
      focus: reservationId,
    }, "Open reservation", "Opens the affected reservation", `Reservation ${shortId(reservationId)}`);
  }

  if (item.name === "provider-reservation-operation-needs-attention" && propertyId) {
    const receiptId = payloadValue(payload, "receiptId");
    const connectionId = payloadValue(payload, "connectionId");
    if (receiptId) {
      return destination("/integrations", {
        property: propertyId,
        tab: "activity",
        activity: "receipts",
        receipt: receiptId,
      }, "Inspect provider update", "Opens the source observation receipt", `Receipt ${shortId(receiptId)}`);
    }
    if (connectionId) {
      return destination("/integrations", {
        property: propertyId,
        tab: "connections",
        connection: connectionId,
        focus: connectionId,
      }, "Open connection", "Opens the affected integration connection", `Connection ${shortId(connectionId)}`);
    }
    if (reservationId) {
      return destination("/reservations", {
        property: propertyId,
        reservation: reservationId,
        focus: reservationId,
      }, "Open reservation", "Opens the affected reservation", `Reservation ${shortId(reservationId)}`);
    }
  }

  if (item.name.startsWith("manual-inventory-block-") && propertyId) {
    const blockGroupId = payloadValue(payload, "blockGroupId");
    const inventoryUnitId = payloadValue(payload, "inventoryUnitId");
    return destination("/inventory", {
      property: propertyId,
      blockGroup: blockGroupId,
      unit: inventoryUnitId,
      arrival: payloadValue(payload, "arrival"),
      departure: payloadValue(payload, "departure"),
      history: item.name === "manual-inventory-block-released" ? "all" : undefined,
      focus: blockGroupId ?? inventoryUnitId,
    }, "Open inventory", "Highlights the affected inventory", blockGroupId
      ? `Block ${shortId(blockGroupId)}`
      : `Inventory ${shortId(inventoryUnitId)}`);
  }

  if (item.name === "room-sales-mode-changed" && propertyId) {
    const roomId = payloadValue(payload, "roomId");
    return roomId ? destination("/inventory", {
      property: propertyId,
      room: roomId,
      focus: roomId,
    }, "Open room inventory", "Highlights the changed room", `Room ${shortId(roomId)}`) : null;
  }

  if (item.name === "property-retired" && propertyId) {
    return destination("/properties", {
      property: propertyId,
      focus: propertyId,
    }, "Open properties", "Opens the affected property", `Property ${shortId(propertyId)}`);
  }

  if (item.name.startsWith("staff-")) {
    const staffMemberId = payloadValue(payload, "staffMemberId");
    if (!staffMemberId) return null;
    return destination("/account", {
      focus: "workspace-profile",
    }, "Open workspace profile", "Opens your workspace profile", `Staff profile ${shortId(staffMemberId)}`);
  }

  return null;
}

function destination(
  pathname: string,
  values: Record<string, string | undefined>,
  actionLabel: string,
  contextLabel: string,
  resourceLabel: string,
): NotificationDestination {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value) params.set(name, value);
  }
  return { path: `${pathname}?${params}`, actionLabel, contextLabel, resourceLabel };
}

function shortId(value: string | undefined) { return value?.slice(0, 8).toUpperCase() ?? "UNKNOWN"; }

function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
}

function payloadValue(payload: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!payload) return undefined;
  const entry = Object.entries(payload).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (typeof entry?.[1] === "string" && entry[1]) return entry[1];
  return undefined;
}
