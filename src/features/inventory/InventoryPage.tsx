import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BedDouble,
  Blocks,
  CalendarSearch,
  CheckCircle2,
  CircleSlash2,
  DoorOpen,
  Plus,
  Unlock,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  InventoryAvailabilityResponse,
  ManualBlockGroup,
  ManualBlockListResponse,
  RoomInventory,
  RoomInventoryListResponse,
} from "../../api/types";
import { inventorySalesModeValue } from "../../api/labels";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";
import { BlockInventoryModal, type CreateBlockGroupPayload } from "./BlockInventoryModal";
import { buildBlockTargetOptions, groupActiveBlocks } from "./inventoryBlocking";
import { sellableInventorySummary } from "./inventorySummary";

const pageSize = 100;

export function InventoryPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [blockOpen, setBlockOpen] = useState(false);
  const [range, setRange] = useState(defaultRange);
  const enabled = Boolean(selectedPropertyId);
  const accessScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.inventoryConfigure, scope: accessScope },
    { permission: permissions.inventoryBlocksManage, scope: accessScope },
  ] : []);
  const canConfigure = access.allows(permissions.inventoryConfigure, accessScope);
  const canManageBlocks = access.allows(permissions.inventoryBlocksManage, accessScope);

  const inventory = useQuery({
    queryKey: ["inventory-rooms", selectedPropertyId],
    queryFn: async ({ signal }) => {
      const rooms: RoomInventory[] = [];
      for (let page = 1; ; page += 1) {
        const response = await request<RoomInventoryListResponse>(
          `/api/inventory/properties/${selectedPropertyId}/rooms?page=${page}&pageSize=${pageSize}`,
          { signal },
        );
        rooms.push(...response.rooms);
        if (response.rooms.length < pageSize) break;
      }
      return { rooms, page: 1, pageSize: rooms.length } satisfies RoomInventoryListResponse;
    },
    enabled,
  });
  const availability = useQuery({
    queryKey: ["availability", selectedPropertyId, range.arrival, range.departure],
    queryFn: () => request<InventoryAvailabilityResponse>(
      `/api/inventory/properties/${selectedPropertyId}/availability?arrival=${range.arrival}&departure=${range.departure}`,
    ),
    enabled: enabled && Boolean(range.arrival && range.departure),
  });
  const blocks = useQuery({
    queryKey: ["blocks", selectedPropertyId, false],
    queryFn: async ({ signal }) => {
      const activeBlocks: ManualBlockListResponse["blocks"] = [];
      for (let page = 1; ; page += 1) {
        const response = await request<ManualBlockListResponse>(
          `/api/inventory/properties/${selectedPropertyId}/blocks?includeReleased=false&page=${page}&pageSize=${pageSize}`,
          { signal },
        );
        activeBlocks.push(...response.blocks);
        if (response.blocks.length < pageSize) break;
      }
      return { blocks: activeBlocks, page: 1, pageSize: activeBlocks.length } satisfies ManualBlockListResponse;
    },
    enabled,
  });

  const rooms = inventory.data?.rooms ?? [];
  const targetOptions = useMemo(
    () => buildBlockTargetOptions(selectedProperty?.name ?? "Property", rooms),
    [rooms, selectedProperty?.name],
  );
  const activeBlockGroups = useMemo(
    () => groupActiveBlocks(blocks.data?.blocks ?? [], targetOptions),
    [blocks.data?.blocks, targetOptions],
  );

  const salesModeMutation = useMutation({
    mutationFn: ({ room, salesMode }: { room: RoomInventory; salesMode: "roomLevel" | "bedLevel" }) =>
      request(`/api/inventory/properties/${selectedPropertyId}/rooms/${room.roomId}/sales-mode`, {
        method: "PUT",
        body: JSON.stringify({
          salesMode: inventorySalesModeValue(salesMode),
          expectedVersion: room.version,
        }),
      }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
    ]),
  });
  const createBlockGroup = useMutation({
    mutationFn: (payload: CreateBlockGroupPayload) =>
      request<ManualBlockGroup>(`/api/inventory/properties/${selectedPropertyId}/block-groups`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["blocks", selectedPropertyId] }),
        queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
      ]);
      setBlockOpen(false);
    },
  });
  const releaseBlockGroup = useMutation({
    mutationFn: (blockGroupId: string) =>
      request<ManualBlockGroup>(
        `/api/inventory/properties/${selectedPropertyId}/block-groups/${blockGroupId}/release`,
        { method: "POST" },
      ),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["blocks", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
    ]),
  });

  if (!selectedProperty) {
    return <EmptyState icon={<DoorOpen />} title="Choose a property first" description="Inventory is managed within a property. Create or select one to continue." />;
  }
  if (inventory.isLoading || blocks.isLoading) return <LoadingState label="Loading inventory" />;
  if (inventory.error || blocks.error) return <ErrorState error={inventory.error ?? blocks.error} />;

  const availableCount = availability.data?.units.filter((item) => item.isAvailable).length ?? 0;
  const unavailableCount = availability.data?.units.filter((item) => !item.isAvailable).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={selectedProperty.name}
        title="Inventory"
        description="Control how rooms are sold, check availability, and take physical areas out of service."
        action={canManageBlocks ? (
          <button
            className="btn btn-primary"
            onClick={() => setBlockOpen(true)}
            disabled={targetOptions.length === 0}
          >
            <Plus size={17} />
            Block inventory
          </button>
        ) : undefined}
      />

      <AvailabilitySection
        range={range}
        onRangeChange={setRange}
        loading={availability.isLoading}
        error={availability.error}
        availableCount={availableCount}
        unavailableCount={unavailableCount}
        totalCount={availability.data?.units.length ?? 0}
      />

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <SalesSetupSection
          rooms={rooms}
          canConfigure={canConfigure}
          mutation={salesModeMutation}
        />

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="flex items-center justify-between border-b border-base-300 px-5 py-5 sm:px-6">
            <div>
              <h2 className="font-display text-xl font-semibold">Active blocks</h2>
              <p className="mt-1 text-sm text-base-content/50">Out-of-service and operational holds.</p>
            </div>
            <span className="badge badge-neutral">{activeBlockGroups.length}</span>
          </div>
          {activeBlockGroups.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<Blocks />} title="No active blocks" description="All configured inventory is free from manual blocks." />
            </div>
          ) : (
            <div className="divide-y divide-base-300">
              {activeBlockGroups.map((group) => (
                <div key={group.blockGroupId} className="px-5 py-4 sm:px-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{group.label}</p>
                      <p className="mt-1 text-xs text-base-content/45">
                        {group.detail} - {formatDate(group.arrival)} to {formatDate(group.departure)}
                      </p>
                    </div>
                    {canManageBlocks && (
                      <button
                        className="btn btn-ghost btn-sm shrink-0 text-primary"
                        onClick={() => releaseBlockGroup.mutate(group.blockGroupId)}
                        disabled={releaseBlockGroup.isPending}
                      >
                        <Unlock size={15} />
                        Release
                      </button>
                    )}
                  </div>
                  <p className="mt-3 rounded-lg bg-base-200 px-3 py-2 text-xs text-base-content/60">{group.reason}</p>
                </div>
              ))}
            </div>
          )}
          {releaseBlockGroup.error && <div className="p-5"><ErrorState error={releaseBlockGroup.error} /></div>}
        </section>
      </div>

      <BlockInventoryModal
        open={blockOpen && canManageBlocks}
        propertyName={selectedProperty.name}
        rooms={rooms}
        mutation={createBlockGroup}
        onClose={() => setBlockOpen(false)}
      />
    </>
  );
}

function AvailabilitySection({
  range,
  onRangeChange,
  loading,
  error,
  availableCount,
  unavailableCount,
  totalCount,
}: {
  range: { arrival: string; departure: string };
  onRangeChange: (range: { arrival: string; departure: string }) => void;
  loading: boolean;
  error: Error | null;
  availableCount: number;
  unavailableCount: number;
  totalCount: number;
}) {
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-base-300 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="font-display text-xl font-semibold">Availability check</h2>
          <p className="mt-1 text-sm text-base-content/50">See what can be assigned for a stay range.</p>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onRangeChange({
              arrival: String(data.get("arrival")),
              departure: String(data.get("departure")),
            });
          }}
        >
          <input className="input input-bordered input-sm" type="date" name="arrival" aria-label="Arrival date" defaultValue={range.arrival} required />
          <span className="hidden self-center text-base-content/30 sm:block">to</span>
          <input className="input input-bordered input-sm" type="date" name="departure" aria-label="Departure date" defaultValue={range.departure} required />
          <button className="btn btn-secondary btn-sm"><CalendarSearch size={16} />Check</button>
        </form>
      </div>
      {loading ? (
        <LoadingState label="Checking availability" />
      ) : error ? (
        <div className="p-6"><ErrorState error={error} /></div>
      ) : (
        <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
          <AvailabilityStat icon={<CheckCircle2 />} label="Available" value={availableCount} tone="success" />
          <AvailabilityStat icon={<CircleSlash2 />} label="Unavailable" value={unavailableCount} tone="error" />
          <AvailabilityStat icon={<BedDouble />} label="Total sellable" value={totalCount} tone="primary" />
        </div>
      )}
    </section>
  );
}

function SalesSetupSection({
  rooms,
  canConfigure,
  mutation,
}: {
  rooms: RoomInventory[];
  canConfigure: boolean;
  mutation: ReturnType<typeof useMutation<unknown, Error, { room: RoomInventory; salesMode: "roomLevel" | "bedLevel" }>>;
}) {
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="border-b border-base-300 px-5 py-5 sm:px-6">
        <h2 className="font-display text-xl font-semibold">Sales setup</h2>
        <p className="mt-1 text-sm text-base-content/50">Choose whether guests reserve the whole room or individual beds.</p>
      </div>
      {rooms.length === 0 ? (
        <div className="p-6">
          <EmptyState icon={<DoorOpen />} title="No rooms available" description="Set up rooms and beds in Properties before configuring inventory." />
        </div>
      ) : (
        <div className="divide-y divide-base-300">
          {rooms.map((room) => {
            const mode = normalizeSalesMode(room.salesMode);
            const location = [room.buildingLabel, room.floorLabel].filter(Boolean).join(" / ");
            return (
              <div key={room.roomId} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary/15 text-secondary"><DoorOpen size={18} /></div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{room.roomName}</p>
                    <p className="mt-1 truncate text-xs text-base-content/45">
                      {[location, sellableInventorySummary(room.units)].filter(Boolean).join(" - ")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={mode} />
                  {canConfigure && (
                    <select
                      className="select select-bordered select-sm"
                      aria-label={`Sales mode for ${room.roomName}`}
                      value={mode}
                      onChange={(event) => mutation.mutate({
                        room,
                        salesMode: event.target.value as "roomLevel" | "bedLevel",
                      })}
                    >
                      <option value="unconfigured" disabled>Not configured</option>
                      <option value="roomLevel">Sell whole room</option>
                      <option value="bedLevel">Sell individual beds</option>
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {mutation.error && <div className="p-5"><ErrorState error={mutation.error} /></div>}
    </section>
  );
}

function AvailabilityStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "success" | "error" | "primary";
}) {
  const tones = {
    success: "bg-success/12 text-success",
    error: "bg-error/12 text-error",
    primary: "bg-primary/12 text-primary",
  };
  return (
    <div className="flex items-center gap-4 rounded-lg bg-base-200 p-4">
      <div className={`grid size-11 place-items-center rounded-lg ${tones[tone]}`}>{icon}</div>
      <div>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-base-content/45">{label}</p>
      </div>
    </div>
  );
}

function normalizeSalesMode(value: RoomInventory["salesMode"]): "unconfigured" | "roomLevel" | "bedLevel" {
  if (value === 2 || String(value).toLowerCase() === "roomlevel") return "roomLevel";
  if (value === 3 || String(value).toLowerCase() === "bedlevel") return "bedLevel";
  return "unconfigured";
}

function defaultRange() {
  const arrival = new Date();
  arrival.setDate(arrival.getDate() + 1);
  const departure = new Date(arrival);
  departure.setDate(departure.getDate() + 2);
  return {
    arrival: arrival.toISOString().slice(0, 10),
    departure: departure.toISOString().slice(0, 10),
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}
