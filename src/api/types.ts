export type EntityStatus = "active" | "retired" | number;

export type Property = {
  propertyId: string;
  name: string;
  code: string;
  timeZoneId: string;
  status: EntityStatus;
  version: number;
  createdAtUtc: string;
  updatedAtUtc?: string | null;
  retiredAtUtc?: string | null;
};

export type PropertyListResponse = { properties: Property[]; page: number; pageSize: number };

export type Room = {
  roomId: string;
  propertyId: string;
  name: string;
  buildingLabel?: string | null;
  floorLabel?: string | null;
  status: EntityStatus;
  version: number;
  createdAtUtc: string;
  updatedAtUtc?: string | null;
  retiredAtUtc?: string | null;
};

export type RoomListResponse = { rooms: Room[]; page: number; pageSize: number };

export type Bed = {
  bedId: string;
  roomId: string;
  propertyId: string;
  label: string;
  status: EntityStatus;
  version: number;
  roomVersion: number;
  createdAtUtc: string;
  updatedAtUtc?: string | null;
  retiredAtUtc?: string | null;
};

export type BedListResponse = { beds: Bed[]; page: number; pageSize: number };

export type InventorySalesMode = "unconfigured" | "roomLevel" | "bedLevel" | number;
export type InventoryUnitKind = "room" | "bed" | number;

export type InventoryUnit = {
  inventoryUnitId: string;
  propertyId: string;
  roomId: string;
  bedId?: string | null;
  kind: InventoryUnitKind;
  label: string;
  isSellable: boolean;
  isTopologyActive: boolean;
};

export type RoomInventory = {
  propertyId: string;
  roomId: string;
  roomName: string;
  salesMode: InventorySalesMode;
  version: number;
  units: InventoryUnit[];
};

export type RoomInventoryListResponse = { rooms: RoomInventory[]; page: number; pageSize: number };

export type InventoryUnitAvailability = {
  unit: InventoryUnit;
  isAvailable: boolean;
  activeBlockIds: string[];
  activeAllocationIds: string[];
};

export type InventoryAvailabilityResponse = {
  propertyId: string;
  arrival: string;
  departure: string;
  units: InventoryUnitAvailability[];
};

export type ManualBlock = {
  blockId: string;
  propertyId: string;
  inventoryUnitId: string;
  arrival: string;
  departure: string;
  reason: string;
  status: "active" | "released" | number;
  version: number;
  createdAtUtc: string;
  releasedAtUtc?: string | null;
};

export type ManualBlockListResponse = { blocks: ManualBlock[]; page: number; pageSize: number };

export type ReservationStatus =
  | "pendingAllocation"
  | "confirmed"
  | "allocationRejected"
  | "cancellationPending"
  | "cancelled"
  | number;

export type ReservationSourceKind = "direct" | "external" | number;

export type Reservation = {
  reservationId: string;
  propertyId: string;
  arrival: string;
  departure: string;
  inventoryUnitIds: string[];
  primaryGuestName: string;
  email?: string | null;
  phone?: string | null;
  guestCount: number;
  sourceKind: ReservationSourceKind;
  sourceSystem?: string | null;
  sourceReference?: string | null;
  notes?: string | null;
  status: ReservationStatus;
  allocationRequestId: string;
  allocationId?: string | null;
  allocationVersion?: number | null;
  allocationRejection?: string | number | null;
  version: number;
  createdAtUtc: string;
  updatedAtUtc?: string | null;
};

export type ReservationListResponse = { reservations: Reservation[]; page: number; pageSize: number };

export type AuthTokens = { accessToken: string; refreshToken: string };

export type SmokeStatus = {
  application: string;
  service: string;
  status: string;
  timestampUtc: string;
};
