import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BedDouble, Building2, Clock3, Edit3, Globe2, Layers3, MoreHorizontal, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  Bed,
  Property,
  Room,
} from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { permissions, propertyAccessScope, tenantAccessScope, usePermissions } from "../../app/permissions";
import { focusedResourceClass, useScrollToTransientResourceFocus, useTargetProperty, useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  timeZoneLabel,
} from "./propertyFormOptions";
import {
  bedListMatchesContext,
  loadAllBeds,
  loadAllRooms,
  roomListMatchesProperty,
} from "./propertiesApi";
import {
  propertiesMutationAllowed,
} from "./propertiesMutationAuthority";
import { PropertyProcessingPanel } from "./PropertyProcessingPanel";
import { propertyTimeZoneHealthCopy } from "./propertyTimeZoneCatalog";
import { usePropertyEditor } from "./usePropertyEditor";
import { PropertyEditorForms } from "./PropertyEditorForms";
import { usePropertyRetirementEditor } from "./usePropertyRetirementEditor";
import { PropertyRetirementPanel } from "./PropertyRetirementPanel";
import { OwnerOriginLink } from "../spaces/OwnerOriginLink";
import { inventorySalesSetupUrl } from "../inventory/salesModeRoutes";
import { useTopologyEditor } from "./useTopologyEditor";
import { TopologyEditorForm, TopologyMutationNotice } from "./TopologyEditorForm";
import { useTopologyRetirementEditor } from "./useTopologyRetirementEditor";
import { TopologyRetirementPanel } from "./TopologyRetirementPanel";

type RoomFormState = { room?: Room } | null;
type BedFormState = { bed?: Bed } | null;
const emptyBeds: Bed[] = [];

export function PropertiesPage() {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasRequestedProperty = searchParams.has("property");
  const requestedPropertyId = searchParams.get("property");
  const selectedPropertyId = hasRequestedProperty
    ? requestedPropertyId ?? ""
    : workspace.selectedPropertyId;
  const selectedProperty = workspace.properties.find(
    (property) => property.propertyId === selectedPropertyId,
  ) ?? null;
  useTargetProperty(hasRequestedProperty ? requestedPropertyId : null);
  const targetRoomId = searchParams.get("room");
  const targetBedId = searchParams.get("bed");
  const targetEdit = searchParams.get("edit");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [processingEngaged, setProcessingEngaged] = useState(false);
  const tenantScope = session ? tenantAccessScope(session.tenantId) : "";
  const propertyScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions([
    ...(tenantScope ? [{ permission: permissions.propertiesManage, scope: tenantScope }] : []),
    ...(propertyScope ? [
      { permission: permissions.propertiesManage, scope: propertyScope },
      { permission: permissions.propertyTimeZonesManage, scope: propertyScope },
      { permission: permissions.roomsManage, scope: propertyScope },
      { permission: permissions.bedsManage, scope: propertyScope },
      { permission: permissions.inventoryRead, scope: propertyScope },
      { permission: permissions.inventoryRetire, scope: propertyScope },
      { permission: permissions.reservationsRead, scope: propertyScope },
    ] : []),
  ]);
  const mayCreateProperty = access.allows(permissions.propertiesManage, tenantScope);
  const mayManageProperty = access.allows(permissions.propertiesManage, propertyScope);
  const mayManagePropertyTimeZone = access.allows(permissions.propertyTimeZonesManage, propertyScope);
  const mayManageRooms = access.allows(permissions.roomsManage, propertyScope);
  const mayManageBeds = access.allows(permissions.bedsManage, propertyScope);
  const mayReadInventory = access.allows(permissions.inventoryRead, propertyScope);
  const mayRetireInventory = access.allows(permissions.inventoryRetire, propertyScope);
  const permissionSource = createCompositeSource({
    label: "Property permissions",
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

  const rooms = useQuery({
    queryKey: ["rooms", selectedPropertyId],
    queryFn: (context) => loadAllRooms(request, selectedPropertyId, context.signal),
    enabled: Boolean(selectedPropertyId),
  });
  const roomContextMismatch = Boolean(
    rooms.data && !roomListMatchesProperty(rooms.data.rooms, selectedPropertyId),
  );
  const roomSource = createCompositeSource({
    label: "Room directory",
    hasData: rooms.data !== undefined && !roomContextMismatch,
    isLoading: rooms.isLoading,
    error: roomContextMismatch
      ? new Error("The room response did not match the selected property.")
      : rooms.error,
    isFetching: rooms.isFetching,
    refetch: () => rooms.refetch(),
  });
  const roomsUsable = compositeSourceUsable(roomSource.state);
  const roomsCurrent = compositeSourceCurrent(roomSource);
  const roomItems = roomsUsable ? rooms.data?.rooms ?? [] : [];
  const exactTargetRoom = targetRoomId === null
    ? null
    : roomItems.find((room) => room.roomId === targetRoomId) ?? null;
  const targetRoomUnconfirmed = targetRoomId !== null && !exactTargetRoom && !roomsCurrent;
  const targetRoomUnavailable = targetRoomId !== null && !exactTargetRoom && roomsCurrent;
  const selectedRoom = targetRoomId !== null
    ? exactTargetRoom
    : roomItems.find((room) => room.roomId === selectedRoomId) ?? roomItems[0] ?? null;
  const beds = useQuery({
    queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId],
    queryFn: (context) => loadAllBeds(request, selectedPropertyId, selectedRoom!.roomId, context.signal),
    enabled: Boolean(selectedPropertyId && selectedRoom),
  });
  const bedContextMismatch = Boolean(
    beds.data
    && selectedRoom
    && !bedListMatchesContext(beds.data.beds, selectedPropertyId, selectedRoom.roomId),
  );
  const bedSource = createCompositeSource({
    label: "Bed directory",
    hasData: beds.data !== undefined && !bedContextMismatch,
    isLoading: beds.isLoading,
    error: bedContextMismatch
      ? new Error("The bed response did not match the selected property and room.")
      : beds.error,
    isFetching: beds.isFetching,
    refetch: () => beds.refetch(),
  });
  const bedsUsable = compositeSourceUsable(bedSource.state);
  const bedsCurrent = compositeSourceCurrent(bedSource);
  const bedItems = bedsUsable ? beds.data?.beds ?? emptyBeds : emptyBeds;
  const exactTargetBed = targetBedId === null
    ? null
    : bedItems.find((bed) => bed.bedId === targetBedId) ?? null;
  const targetBedUnconfirmed = targetBedId !== null && selectedRoom && !exactTargetBed && !bedsCurrent;
  const targetBedUnavailable = targetBedId !== null && selectedRoom && !exactTargetBed && bedsCurrent;
  const focusedResourceId = useTransientResourceFocus(
    roomsUsable && (targetBedId === null || bedsUsable),
  );
  const focusedRoomId = focusedResourceId === targetRoomId ? targetRoomId : null;
  const focusedBedId = focusedResourceId === targetBedId ? targetBedId : null;
  useScrollToTransientResourceFocus(focusedResourceId, roomsUsable && (targetBedId === null || bedsUsable));
  const openedTargetEditRef = useRef("");
  const permissionsCurrent = compositeSourceCurrent(permissionSource);
  const propertyCurrent = compositeSourceCurrent(propertySource);
  const propertyActive = selectedProperty?.status === "active";
  const mutationEvidence = {
    permissionsCurrent,
    propertyCurrent,
    roomsCurrent,
    bedsCurrent,
    retirementCurrent: false,
  };
  const canCreateProperty = mayCreateProperty &&
    propertiesMutationAllowed("create-property", mutationEvidence);
  const canUpdateProperty = mayManageProperty && selectedProperty?.status === "active" &&
    propertiesMutationAllowed("update-property", mutationEvidence);
  const canUpdatePropertyTimeZone = mayManagePropertyTimeZone && propertyActive &&
    propertiesMutationAllowed("update-property", mutationEvidence);
  const canCreateRoom = mayManageRooms && propertyActive &&
    propertiesMutationAllowed("create-room", mutationEvidence);
  const canUpdateRoom = mayManageRooms && propertyActive &&
    propertiesMutationAllowed("update-room", mutationEvidence);
  const canCreateBed = mayManageBeds && propertyActive &&
    propertiesMutationAllowed("create-bed", mutationEvidence);
  const canUpdateBed = mayManageBeds && propertyActive &&
    propertiesMutationAllowed("update-bed", mutationEvidence);
  const canRetireProperty = mayManageProperty && propertyActive &&
    propertiesMutationAllowed("update-property", mutationEvidence);
  const canRetireRoom = mayRetireInventory && propertyActive &&
    propertiesMutationAllowed("update-room", mutationEvidence);
  const canRetireBed = mayRetireInventory && propertyActive &&
    propertiesMutationAllowed("update-bed", mutationEvidence);
  const canOpenInventory = mayReadInventory && permissionsCurrent && propertyCurrent;

  useEffect(() => {
    setSelectedRoomId("");
  }, [selectedPropertyId]);

  useEffect(() => {
    if (!roomsCurrent) return;
    if (targetRoomId !== null) {
      setSelectedRoomId(roomItems.some((room) => room.roomId === targetRoomId) ? targetRoomId : "");
      return;
    }
    if (roomItems.length && !roomItems.some((room) => room.roomId === selectedRoomId)) setSelectedRoomId(roomItems[0].roomId);
    if (!roomItems.length) setSelectedRoomId("");
  }, [roomItems, roomsCurrent, selectedRoomId, targetRoomId]);


  function clearEditTarget() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("edit");
      return next;
    }, { replace: true });
  }

  function selectRoomForView(roomId: string) {
    setSelectedRoomId(roomId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("room", roomId);
      next.delete("retire"); next.delete("retirement");
      next.delete("bed");
      next.delete("unit");
      next.delete("focus");
      next.delete("edit");
      return next;
    });
  }

  const invalidateProperty = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["properties"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["property-processing", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }),
    ]);
    await workspace.refetchProperties();
  };

  const editor = usePropertyEditor({
    property: selectedProperty,
    canCreate: canCreateProperty,
    canUpdate: canUpdateProperty,
    canUpdateTimeZone: canUpdatePropertyTimeZone && selectedProperty?.status === "active",
    permissionsCurrent,
    mayUpdate: mayManageProperty,
    mayUpdateTimeZone: mayManagePropertyTimeZone,
  });
  const { openPropertyForm: setPropertyForm, openTimeZoneForm: setTimeZoneTarget } = editor;

  const topologyEditor = useTopologyEditor({
    property: selectedProperty,
    room: selectedRoom,
    selectionKey: [targetRoomId ?? "", targetBedId ?? ""].join("|"),
    evidence: { ...mutationEvidence, mayManageRooms, mayManageBeds, property: selectedProperty, rooms: roomItems, beds: bedItems },
    onClose: clearEditTarget,
    onSaved: (target, receipt) => {
      setSelectedRoomId(receipt.roomId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("room", receipt.roomId); next.delete("edit");
        if (target.kind === "room" && !target.room) { next.delete("bed"); next.delete("unit"); }
        next.set("focus", target.kind === "bed" && target.bed ? target.bed.bedId : receipt.roomId);
        return next;
      }, { replace: true });
    },
  });
  function setRoomForm(state: NonNullable<RoomFormState>, opener?: HTMLElement) { topologyEditor.openRoom(state.room, opener); }
  function setBedForm(state: NonNullable<BedFormState>, opener?: HTMLElement) { topologyEditor.openBeds(state.bed, opener); }

  useEffect(() => {
    if (targetEdit !== "room" && targetEdit !== "bed") {
      openedTargetEditRef.current = "";
      return;
    }
    const targetId = targetEdit === "bed" ? targetBedId : targetRoomId;
    if (!targetId) return;
    const key = `${topologyEditor.context}:${targetEdit}:${targetId}`;
    if (openedTargetEditRef.current === key) return;

    if (targetEdit === "room") {
      const room = roomItems.find((item) => item.roomId === targetRoomId);
      if (!room || !canUpdateRoom) return;
      openedTargetEditRef.current = key;
      setRoomForm({ room });
      return;
    }

    const bed = bedItems.find((item) => item.bedId === targetBedId);
    if (!bed || !selectedRoom || !canUpdateBed) return;
    openedTargetEditRef.current = key;
    setBedForm({ bed });
  }, [
    bedItems,
    canUpdateBed,
    canUpdateRoom,
    roomItems,
    selectedPropertyId,
    selectedRoom,
    targetBedId,
    targetEdit,
    targetRoomId,
    topologyEditor.context,
  ]);

  const retirementEditor = useTopologyRetirementEditor({
    evidence: { propertyId: selectedPropertyId, permissionsCurrent, propertyCurrent, roomsCurrent, bedsCurrent,
      mayRead: mayReadInventory, mayRetire: mayRetireInventory },
    rooms: roomItems, beds: bedItems, selectionKey: [targetRoomId ?? selectedRoom?.roomId ?? "", targetBedId ?? ""].join("|"),
    refreshAuthority: () => Promise.all([access.refetch(), workspace.refetchProperties(), rooms.refetch(), ...(selectedRoom ? [beds.refetch()] : [])]),
  });
  const propertyRetirement = usePropertyRetirementEditor({
    property: selectedProperty, permissionsCurrent, propertyCurrent, mayManage: mayManageProperty,
    competingEditor: processingEngaged || editor.busy || topologyEditor.busy || retirementEditor.busy
      || Boolean(editor.propertyForm || editor.timeZoneTarget || topologyEditor.target || retirementEditor.target),
    refreshAuthority: () => Promise.all([access.refetch(), workspace.refetchProperties()]),
  });
  const propertyRetirementPending = Boolean(propertyRetirement.target) || propertyRetirement.busy;
  const propertyRetirementEngaged = propertyRetirementPending || Boolean(propertyRetirement.confirmed);
  const propertyCatalogueUsable = compositeSourceUsable(propertySource.state);
  const topologySources = selectedRoom ? [roomSource, bedSource] : [roomSource];
  const hasMultipleProperties = workspace.properties.length > 1;


  return (
    <>
      <OwnerOriginLink />
      <PropertyRetirementPanel editor={propertyRetirement} />
      <TopologyMutationNotice notice={topologyEditor.notice} />
      <PageHeader
        eyebrow="Setup"
        title="Properties"
        description="Keep each hostel’s physical layout accurate so availability and reservations stay trustworthy."
        action={canCreateProperty ? (
          <button className="btn btn-primary" disabled={editor.busy || propertyRetirementPending} onClick={() => setPropertyForm({})}>
            <Plus size={17} />New property
          </button>
        ) : undefined}
      />
      <CompositeSourceNotice
        sources={[permissionSource, propertySource]}
        title="Some property context is delayed"
      />

      {!propertyCatalogueUsable ? (
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <CompositeSourceFallback state={propertySource.state} label="properties" />
        </div>
      ) : !workspace.properties.length ? (
        <EmptyState
          icon={<Building2 />}
          title="No properties yet"
          description="Create your first hostel property to begin adding rooms and beds."
          action={canCreateProperty ? (
            <button className="btn btn-primary" disabled={editor.busy || propertyRetirementPending} onClick={() => setPropertyForm({})}>
              <Plus size={17} />Add property
            </button>
          ) : undefined}
        />
      ) : (
        <div className={hasMultipleProperties ? "grid gap-5 xl:grid-cols-[288px_minmax(0,1fr)]" : ""}>
          {hasMultipleProperties && (
            <div className="min-w-0">
              <div className="xl:hidden">
                <label className="form-control block">
                  <span className="label-text mb-1.5 block text-sm font-semibold">Property to manage</span>
                  <SelectPicker
                    className="w-full"
                    value={selectedPropertyId}
                    onValueChange={workspace.setSelectedPropertyId}
                    ariaLabel="Property to manage"
                    options={workspace.properties.map((property) => ({
                      value: property.propertyId,
                      label: property.name,
                      description: `${property.code} · ${timeZoneLabel(property.timeZoneId)}${property.status === "retired" ? " · Retired" : ""}`,
                    }))}
                  />
                </label>
              </div>
              <aside className="hidden max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-2 shadow-sm xl:sticky xl:top-20 xl:block">
                {workspace.properties.map((property) => (
                  <button
                    key={property.propertyId}
                    onClick={() => workspace.setSelectedPropertyId(property.propertyId)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${property.propertyId === selectedPropertyId ? "bg-primary/10 text-primary shadow-[inset_3px_0_0_var(--color-primary)]" : "text-base-content hover:bg-base-200"}`}
                  >
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Building2 size={19} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold">{property.name}</h2>
                      <p className="mt-1 truncate text-xs text-base-content/45">{property.code} · {timeZoneLabel(property.timeZoneId)}</p>
                    </div>
                    <StatusBadge status={property.status} />
                  </button>
                ))}
              </aside>
            </div>
          )}

          {selectedProperty && (
            <section className="min-w-0 space-y-5">
              <div className="card border border-base-300 bg-base-100 shadow-sm">
                <div className="card-body gap-5 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 data-property-retirement-heading tabIndex={-1} className="font-display text-2xl font-semibold outline-offset-2 focus:outline-2 focus:outline-primary">{selectedProperty.name}</h2>
                        <StatusBadge status={selectedProperty.status} />
                      </div>
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-base-content/55">
                        <Clock3 size={15} />{timeZoneLabel(selectedProperty.timeZoneId)}
                        <span aria-hidden="true">·</span>
                        <span>Code {selectedProperty.code}</span>
                      </p>
                    </div>
                    {(canUpdateProperty || (canUpdatePropertyTimeZone && selectedProperty.status === "active") || canRetireProperty) && (
                      <div className="flex gap-2">
                        {canUpdateProperty && (
                          <button className="btn btn-sm btn-ghost" disabled={editor.busy || propertyRetirementEngaged} onClick={() => setPropertyForm({ property: selectedProperty })}>
                            <Edit3 size={16} />Edit
                          </button>
                        )}
                        {canUpdatePropertyTimeZone && selectedProperty.status === "active" && (
                          <button className="btn btn-sm btn-ghost" disabled={editor.busy || propertyRetirementEngaged} onClick={() => setTimeZoneTarget(selectedProperty)}>
                            <Globe2 size={16} />{selectedProperty.timeZoneStatus === "canonical" ? "Time zone" : "Fix time zone"}
                          </button>
                        )}
                        {canRetireProperty && selectedProperty.status === "active" && !propertyRetirement.confirmed && (
                          <button className="btn btn-sm btn-ghost text-error" disabled={!propertyRetirement.canOpen} onClick={(event) => propertyRetirement.open(event.currentTarget)}>
                            <Trash2 size={16} />Retire
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <PropertyTimeZoneHealthNotice
                    property={selectedProperty}
                    canCorrect={canUpdatePropertyTimeZone && selectedProperty.status === "active" && !editor.busy && !propertyRetirementEngaged}
                    onCorrect={() => setTimeZoneTarget(selectedProperty)}
                  />
                </div>
              </div>

              <PropertyProcessingPanel
                property={selectedProperty}
                canManage={mayManageProperty}
                permissionsCurrent={permissionsCurrent}
                propertyCurrent={propertyCurrent}
                actionsDisabled={propertyRetirementEngaged} onEngagementChange={setProcessingEngaged}
                onChanged={invalidateProperty}
              />

              <div className="card border border-base-300 bg-base-100 shadow-sm">
                <div className="flex items-center justify-between border-b border-base-300 px-5 py-5 sm:px-6">
                  <div>
                    <h2 data-retirement-fallback className="font-display text-xl font-semibold">Rooms & beds</h2>
                    <p className="mt-1 text-sm text-base-content/50">The physical topology used by inventory.</p>
                  </div>
                  {canCreateRoom && (
                    <button className="btn btn-sm btn-primary" disabled={topologyEditor.busy || propertyRetirementEngaged} onClick={(event) => setRoomForm({}, event.currentTarget)}>
                      <Plus size={16} />Add room
                    </button>
                  )}
                </div>
                <CompositeSourceNotice
                  className="mx-5 mt-5 sm:mx-6"
                  sources={topologySources}
                  title="Some topology data is delayed"
                />
                {!roomsUsable ? (
                  <CompositeSourceFallback state={roomSource.state} label="rooms" />
                ) : !roomItems.length ? (
                  <div className="p-6">
                    <EmptyState
                      icon={<Layers3 />}
                      title="No rooms configured"
                      description={selectedProperty.status === "retired"
                        ? "This retired property has no room records. Rooms cannot be added."
                        : "Add the first room, then assign beds or sell it as a whole room."}
                      action={canCreateRoom ? (
                        <button className="btn btn-sm btn-primary" disabled={topologyEditor.busy || propertyRetirementEngaged} onClick={(event) => setRoomForm({}, event.currentTarget)}>Add room</button>
                      ) : undefined}
                    />
                  </div>
                ) : (
                  <div className="grid min-h-[430px] md:grid-cols-[280px_1fr]">
                    <div className="border-b border-base-300 p-3 md:border-b-0 md:border-r">
                      {roomItems.map((room) => (
                        <button
                          key={room.roomId}
                          onClick={() => selectRoomForView(room.roomId)}
                          className={`mb-1 flex w-full items-center gap-3 rounded-lg p-3 text-left transition ${selectedRoom?.roomId === room.roomId ? "bg-primary/10 text-primary shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-base-200/60"} ${focusedRoomId === room.roomId ? focusedResourceClass : ""}`}
                        >
                          <div className="grid size-9 place-items-center rounded-lg bg-secondary/15 text-secondary"><BedDouble size={17} /></div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{room.name}</p>
                            <p className="truncate text-xs text-base-content/40">{[room.buildingLabel, room.floorLabel].filter(Boolean).join(" · ") || "No location labels"}</p>
                          </div>
                          <MoreHorizontal size={16} className="text-base-content/30" />
                        </button>
                      ))}
                    </div>
                    {targetRoomUnconfirmed ? (
                      <div className="grid min-h-[28rem] place-items-center p-6">
                        <div className="max-w-md text-center" role="status" aria-live="polite">
                          <span className="mx-auto grid size-11 place-items-center rounded-lg bg-info/12 text-info"><Clock3 size={20} /></span>
                          <h3 className="mt-4 font-display text-lg font-semibold">Confirming requested room</h3>
                          <p className="mt-2 text-sm leading-6 text-base-content/55">The current room directory has not confirmed this target. No other room has been substituted.</p>
                        </div>
                      </div>
                    ) : targetRoomUnavailable ? (
                      <div className="grid min-h-[28rem] place-items-center p-6">
                        <div className="max-w-md text-center" role="alert">
                          <span className="mx-auto grid size-11 place-items-center rounded-lg bg-warning/15 text-warning"><AlertTriangle size={20} /></span>
                          <h3 className="mt-4 font-display text-lg font-semibold">Requested room changed or is unavailable</h3>
                          <p className="mt-2 text-sm leading-6 text-base-content/55">The exact room remains in the URL. Choose a current room deliberately; nothing else has been selected.</p>
                          {roomItems[0] && (
                            <button className="btn btn-primary btn-sm mt-5" onClick={() => selectRoomForView(roomItems[0].roomId)}>
                              Show {roomItems[0].name}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : selectedRoom && (
                      <div className="p-5 sm:p-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-display text-xl font-semibold">{selectedRoom.name}</h3>
                              <StatusBadge status={selectedRoom.status} />
                            </div>
                            <p className="mt-1 text-sm text-base-content/45">{[selectedRoom.buildingLabel, selectedRoom.floorLabel].filter(Boolean).join(" · ") || "No building or floor label"}</p>
                          </div>
                          {(canUpdateRoom || canRetireRoom) && (
                            <div className="dropdown dropdown-end">
                              <button tabIndex={0} className="btn btn-circle btn-ghost btn-sm" aria-label={`Actions for ${selectedRoom.name}`}><MoreHorizontal size={18} /></button>
                              <ul tabIndex={0} className="menu dropdown-content z-10 w-40 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
                                {canUpdateRoom && <li><button disabled={topologyEditor.busy || propertyRetirementEngaged} onClick={(event) => setRoomForm({ room: selectedRoom }, event.currentTarget)}><Edit3 size={15} />Edit room</button></li>}
                                {canRetireRoom && <li><button className="text-error" disabled={propertyRetirementEngaged || !retirementEditor.canOpen({ propertyId: selectedPropertyId, roomId: selectedRoom.roomId, kind: "room" })} onClick={(event) => retirementEditor.open({ propertyId: selectedPropertyId, roomId: selectedRoom.roomId, kind: "room", label: selectedRoom.name }, event.currentTarget)}><Trash2 size={15} />Retire</button></li>}
                              </ul>
                            </div>
                          )}
                        </div>
                        <div className="my-5 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Beds</p>
                          <div className="flex flex-wrap items-center gap-2">
                            {canOpenInventory && (
                              <Link
                                className="btn btn-sm btn-ghost"
                                to={inventorySalesSetupUrl(selectedPropertyId, selectedRoom.roomId, searchParams)}
                              >
                                <SlidersHorizontal size={15} />Sales setup
                              </Link>
                            )}
                            {canCreateBed && <button className="btn btn-sm btn-outline" disabled={topologyEditor.busy || propertyRetirementEngaged} onClick={(event) => setBedForm({}, event.currentTarget)}><Plus size={15} />Add bed</button>}
                          </div>
                        </div>
                        {targetBedUnconfirmed && (
                          <div className="mb-4 flex gap-3 rounded-lg border border-info/25 bg-info/8 p-4" role="status" aria-live="polite">
                            <Clock3 className="mt-0.5 shrink-0 text-info" size={18} />
                            <div>
                              <p className="text-sm font-semibold">Confirming requested bed</p>
                              <p className="mt-1 text-xs leading-5 text-base-content/60">The current bed directory has not confirmed this target. No other bed has been selected.</p>
                            </div>
                          </div>
                        )}
                        {targetBedUnavailable && (
                          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 sm:flex-row sm:items-center" role="alert">
                            <AlertTriangle className="shrink-0 text-warning" size={18} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold">Requested bed changed or is unavailable</p>
                              <p className="mt-1 text-xs leading-5 text-base-content/60">The room is exact, but no current bed matches the requested ID. Nothing else has been selected.</p>
                            </div>
                            <button className="btn btn-ghost btn-sm self-end sm:self-auto" onClick={() => {
                              setSearchParams((current) => {
                                const next = new URLSearchParams(current);
                                next.delete("bed");
                                next.delete("focus");
                                next.delete("edit");
                                return next;
                              });
                            }}>Clear unavailable bed</button>
                          </div>
                        )}
                        {!bedsUsable ? (
                          <CompositeSourceFallback state={bedSource.state} label="beds" />
                        ) : !bedItems.length ? (
                          <EmptyState
                            icon={<BedDouble />}
                            title="No beds in this room"
                            description={selectedProperty.status === "retired"
                              ? "No bed records are stored for this room. Beds cannot be added to a retired property."
                              : "Add beds for bed-level sales, or configure the room for room-level inventory."}
                            action={canCreateBed ? <button className="btn btn-sm btn-primary" disabled={topologyEditor.busy || propertyRetirementEngaged} onClick={(event) => setBedForm({}, event.currentTarget)}>Add beds</button> : undefined}
                          />
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {bedItems.map((bed) => (
                              <div key={bed.bedId} tabIndex={focusedBedId === bed.bedId ? -1 : undefined} className={`rounded-lg border border-base-300 p-4 outline-none ${focusedBedId === bed.bedId ? focusedResourceClass : ""}`}>
                                <div className="flex items-start justify-between">
                                  <div className="grid size-9 place-items-center rounded-lg bg-accent/15 text-accent-content"><BedDouble size={17} /></div>
                                  {(canUpdateBed || canRetireBed) && (
                                    <div className="dropdown dropdown-end">
                                      <button tabIndex={0} className="btn btn-circle btn-ghost btn-xs" aria-label={`Actions for ${bed.label}`}><MoreHorizontal size={15} /></button>
                                      <ul tabIndex={0} className="menu dropdown-content z-10 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
                                        {canUpdateBed && <li><button disabled={topologyEditor.busy || propertyRetirementEngaged} onClick={(event) => setBedForm({ bed }, event.currentTarget)}>Edit</button></li>}
                                        {canRetireBed && <li><button className="text-error" disabled={propertyRetirementEngaged || !retirementEditor.canOpen({ propertyId: selectedPropertyId, roomId: selectedRoom.roomId, bedId: bed.bedId, kind: "bed" })} onClick={(event) => retirementEditor.open({ propertyId: selectedPropertyId, roomId: selectedRoom.roomId, bedId: bed.bedId, kind: "bed", label: bed.label }, event.currentTarget)}>Retire</button></li>}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                                <p className="mt-3 font-semibold">{bed.label}</p>
                                <div className="mt-2"><StatusBadge status={bed.status} /></div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <PropertyEditorForms editor={editor} />
      <TopologyEditorForm editor={topologyEditor} beds={bedItems} />
      <TopologyRetirementPanel editor={retirementEditor} mayReadReservations={permissionsCurrent && access.allows(permissions.reservationsRead, propertyScope)} />
    </>
  );
}


function PropertyTimeZoneHealthNotice({ property, canCorrect, onCorrect }: {
  property: Property;
  canCorrect: boolean;
  onCorrect: () => void;
}) {
  const health = propertyTimeZoneHealthCopy(property.timeZoneStatus);
  if (!health) return null;
  const error = health.severity === "error";

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center ${error ? "border-error/30 bg-error/8" : "border-warning/30 bg-warning/10"}`}
      role="status"
    >
      <AlertTriangle size={18} className={`shrink-0 ${error ? "text-error" : "text-warning-content"}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{health.label}</p>
        <p className="mt-1 text-xs leading-5 text-base-content/60">
          {health.description}
          {property.canonicalTimeZoneId && property.canonicalTimeZoneId !== property.timeZoneId
            ? ` Recommended: ${timeZoneLabel(property.canonicalTimeZoneId)}.`
            : ""}
        </p>
      </div>
      {canCorrect && (
        <button type="button" className="btn btn-sm btn-outline shrink-0" onClick={onCorrect}>
          <Globe2 size={15} />Review
        </button>
      )}
    </div>
  );
}
