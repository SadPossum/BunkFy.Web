import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BedDouble,
  Blocks,
  CalendarSearch,
  CheckCircle2,
  CircleSlash2,
  DoorOpen,
  History,
  Plus,
  Unlock,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  InventoryAvailabilityResponse,
  ManualBlockGroup,
  ManualBlockListResponse,
  RoomInventory,
  RoomInventoryChangeImpact,
  RoomInventoryListResponse,
} from "../../api/types";
import { inventorySalesModeValue, manualBlockStatusLabel } from "../../api/labels";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { focusedResourceClass, useTargetProperty, useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "../../components/ui/primitives";
import { DatePicker } from "../../components/ui/DatePicker";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { BlockInventoryModal, type CreateBlockGroupPayload } from "./BlockInventoryModal";
import { buildBlockTargetOptions, groupActiveBlocks } from "./inventoryBlocking";
import { sellableInventorySummary } from "./inventorySummary";
import { SalesModeChangeModal, type PendingSalesModeChange } from "./SalesModeChangeModal";

const pageSize = 100;

export function InventoryPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const targetArrival = searchParams.get("arrival");
  const targetDeparture = searchParams.get("departure");
  const blockView = searchParams.get("history") === "all" ? "all" : "active";
  const [blockOpen, setBlockOpen] = useState(false);
  const [range, setRange] = useState(defaultRange);
  const [pendingSalesModeChange, setPendingSalesModeChange] = useState<PendingSalesModeChange | null>(null);
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
    queryKey: ["blocks", selectedPropertyId, blockView],
    queryFn: async ({ signal }) => {
      const activeBlocks: ManualBlockListResponse["blocks"] = [];
      for (let page = 1; ; page += 1) {
        const response = await request<ManualBlockListResponse>(
          `/api/inventory/properties/${selectedPropertyId}/blocks?includeReleased=${blockView === "all"}&page=${page}&pageSize=${pageSize}`,
          { signal },
        );
        activeBlocks.push(...response.blocks);
        if (response.blocks.length < pageSize) break;
      }
      return { blocks: activeBlocks, page: 1, pageSize: activeBlocks.length } satisfies ManualBlockListResponse;
    },
    enabled,
  });
  const salesModeImpact = useQuery({
    queryKey: ["room-sales-mode-impact", selectedPropertyId, pendingSalesModeChange?.room.roomId],
    queryFn: () => request<RoomInventoryChangeImpact>(
      `/api/inventory/properties/${selectedPropertyId}/rooms/${pendingSalesModeChange?.room.roomId}/change-impact`,
    ),
    enabled: Boolean(selectedPropertyId && pendingSalesModeChange),
  });
  const focusedResourceId = useTransientResourceFocus(Boolean(inventory.data && blocks.data));

  const rooms = inventory.data?.rooms ?? [];
  const targetUnitId = searchParams.get("unit");
  const targetRoomId = searchParams.get("room")
    ?? rooms.find((room) => room.units.some((unit) => unit.inventoryUnitId === targetUnitId))?.roomId
    ?? null;
  const targetBlockGroupId = searchParams.get("blockGroup");
  const focusedRoomId = focusedResourceId && (
    focusedResourceId === targetRoomId ||
    focusedResourceId === targetUnitId ||
    focusedResourceId === targetBlockGroupId
  ) ? targetRoomId : null;
  const focusedBlockGroupId = focusedResourceId === targetBlockGroupId ? targetBlockGroupId : null;
  const targetOptions = useMemo(
    () => buildBlockTargetOptions(selectedProperty?.name ?? "Property", rooms),
    [rooms, selectedProperty?.name],
  );
  const activeBlockGroups = useMemo(
    () => groupActiveBlocks(blocks.data?.blocks ?? [], targetOptions),
    [blocks.data?.blocks, targetOptions],
  );

  function setBlockView(value: "active" | "all") {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.set("history", "all");
    else next.delete("history");
    next.delete("focus");
    next.delete("blockGroup");
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (!targetArrival || !targetDeparture || targetArrival >= targetDeparture) return;
    setRange((current) => current.arrival === targetArrival && current.departure === targetDeparture
      ? current
      : { arrival: targetArrival, departure: targetDeparture });
  }, [targetArrival, targetDeparture]);

  const salesModeMutation = useMutation({
    mutationFn: ({ room, salesMode }: { room: RoomInventory; salesMode: "roomLevel" | "bedLevel" }) =>
      request(`/api/inventory/properties/${selectedPropertyId}/rooms/${room.roomId}/sales-mode`, {
        method: "PUT",
        body: JSON.stringify({
          salesMode: inventorySalesModeValue(salesMode),
          expectedVersion: room.version,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }),
        queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
      ]);
      setPendingSalesModeChange(null);
    },
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
          focusedRoomId={focusedRoomId}
          canConfigure={canConfigure}
          pending={salesModeMutation.isPending}
          onModeChange={(room, salesMode) => {
            salesModeMutation.reset();
            setPendingSalesModeChange({ room, salesMode });
          }}
        />

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-base-300 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h2 className="font-display text-xl font-semibold">Inventory blocks</h2>
              <p className="mt-1 text-sm text-base-content/50">Current holds and released-block history.</p>
            </div>
            <SegmentedTabs
              value={blockView}
              ariaLabel="Inventory block view"
              onValueChange={setBlockView}
              options={[
                { value: "active", label: "Active", icon: <Blocks size={14} /> },
                { value: "all", label: "All", icon: <History size={14} /> },
              ]}
            />
          </div>
          {activeBlockGroups.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Blocks />}
                title={blockView === "active" ? "No active blocks" : "No block history"}
                description={blockView === "active" ? "All configured inventory is free from manual blocks." : "No inventory blocks have been recorded yet."}
              />
            </div>
          ) : (
            <div className="divide-y divide-base-300">
              {activeBlockGroups.map((group) => (
                <div key={group.blockGroupId} className={`px-5 py-4 sm:px-6 ${group.blockGroupId === focusedBlockGroupId ? focusedResourceClass : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{group.label}</p>
                      <p className="mt-1 text-xs text-base-content/45">
                        {group.detail} - {formatDate(group.arrival)} to {formatDate(group.departure)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {blockView === "all" && (
                        <span className={`badge badge-sm ${blockStatus(group) === "released" ? "badge-ghost" : "badge-neutral"}`}>
                          {capitalize(blockStatus(group))}
                        </span>
                      )}
                    {canManageBlocks && blockStatus(group) === "active" && (
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
      <SalesModeChangeModal
        change={pendingSalesModeChange}
        impact={salesModeImpact.data}
        loading={salesModeImpact.isLoading}
        pending={salesModeMutation.isPending}
        error={salesModeImpact.error ?? salesModeMutation.error}
        onConfirm={() => pendingSalesModeChange && salesModeMutation.mutate(pendingSalesModeChange)}
        onClose={() => setPendingSalesModeChange(null)}
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
  const [arrival, setArrival] = useState(range.arrival);
  const [departure, setDeparture] = useState(range.departure);

  useEffect(() => {
    setArrival(range.arrival);
    setDeparture(range.departure);
  }, [range.arrival, range.departure]);

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
            onRangeChange({ arrival, departure });
          }}
        >
          <DatePicker value={arrival} onChange={setArrival} ariaLabel="Arrival date" size="sm" className="w-full sm:w-40" required />
          <span className="hidden self-center text-base-content/30 sm:block">to</span>
          <DatePicker value={departure} onChange={setDeparture} ariaLabel="Departure date" min={arrival} size="sm" className="w-full sm:w-40" required />
          <button className="btn btn-secondary btn-sm text-white"><CalendarSearch size={16} />Check</button>
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
  focusedRoomId,
  canConfigure,
  pending,
  onModeChange,
}: {
  rooms: RoomInventory[];
  focusedRoomId: string | null;
  canConfigure: boolean;
  pending: boolean;
  onModeChange: (room: RoomInventory, salesMode: "roomLevel" | "bedLevel") => void;
}) {
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="border-b border-base-300 px-5 py-5 sm:px-6">
        <h2 className="font-display text-xl font-semibold">Sales setup</h2>
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
              <div key={room.roomId} className={`flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${room.roomId === focusedRoomId ? focusedResourceClass : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary/15 text-secondary"><DoorOpen size={18} /></div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{room.roomName}</p>
                    <p className="mt-1 truncate text-xs text-base-content/45">
                      {[location, sellableInventorySummary(room.units)].filter(Boolean).join(" - ")}
                    </p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col items-start gap-2 sm:shrink-0 sm:flex-row sm:items-center sm:gap-3">
                  <SalesModeBadge mode={mode} />
                  {canConfigure && (
                    <SelectPicker
                      className="w-full min-w-0 sm:w-64"
                      size="sm"
                      ariaLabel={`Sales mode for ${room.roomName}`}
                      value={mode}
                      disabled={pending}
                      onValueChange={(value) => onModeChange(room, value as "roomLevel" | "bedLevel")}
                      options={[
                        { value: "unconfigured", label: "Not configured", disabled: true },
                        { value: "roomLevel", label: "Private room" },
                        { value: "bedLevel", label: "Shared room" },
                      ]}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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

function SalesModeBadge({ mode }: { mode: "unconfigured" | "roomLevel" | "bedLevel" }) {
  if (mode === "roomLevel") {
    return <span className="badge badge-sm whitespace-nowrap border-0 bg-secondary font-semibold text-white">Private room</span>;
  }
  if (mode === "bedLevel") {
    return <span className="badge badge-sm whitespace-nowrap border-0 bg-primary font-semibold text-white">Shared room</span>;
  }
  return <span className="badge badge-sm whitespace-nowrap border-0 bg-warning-content font-semibold text-white">Not configured</span>;
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

function blockStatus(group: { blocks: ManualBlockGroup["blocks"] }) {
  return manualBlockStatusLabel(group.blocks[0]?.status ?? 0);
}

function capitalize(value: string) { return value.slice(0, 1).toUpperCase() + value.slice(1); }
