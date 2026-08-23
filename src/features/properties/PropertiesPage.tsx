import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BedDouble, Building2, Edit3, Layers3, MapPin, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type {
  Bed,
  BedBatchMutationReceipt,
  BedMutationReceipt,
  BedRetirement,
  Property,
  PropertyMutationReceipt,
  Room,
  RoomMutationReceipt,
  RoomRetirement,
  TopologyRetirement,
} from "../../api/types";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { LIVE_DETAIL_REFRESH_INTERVAL_MS, topologyRetirementNeedsLiveRefresh } from "../../app/liveUpdates";
import { permissions, propertyAccessScope, tenantAccessScope, usePermissions } from "../../app/permissions";
import { focusedResourceClass, useTargetProperty, useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, FormActions, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  createDefaultBedLabels,
  duplicateBedLabel,
  supportedTimeZones,
  timeZoneDescription,
  timeZoneLabel,
} from "./propertyFormOptions";
import { loadAllBeds, loadAllRooms } from "./propertiesApi";
import {
  bedRecordIsCurrent,
  propertiesMutationAllowed,
  propertyRecordMatches,
  roomRecordIsCurrent,
} from "./propertiesMutationAuthority";
import {
  resolveBedMutationAttempt,
  type BedMutationAttempt,
} from "./bedMutationAttempt";
import {
  resolvePropertyCreateAttempt,
  type PropertyCreateAttempt,
} from "./propertyCreateAttempt";
import {
  resolvePropertySimpleLifecycleAttempt,
  type PropertyLifecycleAttempt,
} from "./propertyLifecycleAttempt";
import {
  resolvePropertyUpdateAttempt,
  type PropertyUpdateAttempt,
} from "./propertyUpdateAttempt";
import {
  resolveRoomMutationAttempt,
  type RoomMutationAttempt,
} from "./roomMutationAttempt";
import {
  resolveTopologyRetirementCancellationAttempt,
  resolveTopologyRetirementRequestAttempt,
  resolveTopologyRetirementRetryAttempt,
  topologyRetirementCancellationPayload,
  topologyRetirementRequestPayload,
  type TopologyRetirementMutationAttempt,
} from "./topologyRetirementMutationAttempt";
import { PropertyProcessingPanel } from "./PropertyProcessingPanel";
import { TopologyRetirementModal, type RetirementTarget } from "./TopologyRetirementModal";

type PropertyFormState = { property?: Property } | null;
type RoomFormState = { room?: Room } | null;
type BedFormState = { bed?: Bed } | null;
type BedMutationInput = { bed?: Bed; labels: string[] };
type BedMutationResult = BedMutationReceipt | BedBatchMutationReceipt;
type PropertyMutationInput = {
  property?: Property;
  name: string;
  code: string;
  timeZoneId: string;
};
type RetirementMutationInput = { target: RetirementTarget; reason: string };
type InventoryRetirementTarget = Extract<RetirementTarget, { kind: "bed" | "room" }>;
type RetirementRetryInput = { target: InventoryRetirementTarget; outcome: TopologyRetirement };
type RetirementCancellationInput = RetirementRetryInput & { reason: string };
const emptyBeds: Bed[] = [];

export function PropertiesPage() {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const { selectedProperty, selectedPropertyId } = workspace;
  const [searchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const targetRoomId = searchParams.get("room");
  const targetBedId = searchParams.get("bed");
  const [propertyForm, setPropertyForm] = useState<PropertyFormState>(null);
  const propertyCreateAttempt = useRef<PropertyCreateAttempt | null>(null);
  const propertyUpdateAttempt = useRef<PropertyUpdateAttempt | null>(null);
  const [roomForm, setRoomForm] = useState<RoomFormState>(null);
  const roomMutationAttempt = useRef<RoomMutationAttempt | null>(null);
  const [bedForm, setBedForm] = useState<BedFormState>(null);
  const bedMutationAttempt = useRef<BedMutationAttempt | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [retirementTarget, setRetirementTarget] = useState<RetirementTarget | null>(null);
  const [retirementOutcome, setRetirementOutcome] = useState<TopologyRetirement | null>(null);
  const retirementRequestAttempt = useRef<TopologyRetirementMutationAttempt | null>(null);
  const retirementRetryAttempt = useRef<TopologyRetirementMutationAttempt | null>(null);
  const retirementCancellationAttempt = useRef<TopologyRetirementMutationAttempt | null>(null);
  const propertyRetirementAttempt = useRef<PropertyLifecycleAttempt | null>(null);
  const tenantScope = session ? tenantAccessScope(session.tenantId) : "";
  const propertyScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions([
    ...(tenantScope ? [{ permission: permissions.propertiesManage, scope: tenantScope }] : []),
    ...(propertyScope ? [
      { permission: permissions.propertiesManage, scope: propertyScope },
      { permission: permissions.roomsManage, scope: propertyScope },
      { permission: permissions.bedsManage, scope: propertyScope },
      { permission: permissions.inventoryRetire, scope: propertyScope },
    ] : []),
  ]);
  const mayCreateProperty = access.allows(permissions.propertiesManage, tenantScope);
  const mayManageProperty = access.allows(permissions.propertiesManage, propertyScope);
  const mayManageRooms = access.allows(permissions.roomsManage, propertyScope);
  const mayManageBeds = access.allows(permissions.bedsManage, propertyScope);
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
  const roomSource = createCompositeSource({
    label: "Room directory",
    hasData: rooms.data !== undefined,
    isLoading: rooms.isLoading,
    error: rooms.error,
    isFetching: rooms.isFetching,
    refetch: () => rooms.refetch(),
  });
  const roomsUsable = compositeSourceUsable(roomSource.state);
  const roomItems = roomsUsable ? rooms.data?.rooms ?? [] : [];
  const selectedRoom = roomItems.find((room) => room.roomId === selectedRoomId) ?? roomItems[0] ?? null;
  const beds = useQuery({
    queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId],
    queryFn: (context) => loadAllBeds(request, selectedPropertyId, selectedRoom!.roomId, context.signal),
    enabled: Boolean(selectedPropertyId && selectedRoom),
  });
  const bedSource = createCompositeSource({
    label: "Bed directory",
    hasData: beds.data !== undefined,
    isLoading: beds.isLoading,
    error: beds.error,
    isFetching: beds.isFetching,
    refetch: () => beds.refetch(),
  });
  const bedsUsable = compositeSourceUsable(bedSource.state);
  const bedItems = bedsUsable ? beds.data?.beds ?? emptyBeds : emptyBeds;
  const focusedResourceId = useTransientResourceFocus(
    roomsUsable && (!targetBedId || bedsUsable),
  );
  const focusedRoomId = focusedResourceId === targetRoomId ? targetRoomId : null;
  const focusedBedId = focusedResourceId === targetBedId ? targetBedId : null;
  const retirementProcess = useQuery({
    queryKey: ["topology-retirement", selectedPropertyId, retirementTarget?.kind, retirementOutcome?.topologyChangeId],
    queryFn: () => request<TopologyRetirement>(retirementTarget?.kind === "bed"
      ? `/api/inventory/properties/${selectedPropertyId}/bed-retirements/${retirementOutcome?.topologyChangeId}`
      : `/api/inventory/properties/${selectedPropertyId}/room-retirements/${retirementOutcome?.topologyChangeId}`),
    enabled: Boolean(retirementOutcome && (retirementTarget?.kind === "bed" || retirementTarget?.kind === "room")),
    initialData: retirementOutcome ?? undefined,
    refetchInterval: (query) => topologyRetirementNeedsLiveRefresh(query.state.data?.status)
      ? LIVE_DETAIL_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const retirementSource = retirementOutcome ? createCompositeSource({
    label: "Retirement status",
    hasData: retirementProcess.data !== undefined,
    isLoading: retirementProcess.isLoading,
    error: retirementProcess.error,
    isFetching: retirementProcess.isFetching,
    refetch: () => retirementProcess.refetch(),
  }) : null;
  const permissionsCurrent = compositeSourceCurrent(permissionSource);
  const propertyCurrent = compositeSourceCurrent(propertySource);
  const roomsCurrent = compositeSourceCurrent(roomSource);
  const bedsCurrent = compositeSourceCurrent(bedSource);
  const retirementCurrent = Boolean(
    retirementSource && compositeSourceCurrent(retirementSource),
  );
  const mutationEvidence = {
    permissionsCurrent,
    propertyCurrent,
    roomsCurrent,
    bedsCurrent,
    retirementCurrent,
  };
  const canCreateProperty = mayCreateProperty &&
    propertiesMutationAllowed("create-property", mutationEvidence);
  const canUpdateProperty = mayManageProperty &&
    propertiesMutationAllowed("update-property", mutationEvidence);
  const canCreateRoom = mayManageRooms &&
    propertiesMutationAllowed("create-room", mutationEvidence);
  const canUpdateRoom = mayManageRooms &&
    propertiesMutationAllowed("update-room", mutationEvidence);
  const canCreateBed = mayManageBeds &&
    propertiesMutationAllowed("create-bed", mutationEvidence);
  const canUpdateBed = mayManageBeds &&
    propertiesMutationAllowed("update-bed", mutationEvidence);
  const canRetireProperty = mayManageProperty &&
    propertiesMutationAllowed("update-property", mutationEvidence);
  const canRetireRoom = mayRetireInventory &&
    propertiesMutationAllowed("update-room", mutationEvidence);
  const canRetireBed = mayRetireInventory &&
    propertiesMutationAllowed("update-bed", mutationEvidence);
  const canControlRetirement = mayRetireInventory &&
    propertiesMutationAllowed("control-retirement", mutationEvidence);

  useEffect(() => {
    const updated = retirementProcess.data;
    if (!updated || !retirementOutcome || updated.version === retirementOutcome.version) return;
    setRetirementOutcome(updated);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["properties"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
    ]);
    void workspace.refetchProperties();
  }, [queryClient, retirementOutcome, retirementProcess.data, selectedPropertyId, workspace]);

  useEffect(() => {
    propertyCreateAttempt.current = null;
    propertyUpdateAttempt.current = null;
    roomMutationAttempt.current = null;
    bedMutationAttempt.current = null;
    retirementRequestAttempt.current = null;
    retirementRetryAttempt.current = null;
    retirementCancellationAttempt.current = null;
    propertyRetirementAttempt.current = null;
    setPropertyForm(null);
    setRoomForm(null);
    setBedForm(null);
    setRetirementTarget(null);
    setRetirementOutcome(null);
    setSelectedRoomId("");
  }, [selectedPropertyId]);

  useEffect(() => {
    if (!roomsCurrent) return;
    if (targetRoomId && roomItems.some((room) => room.roomId === targetRoomId)) {
      setSelectedRoomId(targetRoomId);
      return;
    }
    if (roomItems.length && !roomItems.some((room) => room.roomId === selectedRoomId)) setSelectedRoomId(roomItems[0].roomId);
    if (!roomItems.length) setSelectedRoomId("");
  }, [roomItems, roomsCurrent, selectedRoomId, targetRoomId]);

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

  const propertyMutation = useMutation({
    mutationFn: async (input: PropertyMutationInput) => {
      requireMutationAuthority(
        input.property
          ? canUpdateProperty && propertyRecordMatches(selectedProperty, input.property)
          : canCreateProperty,
        "Refresh property access and directory data before saving this property.",
      );
      if (input.property) {
        propertyUpdateAttempt.current = resolvePropertyUpdateAttempt(
          propertyUpdateAttempt.current,
          {
            propertyId: input.property.propertyId,
            expectedVersion: input.property.version,
            name: input.name,
            code: input.code,
            timeZoneId: input.timeZoneId,
          },
        );
        return request<PropertyMutationReceipt>(
          `/api/properties/${input.property.propertyId}`,
          {
            method: "PUT",
            body: JSON.stringify({
              operationId: propertyUpdateAttempt.current.operationId,
              name: input.name,
              code: input.code,
              timeZoneId: input.timeZoneId,
              expectedVersion: input.property.version,
            }),
          },
        );
      }

      propertyCreateAttempt.current = resolvePropertyCreateAttempt(
        propertyCreateAttempt.current,
        input,
      );
      return request<PropertyMutationReceipt>("/api/properties/", {
        method: "POST",
        body: JSON.stringify({
          operationId: propertyCreateAttempt.current.operationId,
          name: input.name,
          code: input.code,
          timeZoneId: input.timeZoneId,
        }),
      });
    },
    onSuccess: async (property) => {
      propertyCreateAttempt.current = null;
      propertyUpdateAttempt.current = null;
      await invalidateProperty();
      workspace.setSelectedPropertyId(property.propertyId);
      setPropertyForm(null);
    },
  });

  function closePropertyForm() {
    propertyCreateAttempt.current = null;
    propertyUpdateAttempt.current = null;
    propertyMutation.reset();
    setPropertyForm(null);
  }
  const roomMutation = useMutation({
    mutationFn: async (input: { room?: Room; name: string; buildingLabel: string; floorLabel: string }) => {
      requireMutationAuthority(
        input.room
          ? canUpdateRoom && roomRecordIsCurrent(roomItems, input.room)
          : canCreateRoom,
        "Refresh property access and topology data before saving this room.",
      );
      roomMutationAttempt.current = resolveRoomMutationAttempt(
        roomMutationAttempt.current,
        {
          propertyId: selectedPropertyId,
          roomId: input.room?.roomId,
          expectedVersion: input.room?.version ?? selectedProperty?.version ?? 0,
          name: input.name,
          buildingLabel: input.buildingLabel,
          floorLabel: input.floorLabel,
        },
      );
      return request<RoomMutationReceipt>(
        input.room
          ? `/api/properties/${selectedPropertyId}/rooms/${input.room.roomId}`
          : `/api/properties/${selectedPropertyId}/rooms`,
        {
          method: input.room ? "PUT" : "POST",
          body: JSON.stringify({
            operationId: roomMutationAttempt.current.operationId,
            name: input.name,
            buildingLabel: input.buildingLabel || null,
            floorLabel: input.floorLabel || null,
            ...(input.room
              ? { expectedVersion: roomMutationAttempt.current.expectedVersion }
              : { expectedPropertyVersion: roomMutationAttempt.current.expectedVersion }),
          }),
        },
      );
    },
    onSuccess: async (room) => {
      roomMutationAttempt.current = null;
      await invalidateProperty();
      setSelectedRoomId(room.roomId);
      setRoomForm(null);
    },
  });

  function closeRoomForm() {
    roomMutationAttempt.current = null;
    roomMutation.reset();
    setRoomForm(null);
  }
  const bedMutation = useMutation({
    mutationFn: async (input: BedMutationInput) => {
      requireMutationAuthority(
        input.bed
          ? canUpdateBed && bedRecordIsCurrent(bedItems, selectedRoom, input.bed)
          : canCreateBed,
        "Refresh property access, rooms, and beds before saving this change.",
      );
      if (!selectedRoom) throw new Error("Choose a room before adding beds.");
      bedMutationAttempt.current = resolveBedMutationAttempt(
        bedMutationAttempt.current,
        {
          propertyId: selectedPropertyId,
          roomId: selectedRoom.roomId,
          bedId: input.bed?.bedId,
          expectedRoomVersion: input.bed?.roomVersion ?? selectedRoom.version,
          labels: input.labels,
        },
      );
      if (input.bed) {
        return request<BedMutationReceipt>(`/api/properties/${selectedPropertyId}/rooms/${selectedRoom.roomId}/beds/${input.bed.bedId}`, {
          method: "PUT",
          body: JSON.stringify({
            operationId: bedMutationAttempt.current.operationId,
            label: input.labels[0],
            expectedRoomVersion: bedMutationAttempt.current.expectedRoomVersion,
          }),
        });
      }

      return request<BedBatchMutationReceipt>(
        `/api/properties/${selectedPropertyId}/rooms/${selectedRoom.roomId}/beds/batch`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: bedMutationAttempt.current.operationId,
            labels: input.labels,
            expectedRoomVersion: bedMutationAttempt.current.expectedRoomVersion,
          }),
        },
      );
    },
    onSuccess: async () => {
      bedMutationAttempt.current = null;
      await Promise.all([invalidateProperty(), queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId] })]);
      setBedForm(null);
    },
  });

  function closeBedForm() {
    bedMutationAttempt.current = null;
    bedMutation.reset();
    setBedForm(null);
  }
  const retireMutation = useMutation<TopologyRetirement | void, Error, RetirementMutationInput>({
    mutationFn: async ({ target, reason }) => {
      const targetCurrent = target.kind === "property"
        ? canRetireProperty && propertyRecordMatches(selectedProperty, target.entity)
        : target.kind === "room"
          ? canRetireRoom && roomRecordIsCurrent(roomItems, target.entity)
          : canRetireBed && bedRecordIsCurrent(bedItems, selectedRoom, target.entity);
      requireMutationAuthority(
        targetCurrent,
        "Refresh property access and topology data before starting retirement.",
      );
      if (target.kind === "bed") {
        retirementRequestAttempt.current = resolveTopologyRetirementRequestAttempt(
          retirementRequestAttempt.current,
          {
            propertyId: selectedPropertyId,
            targetKind: target.kind,
            roomId: target.roomId,
            targetId: target.entity.bedId,
            reason,
          },
        );
        return request<BedRetirement>(`/api/inventory/properties/${selectedPropertyId}/rooms/${target.roomId}/beds/${target.entity.bedId}/retirement`, {
          method: "POST",
          body: JSON.stringify(topologyRetirementRequestPayload(retirementRequestAttempt.current, reason)),
        });
      }
      if (target.kind === "room") {
        retirementRequestAttempt.current = resolveTopologyRetirementRequestAttempt(
          retirementRequestAttempt.current,
          {
            propertyId: selectedPropertyId,
            targetKind: target.kind,
            roomId: target.entity.roomId,
            targetId: target.entity.roomId,
            reason,
          },
        );
        return request<RoomRetirement>(`/api/inventory/properties/${selectedPropertyId}/rooms/${target.entity.roomId}/retirement`, {
          method: "POST",
          body: JSON.stringify(topologyRetirementRequestPayload(retirementRequestAttempt.current, reason)),
        });
      }
      propertyRetirementAttempt.current = resolvePropertySimpleLifecycleAttempt(
        propertyRetirementAttempt.current,
        "retirement",
        target.entity.propertyId,
        target.entity.version,
      );
      await request<PropertyMutationReceipt>(`/api/properties/${target.entity.propertyId}/retire`, {
        method: "POST",
        body: JSON.stringify({
          operationId: propertyRetirementAttempt.current.operationId,
          confirmed: true,
          expectedVersion: target.entity.version,
        }),
      });
    },
    onSuccess: async (result, input) => {
      if (input.target.kind === "property") propertyRetirementAttempt.current = null;
      else retirementRequestAttempt.current = null;
      await Promise.all([invalidateProperty(), queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId] })]);
      if (input.target.kind !== "property" && result) setRetirementOutcome(result);
      else setRetirementTarget(null);
    },
  });

  const retryRetirementMutation = useMutation<TopologyRetirement, Error, RetirementRetryInput>({
    mutationFn: async ({ target, outcome }) => {
      requireMutationAuthority(
        canControlRetirement,
        "Refresh property access and retirement status before retrying finalization.",
      );
      retirementRetryAttempt.current = resolveTopologyRetirementRetryAttempt(
        retirementRetryAttempt.current,
        {
          propertyId: selectedPropertyId,
          targetKind: target.kind,
          topologyChangeId: outcome.topologyChangeId,
          expectedVersion: outcome.version,
        },
      );
      return request<TopologyRetirement>(
        `/api/inventory/properties/${selectedPropertyId}/${target.kind}-retirements/${outcome.topologyChangeId}/retry`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: retirementRetryAttempt.current.operationId,
            expectedVersion: outcome.version,
          }),
        },
      );
    },
    onSuccess: async (result, input) => {
      retirementRetryAttempt.current = null;
      queryClient.setQueryData(
        ["topology-retirement", selectedPropertyId, input.target.kind, result.topologyChangeId],
        result,
      );
      setRetirementOutcome(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }),
        queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
      ]);
    },
  });

  const cancelRetirementMutation = useMutation<TopologyRetirement, Error, RetirementCancellationInput>({
    mutationFn: async ({ target, outcome, reason }) => {
      requireMutationAuthority(
        canControlRetirement,
        "Refresh property access and retirement status before stopping retirement.",
      );
      retirementCancellationAttempt.current = resolveTopologyRetirementCancellationAttempt(
        retirementCancellationAttempt.current,
        {
          propertyId: selectedPropertyId,
          targetKind: target.kind,
          topologyChangeId: outcome.topologyChangeId,
          expectedVersion: outcome.version,
          reason,
        },
      );
      return request<TopologyRetirement>(
        `/api/inventory/properties/${selectedPropertyId}/${target.kind}-retirements/${outcome.topologyChangeId}/cancel`,
        {
          method: "POST",
          body: JSON.stringify(topologyRetirementCancellationPayload(
            retirementCancellationAttempt.current,
            outcome.version,
            reason,
          )),
        },
      );
    },
    onSuccess: async (result, input) => {
      retirementCancellationAttempt.current = null;
      queryClient.setQueryData(
        ["topology-retirement", selectedPropertyId, input.target.kind, result.topologyChangeId],
        result,
      );
      setRetirementOutcome(result);
      await Promise.all([
        invalidateProperty(),
        queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId] }),
        queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] }),
      ]);
    },
  });
  const retirementNeedsAuthentication =
    Boolean(retirementTarget) &&
    isInsufficientAuthenticationError(retireMutation.error);
  const propertyCatalogueUsable = compositeSourceUsable(propertySource.state);
  const topologySources = selectedRoom ? [roomSource, bedSource] : [roomSource];
  const propertyFormCanSubmit = propertyForm?.property
    ? canUpdateProperty && propertyRecordMatches(selectedProperty, propertyForm.property)
    : canCreateProperty;
  const roomFormCanSubmit = roomForm?.room
    ? canUpdateRoom && roomRecordIsCurrent(roomItems, roomForm.room)
    : canCreateRoom;
  const bedFormCanSubmit = bedForm?.bed
    ? canUpdateBed && bedRecordIsCurrent(bedItems, selectedRoom, bedForm.bed)
    : canCreateBed;
  const retirementTargetMatchesCurrentSource = retirementTarget?.kind === "property"
    ? propertyRecordMatches(selectedProperty, retirementTarget.entity)
    : retirementTarget?.kind === "room"
      ? roomRecordIsCurrent(roomItems, retirementTarget.entity)
      : retirementTarget?.kind === "bed"
        ? bedRecordIsCurrent(bedItems, selectedRoom, retirementTarget.entity)
        : false;
  const canConfirmRetirement = retirementTarget?.kind === "property"
    ? canRetireProperty && retirementTargetMatchesCurrentSource
    : retirementTarget?.kind === "room"
      ? canRetireRoom && retirementTargetMatchesCurrentSource
      : retirementTarget?.kind === "bed"
        ? canRetireBed && retirementTargetMatchesCurrentSource
        : false;

  function retryRetirementAfterAuthentication() {
    const input = retireMutation.variables;
    if (!input) return;
    retireMutation.reset();
    retireMutation.mutate(input);
  }

  function closeRetirement() {
    propertyRetirementAttempt.current = null;
    retirementRequestAttempt.current = null;
    retirementRetryAttempt.current = null;
    retirementCancellationAttempt.current = null;
    retireMutation.reset();
    retryRetirementMutation.reset();
    cancelRetirementMutation.reset();
    setRetirementOutcome(null);
    setRetirementTarget(null);
  }

  return (
    <>
      <PageHeader
        eyebrow="Setup"
        title="Properties"
        description="Keep each hostel’s physical layout accurate so availability and reservations stay trustworthy."
        action={canCreateProperty ? (
          <button className="btn btn-primary" onClick={() => setPropertyForm({})}>
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
            <button className="btn btn-primary" onClick={() => setPropertyForm({})}>
              <Plus size={17} />Add property
            </button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-3">
            {workspace.properties.map((property) => (
              <button
                key={property.propertyId}
                onClick={() => workspace.setSelectedPropertyId(property.propertyId)}
                className={`w-full rounded-2xl border p-4 text-left transition ${property.propertyId === selectedPropertyId ? "border-primary bg-primary text-primary-content shadow-md" : "border-base-300 bg-base-100 hover:border-primary/35"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`grid size-10 place-items-center rounded-xl ${property.propertyId === selectedPropertyId ? "bg-primary-content/10" : "bg-primary/10 text-primary"}`}>
                    <Building2 size={19} />
                  </div>
                  <StatusBadge status={property.status} surface={property.propertyId === selectedPropertyId ? "dark" : "light"} />
                </div>
                <h2 className="mt-4 font-display text-lg font-semibold">{property.name}</h2>
                <p className={`mt-1 text-xs ${property.propertyId === selectedPropertyId ? "text-primary-content/55" : "text-base-content/45"}`}>{property.code} · {property.timeZoneId}</p>
              </button>
            ))}
          </aside>

          {selectedProperty && (
            <section className="min-w-0 space-y-6">
              <div className="card border border-base-300 bg-base-100 shadow-sm">
                <div className="card-body gap-5 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="font-display text-2xl font-semibold">{selectedProperty.name}</h2>
                        <StatusBadge status={selectedProperty.status} />
                      </div>
                      <p className="mt-2 flex items-center gap-2 text-sm text-base-content/50">
                        <MapPin size={15} />{selectedProperty.timeZoneId} · Code {selectedProperty.code}
                      </p>
                    </div>
                    {(canUpdateProperty || canRetireProperty) && (
                      <div className="flex gap-2">
                        {canUpdateProperty && (
                          <button className="btn btn-sm btn-ghost" onClick={() => setPropertyForm({ property: selectedProperty })}>
                            <Edit3 size={16} />Edit
                          </button>
                        )}
                        {canRetireProperty && (
                          <button className="btn btn-sm btn-ghost text-error" onClick={() => setRetirementTarget({ kind: "property", entity: selectedProperty })}>
                            <Trash2 size={16} />Retire
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <PropertyProcessingPanel
                property={selectedProperty}
                canManage={mayManageProperty}
                permissionsCurrent={permissionsCurrent}
                propertyCurrent={propertyCurrent}
                onChanged={invalidateProperty}
              />

              <div className="card border border-base-300 bg-base-100 shadow-sm">
                <div className="flex items-center justify-between border-b border-base-300 px-5 py-5 sm:px-6">
                  <div>
                    <h2 className="font-display text-xl font-semibold">Rooms & beds</h2>
                    <p className="mt-1 text-sm text-base-content/50">The physical topology used by inventory.</p>
                  </div>
                  {canCreateRoom && (
                    <button className="btn btn-sm btn-primary" onClick={() => setRoomForm({})}>
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
                      description="Add the first room, then assign beds or sell it as a whole room."
                      action={canCreateRoom ? (
                        <button className="btn btn-sm btn-primary" onClick={() => setRoomForm({})}>Add room</button>
                      ) : undefined}
                    />
                  </div>
                ) : (
                  <div className="grid min-h-[430px] md:grid-cols-[280px_1fr]">
                    <div className="border-b border-base-300 p-3 md:border-b-0 md:border-r">
                      {roomItems.map((room) => (
                        <button
                          key={room.roomId}
                          onClick={() => setSelectedRoomId(room.roomId)}
                          className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selectedRoom?.roomId === room.roomId ? "bg-base-200" : "hover:bg-base-200/60"} ${focusedRoomId === room.roomId ? focusedResourceClass : ""}`}
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
                    {selectedRoom && (
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
                                {canUpdateRoom && <li><button onClick={() => setRoomForm({ room: selectedRoom })}><Edit3 size={15} />Edit room</button></li>}
                                {canRetireRoom && <li><button className="text-error" onClick={() => setRetirementTarget({ kind: "room", entity: selectedRoom })}><Trash2 size={15} />Retire</button></li>}
                              </ul>
                            </div>
                          )}
                        </div>
                        <div className="my-5 flex items-center justify-between">
                          <p className="text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Beds</p>
                          {canCreateBed && <button className="btn btn-sm btn-outline" onClick={() => setBedForm({})}><Plus size={15} />Add bed</button>}
                        </div>
                        {!bedsUsable ? (
                          <CompositeSourceFallback state={bedSource.state} label="beds" />
                        ) : !bedItems.length ? (
                          <EmptyState
                            icon={<BedDouble />}
                            title="No beds in this room"
                            description="Add beds for bed-level sales, or configure the room for room-level inventory."
                            action={canCreateBed ? <button className="btn btn-sm btn-primary" onClick={() => setBedForm({})}>Add beds</button> : undefined}
                          />
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {bedItems.map((bed) => (
                              <div key={bed.bedId} className={`rounded-xl border border-base-300 p-4 ${focusedBedId === bed.bedId ? focusedResourceClass : ""}`}>
                                <div className="flex items-start justify-between">
                                  <div className="grid size-9 place-items-center rounded-lg bg-accent/15 text-accent-content"><BedDouble size={17} /></div>
                                  {(canUpdateBed || canRetireBed) && (
                                    <div className="dropdown dropdown-end">
                                      <button tabIndex={0} className="btn btn-circle btn-ghost btn-xs" aria-label={`Actions for ${bed.label}`}><MoreHorizontal size={15} /></button>
                                      <ul tabIndex={0} className="menu dropdown-content z-10 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
                                        {canUpdateBed && <li><button onClick={() => setBedForm({ bed })}>Edit</button></li>}
                                        {canRetireBed && <li><button className="text-error" onClick={() => setRetirementTarget({ kind: "bed", entity: bed, roomId: selectedRoom.roomId })}>Retire</button></li>}
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

      <PropertyForm state={propertyForm} canSubmit={propertyFormCanSubmit} mutation={propertyMutation} onClose={closePropertyForm} />
      <RoomForm state={roomForm} canSubmit={roomFormCanSubmit} mutation={roomMutation} onClose={closeRoomForm} />
      <BedForm state={bedForm} canSubmit={bedFormCanSubmit} existingBeds={bedItems} mutation={bedMutation} onClose={closeBedForm} />
      <TopologyRetirementModal
        target={retirementTarget}
        outcome={retirementProcess.data ?? retirementOutcome}
        canConfirm={canConfirmRetirement}
        canRetry={canControlRetirement}
        canCancel={canControlRetirement}
        pending={retireMutation.isPending}
        error={retirementNeedsAuthentication && canConfirmRetirement ? null : retireMutation.error}
        authenticationPrompt={retirementNeedsAuthentication && canConfirmRetirement ? (
          <RecentAuthenticationPrompt
            error={retireMutation.error}
            title={`Confirm your password to retire this ${retirementTarget?.kind ?? "topology"}`}
            description="Retirement is terminal and changes the topology available to the workspace."
            onAuthenticated={retryRetirementAfterAuthentication}
          />
        ) : null}
        refreshError={retirementProcess.error}
        retryPending={retryRetirementMutation.isPending}
        retryError={retryRetirementMutation.error}
        cancellationPending={cancelRetirementMutation.isPending}
        cancellationError={cancelRetirementMutation.error}
        onConfirm={(reason) => canConfirmRetirement && retirementTarget && retireMutation.mutate({ target: retirementTarget, reason })}
        onRefresh={() => void retirementProcess.refetch()}
        onRetry={() => {
          if (canControlRetirement && (retirementTarget?.kind === "bed" || retirementTarget?.kind === "room")) {
            const outcome = retirementProcess.data ?? retirementOutcome;
            if (outcome) retryRetirementMutation.mutate({ target: retirementTarget, outcome });
          }
        }}
        onCancelRetirement={(reason) => {
          if (canControlRetirement && (retirementTarget?.kind === "bed" || retirementTarget?.kind === "room")) {
            const outcome = retirementProcess.data ?? retirementOutcome;
            if (outcome) cancelRetirementMutation.mutate({ target: retirementTarget, outcome, reason });
          }
        }}
        onClose={closeRetirement}
      />
    </>
  );
}

function requireMutationAuthority(allowed: boolean, message: string): void {
  if (!allowed) throw new Error(message);
}

function PropertyForm({ state, canSubmit, mutation, onClose }: {
  state: PropertyFormState;
  canSubmit: boolean;
  mutation: ReturnType<typeof useMutation<PropertyMutationReceipt, Error, PropertyMutationInput>>;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      property: state?.property,
      name: String(data.get("name")),
      code: String(data.get("code")).toUpperCase(),
      timeZoneId: String(data.get("timeZoneId")),
    });
  }

  return (
    <Modal
      open={Boolean(state)}
      title={state?.property ? "Edit property" : "New property"}
      description="Property details are shared across topology, inventory and reservations."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {!canSubmit && state && <MutationAuthorityNotice label="property" />}
        <Input label="Property name" name="name" defaultValue={state?.property?.name} placeholder="Harbour House Hostel" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Short code" name="code" defaultValue={state?.property?.code} placeholder="HBR" maxLength={16} />
          <TimeZoneSelect defaultValue={state?.property?.timeZoneId} />
        </div>
        {mutation.error && <ErrorState error={mutation.error} title="Couldn't save the property" />}
        <FormActions
          submitting={mutation.isPending}
          disabled={!canSubmit}
          submitLabel={state?.property ? "Save changes" : "Create property"}
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

function RoomForm({ state, canSubmit, mutation, onClose }: {
  state: RoomFormState;
  canSubmit: boolean;
  mutation: ReturnType<typeof useMutation<RoomMutationReceipt, Error, {
    room?: Room;
    name: string;
    buildingLabel: string;
    floorLabel: string;
  }>>;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      room: state?.room,
      name: String(data.get("name")),
      buildingLabel: String(data.get("buildingLabel")),
      floorLabel: String(data.get("floorLabel")),
    });
  }

  return (
    <Modal
      open={Boolean(state)}
      title={state?.room ? "Edit room" : "Add room"}
      description="Use labels your staff will recognize at a glance."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {!canSubmit && state && <MutationAuthorityNotice label="room" />}
        <Input label="Room name or number" name="name" defaultValue={state?.room?.name} placeholder="Room 204" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Building (optional)" name="buildingLabel" defaultValue={state?.room?.buildingLabel ?? ""} placeholder="Main building" required={false} />
          <Input label="Floor (optional)" name="floorLabel" defaultValue={state?.room?.floorLabel ?? ""} placeholder="Second floor" required={false} />
        </div>
        {mutation.error && <ErrorState error={mutation.error} title="Couldn't save the room" />}
        <FormActions
          submitting={mutation.isPending}
          disabled={!canSubmit}
          submitLabel={state?.room ? "Save room" : "Add room"}
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

function BedForm({ state, canSubmit, existingBeds, mutation, onClose }: {
  state: BedFormState;
  canSubmit: boolean;
  existingBeds: Bed[];
  mutation: ReturnType<typeof useMutation<BedMutationResult, Error, BedMutationInput>>;
  onClose: () => void;
}) {
  const editing = Boolean(state?.bed);
  return (
    <Modal
      open={Boolean(state)}
      title={editing ? "Edit bed" : "Add beds"}
      description={editing ? "Keep the label short and easy to find in the room." : "Choose how many beds the room has, then customize any labels you need."}
      onClose={onClose}
    >
      {state && (
        <BedFormFields
          state={state}
          canSubmit={canSubmit}
          existingBeds={existingBeds}
          mutation={mutation}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function BedFormFields({ state, canSubmit, existingBeds, mutation, onClose }: {
  state: NonNullable<BedFormState>;
  canSubmit: boolean;
  existingBeds: Bed[];
  mutation: ReturnType<typeof useMutation<BedMutationResult, Error, BedMutationInput>>;
  onClose: () => void;
}) {
  const existingLabels = useMemo(
    () => existingBeds.filter((bed) => bed.bedId !== state?.bed?.bedId).map((bed) => bed.label),
    [existingBeds, state?.bed?.bedId],
  );
  const [count, setCount] = useState(1);
  const [labels, setLabels] = useState<string[]>(() => state.bed ? [state.bed.label] : createDefaultBedLabels(1, existingLabels));
  const [formError, setFormError] = useState("");

  function changeCount(rawCount: number) {
    const nextCount = Math.max(1, Math.min(50, Math.trunc(rawCount) || 1));
    setCount(nextCount);
    setLabels((current) => createDefaultBedLabels(nextCount, existingLabels, current));
    setFormError("");
  }

  function changeLabel(index: number, label: string) {
    setLabels((current) => current.map((value, currentIndex) => currentIndex === index ? label : value));
    setFormError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const normalizedLabels = labels.map((label) => label.trim());
    if (normalizedLabels.some((label) => !label)) {
      setFormError("Every bed needs a label.");
      return;
    }
    const duplicate = duplicateBedLabel(normalizedLabels);
    if (duplicate) {
      setFormError(`Bed label ${duplicate} is used more than once.`);
      return;
    }
    const existingDuplicate = normalizedLabels.find((label) => existingLabels.includes(label));
    if (existingDuplicate) {
      setFormError(`A bed labeled ${existingDuplicate} already exists in this room.`);
      return;
    }
    mutation.mutate({ bed: state?.bed, labels: normalizedLabels });
  }

  const editing = Boolean(state?.bed);
  return (
    <form onSubmit={submit} className="space-y-4">
      {!canSubmit && <MutationAuthorityNotice label="bed directory" />}
      {!editing && (
        <label className="form-control block max-w-40">
          <span className="label-text mb-1.5 block text-sm font-semibold">Number of beds</span>
          <input className="input input-bordered w-full" type="number" min={1} max={50} value={count} onChange={(event) => changeCount(Number(event.target.value))} />
        </label>
      )}
      <div>
        <div className="mb-3">
          <p className="text-sm font-semibold">{editing ? "Bed label" : "Bed labels"}</p>
          {!editing && <p className="mt-1 text-xs text-base-content/50">Numbered automatically. Edit only the labels you want to change.</p>}
        </div>
        <div className="grid gap-3 sm:max-h-64 sm:grid-cols-2 sm:overflow-y-auto sm:pr-1">
          {labels.map((label, index) => (
            <label key={index} className="form-control block">
              <span className="label-text mb-1.5 block text-xs font-semibold">{editing ? "Label" : `Bed ${index + 1}`}</span>
              <input className="input input-bordered w-full" value={label} maxLength={128} onChange={(event) => changeLabel(index, event.target.value)} required />
            </label>
          ))}
        </div>
      </div>
      {(formError || mutation.error) && <ErrorState error={formError || mutation.error} title={editing ? "Couldn't save the bed" : "Couldn't add the beds"} />}
      <FormActions
        submitting={mutation.isPending}
        disabled={!canSubmit}
        submitLabel={editing ? "Save bed" : count === 1 ? "Add bed" : `Add ${count} beds`}
        onCancel={onClose}
      />
    </form>
  );
}

function MutationAuthorityNotice({ label }: { label: string }) {
  return (
    <div className="alert border border-warning/25 bg-warning/10 text-base-content" role="status">
      <AlertTriangle size={18} className="text-warning-content" />
      <p className="text-sm">Refresh property access and current {label} data before saving.</p>
    </div>
  );
}

function TimeZoneSelect({ defaultValue }: { defaultValue?: string }) {
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const selectedValue = defaultValue ?? browserTimeZone;
  const [value, setValue] = useState(selectedValue);
  const options = useMemo(() => {
    const values = supportedTimeZones();
    return values.includes(selectedValue) ? values : [selectedValue, ...values];
  }, [selectedValue]);

  return (
    <div className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">Time zone</span>
      <SelectPicker
        className="w-full"
        name="timeZoneId"
        value={value}
        onValueChange={setValue}
        ariaLabel="Time zone"
        options={options.map((timeZoneId) => ({
          value: timeZoneId,
          label: timeZoneLabel(timeZoneId),
          description: timeZoneDescription(timeZoneId),
        }))}
      />
    </div>
  );
}

function Input({ label, name, defaultValue, placeholder, required = true, maxLength }: { label: string; name: string; defaultValue?: string; placeholder?: string; required?: boolean; maxLength?: number }) {
  return <label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} defaultValue={defaultValue} placeholder={placeholder} required={required} maxLength={maxLength} /></label>;
}
