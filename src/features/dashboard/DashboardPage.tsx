import { useQuery } from "@tanstack/react-query";
import { Building2, LayoutDashboard, Map, Plus, ShieldCheck } from "lucide-react";
import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  InventoryAvailabilityResponse,
  ReservationListItem,
  ReservationOperationsSnapshot,
} from "../../api/types";
import {
  compositeSourceUsable,
  compositeSourceCurrent,
  createCompositeSource,
} from "../../app/compositeSourceState";
import {
  LIVE_LIST_REFRESH_INTERVAL_MS,
  reservationNeedsLiveRefresh,
} from "../../app/liveUpdates";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { useTargetProperty } from "../../app/resourceFocus";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/primitives";
import { loadAllManualInventoryBlocks, loadAllRoomInventory } from "../inventory/inventoryApi";
import { ApiError } from "../../api/client";
import { loadTodayReservationFeed, TodayReservationFeedError, type TodayReservationFeed } from "./todayReservationFeed";
import { TodayOperationsView } from "./TodayOperationsView";
import { TodayVisualView } from "./TodayVisualView";

const todayViews = [
  { value: "operations", label: "Operations", icon: <LayoutDashboard size={16} /> },
  { value: "visual", label: "Rooms", icon: <Map size={16} /> },
] as const;

type TodayView = (typeof todayViews)[number]["value"];

export function DashboardPage() {
  const { request, session } = useSession();
  const {
    selectedProperty,
    selectedPropertyId,
    properties,
    propertiesLoading,
    propertiesError,
    refetchProperties,
  } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPropertyId = searchParams.get("property");
  const hasRequestedProperty = searchParams.has("property");
  const unambiguousProperty = searchParams.getAll("property").length <= 1;
  useTargetProperty(unambiguousProperty ? requestedPropertyId : null);
  const requestedPropertyExists = !hasRequestedProperty
    || (unambiguousProperty && properties.some((property) => property.propertyId === requestedPropertyId));
  const propertyBound = requestedPropertyExists
    && (!hasRequestedProperty || requestedPropertyId === selectedPropertyId);
  const view: TodayView = searchParams.get("view") === "visual" ? "visual" : "operations";
  const accessScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.inventoryRead, scope: accessScope },
    { permission: permissions.reservationsRead, scope: accessScope },
    { permission: permissions.reservationsCreate, scope: accessScope },
    { permission: permissions.propertiesRead, scope: accessScope },
    // Stabilize the evaluation set across preview entry/exit, not its decisions.
    { permission: permissions.reservationsCheckIn, scope: accessScope },
    { permission: permissions.reservationsCheckOut, scope: accessScope },
  ] : []);
  const canReadInventory = access.allows(permissions.inventoryRead, accessScope);
  const canReadReservations = access.allows(permissions.reservationsRead, accessScope);
  const permissionCurrent = access.hasData && !access.error;
  const hasTodayAccess = canReadInventory && canReadReservations;
  const canOpenSpaces = propertyBound && permissionCurrent && !propertiesError
    && access.allows(permissions.propertiesRead, accessScope);
  const enabled = Boolean(propertyBound && selectedPropertyId && permissionCurrent && hasTodayAccess);
  const authority = `${session?.tenantId}:${session?.subjectId}:${session?.sessionId}:${session?.generation}:${selectedPropertyId}`;
  const operations = useQuery({
    queryKey: ["reservation-operations", selectedPropertyId],
    queryFn: ({ signal }) => request<ReservationOperationsSnapshot>(
      `/api/reservations/properties/${selectedPropertyId}/operations-snapshot?upcomingLimit=8`,
      { signal },
    ),
    enabled,
    refetchInterval: (query) => query.state.data?.upcoming.some((item) =>
      reservationNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : 30_000,
    refetchIntervalInBackground: false,
  });
  const inventory = useQuery({
    queryKey: ["inventory-rooms", selectedPropertyId],
    queryFn: ({ signal }) => loadAllRoomInventory(request, selectedPropertyId!, signal),
    enabled,
  });
  const localDate = operations.data?.propertyId === selectedPropertyId ? operations.data.localDate : undefined;
  const schedule = useQuery<TodayReservationFeed>({
    queryKey: ["reservations", selectedPropertyId, "today", localDate, authority],
    queryFn: ({ signal }) => loadTodayReservationFeed(request, selectedPropertyId!, localDate!, signal),
    enabled: enabled && Boolean(localDate),
    retry: (count, error) => !readDenied(error) && !(error instanceof TodayReservationFeedError) && count < 1,
    refetchInterval: (query) => query.state.data?.reservations.some((item) => reservationNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const blocks = useQuery({
    queryKey: ["blocks", selectedPropertyId, false, localDate, localDate ? nextDate(localDate) : null],
    queryFn: ({ signal }) => loadAllManualInventoryBlocks(
      request,
      selectedPropertyId!,
      false,
      signal,
      { from: localDate!, to: nextDate(localDate!) },
    ),
    enabled: enabled && Boolean(localDate),
  });
  const availability = useQuery({
    queryKey: ["availability", selectedPropertyId, localDate, localDate ? nextDate(localDate) : null],
    queryFn: ({ signal }) => request<InventoryAvailabilityResponse>(
      `/api/inventory/properties/${selectedPropertyId}/availability?arrival=${localDate}&departure=${nextDate(localDate!)}`,
      { signal },
    ),
    enabled: enabled && view === "visual" && Boolean(localDate),
  });
  // A retry clears Query's error before its first data arrives. Keep a previously
  // failed source unconfirmed (and its Retry mounted) during that pending read.
  const operationSource = createCompositeSource({ label: "Today operations", hasData: Boolean(localDate) && !readDenied(operations.error), isLoading: operations.isLoading && !operations.errorUpdatedAt, error: operations.error, isFetching: operations.isFetching || operations.isPaused, refetch: () => operations.refetch() });
  const inventorySource = createCompositeSource({ label: "Inventory", hasData: inventory.data !== undefined && inventory.data.rooms.every(room => room.propertyId === selectedPropertyId) && !readDenied(inventory.error), isLoading: inventory.isLoading && !inventory.errorUpdatedAt, error: inventory.error, isFetching: inventory.isFetching || inventory.isPaused, refetch: () => inventory.refetch() });
  const blockSource = createCompositeSource({ label: "Blocks", hasData: blocks.data !== undefined && blocks.data.blocks.every(block => block.propertyId === selectedPropertyId) && !readDenied(blocks.error), isLoading: blocks.isLoading && !blocks.errorUpdatedAt, error: blocks.error, isFetching: blocks.isFetching || blocks.isPaused, refetch: () => blocks.refetch() });
  const feedMatches = schedule.data?.propertyId === selectedPropertyId && schedule.data?.localDate === localDate;
  const feedConflict = feedMatches && Boolean(schedule.data?.conflictingIds.length);
  const scheduleSource = createCompositeSource({ label: "Complete Today reservation details", hasData: feedMatches && !readDenied(schedule.error) && !(schedule.error instanceof TodayReservationFeedError), isLoading: schedule.isLoading && !schedule.errorUpdatedAt, error: schedule.error || (feedConflict ? new TodayReservationFeedError() : null), isFetching: schedule.isFetching || schedule.isPaused, refetch: () => schedule.refetch() });
  const availabilitySource = createCompositeSource({ label: "Tonight availability", hasData: availability.data?.propertyId === selectedPropertyId && availability.data.arrival === localDate && availability.data.departure === nextDate(localDate!) && !readDenied(availability.error), isLoading: availability.isLoading && !availability.errorUpdatedAt, error: availability.error, isFetching: availability.isFetching || availability.isPaused, refetch: () => availability.refetch() });
  const sources = [
    operationSource,
    inventorySource,
    ...(localDate ? [blockSource, scheduleSource] : []),
    ...(view === "visual" && localDate ? [availabilitySource] : []),
  ];

  const viewControls = useRef<HTMLDivElement>(null);
  const retryFocus = useRef<{ owner: string; button: HTMLButtonElement; cancel: () => void } | null>(null);
  const retryOwner = `${authority}:${localDate}:${view}:${searchParams.toString()}:${enabled && !propertiesLoading && !propertiesError}`;

  function rememberRetryFocus(event: MouseEvent<HTMLDivElement>) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true" || document.activeElement !== button) return;
    retryFocus.current?.cancel();
    const cancel = () => {
      document.removeEventListener("focusin", moved);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
      retryFocus.current = null;
    };
    const moved = (focus: FocusEvent) => { if (focus.target !== button) cancel(); };
    const pointer = (input: PointerEvent) => { if (!(input.target instanceof Element) || input.target.closest("button") !== button) cancel(); };
    const key = (input: KeyboardEvent) => { if (input.key === "Tab") cancel(); };
    retryFocus.current = { owner: retryOwner, button, cancel };
    document.addEventListener("focusin", moved);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
  }

  useLayoutEffect(() => {
    const intent = retryFocus.current;
    if (!intent) return;
    if (intent.owner !== retryOwner) { intent.cancel(); return; }
    if (access.isFetching || !sources.every(compositeSourceCurrent) || intent.button.isConnected) return;
    const target = viewControls.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    const shouldRestore = document.activeElement === document.body && target?.isConnected
      && !target.disabled && !target.closest('[hidden], [inert], [aria-hidden="true"]')
      && target.getClientRects().length > 0 && getComputedStyle(target).visibility === "visible";
    intent.cancel();
    if (shouldRestore) target.focus({ preventScroll: true });
  });
  useLayoutEffect(() => () => retryFocus.current?.cancel(), []);

  function setView(nextView: TodayView) {
    const next = new URLSearchParams(searchParams);
    if (nextView === "operations") next.delete("view");
    else next.set("view", nextView);
    setSearchParams(next, { replace: true });
  }

  if (propertiesLoading) return <LoadingState />;
  if (propertiesError) return <ErrorState error={propertiesError} retry={() => void refetchProperties()} title="Properties could not be loaded" />;
  if (!requestedPropertyExists) return <EmptyState icon={<ShieldCheck />} title="This property is not available" description="Choose an accessible property to open Today. No other property's details are shown for this link." />;
  if (!propertyBound) return <LoadingState label="Opening the requested property" />;
  if (!selectedProperty) {
    return (
      <EmptyState
        icon={<Building2 />}
        title="Start with your first property"
        description="Add a hostel property, then set up rooms, beds, inventory, and reservations."
        action={<Link className="btn btn-primary" to="/properties"><Plus size={17} />Add property</Link>}
      />
    );
  }
  if (access.error) return <ErrorState error={access.error} retry={() => void access.refetch()} title="Today access could not be checked" />;
  if (!access.hasData) {
    return <LoadingState label="Checking Today access" />;
  }
  if (!hasTodayAccess) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Today access is not assigned"
        description="Today combines reservation and inventory information, so both read permissions are required for this property."
      />
    );
  }

  const inventoryItems = compositeSourceUsable(inventorySource.state) ? inventory.data?.rooms ?? [] : [];
  const blockItems = compositeSourceUsable(blockSource.state) ? blocks.data?.blocks ?? [] : [];
  const snapshot = compositeSourceUsable(operationSource.state) ? operations.data : undefined;
  const todayReservations: ReservationListItem[] = compositeSourceUsable(scheduleSource.state) ? schedule.data?.reservations ?? [] : [];
  const liveAvailability = compositeSourceUsable(availabilitySource.state) ? availability.data : undefined;
  const canCreate = permissionCurrent
    && access.allows(permissions.reservationsCreate, accessScope);
  // Presentation only: retain the real currentness/permission gates above.
  // A paused, failed or incomplete source is not a successful background read.
  const updating = sources.every(source => source.state === "ready") && !access.isFetching
    && ![operations, inventory, blocks, schedule, ...(view === "visual" ? [availability] : [])].some(query => query.isPaused)
    ? [[operationSource, "Summary"], [inventorySource, "Rooms"], [blockSource, "Blocks"], [scheduleSource, "Reservations"], ...(view === "visual" ? [[availabilitySource, "Availability"]] : [])]
      .filter(([source]) => typeof source !== "string" && source.isFetching)
      .map(([, label]) => String(label))
    : [];
  const routineRefresh = updating.length > 0;
  const sourceStatus = routineRefresh ? <>
    {updating.length === 1 ? `${updating[0]}: updating` : `${updating.length} sources: updating`}
    <span className="sr-only">. Last known {updating.join(", ").toLowerCase()} shown while refreshing. Open a record to check current details.</span>
  </> : null;

  return (
    <>
      <header className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-[30px]">Today<span className="sr-only"> at {selectedProperty.name}</span></h1>
          <p className="text-[13px] leading-[18px] text-base-content/65">{snapshot ? formatLongDate(snapshot.localDate, snapshot.timeZoneId) : "Operating date unconfirmed"}</p>
        </div>
        {canCreate && <Link to="/reservations?new=1" className="btn btn-primary min-h-[44px] text-[14px] leading-[20px]"><Plus size={17} />New reservation</Link>}
      </header>
      <div ref={viewControls} className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <SegmentedTabs
          value={view}
          options={todayViews}
          ariaLabel="Today view"
          className="[&>button]:min-h-[44px] [&>button]:h-auto [&>button]:text-[14px] [&>button]:leading-[20px]"
          onValueChange={setView}
        />
        {snapshot && <p className="text-[13px] leading-[18px] text-base-content/65">{snapshot.timeZoneId}</p>}
      </div>

      <div onClickCapture={rememberRetryFocus}>
        <CompositeSourceNotice sources={sources} title="Some live property data is delayed" keepRetryFocusable />
      </div>

      {view === "operations" ? (
        <TodayOperationsView
          propertyId={selectedPropertyId}
          canOpenSpaces={canOpenSpaces}
          snapshot={snapshot}
          snapshotState={operationSource.state}
          inventory={inventoryItems}
          inventoryState={inventorySource.state}
          blocks={blockItems}
          blockState={blockSource.state}
          reservations={todayReservations}
          reservationState={scheduleSource.state}
          reservationCurrent={compositeSourceCurrent(scheduleSource)}
          snapshotCurrent={compositeSourceCurrent(operationSource)}
          conflictCount={feedConflict ? schedule.data!.conflictingIds.length : 0}
          routineRefresh={routineRefresh}
          sourceStatus={sourceStatus}
        />
      ) : (
        <TodayVisualView
          key={`${authority}:${snapshot?.localDate ?? "unknown"}`}
          propertyId={selectedPropertyId}
          propertyName={selectedProperty.name}
          rooms={inventoryItems}
          roomState={inventorySource.state}
          availability={liveAvailability}
          availabilityState={availabilitySource.state}
          reservations={todayReservations}
          reservationState={scheduleSource.state}
          blocks={blockItems}
          blockState={blockSource.state}
          localDate={snapshot?.localDate}
          current={sources.every(compositeSourceCurrent) && !access.isFetching}
          canOpenSpaces={canOpenSpaces}
          reservationCurrent={compositeSourceCurrent(scheduleSource)}
          conflictCount={feedConflict ? schedule.data!.conflictingIds.length : 0}
          routineRefresh={routineRefresh}
          sourceStatus={sourceStatus}
        />
      )}
    </>
  );
}

function nextDate(value: string) {
  return shiftDate(value, 1);
}

function readDenied(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatLongDate(value: string, timeZoneId: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timeZoneId,
  }).format(new Date(`${value}T12:00:00Z`));
}
