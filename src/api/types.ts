import type { components } from "./contracts.generated";

type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];
type NonNullableFields<T, Keys extends keyof T> = Omit<T, Keys> & {
  [Key in Keys]-?: NonNullable<T[Key]>;
};

export type EntityStatus = "active" | "retired" | string;

export type Property = NonNullableFields<
  Schema<"PropertyDto">,
  "name" | "code" | "timeZoneId" | "status"
>;

export type PropertyListResponse = Omit<Schema<"PropertyListResponse">, "properties"> & {
  properties: Property[];
};

export type Room = NonNullableFields<Schema<"RoomDto">, "name" | "status">;

export type RoomListResponse = Omit<Schema<"RoomListResponse">, "rooms"> & {
  rooms: Room[];
};

export type Bed = NonNullableFields<Schema<"BedDto">, "label" | "status">;

export type BedListResponse = Omit<Schema<"BedListResponse">, "beds"> & {
  beds: Bed[];
};

export type InventorySalesMode = Schema<"InventorySalesMode"> | "unconfigured" | "roomLevel" | "bedLevel";
export type InventoryUnitKind = Schema<"InventoryUnitKind"> | "room" | "bed";

export type InventoryUnit = Omit<
  NonNullableFields<Schema<"InventoryUnitDto">, "label">,
  "kind"
> & { kind: InventoryUnitKind };

export type RoomInventory = Omit<
  NonNullableFields<Schema<"RoomInventoryDto">, "roomName" | "units">,
  "salesMode" | "units"
> & {
  salesMode: InventorySalesMode;
  units: InventoryUnit[];
};

export type RoomInventoryListResponse = Omit<Schema<"RoomInventoryListResponse">, "rooms"> & {
  rooms: RoomInventory[];
};

export type InventoryUnitAvailability = Omit<
  NonNullableFields<Schema<"InventoryUnitAvailabilityDto">, "activeBlockIds" | "activeAllocationIds">,
  "unit"
> & { unit: InventoryUnit };

export type InventoryAvailabilityResponse = Omit<Schema<"InventoryAvailabilityResponse">, "units"> & {
  units: InventoryUnitAvailability[];
};

export type ManualBlock = Omit<NonNullableFields<Schema<"ManualInventoryBlockDto">, "reason">, "status"> & {
  status: Schema<"ManualInventoryBlockStatus"> | "active" | "released";
};

export type ManualBlockListResponse = Omit<Schema<"ManualInventoryBlockListResponse">, "blocks"> & {
  blocks: ManualBlock[];
};

export type ReservationStatus = Schema<"ReservationStatus">
  | "pendingAllocation"
  | "confirmed"
  | "allocationRejected"
  | "cancellationPending"
  | "cancelled";

export type ReservationSourceKind = Schema<"ReservationSourceKind"> | "direct" | "external";

export type Reservation = Omit<
  NonNullableFields<Schema<"ReservationDto">, "inventoryUnitIds" | "primaryGuestName">,
  "status" | "sourceKind"
> & {
  status: ReservationStatus;
  sourceKind: ReservationSourceKind;
};

export type ReservationListResponse = Omit<Schema<"ReservationListResponse">, "reservations"> & {
  reservations: Reservation[];
};

export type GuestStatus = Schema<"GuestStatus"> | "active" | "archived";

export type GuestProfile = {
  guestId: string;
  originPropertyId: string;
  displayName: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  nationalityCountryCode?: string | null;
  preferredLanguageTag?: string | null;
  notes?: string | null;
  status: GuestStatus;
  version: number;
  createdBy: string;
  createdAtUtc: string;
  lastChangedBy: string;
  lastChangedAtUtc: string;
  archivedAtUtc?: string | null;
};

export type GuestListResponse = {
  guests: GuestProfile[];
  page: number;
  pageSize: number;
};

export type GuestStayRole = 0 | 1 | "unknown" | "primary" | string;
export type GuestStayStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | string;

export type GuestStayHistoryItem = {
  reservationId: string;
  propertyId: string;
  role: GuestStayRole;
  arrival: string;
  departure: string;
  status: GuestStayStatus;
  checkedInBusinessDate?: string | null;
  noShowBusinessDate?: string | null;
  checkedOutBusinessDate?: string | null;
  isCurrentParticipant: boolean;
  reservationVersion: number;
};

export type BrowserAuthResponse = NonNullableFields<Schema<"BrowserAuthResponse">, "accessToken">;

export type AccessPermissionCheck = NonNullableFields<Schema<"AccessPermissionCheck">, "permission" | "scope">;
export type AccessPermissionDecision = NonNullableFields<Schema<"AccessPermissionDecision">, "permission" | "scope">;
export type AccessPermissionEvaluationResponse = Omit<
  Schema<"AccessPermissionEvaluationResponse">,
  "permissions"
> & { permissions: AccessPermissionDecision[] };

export type SmokeStatus = {
  application: string;
  service: string;
  status: string;
  timestampUtc: string;
};
