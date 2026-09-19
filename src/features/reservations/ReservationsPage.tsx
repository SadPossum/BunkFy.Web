import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, CalendarDays, ChevronRight, Plus, Search, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Reservation, ReservationListItem, ReservationListResponse, ReservationOperationsSnapshot } from "../../api/types";
import { ApiError } from "../../api/client";
import { reservationSourceLabel, reservationStatusLabel } from "../../api/labels";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { LIVE_LIST_REFRESH_INTERVAL_MS, reservationNeedsLiveRefresh } from "../../app/liveUpdates";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { propertyDateKey } from "../../app/propertyDate";
import { focusedResourceClass, useTargetProperty, useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { useCurrentRouteNavigationLease } from "../../app/routeNavigationLease";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { CreateReservationModal } from "./CreateReservationModal";
import { ReservationDetail, type ReservationCapabilities } from "./ReservationDetail";
import {
  reservationAttentionReason,
  reservationInventorySummary,
} from "./reservationOperationalView";
import { OwnerOriginLink } from "../spaces/OwnerOriginLink";
import { calendarBookingReturnHref, hasCalendarBookingContext, parseCalendarBookingContext } from "../calendar/calendarBookingRoute";
import { reservationEditorIdentity } from "./reservationsMutationAuthority";
import { useReservationCreationRecovery } from "./useReservationCreationRecovery";
import { clearReservationRecovery, recoveryMatchesSession, updateReservationRecovery } from "./reservationCreationRecovery";
import { useReservationAccessRecovery } from "./useReservationAccessRecovery";
import { completedReservationReturnHref, completedReservationSeed, hasCompletedReservationCreateContext, parseCompletedReservationCreateContext } from "./completedReservationCreate";

const PAGE_SIZE = 30;
const statusFilters = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "inHouse", label: "In house" },
  { value: "attention", label: "Attention" },
  { value: "closed", label: "Closed" },
] as const;
type StatusFilter = (typeof statusFilters)[number]["value"];
const viewByFilter: Record<Exclude<StatusFilter, "all">, number> = {
  upcoming: 1,
  inHouse: 2,
  attention: 3,
  closed: 4,
};

export function ReservationsPage() {
  const navigation = useCurrentRouteNavigationLease();
  const { request, session } = useSession();
  const workspace = useWorkspace();
  const { selectedProperty, selectedPropertyId } = workspace;
  const queryClient = useQueryClient();
  const recovery = useReservationCreationRecovery();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const calendarEntry = hasCalendarBookingContext(searchParams);
  const calendarContext = parseCalendarBookingContext(searchParams);
  const completedEntry = hasCompletedReservationCreateContext(searchParams);
  const completedContext = parseCompletedReservationCreateContext(searchParams);
  const requestedPropertyId = searchParams.has("property")
    ? searchParams.getAll("property").length === 1 ? searchParams.get("property") ?? "" : ""
    : selectedPropertyId;
  const propertyBound = requestedPropertyId === selectedPropertyId && Boolean(workspace.properties.find((property) => property.propertyId === requestedPropertyId));
  useTargetProperty(searchParams.get("property"));
  const requestedStatus = statusFilter(searchParams.get("status"));
  const [status, setStatus] = useState<StatusFilter>(requestedStatus);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedReservationId = searchParams.get("reservation");
  const affectedReservationIds = useMemo(
    () => [...new Set((searchParams.get("affected") ?? "").split(",").filter(Boolean))].slice(0, 25),
    [searchParams],
  );
  const reservationInitialTab = searchParams.get("section") === "guest" ? "guest" : undefined;
  const createOpen = searchParams.get("new") === "1";
  const hasRecovery = recovery.snapshot.kind !== "none";
  const propertySelected = Boolean(selectedPropertyId && selectedProperty && propertyBound && (!calendarEntry || calendarContext || hasRecovery)
    && (!completedEntry || completedContext || hasRecovery));
  const accessScope = session && propertySelected ? propertyAccessScope(session.tenantId, selectedPropertyId) : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.reservationsRead, scope: accessScope },
    { permission: permissions.reservationsCreate, scope: accessScope },
    { permission: permissions.inventoryRead, scope: accessScope },
    { permission: permissions.reservationsManage, scope: accessScope },
    { permission: permissions.reservationsManageGuests, scope: accessScope },
    { permission: permissions.reservationsCancel, scope: accessScope },
    { permission: permissions.reservationsCheckIn, scope: accessScope },
    { permission: permissions.reservationsNoShow, scope: accessScope },
    { permission: permissions.reservationsCheckOut, scope: accessScope },
    { permission: permissions.guestsRead, scope: accessScope },
    { permission: permissions.guestsCreate, scope: accessScope },
  ] : []);
  const mayRead = access.allows(permissions.reservationsRead, accessScope);
  const mayCreate = access.allows(permissions.reservationsCreate, accessScope);
  const permissionSource = createCompositeSource({
    label: "Reservation permissions",
    hasData: access.hasData,
    isLoading: access.isLoading,
    error: access.error,
    isFetching: access.isFetching,
    refetch: access.refetch,
  });
  const propertySource = createCompositeSource({
    label: "Property directory",
    hasData: workspace.propertiesLoaded,
    isLoading: workspace.propertiesLoading,
    error: workspace.propertiesError,
    isFetching: workspace.propertiesFetching,
    refetch: workspace.refetchProperties,
  });
  const permissionsCurrent = compositeSourceCurrent(permissionSource) && compositeSourceCurrent(propertySource) && propertySelected;
  const mayReadCurrent = mayRead && permissionsCurrent;
  const canCreate = mayCreate && permissionsCurrent;
  const completedSourceIdentity = reservationEditorIdentity(session, requestedPropertyId);
  const completedSourceKey = useMemo(() => ["reservations", requestedPropertyId, "completed-create", completedContext?.reservationId ?? "", completedSourceIdentity],
    [requestedPropertyId, completedContext?.reservationId, completedSourceIdentity]);
  const mayLoadCompletedSource = Boolean(createOpen && completedContext && mayReadCurrent && canCreate && !hasRecovery);
  const completedQuery = useQuery({
    queryKey: completedSourceKey,
    queryFn: ({ signal }) => request<Reservation>(`/api/reservations/properties/${requestedPropertyId}/${completedContext!.reservationId}`, { signal }),
    enabled: mayLoadCompletedSource, retry: false, staleTime: 0, refetchOnMount: "always",
  });
  useEffect(() => {
    if (!completedEntry) return;
    if (!mayLoadCompletedSource) void queryClient.cancelQueries({ queryKey: completedSourceKey, exact: true });
    return () => { void queryClient.cancelQueries({ queryKey: completedSourceKey, exact: true }); };
  }, [completedEntry, mayLoadCompletedSource, completedSourceKey, queryClient]);
  const completedSeed = completedContext && mayReadCurrent && canCreate && completedQuery.isFetchedAfterMount
    && !completedQuery.error
    ? completedReservationSeed(completedQuery.data, requestedPropertyId, completedContext.reservationId) : null;
  const completedSource = createCompositeSource({
    label: "Completed reservation", hasData: Boolean(completedSeed),
    isLoading: Boolean(mayLoadCompletedSource && (!completedQuery.isFetchedAfterMount || completedQuery.isLoading)),
    error: completedQuery.error ?? (completedQuery.isFetchedAfterMount && !completedQuery.isFetching && !completedSeed ? new Error("The completed source is unavailable or no longer eligible.") : null),
    isFetching: completedQuery.isFetching || completedQuery.isPaused,
    refetch: async () => { if (mayLoadCompletedSource) await completedQuery.refetch(); },
  });
  const capabilities: ReservationCapabilities = {
    manage: access.allows(permissions.reservationsManage, accessScope),
    manageGuests: access.allows(permissions.reservationsManageGuests, accessScope),
    readGuests: access.allows(permissions.guestsRead, accessScope),
    createGuests: access.allows(permissions.guestsCreate, accessScope),
    cancel: access.allows(permissions.reservationsCancel, accessScope),
    checkIn: access.allows(permissions.reservationsCheckIn, accessScope),
    noShow: access.allows(permissions.reservationsNoShow, accessScope),
    checkOut: access.allows(permissions.reservationsCheckOut, accessScope),
  };
  const detailIdentity = `${reservationEditorIdentity(session, selectedPropertyId)}:${selectedReservationId ?? ""}:${navigation.editorKey}`;
  const [detailAdmission, setDetailAdmission] = useState({ identity: detailIdentity, admitted: false });
  const detailReadDenied = Boolean(accessScope) && access.hasData && !access.isLoading && !access.isFetching && !access.error && !mayRead;
  const detailAuthorityLost = !session || !selectedPropertyId || requestedPropertyId !== selectedPropertyId
    || (compositeSourceCurrent(propertySource) && !propertySelected) || detailReadDenied
    || (access.error instanceof ApiError && access.error.status === 403)
    || (workspace.propertiesError instanceof ApiError && workspace.propertiesError.status === 403);
  const admittedDetail = !detailAuthorityLost && (mayReadCurrent || (detailAdmission.identity === detailIdentity && detailAdmission.admitted));
  if (detailAdmission.identity !== detailIdentity || detailAdmission.admitted !== admittedDetail) setDetailAdmission({ identity: detailIdentity, admitted: admittedDetail });
  useLayoutEffect(() => {
    if (detailAuthorityLost) navigation.reportOwner({ engaged: false, pending: false, label: "booking details", authorityLost: true });
  }, [detailAuthorityLost, navigation.reportOwner]);
  const operations = useQuery({
    queryKey: ["reservation-operations", selectedPropertyId],
    queryFn: () => request<ReservationOperationsSnapshot>(
      `/api/reservations/properties/${selectedPropertyId}/operations-snapshot?upcomingLimit=8`,
    ),
    enabled: propertySelected && mayReadCurrent && status !== "all" && affectedReservationIds.length === 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const operationsSource = createCompositeSource({
    label: "Property operating date",
    hasData: operations.data !== undefined,
    isLoading: operations.isLoading && !operations.errorUpdatedAt,
    error: operations.error,
    isFetching: operations.isFetching || operations.isPaused,
    refetch: () => operations.refetch(),
  });
  const operationalViewCurrent = status === "all" || compositeSourceCurrent(operationsSource);
  const operatingDate = operations.data?.localDate;
  const propertyToday = operatingDate
    ?? propertyDateKey(selectedProperty?.timeZoneId ?? "")
    ?? propertyDateKey("UTC")!;
  const reservationParams = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    order: status === "closed" ? "2" : "1",
  });
  if (deferredSearch) reservationParams.set("search", deferredSearch);
  if (status !== "all" && operatingDate) {
    reservationParams.set("view", String(viewByFilter[status]));
    reservationParams.set("operatingDate", operatingDate);
  }
  const reservations = useQuery({
    queryKey: ["reservations", selectedPropertyId, "directory", status, operatingDate, deferredSearch, page],
    queryFn: () => request<ReservationListResponse>(`/api/reservations/properties/${selectedPropertyId}?${reservationParams}`),
    enabled: propertySelected && mayReadCurrent && operationalViewCurrent && affectedReservationIds.length === 0,
    refetchInterval: (query) => query.state.data?.reservations.some((item) => reservationNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const affectedReservations = useQueries({
    queries: affectedReservationIds.map((reservationId) => ({
      queryKey: ["reservation", selectedPropertyId, reservationId],
      queryFn: () => request<Reservation>(`/api/reservations/properties/${selectedPropertyId}/${reservationId}`),
      enabled: propertySelected && mayReadCurrent,
    })),
  });
  const reservationSource = createCompositeSource({
    label: "Reservation directory",
    hasData: reservations.data !== undefined,
    isLoading: reservations.isLoading && !reservations.errorUpdatedAt,
    error: reservations.error,
    isFetching: reservations.isFetching || reservations.isPaused,
    refetch: () => reservations.refetch(),
  });
  const affectedSources = affectedReservations.map((query, index) => createCompositeSource({
    label: `Reservation ${affectedReservationIds[index]?.slice(0, 8).toUpperCase() ?? index + 1}`,
    hasData: query.data !== undefined,
    isLoading: query.isLoading && !query.errorUpdatedAt,
    error: query.error,
    isFetching: query.isFetching || query.isPaused,
    refetch: () => query.refetch(),
  }));

  useEffect(() => setPage(1), [selectedPropertyId]);
  useEffect(() => {
    setStatus(requestedStatus);
    setPage(1);
  }, [requestedStatus]);
  useEffect(() => {
    if (compositeSourceCurrent(reservationSource) && reservations.data && page > 1 && reservations.data.reservations.length === 0) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [page, reservationSource, reservations.data]);

  const visible = useMemo(() => {
    if (affectedReservationIds.length > 0) {
      return affectedReservations
        .map((query, index) => compositeSourceUsable(affectedSources[index].state) ? query.data : undefined)
        .filter((reservation): reservation is Reservation => Boolean(reservation))
        .map(toReservationListItem);
    }
    return compositeSourceUsable(reservationSource.state)
      ? reservations.data?.reservations ?? []
      : [];
  }, [affectedReservationIds.length, affectedReservations, affectedSources, reservationSource.state, reservations.data]);

  const affectedSource = createAffectedReservationSource(
    affectedSources,
    visible.length,
  );
  const requiredOperationsSource: CompositeSource = !operationalViewCurrent && operationsSource.state === "ready"
    ? { ...operationsSource, state: "loading" }
    : operationsSource;
  const directorySource = status !== "all" && !operationalViewCurrent
    ? requiredOperationsSource
    : reservationSource;
  const listSource = affectedReservationIds.length > 0
    ? affectedSource
    : directorySource;
  const listLoading = listSource.state === "loading";
  const listUsable = affectedReservationIds.length > 0
    ? compositeSourceUsable(listSource.state)
    : operationalViewCurrent && compositeSourceUsable(reservationSource.state);
  const loadingAffectedCount = affectedSources.filter((source) => source.state === "loading").length;
  const focusedReservationId = useTransientResourceFocus(listUsable && !listLoading);
  const statusControls = useRef<HTMLDivElement>(null);
  const retryFocus = useRef<{ owner: string; button: HTMLButtonElement; cancel: () => void } | null>(null);
  const retryOwner = JSON.stringify([reservationEditorIdentity(session, selectedPropertyId), requestedPropertyId,
    searchParams.toString(), status, search, page, navigation.editorKey]);
  const retrySources = [permissionSource, propertySource, listSource,
    ...(status !== "all" && affectedReservationIds.length === 0 ? [operationsSource] : [])];
  const retryReadDenied = [access.error, workspace.propertiesError,
    ...(affectedReservationIds.length > 0 ? affectedReservations.map(query => query.error)
      : [reservations.error, ...(status !== "all" ? [operations.error] : [])]),
  ].some(error => error instanceof ApiError && (error.status === 401 || error.status === 403));

  function rememberRetryFocus(event: MouseEvent<HTMLDivElement>) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    // Only an enabled keyboard/AT activation can create a recovery handoff.
    if (event.detail !== 0 || !button || button.disabled || button.getAttribute("aria-disabled") === "true"
      || document.activeElement !== button) return;
    retryFocus.current?.cancel();
    const cancel = () => {
      document.removeEventListener("focusin", moved);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
      retryFocus.current = null;
    };
    const moved = (event: FocusEvent) => { if (event.target !== button) cancel(); };
    const pointer = (event: PointerEvent) => { if (!(event.target instanceof Element) || event.target.closest("button") !== button) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Tab") cancel(); };
    retryFocus.current = { owner: retryOwner, button, cancel };
    document.addEventListener("focusin", moved);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
  }

  useLayoutEffect(() => {
    const intent = retryFocus.current;
    if (!intent) return;
    if (intent.owner !== retryOwner || detailAuthorityLost || retryReadDenied) { intent.cancel(); return; }
    if (!mayReadCurrent || !retrySources.every(compositeSourceCurrent) || intent.button.isConnected) return;
    const target = statusControls.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    const shouldRestore = document.activeElement === document.body && target?.isConnected
      && !target.disabled && !target.closest('[hidden], [inert], [aria-hidden="true"]')
      && target.getClientRects().length > 0 && getComputedStyle(target).visibility === "visible";
    intent.cancel();
    if (shouldRestore) target.focus({ preventScroll: true });
  });
  useLayoutEffect(() => () => retryFocus.current?.cancel(), []);
  const handoffAttempted = useRef("");

  // The exact detail route is the handoff boundary. Never clear while guest follow-on work still owns the new form.
  useEffect(() => {
    const saved = recovery.snapshot.kind === "record" ? recovery.snapshot.record : null;
    if (!saved || createOpen || !mayReadCurrent || !recoveryMatchesSession(saved, session)
      || saved.propertyId !== selectedPropertyId || saved.operationId !== selectedReservationId || saved.state === "prepared") { handoffAttempted.current = ""; return; }
    const handoffKey = `${saved.tenantId}:${saved.subjectId}:${saved.sessionId}:${saved.propertyId}:${saved.operationId}`;
    if (handoffAttempted.current === handoffKey) return;
    handoffAttempted.current = handoffKey;
    try {
      const handedOff = updateReservationRecovery(saved, "handed-off");
      clearReservationRecovery(handedOff);
      if (saved.followOnNeeded) setNotice("The reservation exists. Optional Guest Record creation or linking was not verified after recovery. Review its Guest Record before repeating a guest operation.");
    } catch {
      setNotice("This reservation is open, but its tab recovery marker could not be cleared. Use Check previous save before starting another reservation.");
    }
  }, [createOpen, mayReadCurrent, recovery.snapshot, selectedPropertyId, selectedReservationId, session]);

  function clearAffectedFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete("affected");
    next.delete("focus");
    next.delete("reservation");
    setSearchParams(next, { replace: true });
  }

  function setParam(name: "reservation" | "new", value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value); else next.delete(name);
    setSearchParams(next, { replace: true });
  }

  const editorIdentity = `${reservationEditorIdentity(session, requestedPropertyId)}:${calendarContext ? JSON.stringify(calendarContext) : completedContext ? JSON.stringify(completedContext) : "direct"}`;
  const accessRecovery = useReservationAccessRecovery(editorIdentity, createOpen, access.error,
    canCreate && access.allows(permissions.inventoryRead, accessScope) && !hasRecovery, {
      scope: accessScope,
      complete: Boolean(accessScope) && access.hasData,
      // hasData covers every registered request key. Observe the complete
      // permission response before its provider scrubs the property snapshot;
      // property-read fetching is not evidence that this decision is denied.
      current: propertySelected && access.hasData && !access.isLoading && !access.isFetching && !access.error,
      allowed: mayCreate,
    });
  const editorKey = accessRecovery.editorKey;
  const currentEditor = useRef<string | null>(null);
  const currentReadAccess = useRef(mayReadCurrent);
  currentReadAccess.current = mayReadCurrent;
  currentEditor.current = createOpen && propertySelected ? editorKey : null;
  const originLink = calendarContext ? <Link className="inline-flex min-h-10 items-center gap-2 rounded px-2 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary" to={calendarBookingReturnHref(calendarContext)}>Back to Calendar · {calendarContext.origin.day}</Link> : <OwnerOriginLink className="mb-0" />;
  const editorPermissionSource: CompositeSource = permissionsCurrent ? permissionSource : {
    ...permissionSource,
    state: permissionSource.state === "ready" ? "unavailable" : permissionSource.state,
    refetch: async () => { await Promise.all([access.refetch(), workspace.refetchProperties()]); },
  };
  const editor = createOpen && ((propertySelected && selectedProperty) || accessRecovery.phase === "reset") ? <CreateReservationModal
    key={editorKey}
    propertyId={requestedPropertyId}
    propertyTimeZoneId={selectedProperty?.timeZoneId ?? "UTC"}
    accessReset={accessRecovery.phase === "reset" ? {
      accessCurrent: permissionsCurrent,
      canStartFresh: canCreate && access.allows(permissions.inventoryRead, accessScope) && !hasRecovery,
      onRetry: () => Promise.allSettled([access.refetch(), workspace.refetchProperties()]),
      onStartFresh: accessRecovery.startFresh,
    } : undefined}
    freshAfterAccessReset={accessRecovery.phase === "fresh"}
    previousSavePending={accessRecovery.phase === "reset" && accessRecovery.pending}
    onSavePendingChange={accessRecovery.setSavePending}
    permissionSource={editorPermissionSource}
    canCreateReservation={mayCreate}
    canReadInventory={access.allows(permissions.inventoryRead, accessScope)}
    canReadReservations={mayRead}
    requestedTarget={calendarContext?.target}
    completedSource={completedEntry ? { context: completedContext, seed: completedSeed, source: completedSource } : undefined}
    originLink={calendarContext || completedContext ? originLink : undefined}
    canReadGuests={capabilities.readGuests}
    canCreateGuests={capabilities.createGuests}
    canManageGuests={capabilities.manageGuests}
    onClose={() => {
      if (completedContext) {
        void navigate(completedReservationReturnHref(completedContext), { replace: true, state: { completedCreateReturn: {
          identity: completedSourceIdentity, propertyId: requestedPropertyId, reservationId: completedContext.reservationId,
          href: completedReservationReturnHref(completedContext),
        } } });
      } else if (calendarContext) void navigate(calendarBookingReturnHref(calendarContext), { replace: true });
      else setParam("new", null);
    }}
    onCreated={async (created, warning, keepCalendarOrigin) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reservations", selectedPropertyId] }),
        queryClient.invalidateQueries({ queryKey: ["reservation-operations", selectedPropertyId] }),
      ]);
      if (currentEditor.current !== editorKey || created.propertyId !== selectedPropertyId) return;
      if (keepCalendarOrigin !== undefined && !currentReadAccess.current) return;
      setNotice(warning);
      const next = keepCalendarOrigin === false || (calendarEntry && !calendarContext)
        ? new URLSearchParams({ property: selectedPropertyId }) : new URLSearchParams(searchParams);
      next.delete("new");
      next.delete("extendFrom");
      next.set("reservation", created.reservationId);
      setSearchParams(next, { replace: true });
    }}
  /> : null;
  // Key only the exact authority/booking owner, never currentness or detailsRevision.
  // A same-owner refresh must not unmount its form or the TimePicker state.
  const detail = <ReservationDetail key={detailIdentity} editorIdentity={detailIdentity} navigation={navigation}
    propertyId={selectedPropertyId} reservationId={admittedDetail && !createOpen ? selectedReservationId : null}
    initialTab={reservationInitialTab} capabilities={capabilities} permissionSource={editorPermissionSource}
    canReadInventory={access.allows(permissions.inventoryRead, accessScope)} businessDateToday={propertyToday}
    notice={notice} originLink={originLink} onDismissNotice={() => setNotice(null)} onClose={() => {
      setNotice(null);
      if (calendarContext) { navigate(calendarBookingReturnHref(calendarContext), { replace: true }); return; }
      const next = new URLSearchParams(searchParams); next.delete("reservation"); next.delete("section"); setSearchParams(next, { replace: true });
    }} />;

  if (calendarEntry && !calendarContext && !hasRecovery) return <><EmptyState icon={<ShieldCheck />} title="This Calendar booking link is invalid" description="Open Calendar and choose the room, bed and dates again. No replacement property or inventory has been selected." action={<Link className="btn btn-primary" to="/calendar">Open Calendar</Link>} /></>;
  if (completedEntry && !completedContext && !hasRecovery) return <EmptyState icon={<ShieldCheck />} title="This completed reservation link is invalid" description="Open the completed reservation again. No guest or replacement space has been selected." action={<Link className="btn btn-primary" to="/calendar">Open Calendar</Link>} />;
  if (!propertyBound && searchParams.has("property")) return <><OwnerOriginLink /><EmptyState icon={<ShieldCheck />} title="Opening the requested property" description="Reservations will only load if this exact property is accessible and selected." />{editor}{detail}</>;

  if (!selectedProperty) return <><OwnerOriginLink /><EmptyState icon={<CalendarDays />} title="Choose a property first" description="Reservations belong to a property. Create or select one to continue." />{editor}{detail}</>;

  if (!access.hasData) {
    return (
      <>
        <OwnerOriginLink />
        <PageHeader eyebrow={selectedProperty.name} title="Reservations" />
        <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
          {access.error
            ? <div className="p-4 sm:p-6"><ErrorState error={access.error} retry={() => void access.refetch()} title="Reservation access could not be checked" /></div>
            : <LoadingState label="Checking reservation access" />}
        </section>
        {editor}
        {detail}
      </>
    );
  }

  if (!mayRead) {
    return (
      <>
        <OwnerOriginLink />
        <PageHeader eyebrow={selectedProperty.name} title="Reservations" />
        <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
          <EmptyState
            icon={<ShieldCheck />}
            title="Reservation access is not assigned"
            description="Ask a workspace administrator for reservation read access to this property."
          />
        </section>
        {editor}
        {detail}
      </>
    );
  }

  return (
    <>
      {!selectedReservationId && <OwnerOriginLink />}
      <PageHeader eyebrow={selectedProperty.name} title="Reservations" action={canCreate ? <button className="btn btn-primary" onClick={() => setParam("new", "1")}><Plus size={17} />New reservation</button> : undefined} />
      {hasRecovery && !createOpen && <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-warning/30 bg-warning/8 p-3 text-sm" role="status"><p>A previous save still has a tab recovery marker.</p><button type="button" className="btn btn-outline btn-sm" onClick={() => setSearchParams(new URLSearchParams({ property: selectedPropertyId, new: "1" }), { replace: true })}>Check previous save</button></div>}
      <div className="contents" onClickCapture={rememberRetryFocus}><CompositeSourceNotice
        sources={[permissionSource, propertySource, ...(status !== "all" && affectedReservationIds.length === 0 ? [operationsSource] : [])]}
        title="Some reservation context is delayed"
        keepRetryFocusable
      /></div>

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        {affectedReservationIds.length > 0 && <div className="flex items-center justify-between gap-4 border-b border-primary/15 bg-primary/5 px-5 py-3 sm:px-6"><div><p className="text-sm font-semibold">Reservations affected by the inventory change</p><p className="mt-1 text-xs text-base-content/50">Showing {visible.length} of {affectedReservationIds.length} linked {affectedReservationIds.length === 1 ? "reservation" : "reservations"}{loadingAffectedCount > 0 ? ` · loading ${loadingAffectedCount}` : ""}.</p></div><button type="button" className="btn btn-circle btn-ghost btn-sm" onClick={clearAffectedFilter} aria-label="Clear affected reservations filter"><X size={16} /></button></div>}
        <div ref={statusControls} className="flex flex-col gap-4 border-b border-base-300 p-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <SegmentedTabs value={status} options={statusFilters} ariaLabel="Reservation status" onValueChange={(value) => {
            setStatus(value);
            setPage(1);
            const next = new URLSearchParams(searchParams);
            if (value === "all") next.delete("status");
            else next.set("status", value);
            setSearchParams(next, { replace: true });
          }} />
          <label className="input input-bordered input-sm flex min-h-11 w-full items-center gap-2 xl:w-72"><Search size={15} className="shrink-0 text-base-content/35" /><input className="min-w-0 grow" aria-label="Search reservations" placeholder="Guest, contact or reference" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        </div>

        <div className="contents" onClickCapture={rememberRetryFocus}><CompositeSourceNotice
          className="mx-4 mt-4 sm:mx-6"
          sources={[listSource]}
          title={affectedReservationIds.length > 0 ? "Some affected reservations are delayed" : "Reservation results are delayed"}
          keepRetryFocusable
        /></div>
        {listLoading ? <LoadingState label="Loading reservations" /> : !listUsable ? <CompositeSourceFallback state={listSource.state} label="reservations" /> : !visible.length ? <div className="p-6"><EmptyState icon={<CalendarDays />} title={search || status !== "all" ? "No reservations match" : "No reservations yet"} description={search || status !== "all" ? "Try changing the status or search filter." : "Create the first stay and BunkFy will allocate the selected inventory."} action={canCreate && !search && status === "all" && affectedReservationIds.length === 0 ? <button className="btn btn-sm btn-primary" onClick={() => setParam("new", "1")}>Add reservation</button> : undefined} /></div> : (<>
          <div className="hidden overflow-x-auto lg:block">
            <table className="table">
              <thead><tr className="border-base-300 text-xs text-base-content/65"><th className="pl-6">Guest</th><th>Stay</th><th className="hidden xl:table-cell">Inventory</th><th>Status</th><th className="hidden xl:table-cell">Source</th><th className="pr-6"><span className="sr-only">View</span></th></tr></thead>
              <tbody>{visible.map((reservation) => (
                <ReservationDesktopRow
                  key={reservation.reservationId}
                  reservation={reservation}
                  attentionReason={status === "attention" ? reservationAttentionReason(reservation, operatingDate) : null}
                  focused={reservation.reservationId === focusedReservationId}
                  onOpen={() => setParam("reservation", reservation.reservationId)}
                />
              ))}</tbody>
            </table>
          </div>
          <div className="divide-y divide-base-300 lg:hidden">
            {visible.map((reservation) => (
              <ReservationMobileRow
                key={reservation.reservationId}
                reservation={reservation}
                attentionReason={status === "attention" ? reservationAttentionReason(reservation, operatingDate) : null}
                focused={reservation.reservationId === focusedReservationId}
                onOpen={() => setParam("reservation", reservation.reservationId)}
              />
            ))}
          </div>
          {affectedReservationIds.length === 0 && <PaginationBar page={page} pageSize={PAGE_SIZE} itemCount={visible.length} hasMore={reservations.data?.hasMore} itemLabel="reservation" disabled={reservations.isFetching} onPageChange={setPage} />}
        </>)}
      </section>

      {editor}
      {detail}
    </>
  );
}

function ReservationDesktopRow({ reservation, attentionReason, focused, onOpen }: {
  reservation: ReservationListItem;
  attentionReason: string | null;
  focused: boolean;
  onOpen: () => void;
}) {
  return (
    <tr
      className={`cursor-pointer border-base-300 transition hover:bg-base-200/70 ${focused ? focusedResourceClass : ""}`}
      onClick={onOpen}
    >
      <td className="pl-6 align-top">
        <p className="break-words font-semibold leading-5">{reservation.primaryGuestName}</p>
        <p className="mt-1 text-xs text-base-content/65">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"}</p>
        <div className="mt-1 space-y-0.5 text-xs leading-4 text-base-content/65 xl:hidden">
          <p><span className="font-medium">Inventory:</span> {reservationInventorySummary(reservation)}</p>
          <p><span className="font-medium">Source:</span> {reservationSourceLabel(reservation.sourceKind)}</p>
        </div>
      </td>
      <td className="align-top">
        <p className="flex flex-col items-start gap-x-1 font-medium leading-5 xl:flex-row xl:flex-wrap">
          <span className="whitespace-nowrap">{formatStayEndpoint(reservation.arrival, reservation.expectedArrivalTime)}</span>
          <span className="whitespace-nowrap">→ {formatStayEndpoint(reservation.departure, reservation.expectedDepartureTime)}</span>
        </p>
        <p className="mt-1 text-xs text-base-content/65">{nightsBetween(reservation.arrival, reservation.departure)} nights</p>
      </td>
      <td className="hidden align-top xl:table-cell">
        <span className={`inline-flex items-center gap-1.5 text-sm ${reservation.holdsInventory ? "" : "font-medium text-warning-content"}`}>
          <BedDouble size={15} className="shrink-0 text-base-content/35" />
          {reservationInventorySummary(reservation)}
        </span>
      </td>
      <td className="align-top">
        <StatusBadge status={reservationStatusLabel(reservation.status)} />
        {attentionReason && <p className="mt-1.5 flex items-start gap-1 text-xs font-semibold text-warning-content"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{attentionReason}</p>}
      </td>
      <td className="hidden align-top text-sm capitalize text-base-content/65 xl:table-cell">{reservationSourceLabel(reservation.sourceKind)}</td>
      <td className="pr-6 text-right">
        <button type="button" className="btn btn-circle btn-ghost min-h-11 min-w-11" aria-label={`View reservation for ${reservation.primaryGuestName}`} onClick={(event) => { event.stopPropagation(); onOpen(); }}><ChevronRight size={17} /></button>
      </td>
    </tr>
  );
}

function ReservationMobileRow({ reservation, attentionReason, focused, onOpen }: {
  reservation: ReservationListItem;
  attentionReason: string | null;
  focused: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`block w-full p-5 text-left transition hover:bg-base-200/70 focus-visible:bg-base-200/70 ${focused ? focusedResourceClass : ""}`}
      onClick={onOpen}
    >
      <p className="break-words font-semibold leading-5">{reservation.primaryGuestName}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge status={reservationStatusLabel(reservation.status)} />
        <span className="text-xs text-base-content/65">{reservation.guestCount} {reservation.guestCount === 1 ? "guest" : "guests"}</span>
      </div>
      {attentionReason && <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-warning/15 px-2 py-1 text-xs font-semibold text-warning-content"><TriangleAlert size={14} />{attentionReason}</p>}
      <div className="mt-3 text-sm">
        <p className="flex flex-wrap gap-x-1 font-medium leading-5">
          <span>{formatStayEndpoint(reservation.arrival, reservation.expectedArrivalTime)}</span>
          <span>→ {formatStayEndpoint(reservation.departure, reservation.expectedDepartureTime)}</span>
        </p>
        <p className="mt-1 text-xs leading-5 text-base-content/65">{nightsBetween(reservation.arrival, reservation.departure)} nights · {reservationInventorySummary(reservation)}</p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-base-content/65">
        <span>Source: {reservationSourceLabel(reservation.sourceKind)}</span>
        <ChevronRight size={17} className="shrink-0" />
      </div>
    </button>
  );
}

function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function statusFilter(value: string | null): StatusFilter { return statusFilters.some((option) => option.value === value) ? value as StatusFilter : "all"; }
function toReservationListItem(reservation: Reservation): ReservationListItem { return { reservationId: reservation.reservationId, propertyId: reservation.propertyId, arrival: reservation.arrival, departure: reservation.departure, expectedArrivalTime: reservation.expectedArrivalTime, expectedDepartureTime: reservation.expectedDepartureTime, primaryGuestName: reservation.primaryGuestName, guestCount: reservation.guestCount, inventoryUnitCount: reservation.inventoryUnitIds.length, inventoryUnitIds: reservation.inventoryUnitIds, holdsInventory: reservation.holdsInventory, sourceKind: reservation.sourceKind, status: reservation.status }; }
function formatStayEndpoint(date: string, time?: string | null) { return time ? `${formatDate(date)}, ${formatTime(time)}` : formatDate(date); }
function formatTime(value: string) { const [hours, minutes] = value.split(":").map(Number); return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes)); }
function nightsBetween(arrival: string, departure: string) { return Math.max(0, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86_400_000)); }

function createAffectedReservationSource(
  sources: CompositeSource[],
  visibleCount: number,
): CompositeSource {
  const hasDelayedSource = sources.some((source) =>
    source.state === "stale" || source.state === "unavailable");
  const hasLoadingSource = sources.some((source) => source.state === "loading");

  return {
    label: "Affected reservation details",
    state: visibleCount > 0
      ? hasDelayedSource ? "stale" : "ready"
      : hasLoadingSource
        ? "loading"
        : hasDelayedSource
          ? "unavailable"
          : "ready",
    isFetching: sources.some((source) => source.isFetching),
    refetch: async () => {
      await Promise.all(sources
        .filter((source) => source.state !== "ready")
        .map((source) => source.refetch()));
    },
  };
}
