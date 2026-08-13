import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BedDouble,
  Blocks,
  CalendarSearch,
  CheckCircle2,
  CircleSlash2,
  ChevronRight,
  DoorOpen,
  History,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type {
  InventoryAvailabilityResponse,
  ManualBlockGroup,
  RoomInventory,
  RoomInventoryChangeImpact,
  RoomInventoryMutationReceipt,
} from "../../api/types";
import { inventorySalesModeValue } from "../../api/labels";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { focusedResourceClass, useTargetProperty, useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";
import { DatePicker } from "../../components/ui/DatePicker";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { canAdvanceCursor, initialCursorPage, nextCursorPage, previousCursorPage } from "./cursorPaging";
import { buildBlockTargetOptions, findBlockTargetOption } from "./inventoryBlocking";
import {
  loadAllRoomInventory,
  loadManualBlockGroupPage,
  manualBlockGroupStatuses,
  MANUAL_BLOCK_GROUP_PAGE_SIZE,
} from "./inventoryApi";
import { sellableInventorySummary } from "./inventorySummary";
import { ManualBlockGroupDetailsModal } from "./ManualBlockGroupDetailsModal";
import {
  ManualBlockGroupWorkflowModal,
  type ManualBlockGroupWorkflow,
} from "./ManualBlockGroupWorkflowModal";
import { manualBlockGroupStatusLabel, manualBlockGroupTargetLabel } from "./manualBlockGroupWorkflow";
import { type ManualBlockMutationAttempt } from "./manualBlockMutationAttempt";
import { ReleaseManualBlockGroupModal } from "./ReleaseManualBlockGroupModal";
import { resolveSalesModeMutationAttempt, type SalesModeMutationAttempt } from "./salesModeMutationAttempt";
import { SalesModeChangeModal, type PendingSalesModeChange } from "./SalesModeChangeModal";
import { defaultInventoryRange } from "./inventoryDates";

export function InventoryPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const targetArrival = searchParams.get("arrival");
  const targetDeparture = searchParams.get("departure");
  const blockView = searchParams.get("history") === "all"
    ? "all"
    : searchParams.get("history") === "partial"
      ? "partial"
      : "active";
  const [blockGroupWorkflow, setBlockGroupWorkflow] = useState<ManualBlockGroupWorkflow | null>(null);
  const [detailsBlockGroupId, setDetailsBlockGroupId] = useState<string | null>(null);
  const [releaseBlockGroup, setReleaseBlockGroup] = useState<ManualBlockGroup | null>(null);
  const [blockGroupPage, setBlockGroupPage] = useState(initialCursorPage);
  const [range, setRange] = useState(() => defaultInventoryRange(selectedProperty?.timeZoneId ?? "UTC"));
  const [pendingSalesModeChange, setPendingSalesModeChange] = useState<PendingSalesModeChange | null>(null);
  const salesModeAttempt = useRef<SalesModeMutationAttempt | null>(null);
  const blockGroupMutationAttempt = useRef<ManualBlockMutationAttempt | null>(null);
  const releaseBlockGroupAttempt = useRef<ManualBlockMutationAttempt | null>(null);
  const enabled = Boolean(selectedPropertyId);
  const accessScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.inventoryRead, scope: accessScope },
    { permission: permissions.inventoryConfigure, scope: accessScope },
    { permission: permissions.inventoryBlockGroupsManage, scope: accessScope },
  ] : []);
  const canReadInventory = access.allows(permissions.inventoryRead, accessScope);
  const canConfigure = access.allows(permissions.inventoryConfigure, accessScope);
  const canManageBlockGroups = access.allows(permissions.inventoryBlockGroupsManage, accessScope);
  const inventoryEnabled = enabled && !access.isLoading && canReadInventory;

  const inventory = useQuery({
    queryKey: ["inventory-rooms", selectedPropertyId],
    queryFn: ({ signal }) => loadAllRoomInventory(request, selectedPropertyId!, signal),
    enabled: inventoryEnabled,
  });
  const availability = useQuery({
    queryKey: ["availability", selectedPropertyId, range.arrival, range.departure],
    queryFn: () => request<InventoryAvailabilityResponse>(
      `/api/inventory/properties/${selectedPropertyId}/availability?arrival=${range.arrival}&departure=${range.departure}`,
    ),
    enabled: inventoryEnabled && Boolean(range.arrival && range.departure),
  });
  const blockGroups = useQuery({
    queryKey: ["inventory-block-groups", selectedPropertyId, blockView, blockGroupPage.cursor],
    queryFn: ({ signal }) => loadManualBlockGroupPage(
      request,
      selectedPropertyId!,
      blockView === "active"
        ? manualBlockGroupStatuses.active
        : blockView === "partial"
          ? manualBlockGroupStatuses.partiallyReleased
          : null,
      blockGroupPage.cursor,
      signal,
    ),
    enabled: inventoryEnabled,
  });
  const salesModeImpact = useQuery({
    queryKey: ["room-sales-mode-impact", selectedPropertyId, pendingSalesModeChange?.room.roomId],
    queryFn: () => request<RoomInventoryChangeImpact>(
      `/api/inventory/properties/${selectedPropertyId}/rooms/${pendingSalesModeChange?.room.roomId}/change-impact`,
    ),
    enabled: Boolean(selectedPropertyId && pendingSalesModeChange),
  });
  const focusedResourceId = useTransientResourceFocus(Boolean(inventory.data && blockGroups.data));

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

  function setBlockView(value: "active" | "partial" | "all") {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.set("history", "all");
    else if (value === "partial") next.set("history", "partial");
    else next.delete("history");
    next.delete("focus");
    next.delete("blockGroup");
    setBlockGroupPage(initialCursorPage());
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (!targetArrival || !targetDeparture || targetArrival >= targetDeparture) return;
    setRange((current) => current.arrival === targetArrival && current.departure === targetDeparture
      ? current
      : { arrival: targetArrival, departure: targetDeparture });
  }, [targetArrival, targetDeparture]);

  useEffect(() => {
    if (targetArrival && targetDeparture && targetArrival < targetDeparture) return;
    setRange(defaultInventoryRange(selectedProperty?.timeZoneId ?? "UTC"));
  }, [selectedPropertyId, selectedProperty?.timeZoneId, targetArrival, targetDeparture]);

  useEffect(() => {
    salesModeAttempt.current = null;
    blockGroupMutationAttempt.current = null;
    releaseBlockGroupAttempt.current = null;
    setBlockGroupPage(initialCursorPage());
    setBlockGroupWorkflow(null);
    setDetailsBlockGroupId(null);
    setReleaseBlockGroup(null);
    setPendingSalesModeChange(null);
  }, [selectedPropertyId]);

  useEffect(() => {
    if (targetBlockGroupId) setDetailsBlockGroupId(targetBlockGroupId);
  }, [targetBlockGroupId]);

  const salesModeMutation = useMutation({
    mutationFn: ({ room, salesMode }: { room: RoomInventory; salesMode: "roomLevel" | "bedLevel" }) => {
      salesModeAttempt.current = resolveSalesModeMutationAttempt(
        salesModeAttempt.current,
        {
          propertyId: selectedPropertyId!,
          roomId: room.roomId,
          salesMode,
          expectedVersion: room.version,
        },
      );
      return request<RoomInventoryMutationReceipt>(`/api/inventory/properties/${selectedPropertyId}/rooms/${room.roomId}/sales-mode`, {
        method: "PUT",
        body: JSON.stringify({
          operationId: salesModeAttempt.current.operationId,
          salesMode: inventorySalesModeValue(salesMode),
          expectedVersion: salesModeAttempt.current.expectedVersion,
        }),
      });
    },
    onSuccess: async () => {
      salesModeAttempt.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }),
        queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
      ]);
      setPendingSalesModeChange(null);
    },
  });
  function refreshBlockGroupState() {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inventory-block-groups", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-block-group", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-block-group-members", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
    ]);
  }

  if (!selectedProperty) {
    return <EmptyState icon={<DoorOpen />} title="Choose a property first" description="Inventory is managed within a property. Create or select one to continue." />;
  }
  if (inventory.isLoading || blockGroups.isLoading || access.isLoading) return <LoadingState label="Loading inventory" />;
  if (inventory.error || blockGroups.error || access.error) return <ErrorState error={inventory.error ?? blockGroups.error ?? access.error} />;
  if (!canReadInventory) {
    return <EmptyState icon={<Blocks />} title="Inventory access required" description="Your current property role does not include inventory.read." />;
  }

  const availableCount = availability.data?.units.filter((item) => item.isAvailable).length ?? 0;
  const unavailableCount = availability.data?.units.filter((item) => !item.isAvailable).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={selectedProperty.name}
        title="Inventory"
        description="Control how rooms are sold, check availability, and take physical areas out of service."
        action={canManageBlockGroups ? (
          <button
            className="btn btn-primary"
            onClick={() => setBlockGroupWorkflow({ kind: "create" })}
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
            salesModeAttempt.current = null;
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
                { value: "partial", label: "Partial", icon: <CircleSlash2 size={14} /> },
                { value: "all", label: "All", icon: <History size={14} /> },
              ]}
            />
          </div>
          {(blockGroups.data?.blockGroups.length ?? 0) === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Blocks />}
                title={blockView === "active" ? "No active block groups" : blockView === "partial" ? "No partially released groups" : "No block history"}
                description={blockView === "active"
                  ? "No groups are currently in the Active state. Check Partial for legacy groups that still have active members."
                  : blockView === "partial"
                    ? "No groups have a mix of active and released members."
                    : "No inventory block groups have been recorded yet."}
              />
            </div>
          ) : (
            <>
              <div className="divide-y divide-base-300">
              {blockGroups.data?.blockGroups.map((group) => {
                const target = findBlockTargetOption(targetOptions, group.target);
                return (
                <div key={group.blockGroupId} className={`px-5 py-4 sm:px-6 ${group.blockGroupId === focusedBlockGroupId ? focusedResourceClass : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{target?.label ?? manualBlockGroupTargetLabel(group.target)}</p>
                      <p className="mt-1 text-xs text-base-content/45">
                        {group.activeBlockCount} active of {group.initialBlockCount} - {formatDate(group.arrival)} to {formatDate(group.departure)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm shrink-0"
                        onClick={() => setDetailsBlockGroupId(group.blockGroupId)}
                        aria-label={`View details for ${target?.label ?? "inventory block group"}`}
                      >
                        Details <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusBadge status={manualBlockGroupStatusLabel(group.status)} />
                    {group.replacesGroupId && <span className="badge badge-ghost badge-sm">Replacement</span>}
                    <p className="min-w-0 flex-1 truncate rounded-lg bg-base-200 px-3 py-2 text-xs text-base-content/60">{group.reason || "No reason recorded"}</p>
                  </div>
                </div>
              );})}
              </div>
              <PaginationBar
                page={blockGroupPage.page}
                pageSize={blockGroups.data?.pageSize ?? MANUAL_BLOCK_GROUP_PAGE_SIZE}
                itemCount={blockGroups.data?.blockGroups.length ?? 0}
                itemLabel="block group"
                hasMore={canAdvanceCursor(blockGroupPage, blockGroups.data?.nextCursor ?? null)}
                disabled={blockGroups.isFetching}
                onPageChange={(page) => setBlockGroupPage((current) => page > current.page
                  ? nextCursorPage(current, blockGroups.data?.nextCursor ?? null)
                  : previousCursorPage(current))}
              />
            </>
          )}
        </section>
      </div>

      {blockGroupWorkflow && canManageBlockGroups && (
        <ManualBlockGroupWorkflowModal
          key={blockGroupWorkflow.kind === "create" ? "create" : `replace:${blockGroupWorkflow.group.blockGroupId}:${blockGroupWorkflow.group.version}`}
          workflow={blockGroupWorkflow}
          propertyId={selectedPropertyId!}
          propertyName={selectedProperty.name}
          propertyTimeZoneId={selectedProperty.timeZoneId}
          rooms={rooms}
          attemptRef={blockGroupMutationAttempt}
          onCompleted={refreshBlockGroupState}
          onRefreshRequired={refreshBlockGroupState}
          onClose={() => setBlockGroupWorkflow(null)}
        />
      )}
      {detailsBlockGroupId && (
        <ManualBlockGroupDetailsModal
          key={detailsBlockGroupId}
          blockGroupId={detailsBlockGroupId}
          propertyId={selectedPropertyId!}
          propertyName={selectedProperty.name}
          rooms={rooms}
          canManage={canManageBlockGroups}
          onReplace={(group) => {
            setDetailsBlockGroupId(null);
            setBlockGroupWorkflow({ kind: "replace", group });
          }}
          onRelease={(group) => {
            setDetailsBlockGroupId(null);
            setReleaseBlockGroup(group);
          }}
          onNavigateGroup={setDetailsBlockGroupId}
          onClose={() => setDetailsBlockGroupId(null)}
        />
      )}
      {releaseBlockGroup && canManageBlockGroups && (
        <ReleaseManualBlockGroupModal
          key={`${releaseBlockGroup.blockGroupId}:${releaseBlockGroup.version}`}
          group={releaseBlockGroup}
          propertyId={selectedPropertyId!}
          attemptRef={releaseBlockGroupAttempt}
          onCompleted={refreshBlockGroupState}
          onRefreshRequired={refreshBlockGroupState}
          onClose={() => setReleaseBlockGroup(null)}
        />
      )}
      <SalesModeChangeModal
        change={pendingSalesModeChange}
        impact={salesModeImpact.data}
        loading={salesModeImpact.isLoading}
        pending={salesModeMutation.isPending}
        error={salesModeImpact.error ?? salesModeMutation.error}
        onConfirm={() => pendingSalesModeChange && salesModeMutation.mutate(pendingSalesModeChange)}
        onClose={() => {
          salesModeAttempt.current = null;
          setPendingSalesModeChange(null);
        }}
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}
