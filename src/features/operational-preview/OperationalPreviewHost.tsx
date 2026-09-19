import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router";
import {
  BedDouble,
  Blocks,
  CalendarDays,
  CircleDashed,
  DoorOpen,
  ShieldX,
  UserRound,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  InventoryAvailabilityResponse,
  ManualBlock,
  Reservation,
  ReservationListItem,
  ReservationMutationReceipt,
  RoomInventoryListResponse,
} from "../../api/types";
import { ApiError } from "../../api/client";
import { parseDateKey } from "../../components/ui/DatePicker";
import {
  manualBlockStatusLabel,
  reservationSourceLabel,
  reservationStatusLabel,
} from "../../api/labels";
import {
  permissions,
  propertyAccessScope,
  usePermissions,
} from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { propertyDateKey } from "../../app/propertyDate";
import { LIVE_DETAIL_REFRESH_INTERVAL_MS, reservationNeedsLiveRefresh, reservationStatusKey } from "../../app/liveUpdates";
import { resolveReservationLifecycleAttempt } from "../reservations/reservationLifecycleAttempt";
import { reservationEditorIdentity } from "../reservations/reservationsMutationAuthority";
import { ReservationPreviewLifecycleAction } from "./ReservationPreviewLifecycleAction";
import { completedReservationCreateHref, completedReservationSeed } from "../reservations/completedReservationCreate";
import {
  reservationPreviewInvalidations,
  reservationPreviewNavigationPending,
  reservationPreviewQuickAction,
  reservationPreviewReadback,
  reservationPreviewReceiptMatches,
  type ReservationPreviewLifecycleOwner,
} from "./reservationPreviewLifecycle";
import { loadAllManualInventoryBlocks, loadAllRoomInventory } from "../inventory/inventoryApi";
import { reservationAttentionReasons, reservationInventoryPresentation } from "../reservations/reservationOperationalView";
import {
  availabilityResponseMatchesSelection,
  availabilityUnitMatchesSelection,
  inventoryContextFromRooms,
  inventoryRoomsMatchProperty,
  inventoryDestinationHref,
  manualBlockListMatchesProperty,
  manualBlockMatchesSelection,
  mayOpenSpacesFromPreview,
  operationalInventoryContextMatchesSelection,
  propertySetupDestinationHref,
  reservationMatchesSelection,
  reservationDestinationHref,
  reservationListItemFromDetail,
  resolveUnitState,
} from "./operationalPreviewModel";
import {
  operationalOriginLabel,
  operationalOriginHref,
  operationalPreviewTriggerKey,
  type OperationalPreviewRoute,
} from "./operationalPreviewRoute";
import {
  OperationalPreviewContent,
  type OperationalPreviewAction,
  type OperationalPreviewContentModel,
} from "./OperationalPreviewContent";
import {
  useOperationalPreview,
  type OperationalInventoryContext,
  type OperationalPreviewSeed,
} from "./OperationalPreviewProvider";
import {
  combineOperationalPreviewSourceTones,
  operationalPreviewQueryTone,
  shouldShowOperationalPreviewRefresh,
} from "./operationalPreviewSourceState";

const PREVIEW_BREAKPOINT = "(max-width: 47.999rem)";

export function OperationalPreviewHost() {
  const {
    activeRoute,
    activeSeed,
    closePreview,
    discardPreview,
    findActiveTrigger,
    suppressNextFocusRestore,
  } = useOperationalPreview();
  const { request, session } = useSession();
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const completedFocusConsumed = useRef("");
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const boundRouteRef = useRef("");
  const refreshRunRef = useRef<Promise<unknown> | null>(null);
  const narrow = useMediaQuery(PREVIEW_BREAKPOINT);
  const [explicitRefreshPending, setExplicitRefreshPending] = useState(false);
  const [lifecycleOwner, setLifecycleOwner] = useState<ReservationPreviewLifecycleOwner | null>(null);
  const lifecycleRef = useRef<ReservationPreviewLifecycleOwner | null>(null);
  const lifecycleMounted = useRef(false);
  const lifecycleRun = useRef<Promise<void> | null>(null);
  const [dateClock, setDateClock] = useState(() => Date.now());
  const updateLifecycle = useCallback((owner: ReservationPreviewLifecycleOwner | null) => {
    lifecycleRef.current = owner;
    setLifecycleOwner(owner);
  }, []);
  const [wideStyle, setWideStyle] = useState<CSSProperties>({
    left: 16,
    top: 80,
    width: 352,
  });

  const propertyId = activeRoute?.selection.propertyId ?? "";
  const routeIdentity = activeRoute
    ? `${operationalPreviewTriggerKey(activeRoute)}:${propertyId}`
    : "";
  const propertyExists = Boolean(
    propertyId && workspace.properties.some((property) => property.propertyId === propertyId),
  );
  const propertyBound = Boolean(
    activeRoute && propertyExists && workspace.selectedPropertyId === propertyId,
  );

  useEffect(() => {
    if (!activeRoute) {
      boundRouteRef.current = "";
      return;
    }
    if (!workspace.propertiesLoaded) return;
    if (!propertyExists) {
      discardPreview();
      return;
    }
    if (boundRouteRef.current === routeIdentity) {
      if (workspace.selectedPropertyId !== propertyId) discardPreview();
      return;
    }
    if (workspace.selectedPropertyId === propertyId) {
      boundRouteRef.current = routeIdentity;
      return;
    }
    workspace.setSelectedPropertyId(propertyId);
  }, [
    activeRoute,
    discardPreview,
    propertyExists,
    propertyId,
    routeIdentity,
    workspace,
  ]);

  const accessScope = session && propertyId
    ? propertyAccessScope(session.tenantId, propertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.reservationsRead, scope: accessScope },
    { permission: permissions.reservationsCreate, scope: accessScope },
    { permission: permissions.inventoryRead, scope: accessScope },
    { permission: permissions.propertiesRead, scope: accessScope },
    { permission: permissions.reservationsCheckIn, scope: accessScope },
    { permission: permissions.reservationsCheckOut, scope: accessScope },
  ] : []);
  const permissionCurrent = access.hasData && !access.error;
  const canReadReservations = permissionCurrent
    && access.allows(permissions.reservationsRead, accessScope);
  const canReadInventory = permissionCurrent
    && access.allows(permissions.inventoryRead, accessScope);
  const canReadProperties = permissionCurrent
    && access.allows(permissions.propertiesRead, accessScope);

  const selection = activeRoute?.selection;
  const reservationId = selection?.kind === "reservation"
    ? selection.reservationId
    : "";
  const previewDate = selection?.date ?? "";
  const reservationQuery = useQuery({
    queryKey: ["operational-preview", session?.tenantId, propertyId, "reservation", reservationId],
    queryFn: ({ signal }) => request<Reservation>(
      `/api/reservations/properties/${propertyId}/${reservationId}`,
      { signal },
    ),
    enabled: Boolean(
      propertyBound && selection?.kind === "reservation" && canReadReservations,
    ),
    staleTime: 0,
    retry: false,
    networkMode: "always",
    refetchInterval: (query) => reservationNeedsLiveRefresh(query.state.data?.status) ? LIVE_DETAIL_REFRESH_INTERVAL_MS : false,
  });
  const inventoryQuery = useQuery({
    queryKey: ["operational-preview", session?.tenantId, propertyId, "inventory"],
    queryFn: ({ signal }) => loadAllRoomInventory(request, propertyId, signal),
    enabled: Boolean(propertyBound && selection && canReadInventory),
    staleTime: 0,
    retry: false,
    networkMode: "always",
  });
  const blocksQuery = useQuery({
    queryKey: ["operational-preview", session?.tenantId, propertyId, "blocks", selection?.kind, selection?.date],
    queryFn: ({ signal }) => loadAllManualInventoryBlocks(
      request,
      propertyId,
      true,
      signal,
      selection?.date
        ? { from: selection.date, to: shiftDate(selection.date, 1) }
        : undefined,
    ),
    enabled: Boolean(
      propertyBound
      && canReadInventory
      && selection?.kind === "inventoryBlock",
    ),
    staleTime: 0,
    retry: false,
    networkMode: "always",
  });
  const availabilityQuery = useQuery({
    queryKey: ["operational-preview", session?.tenantId, propertyId, "availability", selection?.date],
    queryFn: ({ signal }) => request<InventoryAvailabilityResponse>(
      `/api/inventory/properties/${propertyId}/availability?arrival=${previewDate}&departure=${shiftDate(previewDate, 1)}`,
      { signal },
    ),
    enabled: Boolean(
      propertyBound && canReadInventory && selection?.kind === "inventoryUnit",
    ),
    staleTime: 0,
    retry: false,
    networkMode: "always",
  });

  const inventorySourceTone = operationalPreviewQueryTone(
    inventoryQuery.data,
    inventoryQuery.isFetching,
    inventoryQuery.error,
    inventoryQuery.isPaused,
  );
  const reservationSourceTone = operationalPreviewQueryTone(
    reservationQuery.data,
    reservationQuery.isFetching,
    reservationQuery.error,
    reservationQuery.isPaused,
  );
  const blockSourceTone = operationalPreviewQueryTone(
    blocksQuery.data,
    blocksQuery.isFetching,
    blocksQuery.error,
    blocksQuery.isPaused,
  );
  const unitSourceTone = combineOperationalPreviewSourceTones(
    operationalPreviewQueryTone(
      availabilityQuery.data,
      availabilityQuery.isFetching,
      availabilityQuery.error,
      availabilityQuery.isPaused,
    ),
    activeSeed?.inventory ? undefined : inventorySourceTone,
  );

  const data = useMemo(() => resolvePreviewData(
    activeRoute,
    activeSeed,
    reservationQuery.data,
    inventoryQuery.data,
    blocksQuery.data?.blocks,
    availabilityQuery.data,
    {
      reservation: reservationSourceTone,
      inventoryBlock: blockSourceTone,
      inventoryUnit: unitSourceTone,
    },
    propertyBound && canReadInventory && inventorySourceTone === "current",
  ), [
    activeRoute,
    activeSeed,
    availabilityQuery.data,
    blockSourceTone,
    blocksQuery.data?.blocks,
    blocksQuery.data,
    inventoryQuery.data,
    propertyBound,
    canReadInventory,
    inventorySourceTone,
    reservationQuery.data,
    reservationSourceTone,
    unitSourceTone,
  ]);
  const requiredPermissionAllowed = selection?.kind === "reservation"
    ? canReadReservations
    : canReadInventory;
  const accessDenied = permissionCurrent && !requiredPermissionAllowed;
  const directLoading = Boolean(
    activeRoute
    && permissionCurrent
    && requiredPermissionAllowed
    && !data.model
    && (reservationQuery.isLoading || inventoryQuery.isLoading || blocksQuery.isLoading),
  );
  const refreshPending = explicitRefreshPending;
  const hasRelevantRefreshFailure = Boolean(
    selection?.kind === "reservation"
      ? reservationQuery.error || reservationQuery.isPaused
      : selection?.kind === "inventoryBlock"
        ? blocksQuery.error || blocksQuery.isPaused
        : selection?.kind === "inventoryUnit"
          ? availabilityQuery.error
            || availabilityQuery.isPaused
            || (!activeSeed?.inventory && (inventoryQuery.error || inventoryQuery.isPaused))
          : false,
  );
  const model = activeRoute
    ? accessDenied
      ? unavailableModel("Access changed", "Current access no longer allows this preview.")
      : !permissionCurrent
        ? unavailableModel("Checking current access", "The preview will open after current property access is confirmed.")
        : directLoading
          ? unavailableModel("Loading current details", "Fetching the latest operational context.")
          : data.contextMismatch
            ? unavailableModel("Source context changed", "Current source data did not match the selected property or item, so no details or navigation actions are shown.")
            : data.model ?? unavailableModel("Details unavailable", "The selected item is no longer available in the current property data.")
    : null;
  const enrichedRoute = activeRoute && data.inventory
    ? routeWithInventoryContext(activeRoute, data.inventory)
    : activeRoute;
  const selectedEntityConfirmedMissing = Boolean(
    selection?.kind === "reservation"
    && reservationQuery.error instanceof ApiError
    && reservationQuery.error.status === 404,
  );
  const actions = enrichedRoute
    && data.model
    && !selectedEntityConfirmedMissing
    && !accessDenied
    && permissionCurrent
    ? previewActions(
        enrichedRoute,
        canReadReservations,
        canReadInventory,
        canReadProperties,
      )
    : [];

  // The memory-only recovery coordinate belongs to actual authority, not the
  // selected Calendar date or a route which browser Back can replace.
  const lifecycleIdentity = JSON.stringify([
    reservationEditorIdentity(session, workspace.selectedPropertyId),
    workspace.selectedWorkspaceId,
  ]);
  const propertyCurrent = Boolean(propertyBound && workspace.propertiesLoaded
    && !workspace.propertiesFetching && !workspace.propertiesError
    && workspace.workspacesLoaded && !workspace.workspacesFetching && !workspace.workspacesError
    && session?.tenantId === workspace.selectedWorkspaceId);
  const timeZoneId = propertyCurrent ? workspace.selectedProperty?.timeZoneId ?? "" : "";
  const propertyToday = timeZoneId ? propertyDateKey(timeZoneId, new Date(dateClock)) : null;
  const lifecycleReadAllowed = Boolean(propertyCurrent && canReadReservations && reservationId);
  const lifecycleRecordCurrent = Boolean(lifecycleReadAllowed && !data.contextMismatch
    && selection?.kind === "reservation" && reservationQuery.data
    && reservationMatchesSelection(reservationQuery.data, selection)
    && !reservationQuery.isFetching && !reservationQuery.isPaused && !reservationQuery.error);
  const attention = permissionCurrent && !access.isLoading && !access.isFetching && lifecycleRecordCurrent && reservationQuery.data
    ? reservationAttentionReasons(reservationQuery.data, propertyToday) : [];
  const finalModel = model ? { ...model, actions, attention, attentionOperatingDate: attention.length ? propertyToday : null } : null;
  const canCheckIn = permissionCurrent && access.allows(permissions.reservationsCheckIn, accessScope);
  const canCheckOut = permissionCurrent && access.allows(permissions.reservationsCheckOut, accessScope);
  const completedHref = activeRoute && lifecycleRecordCurrent && !access.isLoading && !access.isFetching
    && access.allows(permissions.reservationsCreate, accessScope)
    && completedReservationSeed(reservationQuery.data, propertyId, reservationId)
    ? completedReservationCreateHref(activeRoute) : null;
  const completedReturn = (location.state as { completedCreateReturn?: { identity?: string; propertyId?: string; reservationId?: string; href?: string } } | null)?.completedCreateReturn;
  const completedReturnMatches = Boolean(completedReturn
    && completedReturn.identity === reservationEditorIdentity(session, propertyId)
    && completedReturn.propertyId === propertyId && completedReturn.reservationId === reservationId
    && completedReturn.href === `${location.pathname}${location.search}`);
  useEffect(() => {
    if (!completedReturnMatches) return;
    const cancel = () => { completedFocusConsumed.current = location.key; };
    const moved = (event: FocusEvent) => { if (event.target !== document.body && event.target !== panelRef.current) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Tab") cancel(); };
    document.addEventListener("focusin", moved); document.addEventListener("pointerdown", cancel); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("focusin", moved); document.removeEventListener("pointerdown", cancel); document.removeEventListener("keydown", key); };
  }, [completedReturnMatches, location.key]);
  useLayoutEffect(() => {
    if (!completedReturnMatches || !completedHref || lifecycleOwner || completedFocusConsumed.current === location.key) return;
    const target = panelRef.current?.querySelector<HTMLAnchorElement>("[data-completed-create-action]");
    if (!target?.isConnected || target.getClientRects().length === 0 || getComputedStyle(target).visibility !== "visible"
      || target.closest('[hidden], [inert], [aria-hidden="true"]')
      || (document.activeElement !== document.body && document.activeElement !== panelRef.current)) return;
    completedFocusConsumed.current = location.key;
    target.focus({ preventScroll: true });
  }, [completedReturnMatches, completedHref, lifecycleOwner, location.key]);
  const quickAction = reservationPreviewQuickAction(reservationQuery.data, {
    current: lifecycleRecordCurrent, propertyToday, canCheckIn, canCheckOut,
  });
  const visibleLifecycleOwner = lifecycleOwner?.identity === lifecycleIdentity
    && lifecycleOwner.intent.propertyId === propertyId && lifecycleOwner.intent.reservationId === reservationId
    && lifecycleReadAllowed && !data.contextMismatch ? lifecycleOwner : null;
  const pendingCatalogueRefresh = Boolean(lifecycleOwner?.identity === lifecycleIdentity
    && lifecycleOwner.intent.propertyId === propertyId && lifecycleOwner.intent.reservationId === reservationId
    && reservationPreviewNavigationPending(lifecycleOwner) && propertyExists && canReadReservations
    && !workspace.propertiesError && !workspace.workspacesError
    && (workspace.propertiesFetching || workspace.workspacesFetching));
  const lifecycleBusy = reservationPreviewNavigationPending(visibleLifecycleOwner) || pendingCatalogueRefresh;
  const lifecycleAuthority = {
    identity: lifecycleIdentity, reservationId, propertyId, selection,
    readAllowed: lifecycleReadAllowed, current: lifecycleRecordCurrent,
    navigationPending: lifecycleBusy,
    timeZoneId, canCheckIn, canCheckOut, record: reservationQuery.data,
    tenantId: session?.tenantId ?? "",
  };
  const lifecycleLatest = useRef(lifecycleAuthority);
  useLayoutEffect(() => { lifecycleLatest.current = lifecycleAuthority; });
  useLayoutEffect(() => {
    lifecycleMounted.current = true;
    return () => { lifecycleMounted.current = false; lifecycleRef.current = null; };
  }, []);
  useLayoutEffect(() => {
    const owner = lifecycleRef.current;
    if (owner && (owner.identity !== lifecycleIdentity
      || (workspace.propertiesLoaded && !workspace.propertiesFetching && !workspace.propertiesError
        && !workspace.properties.some(property => property.propertyId === owner.intent.propertyId)))) {
      updateLifecycle(null);
      lifecycleRun.current = null;
    } else if (owner && owner.intent.reservationId !== reservationId
      && (!owner.attempt || ["success", "rejected", "changed"].includes(owner.phase))) {
      updateLifecycle(null);
    }
  }, [lifecycleIdentity, reservationId, updateLifecycle, workspace.properties, workspace.propertiesError, workspace.propertiesFetching, workspace.propertiesLoaded]);
  useEffect(() => {
    if (!activeRoute) return;
    const update = () => setDateClock(Date.now());
    update();
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [Boolean(activeRoute)]);

  const ownerMatches = (owner: ReservationPreviewLifecycleOwner) => {
    const live = lifecycleLatest.current;
    return lifecycleMounted.current && lifecycleRef.current?.attempt === owner.attempt
      && lifecycleRef.current?.intent === owner.intent
      && lifecycleRef.current?.identity === owner.identity && live.identity === owner.identity
      && live.propertyId === owner.intent.propertyId && live.reservationId === owner.intent.reservationId;
  };
  const invalidateLifecycle = (owner: ReservationPreviewLifecycleOwner) => {
    if (!ownerMatches(owner) || !lifecycleLatest.current.readAllowed) return;
    for (const filter of reservationPreviewInvalidations(lifecycleLatest.current.tenantId, owner.intent.propertyId, owner.intent.reservationId)) {
      void queryClient.invalidateQueries(filter, { cancelRefetch: false });
    }
  };
  const settleReadback = async (owner: ReservationPreviewLifecycleOwner) => {
    const result = await reservationQuery.refetch({ cancelRefetch: false });
    if (!ownerMatches(owner) || !lifecycleLatest.current.readAllowed) return;
    const live = lifecycleLatest.current;
    const matched = !result.error && !result.isPaused && result.data && live.selection?.kind === "reservation"
      && reservationMatchesSelection(result.data, live.selection);
    const retained = lifecycleRef.current!;
    const phase = matched && owner.attempt ? reservationPreviewReadback(owner.attempt, result.data!, retained.acknowledged, retained.receiptVersion ?? 0, retained.pendingVersion ?? 0) : "unknown";
    updateLifecycle({ ...retained, phase, readAfter: result.dataUpdatedAt, pendingVersion: phase === "pending" ? result.data!.version : retained.pendingVersion });
    if (phase === "success" || phase === "rejected") invalidateLifecycle(owner);
  };
  const finishDetachedRun = (owner: ReservationPreviewLifecycleOwner) => {
    const retained = lifecycleRef.current;
    if (lifecycleMounted.current && retained?.attempt === owner.attempt && retained?.identity === owner.identity
      && ["sending", "checking"].includes(retained.phase)) updateLifecycle({ ...retained, phase: "unknown" });
  };
  const runLifecycle = (retry: boolean) => {
    const owner = lifecycleRef.current, live = lifecycleLatest.current;
    if (!owner || owner.intent !== lifecycleOwner?.intent || lifecycleRun.current || !ownerMatches(owner) || !live.current || !live.record) return;
    const permitted = owner.intent.action === "check-in" ? live.canCheckIn : live.canCheckOut;
    if (!permitted) return;
    if (!retry) {
      const today = live.timeZoneId ? propertyDateKey(live.timeZoneId) : null;
      const action = reservationPreviewQuickAction(live.record, { current: live.current, propertyToday: today, canCheckIn: live.canCheckIn, canCheckOut: live.canCheckOut });
      if (owner.phase !== "confirm" || owner.intent.expectedVersion !== live.record.version
        || owner.intent.businessDate !== today || owner.intent.action !== action) {
        updateLifecycle({ ...owner, phase: "changed" });
        return;
      }
    } else if (owner.phase !== "unknown" || !owner.attempt) return;
    const attempt = retry ? owner.attempt! : resolveReservationLifecycleAttempt(null, owner.intent);
    const sent = { ...owner, attempt, phase: "sending" as const, readAfter: Date.now() };
    updateLifecycle(sent);
    const run = Promise.resolve().then(async () => {
      try {
        const current = lifecycleLatest.current;
        if (!ownerMatches(sent)) return;
        if (!current.current || !(sent.intent.action === "check-in" ? current.canCheckIn : current.canCheckOut)) {
          updateLifecycle({ ...sent, phase: retry ? "unknown" : "changed", attempt: retry ? attempt : null });
          return;
        }
        const payload = attempt.payload;
        const receipt = await request<ReservationMutationReceipt>(`/api/reservations/properties/${payload.propertyId}/${payload.reservationId}/${payload.action}`, {
          method: "POST", body: JSON.stringify({ operationId: attempt.operationId, businessDate: payload.businessDate, expectedVersion: payload.expectedVersion }),
        });
        if (!ownerMatches(sent) || !lifecycleLatest.current.readAllowed) return;
        if (!reservationPreviewReceiptMatches(receipt, attempt)) throw new Error("Unconfirmed lifecycle receipt");
        updateLifecycle({ ...lifecycleRef.current!, phase: "checking", acknowledged: true, receiptVersion: receipt.version,
          pendingVersion: reservationStatusKey(receipt.status) === "checkoutPending" ? receipt.version : lifecycleRef.current!.pendingVersion });
        invalidateLifecycle(sent);
        await settleReadback(sent);
      } catch {
        if (ownerMatches(sent)) updateLifecycle({ ...lifecycleRef.current!, phase: "unknown" });
      } finally {
        finishDetachedRun(sent);
        if (lifecycleRun.current === run) lifecycleRun.current = null;
      }
    });
    lifecycleRun.current = run;
  };
  const checkLifecycle = () => {
    const owner = lifecycleRef.current;
    if (!owner?.attempt || owner.intent !== lifecycleOwner?.intent || lifecycleRun.current || !ownerMatches(owner) || !lifecycleLatest.current.readAllowed) return;
    updateLifecycle({ ...owner, phase: "checking" });
    const run = settleReadback(owner).catch(() => {
      if (ownerMatches(owner)) updateLifecycle({ ...lifecycleRef.current!, phase: "unknown" });
    }).finally(() => { finishDetachedRun(owner); if (lifecycleRun.current === run) lifecycleRun.current = null; });
    lifecycleRun.current = run;
  };
  useEffect(() => {
    const owner = lifecycleRef.current;
    if (!owner?.attempt || owner.phase !== "pending" || !ownerMatches(owner)) return;
    if (reservationQuery.error || reservationQuery.isPaused) { updateLifecycle({ ...owner, phase: "unknown" }); return; }
    if (!lifecycleRecordCurrent || !reservationQuery.data || reservationQuery.dataUpdatedAt <= owner.readAfter) return;
    const phase = reservationPreviewReadback(owner.attempt, reservationQuery.data, owner.acknowledged, owner.receiptVersion ?? 0, owner.pendingVersion ?? 0);
    updateLifecycle({ ...owner, phase, readAfter: reservationQuery.dataUpdatedAt, pendingVersion: phase === "pending" ? reservationQuery.data.version : owner.pendingVersion });
    if (phase === "success" || phase === "rejected") invalidateLifecycle(owner);
  }, [lifecycleRecordCurrent, reservationQuery.dataUpdatedAt, reservationQuery.error, reservationQuery.isPaused]);
  useEffect(() => {
    const owner = lifecycleRef.current;
    if (owner?.phase === "confirm" && ownerMatches(owner) && lifecycleRecordCurrent
      && (owner.intent.expectedVersion !== reservationQuery.data?.version || owner.intent.businessDate !== propertyToday
        || (quickAction !== owner.intent.action && (owner.intent.action === "check-in" ? canCheckIn : canCheckOut)))) {
      updateLifecycle({ ...owner, phase: "changed" });
    }
  }, [lifecycleRecordCurrent, reservationQuery.data?.version, propertyToday, quickAction, canCheckIn, canCheckOut]);

  const guardPreviewNavigation = useCallback((destination: string) => {
    const owner = lifecycleRef.current, live = lifecycleLatest.current;
    if (live.navigationPending && owner && owner.identity === live.identity
      && owner.intent.propertyId === live.propertyId && owner.intent.reservationId === live.reservationId
      && reservationPreviewNavigationPending(owner)) {
      updateLifecycle({ ...owner, deferred: destination });
      return false;
    }
    if (owner?.phase === "confirm") updateLifecycle(null);
    if (destination === "close") closePreview();
    else suppressNextFocusRestore();
    return true;
  }, [closePreview, suppressNextFocusRestore, updateLifecycle]);
  const guardedClose = useCallback(() => { guardPreviewNavigation("close"); }, [guardPreviewNavigation]);
  const beginLifecycle = () => {
    const live = lifecycleLatest.current;
    if (!activeRoute || live.identity !== lifecycleIdentity || live.reservationId !== reservationId || live.propertyId !== propertyId
      || lifecycleRef.current || !live.current || !live.record) return;
    const today = live.timeZoneId ? propertyDateKey(live.timeZoneId) : null;
    const action = reservationPreviewQuickAction(live.record, { current: live.current, propertyToday: today, canCheckIn: live.canCheckIn, canCheckOut: live.canCheckOut });
    if (!action || !today) return;
    updateLifecycle({ identity: live.identity, returnHref: operationalOriginHref(activeRoute), intent: { propertyId: live.propertyId, reservationId: live.reservationId, action, businessDate: today, expectedVersion: live.record.version }, attempt: null, phase: "confirm", acknowledged: false, receiptVersion: null, pendingVersion: null, readAfter: 0, deferred: null });
  };
  const reservationCommand = pendingCatalogueRefresh ? (
    <p className="mt-3 text-sm font-normal leading-5" role="status" data-reservation-request-pending="true">A reservation request is still pending. Refreshing workspace details; actions remain unavailable until current details return.</p>
  ) : visibleLifecycleOwner || (!lifecycleOwner && quickAction) ? (
    <ReservationPreviewLifecycleAction
      key={`${lifecycleIdentity}:${reservationId}`}
      action={quickAction} owner={visibleLifecycleOwner} current={lifecycleRecordCurrent && (visibleLifecycleOwner?.intent.action === "check-in" ? canCheckIn : visibleLifecycleOwner?.intent.action === "check-out" ? canCheckOut : Boolean(quickAction))}
      readAllowed={lifecycleReadAllowed}
      recoveryAllowed={lifecycleRecordCurrent && Boolean(visibleLifecycleOwner?.intent.action === "check-in" ? canCheckIn : canCheckOut)}
      stayLabel={reservationQuery.data?.primaryGuestName ?? "this stay"}
      onBegin={beginLifecycle} onConfirm={() => runLifecycle(false)} onRetry={() => runLifecycle(true)} onCheck={checkLifecycle}
      onCancel={() => {
        const owner = visibleLifecycleOwner;
        if (!owner || !ownerMatches(owner) || reservationPreviewNavigationPending(lifecycleRef.current)) return;
        const focusedElement = document.activeElement;
        const restoreClose = !quickAction && ["confirm", "success", "rejected", "changed"].includes(owner.phase)
          && panelRef.current?.querySelector("[data-reservation-preview-lifecycle]")?.contains(focusedElement);
        updateLifecycle(null);
        if (restoreClose) window.requestAnimationFrame(() => {
          const live = lifecycleLatest.current;
          if (!lifecycleMounted.current || lifecycleRef.current || !live.readAllowed
            || live.identity !== owner.identity || live.propertyId !== owner.intent.propertyId
            || live.reservationId !== owner.intent.reservationId || boundRouteRef.current !== routeIdentity
            || (document.activeElement !== document.body && document.activeElement !== focusedElement)) return;
          panelRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Close operational preview"]')?.focus({ preventScroll: true });
        });
      }}
      onContinue={() => {
        const owner = lifecycleRef.current;
        if (!owner || !ownerMatches(owner) || !["success", "rejected", "changed"].includes(owner.phase)) return;
        const destination = owner.deferred;
        if (destination === "close") { updateLifecycle(null); closePreview(); }
        else if (destination && actions.some(action => action.href === destination)) {
          updateLifecycle(null); suppressNextFocusRestore(); void navigate(destination);
        }
      }}
    />
  ) : lifecycleOwner?.identity === lifecycleIdentity && lifecycleOwner.intent.propertyId === propertyId && lifecycleReadAllowed && !visibleLifecycleOwner ? (
    <div className="mt-3 text-xs font-normal leading-5 text-base-content/70">
      <p>Another preview request still needs its result checked before starting a new action.</p>
      <button type="button" className="btn btn-outline btn-sm mt-2 min-h-11" onClick={() => {
        const owner = lifecycleRef.current, live = lifecycleLatest.current;
        if (owner?.intent !== lifecycleOwner.intent || owner.identity !== live.identity || owner.intent.propertyId !== live.propertyId || !live.readAllowed) return;
        suppressNextFocusRestore(); void navigate(owner.returnHref);
      }}>Review previous request</button>
    </div>
  ) : completedHref ? (
    <span className="mt-3 block text-sm font-normal leading-5" data-completed-create>
      <Link className="btn btn-primary mt-1 min-h-11 max-w-full whitespace-normal" data-completed-create-action
        to={completedHref} onClick={event => { if (!guardPreviewNavigation(completedHref)) event.preventDefault(); }}>Extend as new reservation</Link>
      <span className="mt-2 block text-base-content/70">Start a separate stay with editable dates and spaces. This completed reservation is unchanged.</span>
    </span>
  ) : undefined;

  const refresh = useCallback(() => {
    if (refreshRunRef.current) return;
    const refreshIdentity = routeIdentity;
    let refreshes: Array<Promise<unknown>> = [];
    if (!permissionCurrent && access.error) {
      refreshes = [access.refetch()];
    } else if (selection?.kind === "reservation") {
      refreshes = [reservationQuery.refetch({ cancelRefetch: false })];
    } else if (selection?.kind === "inventoryBlock") {
      refreshes = [blocksQuery.refetch({ cancelRefetch: false })];
    } else if (selection?.kind === "inventoryUnit") {
      refreshes = [availabilityQuery.refetch({ cancelRefetch: false })];
      if (!activeSeed?.inventory) {
        refreshes.push(inventoryQuery.refetch({ cancelRefetch: false }));
      }
    }
    if (refreshes.length === 0) return;

    setExplicitRefreshPending(true);
    const run = Promise.allSettled(refreshes).finally(() => {
      if (refreshRunRef.current !== run) return;
      refreshRunRef.current = null;
      setExplicitRefreshPending(false);
      if (boundRouteRef.current !== refreshIdentity) return;
      window.requestAnimationFrame(() => {
        const retry = panelRef.current?.querySelector<HTMLButtonElement>(
          '[data-operational-preview-refresh="true"]:not(:disabled)',
        );
        (retry ?? panelRef.current)?.focus({ preventScroll: true });
      });
    });
    refreshRunRef.current = run;
  }, [
    access,
    activeSeed?.inventory,
    availabilityQuery,
    blocksQuery,
    inventoryQuery,
    permissionCurrent,
    reservationQuery,
    routeIdentity,
    selection?.kind,
  ]);

  const positionWidePanel = useCallback(() => {
    if (!activeRoute || narrow || !panelRef.current) return;
    const trigger = findActiveTrigger();
    const panelRect = panelRef.current.getBoundingClientRect();
    const width = Math.min(368, Math.max(328, panelRect.width || 352));
    const height = Math.min(window.innerHeight - 32, panelRect.height || 440);
    const protectedRects = [
      trigger?.getBoundingClientRect(),
      activeRoute.origin.surface === "calendar"
        ? document.querySelector<HTMLElement>(`[data-calendar-day-header="${activeRoute.origin.day}"]`)?.getBoundingClientRect()
        : undefined,
      activeRoute.selection.inventoryUnitId
        ? document.querySelector<HTMLElement>(`[data-calendar-row-label="${activeRoute.selection.inventoryUnitId}"]`)?.getBoundingClientRect()
        : undefined,
    ].filter((rect): rect is DOMRect => Boolean(rect));
    setWideStyle(bestInspectorPosition(trigger?.getBoundingClientRect(), protectedRects, width, height));
  }, [activeRoute, findActiveTrigger, narrow]);

  useLayoutEffect(() => {
    if (!activeRoute || narrow) return;
    positionWidePanel();
    const resizeObserver = new ResizeObserver(positionWidePanel);
    if (panelRef.current) resizeObserver.observe(panelRef.current);
    window.addEventListener("resize", positionWidePanel);
    window.addEventListener("scroll", positionWidePanel, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", positionWidePanel);
      window.removeEventListener("scroll", positionWidePanel, true);
    };
  }, [activeRoute, narrow, positionWidePanel]);

  useEffect(() => {
    if (!activeRoute || !panelRef.current) return;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    if (narrow) document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      if (completedFocusConsumed.current === location.key && panel.querySelector("[data-completed-create-action]") === document.activeElement) return;
      panel.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        guardedClose();
        return;
      }
      if (!narrow || event.key !== "Tab") return;
      trapFocus(panel, event);
    }

    function handlePointerDown(event: PointerEvent) {
      if (narrow || !(event.target instanceof Node)) return;
      if (panel.contains(event.target) || findActiveTrigger()?.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      guardedClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      if (narrow) document.body.style.overflow = previousOverflow;
    };
  }, [activeRoute, guardedClose, findActiveTrigger, narrow, location.key]);

  if (!activeRoute || !finalModel) return null;

  const content = (
    <OperationalPreviewContent
      headingId={headingId}
      model={finalModel}
      originLabel={originContextLabel(activeRoute)}
      refreshLabel={!permissionCurrent ? "Retry access check" : "Refresh current state"}
      refreshPending={refreshPending}
      showRefresh={!accessDenied && (
        !permissionCurrent
          ? Boolean(access.error)
          : shouldShowOperationalPreviewRefresh({
              hasRecoveryFailure: hasRelevantRefreshFailure,
              explicitRefreshPending,
            })
      )}
      reservationCommand={reservationCommand}
      navigationPending={lifecycleBusy}
      onClose={guardedClose}
      onNavigate={guardPreviewNavigation}
      onRefresh={refresh}
    />
  );

  return createPortal(
    narrow ? (
      <div className="fixed inset-0 z-[90] flex items-end" data-operational-preview-mode="sheet">
        <button
          type="button"
          className="absolute inset-0 cursor-default bg-neutral/35 backdrop-blur-[1px]"
          aria-label="Close operational preview"
          aria-disabled={lifecycleBusy}
          onClick={guardedClose}
        />
        <section
          ref={panelRef}
          id="operational-preview"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="relative z-10 flex max-h-[calc(100dvh-4rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-b-0 border-base-300 bg-base-100 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <span className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-base-content/20" aria-hidden="true" />
          {content}
        </section>
      </div>
    ) : (
      <section
        ref={panelRef}
        id="operational-preview"
        tabIndex={-1}
        role="region"
        aria-labelledby={headingId}
        data-operational-preview-mode="inspector"
        className="fixed z-[70] flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-[0_20px_60px_-20px_rgba(13,35,29,0.42)] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={wideStyle}
      >
        {content}
      </section>
    ),
    document.body,
  );
}

function resolvePreviewData(
  route: OperationalPreviewRoute | null,
  seed: OperationalPreviewSeed | null,
  reservationDetail: Reservation | undefined,
  inventoryResponse: RoomInventoryListResponse | undefined,
  blocks: ManualBlock[] | undefined,
  availabilityResponse: InventoryAvailabilityResponse | undefined,
  sourceTones: {
    reservation: OperationalPreviewContentModel["sourceTone"];
    inventoryBlock: OperationalPreviewContentModel["sourceTone"];
    inventoryUnit: OperationalPreviewContentModel["sourceTone"];
  },
  inventoryLabelsCurrent: boolean,
): { model: OperationalPreviewContentModel | null; inventory?: OperationalInventoryContext; contextMismatch?: boolean } {
  if (!route) return { model: null };
  const rooms = inventoryResponse?.rooms ?? [];
  const selection = route.selection;
  if (inventoryResponse && !inventoryRoomsMatchProperty(rooms, selection.propertyId)) {
    return { model: null, contextMismatch: true };
  }
  const seedInventory = seed?.kind === selection.kind ? seed.inventory : undefined;
  const inventory = inventoryResponse
    ? inventoryContextFromRooms(rooms, selection.inventoryUnitId, selection)
    : seedInventory;
  if (inventory && !operationalInventoryContextMatchesSelection(inventory, selection)) {
    return { model: null, contextMismatch: true };
  }

  if (selection.kind === "reservation") {
    const seedReservation = seed?.kind === "reservation" ? seed.reservation : undefined;
    if (reservationDetail && !reservationMatchesSelection(reservationDetail, selection)) {
      return { model: null, contextMismatch: true };
    }
    if (!reservationDetail && seedReservation && !reservationMatchesSelection(seedReservation, selection)) {
      return { model: null, contextMismatch: true };
    }
    const reservation = reservationDetail
      ? reservationListItemFromDetail(reservationDetail)
      : seedReservation;
    if (!reservation) return { model: null, inventory };
    const completedLabels = reservationStatusKey(reservation.status) === "checkedOut"
      ? inventoryLabelsCurrent ? reservation.inventoryUnitIds.map(id => {
        const context = inventoryContextFromRooms(rooms, id);
        return context ? `${context.roomName} · ${context.unitLabel}` : "Recorded space label unavailable";
      }).join("; ") || "Recorded space label unavailable"
        : "Recorded space labels unconfirmed"
      : undefined;
    return {
      inventory,
      model: reservationModel(reservation, inventory, sourceTones.reservation, reservationDetail?.checkedOutBusinessDate, completedLabels),
    };
  }

  if (selection.kind === "inventoryBlock") {
    const seedBlock = seed?.kind === "inventoryBlock" ? seed.block : undefined;
    if (blocks && !manualBlockListMatchesProperty(blocks, selection.propertyId)) {
      return { model: null, contextMismatch: true };
    }
    const liveBlock = selection.blockId
      ? blocks?.find((candidate) => (
          candidate.blockGroupId === selection.blockGroupId
          && candidate.blockId === selection.blockId
        ))
      : blocks?.find((candidate) => candidate.blockGroupId === selection.blockGroupId);
    const block = blocks ? liveBlock : seedBlock;
    if (block && !manualBlockMatchesSelection(block, selection)) {
      return { model: null, contextMismatch: true };
    }
    if (!block) return { model: null, inventory };
    return {
      inventory,
      model: blockModel(block, inventory, sourceTones.inventoryBlock),
    };
  }

  if (availabilityResponse && !availabilityResponseMatchesSelection(availabilityResponse, selection)) {
    return { model: null, contextMismatch: true };
  }
  const unit = rooms.flatMap((room) => room.units)
    .find((candidate) => (
      candidate.inventoryUnitId === selection.inventoryUnitId
      && candidate.propertyId === selection.propertyId
      && candidate.roomId === selection.roomId
      && (selection.bedId ? candidate.bedId === selection.bedId : !candidate.bedId)
    ));
  const availability = availabilityResponse?.units.find((item) =>
    item.unit.inventoryUnitId === selection.inventoryUnitId);
  if (availability && !availabilityUnitMatchesSelection(availability, selection)) {
    return { model: null, contextMismatch: true };
  }
  if (availabilityResponse && !availability) return { model: null, inventory };
  const state = resolveUnitState(
        unit,
        availability,
        sourceTones.inventoryUnit === "current" && Boolean(availabilityResponse),
        selection.observedState,
      );
  const unitInventory = inventoryResponse
    ? inventory
    : inventory ?? (seed?.kind === "inventoryUnit" ? seed.inventory : undefined);
  if (!unitInventory) return { model: null };
  return {
    inventory: unitInventory,
    model: unitModel(
      unitInventory,
      selection.date,
      state,
      sourceTones.inventoryUnit,
    ),
  };
}

export function reservationModel(
  reservation: ReservationListItem,
  inventory: OperationalInventoryContext | undefined,
  sourceTone: OperationalPreviewContentModel["sourceTone"],
  checkedOutBusinessDate?: string | null,
  completedLabels?: string,
): OperationalPreviewContentModel {
  const inventoryState = reservationInventoryPresentation(reservation);
  const completed = reservationStatusKey(reservation.status) === "checkedOut";
  const checkout = completed && sourceTone === "current" && parseDateKey(checkedOutBusinessDate ?? "")
    ? checkedOutBusinessDate : null;
  return {
    kindLabel: completed ? "Completed booking" : "Reservation",
    title: reservation.primaryGuestName,
    status: reservationStatusLabel(reservation.status),
    icon: UserRound,
    iconTone: "bg-secondary/12 text-secondary",
    summary: `${reservation.guestCount} ${reservation.guestCount === 1 ? "guest" : "guests"}`,
    details: [
      { label: completed ? "Scheduled dates" : "Stay", value: `${formatDate(reservation.arrival)} to ${formatDate(reservation.departure)}` },
      ...(checkout ? [{ label: "Actual checkout", value: formatDate(checkout) }] : []),
      { label: "Inventory status", value: inventoryState.summary },
      {
        label: inventoryState.contextLabel,
        value: completed
          ? completedLabels ?? (inventory ? `${inventory.roomName} · ${inventory.unitLabel}` : "Recorded space labels unconfirmed")
          : inventory
          ? `${inventory.roomName} · ${inventory.unitLabel}`
          : reservation.inventoryUnitCount > 0
            ? `${reservation.inventoryUnitCount} ${reservation.inventoryUnitCount === 1 ? "unit" : "units"}; labels delayed`
            : "Inventory needs review",
      },
      { label: "Source", value: reservationSourceLabel(reservation.sourceKind) },
    ],
    sourceMessage: sourceMessage(sourceTone, "reservation"),
    sourceTone,
    actions: [],
  };
}

export function blockModel(
  block: ManualBlock,
  inventory: OperationalInventoryContext | undefined,
  sourceTone: OperationalPreviewContentModel["sourceTone"],
): OperationalPreviewContentModel {
  const status = manualBlockStatusLabel(block.status);
  return {
    kindLabel: "Inventory block",
    title: block.reason,
    status,
    icon: Blocks,
    iconTone: "bg-warning/18 text-warning-content",
    summary: status === "released" ? "Manual hold released"
      : status === "active" ? "Space held for these dates" : "Block status unconfirmed",
    details: [
      { label: "Blocked dates", value: `${formatDate(block.arrival)} to ${formatDate(block.departure)}` },
      { label: "Room or bed", value: inventory ? `${inventory.roomName} · ${inventory.unitLabel}` : "Inventory label delayed" },
      { label: "Reason", value: block.reason },
    ],
    sourceMessage: sourceMessage(sourceTone, "inventory block"),
    sourceTone,
    actions: [],
  };
}

function unitModel(
  inventory: OperationalInventoryContext,
  date: string,
  state: ReturnType<typeof resolveUnitState>,
  sourceTone: OperationalPreviewContentModel["sourceTone"],
): OperationalPreviewContentModel {
  const icon = state.state === "available"
    ? DoorOpen
    : state.state === "blocked"
      ? Blocks
      : state.state === "occupied"
        ? UserRound
        : state.state === "unknown"
          ? CircleDashed
          : BedDouble;
  return {
    kindLabel: "Room or bed",
    title: inventory.unitLabel,
    status: unitStateLabel(state.state),
    icon,
    iconTone: unitStateTone(state.state),
    summary: state.explanation,
    details: [
      { label: "Date", value: formatDate(date) },
      { label: "Room", value: inventory.roomName },
      { label: "Space", value: `${inventory.unitLabel} · ${inventory.unitDetail}` },
    ],
    sourceMessage: sourceMessage(sourceTone, "availability"),
    sourceTone,
    actions: [],
  };
}

function unavailableModel(title: string, message: string): OperationalPreviewContentModel {
  return {
    kindLabel: "Operational preview",
    title,
    status: title.includes("Access") ? "Restricted" : "Unknown",
    icon: title.includes("Access") ? ShieldX : CircleDashed,
    iconTone: title.includes("Access") ? "bg-error/9 text-error" : "bg-base-200 text-base-content/55",
    summary: message,
    details: [],
    sourceMessage: "No private details are shown until current property evidence is available.",
    sourceTone: "delayed",
    actions: [],
  };
}

function previewActions(
  route: OperationalPreviewRoute,
  canReadReservations: boolean,
  canReadInventory: boolean,
  canReadProperties: boolean,
): OperationalPreviewAction[] {
  const actions: OperationalPreviewAction[] = [];
  if (route.selection.kind === "reservation" && canReadReservations) {
    actions.push({ href: reservationDestinationHref(route), label: "Open reservation", icon: CalendarDays, primary: true });
  }
  if (mayOpenSpacesFromPreview(canReadInventory, canReadProperties)
    && (route.selection.kind === "inventoryBlock" || route.selection.inventoryUnitId)) {
    actions.push({
      href: inventoryDestinationHref(route),
      label: route.selection.kind === "inventoryBlock" ? "Open block in Spaces" : "Open availability in Spaces",
      icon: route.selection.kind === "inventoryBlock" ? Blocks : CalendarDays,
      primary: route.selection.kind !== "reservation",
    });
  }
  const canOpenSpace = Boolean(canReadProperties && route.selection.roomId);
  if (canOpenSpace) {
    const href = propertySetupDestinationHref(route);
    if (href) actions.push({
      href,
      label: route.selection.bedId ? "Open bed in Spaces" : "Open room in Spaces",
      icon: DoorOpen,
    });
  }
  return actions;
}

function routeWithInventoryContext(
  route: OperationalPreviewRoute,
  inventory: OperationalInventoryContext,
): OperationalPreviewRoute {
  return {
    ...route,
    selection: {
      ...route.selection,
      inventoryUnitId: route.selection.inventoryUnitId ?? inventory.inventoryUnitId,
      roomId: route.selection.roomId ?? inventory.roomId,
      bedId: route.selection.bedId ?? inventory.bedId,
    },
  } as OperationalPreviewRoute;
}

function originContextLabel(route: OperationalPreviewRoute): string {
  return operationalOriginLabel(route.origin).replace(/^Back to /, "From ");
}

function sourceMessage(
  tone: OperationalPreviewContentModel["sourceTone"],
  subject: string,
) {
  if (tone === "current") return `Current ${subject} details.`;
  if (tone === "refreshing") return `Refreshing current ${subject} details; visible context may be older.`;
  return `Current ${subject} details are delayed. Refresh before acting elsewhere.`;
}

function unitStateLabel(state: ReturnType<typeof resolveUnitState>["state"]) {
  if (state === "available") return "Available";
  if (state === "occupied") return "Occupied";
  if (state === "blocked") return "Blocked";
  if (state === "unavailable") return "Unavailable";
  return "Unconfirmed";
}

function unitStateTone(state: ReturnType<typeof resolveUnitState>["state"]) {
  if (state === "available") return "bg-success/10 text-success";
  if (state === "occupied") return "bg-secondary/12 text-secondary";
  if (state === "blocked") return "bg-warning/18 text-warning-content";
  return "bg-base-200 text-base-content/55";
}

function bestInspectorPosition(
  trigger: DOMRect | undefined,
  protectedRects: DOMRect[],
  width: number,
  height: number,
): CSSProperties {
  const margin = 16;
  const gap = 12;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  if (!trigger) return { left: maxLeft, top: Math.min(80, maxTop), width };
  const clampLeft = (value: number) => Math.min(maxLeft, Math.max(margin, value));
  const clampTop = (value: number) => Math.min(maxTop, Math.max(margin, value));
  const candidates = [
    { left: trigger.right + gap, top: trigger.top - 12 },
    { left: trigger.left - width - gap, top: trigger.top - 12 },
    { left: trigger.left, top: trigger.bottom + gap },
    { left: trigger.left, top: trigger.top - height - gap },
    { left: window.innerWidth - width - 24, top: 80 },
  ].map((candidate) => ({
    left: clampLeft(candidate.left),
    top: clampTop(candidate.top),
  }));
  const scored = candidates.map((candidate, index) => ({
    ...candidate,
    index,
    overlap: protectedRects.reduce((total, rect) => total + overlapArea(
      { ...candidate, right: candidate.left + width, bottom: candidate.top + height },
      rect,
    ), 0),
  })).sort((left, right) => left.overlap - right.overlap || left.index - right.index);
  return { left: scored[0].left, top: scored[0].top, width };
}

function overlapArea(
  left: { left: number; top: number; right: number; bottom: number },
  right: DOMRect,
) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

function trapFocus(panel: HTMLElement, event: KeyboardEvent) {
  const focusable = [...panel.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden"));
  if (!focusable.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === panel || document.activeElement === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
