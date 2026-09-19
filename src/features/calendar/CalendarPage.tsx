import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import {
  permissions,
  propertyAccessScope,
  usePermissions,
} from "../../app/permissions";
import { propertyDateKey, shiftDateKey } from "../../app/propertyDate";
import { usePropertyDate } from "../../app/usePropertyDate";
import { useTargetProperty } from "../../app/resourceFocus";
import type { Property } from "../../api/types";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { DatePicker, parseDateKey, toDateKey } from "../../components/ui/DatePicker";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "../../components/ui/primitives";
import { loadAllRoomInventory } from "../inventory/inventoryApi";
import { addCalendarDays, calendarSelectedDay } from "./calendarModel";
import { calendarActionDate, calendarDayCoverage, calendarWindowDays, readCalendarViewport, writeCalendarViewport, type CalendarViewport } from "./calendarWindow";
import { useCalendarSegments } from "./useCalendarSegments";
import { useOperationalPreview } from "../operational-preview/OperationalPreviewProvider";
import { CalendarWeekView } from "./CalendarWeekView";
import { CalendarBookingRange } from "./CalendarBookingRange";
import { calendarBookingHref, parseCalendarBookingFocus, reservationRoomsMatchProperty, type CalendarBookingContext } from "./calendarBookingRoute";
import type { CalendarResource } from "./calendarSchedule";

export function CalendarPage() {
  const { request, session } = useSession();
  const { activeRoute } = useOperationalPreview();
  const workspace = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const target = calendarPropertyTarget(searchParams, workspace.properties, workspace.selectedPropertyId);
  const { property: selectedProperty, propertyId: selectedPropertyId } = target;
  useTargetProperty(target.requested && selectedProperty ? selectedPropertyId : null);
  const propertySource = createCompositeSource({
    label: "Property directory", hasData: workspace.propertiesLoaded, isLoading: workspace.propertiesLoading,
    error: workspace.propertiesError, isFetching: workspace.propertiesFetching, refetch: workspace.refetchProperties,
  });
  const propertyUsable = compositeSourceUsable(propertySource.state);
  const [viewRecoveryMessage, setViewRecoveryMessage] = useState("");
  const [booking, setBooking] = useState<{ context: CalendarBookingContext & { target: NonNullable<CalendarBookingContext["target"]> }; resource: CalendarResource; pageKey: string } | null>(null);
  const authority = `${session?.tenantId}:${session?.subjectId}:${session?.sessionId}:${session?.generation}:${workspace.selectedPropertyId}:${selectedPropertyId}`;
  const propertyTodayKey = propertyDateKey(selectedProperty?.timeZoneId ?? "")
    ?? toDateKey(new Date());
  const propertyToday = parseDateKey(propertyTodayKey) ?? new Date();
  const anchor = parseDateKey(searchParams.get("date") ?? "") ?? propertyToday;
  const selectedDay = calendarSelectedDay(anchor, searchParams.get("day"));
  const bookingPageKey = `${authority}:${toDateKey(anchor)}:${selectedDay}`;
  const parsedViewport = readCalendarViewport(searchParams);
  const bookingFocus = parseCalendarBookingFocus(searchParams, selectedPropertyId);
  const viewport = parsedViewport.viewport ?? { date: selectedDay, offset: 0 };
  const viewportFrozen = Boolean(booking || activeRoute?.origin.surface === "calendar");
  const pendingViewport = useRef<CalendarViewport | null>(null);
  const accessScope = session && selectedProperty
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.reservationsRead, scope: accessScope },
    { permission: permissions.inventoryRead, scope: accessScope },
    { permission: permissions.reservationsCreate, scope: accessScope },
    { permission: permissions.propertiesRead, scope: accessScope },
    // Keep preview mount/unmount from changing the shared evaluation key set.
    // Evaluation grants nothing; the preview still checks its current decisions.
    { permission: permissions.reservationsCheckIn, scope: accessScope },
    { permission: permissions.reservationsCheckOut, scope: accessScope },
  ] : []);
  const canReadReservations = access.allows(permissions.reservationsRead, accessScope);
  const canReadInventory = access.allows(permissions.inventoryRead, accessScope);
  const canReadCalendar = canReadReservations && canReadInventory;
  const permissionCurrent = access.hasData && !access.error;
  const queryEnabled = calendarDomainQueriesEnabled(
    target.bound && propertyUsable ? selectedPropertyId : undefined,
    permissionCurrent,
    canReadCalendar,
  );
  const rooms = useQuery({
    queryKey: ["inventory-rooms", selectedPropertyId],
    queryFn: ({ signal }) => loadAllRoomInventory(request, selectedPropertyId!, signal),
    enabled: queryEnabled,
  });

  useEffect(() => {
    const requestedView = searchParams.get("view");
    if (!requestedView) return;

    const next = new URLSearchParams(searchParams);
    next.delete("view");
    setViewRecoveryMessage(
      "Calendar now uses the operational week so room, bed, movement, and block information stays together.",
    );
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const permissionSource = createCompositeSource({
    label: "Calendar access",
    hasData: access.hasData,
    isLoading: access.isLoading,
    error: access.error,
    isFetching: access.isFetching,
    refetch: access.refetch,
  });
  const roomSource = createCompositeSource({
    label: "Calendar room layout",
    hasData: rooms.data !== undefined,
    isLoading: rooms.isLoading,
    error: rooms.error,
    isFetching: rooms.isFetching,
    refetch: () => rooms.refetch(),
  });
  const sharedCurrent = canReadCalendar && target.bound && [propertySource, permissionSource, roomSource].every(compositeSourceCurrent)
    && reservationRoomsMatchProperty(rooms.data?.rooms, selectedPropertyId);
  const attentionCurrent = Boolean(canReadCalendar && target.bound && [propertySource, permissionSource].every(compositeSourceCurrent)
    && workspace.selectedPropertyId === selectedPropertyId && workspace.selectedWorkspaceId === session?.tenantId
    && workspace.workspacesLoaded && !workspace.workspacesFetching && !workspace.workspacesError);
  const attentionOperatingDate = usePropertyDate(attentionCurrent ? selectedProperty?.timeZoneId ?? "" : "");
  const schedule = useCalendarSegments({ request, propertyId: selectedPropertyId, authority, anchor: viewport.date,
    ownedDay: booking?.context.target.arrival ?? (activeRoute?.origin.surface === "calendar" ? activeRoute.selection.date ?? activeRoute.origin.day : bookingFocus ? selectedDay : undefined),
    enabled: queryEnabled, current: sharedCurrent, attentionCurrent, frozen: viewportFrozen });
  const days = useMemo(() => calendarWindowDays(schedule.segments), [schedule.segments]);
  const from = schedule.segments[0].from, to = schedule.segments[schedule.segments.length - 1].to;
  const canCreate = permissionCurrent
    && access.allows(permissions.reservationsCreate, accessScope);
  const canOpenSpaces = target.bound && propertyUsable && !workspace.propertiesError && permissionCurrent
    && access.allows(permissions.propertiesRead, accessScope);
  const bookingCurrent = (day: string) => canCreate && sharedCurrent && calendarDayCoverage(schedule.coverage, day)?.current === true;
  const bookingOrigin = { surface: "calendar" as const, propertyId: selectedPropertyId, date: toDateKey(anchor), day: selectedDay, viewport };

  function dispatchBooking(resource: CalendarResource, day: string, position?: CalendarViewport) {
    if (!bookingCurrent(day) || day < propertyTodayKey) return;
    setBooking({ context: {
      origin: { ...bookingOrigin, date: calendarActionDate(toDateKey(anchor), day), day, viewport: position ?? viewport },
      target: { roomId: resource.roomId, inventoryUnitId: resource.inventoryUnitId, bedId: resource.bedId, arrival: day, departure: shiftDateKey(day, 1) },
    }, resource, pageKey: bookingPageKey });
  }
  // A viewport URL write must not invalidate every row. Dispatch still reads the
  // latest committed authority, coverage and origin, never a memoized permission.
  const bookingAction = useRef(dispatchBooking);
  useLayoutEffect(() => { bookingAction.current = dispatchBooking; });
  const startBooking = useCallback((resource: CalendarResource, day: string, position?: CalendarViewport) => {
    bookingAction.current(resource, day, position);
  }, []);

  function setDate(date: Date, day?: Date) {
    if (viewportFrozen) return;
    const next = new URLSearchParams(searchParams);
    next.set("date", toDateKey(date));
    if (day) next.set("day", toDateKey(day));
    else next.delete("day");
    writeCalendarViewport(next, { date: toDateKey(day ?? date), offset: 0 });
    setSearchParams(next, { replace: true });
  }

  function updateViewport(position: CalendarViewport) {
    if (viewportFrozen) { pendingViewport.current = position; return; }
    const next = new URLSearchParams(searchParams);
    writeCalendarViewport(next, position);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }
  useEffect(() => {
    if (viewportFrozen || !pendingViewport.current) return;
    const position = pendingViewport.current;
    pendingViewport.current = null;
    const next = new URLSearchParams(searchParams);
    writeCalendarViewport(next, position);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [viewportFrozen, searchParams, setSearchParams]);
  useEffect(() => { pendingViewport.current = null; setBooking(null); }, [authority]);
  useEffect(() => {
    if (parsedViewport.valid || viewportFrozen) return;
    const next = new URLSearchParams(searchParams); writeCalendarViewport(next);
    setSearchParams(next, { replace: true });
  }, [parsedViewport.valid, viewportFrozen, searchParams, setSearchParams]);

  function moveCalendar(amount: number) {
    setDate(addCalendarDays(parseDateKey(viewport.date) ?? anchor, amount * 7));
  }

  if (!propertyUsable) return <CompositeSourceFallback state={propertySource.state} label="properties" error={workspace.propertiesError} retry={() => void workspace.refetchProperties()} />;
  if (target.requested && !selectedProperty) return <EmptyState icon={<ShieldCheck />} title="This property is not available"
    description="Choose an accessible property to open Calendar. No other property's schedule is shown for this link." />;
  if (selectedProperty && !target.bound) return <LoadingState label="Opening the requested property" />;
  if (!selectedProperty) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        title="Choose a property first"
        description="The calendar shows the operating schedule for one property at a time."
      />
    );
  }

  if (access.error) {
    return (
      <>
        <CalendarHeader propertyName={selectedProperty.name} />
        <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
          <div className="p-4 sm:p-6">
            <ErrorState
              error={access.error}
              retry={() => void access.refetch()}
              title="Calendar access could not be confirmed"
            />
          </div>
        </section>
      </>
    );
  }

  if (!access.hasData) {
    return (
      <>
        <CalendarHeader propertyName={selectedProperty.name} />
        <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
          <LoadingState label="Checking calendar access" />
        </section>
      </>
    );
  }

  if (!canReadCalendar) {
    return (
      <>
        <CalendarHeader propertyName={selectedProperty.name} />
        <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
          <EmptyState
            icon={<ShieldCheck />}
            title="Calendar access is not assigned"
            description="This schedule combines reservation and inventory data, so both read permissions are required for this property."
          />
        </section>
      </>
    );
  }

  return (
    <>
      <CalendarHeader
        propertyName={selectedProperty.name}
        action={canCreate ? (
          <Link to={calendarBookingHref({ origin: bookingOrigin })} data-calendar-new-reservation className="btn btn-primary">
            <Plus size={17} />New reservation
          </Link>
        ) : undefined}
      />

      <CompositeSourceNotice
        sources={[permissionSource, propertySource, roomSource]}
        title="Calendar updates are delayed"
      />

      <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-base-300 px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="Previous week"
              disabled={viewportFrozen}
              onClick={() => moveCalendar(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0 sm:w-48">
            <p className="mb-1 text-xs font-medium text-base-content/65">Jump timeline to date</p>
            <DatePicker
              className="min-w-0"
              size="sm"
              value={viewport.date}
              ariaLabel="Jump timeline to date"
              disabled={viewportFrozen}
              compactOnSmallScreens
              onChange={(value) => {
                const date = parseDateKey(value);
                if (date) setDate(date, date);
              }}
            />
            </div>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="Next week"
              disabled={viewportFrozen}
              onClick={() => moveCalendar(1)}
            >
              <ChevronRight size={18} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm col-span-3 justify-self-center sm:col-auto"
              onClick={() => setDate(propertyToday, propertyToday)}
              disabled={viewportFrozen}
            >
              <CalendarDays size={15} />Today
            </button>
          </div>
          <p className="text-xs font-medium text-base-content/50">
            Scroll to load adjacent dates · departures do not occupy the departure night
          </p>
        </div>

        {viewRecoveryMessage && (
          <p
            className="border-b border-info/20 bg-info/8 px-4 py-2.5 text-sm text-base-content/65 sm:px-6"
            role="status"
          >
            {viewRecoveryMessage}
          </p>
        )}

          <CalendarWeekView
            key={authority}
            propertyId={selectedPropertyId}
            dateKey={toDateKey(anchor)}
            days={days}
            from={from}
            to={to}
            selectedDay={selectedDay}
            onSelectDay={(date) => setDate(parseDateKey(calendarActionDate(toDateKey(anchor), toDateKey(date)))!, date)}
            reservations={schedule.reservations}
            rooms={compositeSourceUsable(roomSource.state) && reservationRoomsMatchProperty(rooms.data?.rooms, selectedPropertyId) ? rooms.data?.rooms ?? [] : []}
            roomState={rooms.data && !reservationRoomsMatchProperty(rooms.data.rooms, selectedPropertyId) ? "unavailable" : roomSource.state}
            roomCurrent={compositeSourceCurrent(roomSource)}
            blocks={schedule.blocks}
            availabilityCurrent={schedule.coverage.every((segment) => segment.current)}
            coverage={schedule.coverage}
            viewport={viewport}
            viewportFrozen={viewportFrozen}
            onViewport={updateViewport}
            onExtend={schedule.extend}
            canOpenSpaces={canOpenSpaces}
            todayKey={propertyTodayKey}
            attentionOperatingDate={attentionOperatingDate}
            attentionReservationIds={schedule.attentionReservationIds}
            onBook={canCreate ? startBooking : undefined}
            bookingEnabled={canCreate && sharedCurrent && !viewportFrozen}
            bookingFocus={bookingFocus}
            bookingFocusReady={calendarDayCoverage(schedule.coverage, selectedDay)?.current === true}
          />
      </section>
      {booking && <CalendarBookingRange
        context={booking.context}
        roomName={booking.resource.roomName}
        unitLabel={booking.resource.label}
        current={bookingCurrent(booking.context.target.arrival) && booking.pageKey === bookingPageKey && booking.context.origin.propertyId === selectedPropertyId
          && rooms.data?.rooms.some((room) => room.roomId === booking.resource.roomId
            && room.units.some((unit) => unit.inventoryUnitId === booking.resource.inventoryUnitId && unit.isSellable && unit.isTopologyActive)) === true}
        onClose={() => setBooking(null)}
      />}
    </>
  );
}

export function calendarDomainQueriesEnabled(
  selectedPropertyId: string | undefined,
  permissionCurrent: boolean,
  canReadCalendar: boolean,
) {
  return Boolean(selectedPropertyId && permissionCurrent && canReadCalendar);
}

export function calendarPropertyTarget(params: URLSearchParams, properties: readonly Property[], workspacePropertyId: string) {
  const requested = params.has("property");
  const propertyId = requested
    ? params.getAll("property").length === 1 ? params.get("property") ?? "" : ""
    : workspacePropertyId;
  const property = properties.find((item) => item.propertyId === propertyId) ?? null;
  return { propertyId, property, requested, bound: Boolean(property && propertyId === workspacePropertyId) };
}

function CalendarHeader({
  propertyName,
  action,
}: {
  propertyName: string;
  action?: ReactNode;
}) {
  return (
    <div id="calendar-heading" tabIndex={-1} className="outline-none"><PageHeader
      eyebrow={propertyName}
      title="Calendar"
      description="Scan rooms, beds, guest movements, availability gaps, conflicts, and blocks across adjacent dates."
      action={action}
    /></div>
  );
}
