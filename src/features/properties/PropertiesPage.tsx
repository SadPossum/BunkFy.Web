import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Building2, Edit3, Layers3, MapPin, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { Bed, BedListResponse, BedRetirement, Property, Room, RoomListResponse, RoomRetirement, TopologyRetirement } from "../../api/types";
import { LIVE_DETAIL_REFRESH_INTERVAL_MS, topologyRetirementNeedsLiveRefresh } from "../../app/liveUpdates";
import { permissions, propertyAccessScope, tenantAccessScope, usePermissions } from "../../app/permissions";
import { focusedResourceClass, useTargetProperty, useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, FormActions, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  createDefaultBedLabels,
  duplicateBedLabel,
  supportedTimeZones,
  timeZoneDescription,
  timeZoneLabel,
} from "./propertyFormOptions";
import { PropertyProcessingPanel } from "./PropertyProcessingPanel";
import { TopologyRetirementModal, type RetirementTarget } from "./TopologyRetirementModal";

type PropertyFormState = { property?: Property } | null;
type RoomFormState = { room?: Room } | null;
type BedFormState = { bed?: Bed } | null;
type BedMutationInput = { bed?: Bed; labels: string[] };
type RetirementMutationInput = { target: RetirementTarget; reason: string };
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
  const [roomForm, setRoomForm] = useState<RoomFormState>(null);
  const [bedForm, setBedForm] = useState<BedFormState>(null);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [retirementTarget, setRetirementTarget] = useState<RetirementTarget | null>(null);
  const [retirementOutcome, setRetirementOutcome] = useState<TopologyRetirement | null>(null);
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
      { permission: permissions.inventoryConfigure, scope: propertyScope },
    ] : []),
  ]);
  const canCreateProperty = access.allows(permissions.propertiesManage, tenantScope);
  const canManageProperty = access.allows(permissions.propertiesManage, propertyScope);
  const canManageRooms = access.allows(permissions.roomsManage, propertyScope);
  const canManageBeds = access.allows(permissions.bedsManage, propertyScope);
  const canConfigureInventory = access.allows(permissions.inventoryConfigure, propertyScope);

  const rooms = useQuery({
    queryKey: ["rooms", selectedPropertyId],
    queryFn: () => request<RoomListResponse>(`/api/properties/${selectedPropertyId}/rooms?page=1&pageSize=100`),
    enabled: Boolean(selectedPropertyId),
  });
  const roomItems = rooms.data?.rooms ?? [];
  const selectedRoom = roomItems.find((room) => room.roomId === selectedRoomId) ?? roomItems[0] ?? null;
  const beds = useQuery({
    queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId],
    queryFn: () => request<BedListResponse>(`/api/properties/${selectedPropertyId}/rooms/${selectedRoom?.roomId}/beds?page=1&pageSize=100`),
    enabled: Boolean(selectedPropertyId && selectedRoom),
  });
  const bedItems = beds.data?.beds ?? emptyBeds;
  const focusedResourceId = useTransientResourceFocus(Boolean(rooms.data && (!targetBedId || beds.data)));
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
    if (targetRoomId && roomItems.some((room) => room.roomId === targetRoomId)) {
      setSelectedRoomId(targetRoomId);
      return;
    }
    if (roomItems.length && !roomItems.some((room) => room.roomId === selectedRoomId)) setSelectedRoomId(roomItems[0].roomId);
    if (!roomItems.length) setSelectedRoomId("");
  }, [roomItems, selectedRoomId, targetRoomId]);

  const invalidateProperty = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["properties"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }),
    ]);
    await workspace.refetchProperties();
  };

  const propertyMutation = useMutation({
    mutationFn: async (input: { property?: Property; name: string; code: string; timeZoneId: string }) => request<Property>(input.property ? `/api/properties/${input.property.propertyId}` : "/api/properties/", {
      method: input.property ? "PUT" : "POST",
      body: JSON.stringify({ name: input.name, code: input.code, timeZoneId: input.timeZoneId, ...(input.property ? { expectedVersion: input.property.version } : {}) }),
    }),
    onSuccess: async (property) => { await invalidateProperty(); workspace.setSelectedPropertyId(property.propertyId); setPropertyForm(null); },
  });
  const roomMutation = useMutation({
    mutationFn: async (input: { room?: Room; name: string; buildingLabel: string; floorLabel: string }) => request<Room>(input.room ? `/api/properties/${selectedPropertyId}/rooms/${input.room.roomId}` : `/api/properties/${selectedPropertyId}/rooms`, {
      method: input.room ? "PUT" : "POST",
      body: JSON.stringify({ name: input.name, buildingLabel: input.buildingLabel || null, floorLabel: input.floorLabel || null, ...(input.room ? { expectedVersion: input.room.version } : { expectedPropertyVersion: selectedProperty?.version ?? 0 }) }),
    }),
    onSuccess: async (room) => { await invalidateProperty(); setSelectedRoomId(room.roomId); setRoomForm(null); },
  });
  const bedMutation = useMutation({
    mutationFn: async (input: BedMutationInput) => {
      if (!selectedRoom) throw new Error("Choose a room before adding beds.");
      if (input.bed) {
        return [await request<Bed>(`/api/properties/${selectedPropertyId}/rooms/${selectedRoom.roomId}/beds/${input.bed.bedId}`, {
          method: "PUT",
          body: JSON.stringify({ label: input.labels[0], expectedRoomVersion: input.bed.roomVersion }),
        })];
      }

      const createdBeds: Bed[] = [];
      let expectedRoomVersion = selectedRoom.version;
      for (const label of input.labels) {
        try {
          const createdBed = await request<Bed>(`/api/properties/${selectedPropertyId}/rooms/${selectedRoom.roomId}/beds`, {
            method: "POST",
            body: JSON.stringify({ label, expectedRoomVersion }),
          });
          createdBeds.push(createdBed);
          expectedRoomVersion = createdBed.roomVersion;
        } catch (error) {
          if (createdBeds.length > 0) {
            throw new Error(`${createdBeds.length} ${createdBeds.length === 1 ? "bed was" : "beds were"} added before the remaining request failed. Refresh the list and try the remaining labels.`, { cause: error });
          }
          throw error;
        }
      }
      return createdBeds;
    },
    onSuccess: async () => { await Promise.all([invalidateProperty(), queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId] })]); setBedForm(null); },
    onError: async () => { await Promise.all([invalidateProperty(), queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId] })]); },
  });
  const retireMutation = useMutation<TopologyRetirement | void, Error, RetirementMutationInput>({
    mutationFn: async ({ target, reason }) => {
      if (target.kind === "bed") {
        return request<BedRetirement>(`/api/inventory/properties/${selectedPropertyId}/rooms/${target.roomId}/beds/${target.entity.bedId}/retirement`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
      }
      if (target.kind === "room") {
        return request<RoomRetirement>(`/api/inventory/properties/${selectedPropertyId}/rooms/${target.entity.roomId}/retirement`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
      }
      await request<void>(`/api/properties/${target.entity.propertyId}/retire`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true, expectedVersion: target.entity.version }),
      });
    },
    onSuccess: async (result, input) => {
      await Promise.all([invalidateProperty(), queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId] })]);
      if (input.target.kind !== "property" && result) setRetirementOutcome(result);
      else setRetirementTarget(null);
    },
  });

  function closeRetirement() {
    retireMutation.reset();
    setRetirementOutcome(null);
    setRetirementTarget(null);
  }

  if (workspace.propertiesLoading) return <LoadingState />;
  if (workspace.propertiesError) return <ErrorState error={workspace.propertiesError} />;

  return (
    <>
      <PageHeader eyebrow="Setup" title="Properties" description="Keep each hostel’s physical layout accurate so availability and reservations stay trustworthy." action={canCreateProperty ? <button className="btn btn-primary" onClick={() => setPropertyForm({})}><Plus size={17} />New property</button> : undefined} />

      {!workspace.properties.length ? <EmptyState icon={<Building2 />} title="No properties yet" description="Create your first hostel property to begin adding rooms and beds." action={canCreateProperty ? <button className="btn btn-primary" onClick={() => setPropertyForm({})}><Plus size={17} />Add property</button> : undefined} /> : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-3">
            {workspace.properties.map((property) => (
              <button key={property.propertyId} onClick={() => workspace.setSelectedPropertyId(property.propertyId)} className={`w-full rounded-2xl border p-4 text-left transition ${property.propertyId === selectedPropertyId ? "border-primary bg-primary text-primary-content shadow-md" : "border-base-300 bg-base-100 hover:border-primary/35"}`}>
                <div className="flex items-start justify-between gap-3"><div className={`grid size-10 place-items-center rounded-xl ${property.propertyId === selectedPropertyId ? "bg-primary-content/10" : "bg-primary/10 text-primary"}`}><Building2 size={19} /></div><StatusBadge status={property.status} surface={property.propertyId === selectedPropertyId ? "dark" : "light"} /></div>
                <h2 className="mt-4 font-display text-lg font-semibold">{property.name}</h2>
                <p className={`mt-1 text-xs ${property.propertyId === selectedPropertyId ? "text-primary-content/55" : "text-base-content/45"}`}>{property.code} · {property.timeZoneId}</p>
              </button>
            ))}
          </aside>

          {selectedProperty && <section className="min-w-0 space-y-6">
            <div className="card border border-base-300 bg-base-100 shadow-sm"><div className="card-body gap-5 p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-3"><h2 className="font-display text-2xl font-semibold">{selectedProperty.name}</h2><StatusBadge status={selectedProperty.status} /></div><p className="mt-2 flex items-center gap-2 text-sm text-base-content/50"><MapPin size={15} />{selectedProperty.timeZoneId} · Code {selectedProperty.code}</p></div>{canManageProperty && <div className="flex gap-2"><button className="btn btn-sm btn-ghost" onClick={() => setPropertyForm({ property: selectedProperty })}><Edit3 size={16} />Edit</button><button className="btn btn-sm btn-ghost text-error" onClick={() => setRetirementTarget({ kind: "property", entity: selectedProperty })}><Trash2 size={16} />Retire</button></div>}</div></div></div>

            <PropertyProcessingPanel
              property={selectedProperty}
              canManage={canManageProperty}
              onChanged={invalidateProperty}
            />

            <div className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="flex items-center justify-between border-b border-base-300 px-5 py-5 sm:px-6"><div><h2 className="font-display text-xl font-semibold">Rooms & beds</h2><p className="mt-1 text-sm text-base-content/50">The physical topology used by inventory.</p></div>{canManageRooms && <button className="btn btn-sm btn-primary" onClick={() => setRoomForm({})}><Plus size={16} />Add room</button>}</div>
              {rooms.isLoading ? <LoadingState label="Loading rooms" /> : rooms.error ? <div className="p-6"><ErrorState error={rooms.error} /></div> : !roomItems.length ? <div className="p-6"><EmptyState icon={<Layers3 />} title="No rooms configured" description="Add the first room, then assign beds or sell it as a whole room." action={canManageRooms ? <button className="btn btn-sm btn-primary" onClick={() => setRoomForm({})}>Add room</button> : undefined} /></div> : (
                <div className="grid min-h-[430px] md:grid-cols-[280px_1fr]">
                  <div className="border-b border-base-300 p-3 md:border-b-0 md:border-r">
                    {roomItems.map((room) => <button key={room.roomId} onClick={() => setSelectedRoomId(room.roomId)} className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selectedRoom?.roomId === room.roomId ? "bg-base-200" : "hover:bg-base-200/60"} ${focusedRoomId === room.roomId ? focusedResourceClass : ""}`}><div className="grid size-9 place-items-center rounded-lg bg-secondary/15 text-secondary"><BedDouble size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{room.name}</p><p className="truncate text-xs text-base-content/40">{[room.buildingLabel, room.floorLabel].filter(Boolean).join(" · ") || "No location labels"}</p></div><MoreHorizontal size={16} className="text-base-content/30" /></button>)}
                  </div>
                  {selectedRoom && <div className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-display text-xl font-semibold">{selectedRoom.name}</h3><StatusBadge status={selectedRoom.status} /></div><p className="mt-1 text-sm text-base-content/45">{[selectedRoom.buildingLabel, selectedRoom.floorLabel].filter(Boolean).join(" · ") || "No building or floor label"}</p></div>{canManageRooms && <div className="dropdown dropdown-end"><button tabIndex={0} className="btn btn-circle btn-ghost btn-sm" aria-label={`Actions for ${selectedRoom.name}`}><MoreHorizontal size={18} /></button><ul tabIndex={0} className="menu dropdown-content z-10 w-40 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"><li><button onClick={() => setRoomForm({ room: selectedRoom })}><Edit3 size={15} />Edit room</button></li>{canConfigureInventory && <li><button className="text-error" onClick={() => setRetirementTarget({ kind: "room", entity: selectedRoom })}><Trash2 size={15} />Retire</button></li>}</ul></div>}</div>
                    <div className="my-5 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Beds</p>{canManageBeds && <button className="btn btn-sm btn-outline" onClick={() => setBedForm({})}><Plus size={15} />Add bed</button>}</div>
                    {beds.isLoading ? <LoadingState label="Loading beds" /> : beds.error ? <ErrorState error={beds.error} /> : !bedItems.length ? <EmptyState icon={<BedDouble />} title="No beds in this room" description="Add beds for bed-level sales, or configure the room for room-level inventory." action={canManageBeds ? <button className="btn btn-sm btn-primary" onClick={() => setBedForm({})}>Add beds</button> : undefined} /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{bedItems.map((bed) => <div key={bed.bedId} className={`rounded-xl border border-base-300 p-4 ${focusedBedId === bed.bedId ? focusedResourceClass : ""}`}><div className="flex items-start justify-between"><div className="grid size-9 place-items-center rounded-lg bg-accent/15 text-accent-content"><BedDouble size={17} /></div>{canManageBeds && <div className="dropdown dropdown-end"><button tabIndex={0} className="btn btn-circle btn-ghost btn-xs" aria-label={`Actions for ${bed.label}`}><MoreHorizontal size={15} /></button><ul tabIndex={0} className="menu dropdown-content z-10 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"><li><button onClick={() => setBedForm({ bed })}>Edit</button></li>{canConfigureInventory && <li><button className="text-error" onClick={() => setRetirementTarget({ kind: "bed", entity: bed, roomId: selectedRoom.roomId })}>Retire</button></li>}</ul></div>}</div><p className="mt-3 font-semibold">{bed.label}</p><div className="mt-2"><StatusBadge status={bed.status} /></div></div>)}</div>}
                  </div>}
                </div>
              )}
            </div>
          </section>}
        </div>
      )}

      <PropertyForm state={(propertyForm?.property ? canManageProperty : canCreateProperty) ? propertyForm : null} mutation={propertyMutation} onClose={() => setPropertyForm(null)} />
      <RoomForm state={canManageRooms ? roomForm : null} mutation={roomMutation} onClose={() => setRoomForm(null)} />
      <BedForm state={canManageBeds ? bedForm : null} existingBeds={bedItems} mutation={bedMutation} onClose={() => { bedMutation.reset(); setBedForm(null); }} />
      <TopologyRetirementModal
        target={retirementTarget}
        outcome={retirementProcess.data ?? retirementOutcome}
        pending={retireMutation.isPending}
        error={retireMutation.error || retirementProcess.error}
        onConfirm={(reason) => retirementTarget && retireMutation.mutate({ target: retirementTarget, reason })}
        onClose={closeRetirement}
      />
    </>
  );
}

function PropertyForm({ state, mutation, onClose }: { state: PropertyFormState; mutation: ReturnType<typeof useMutation<Property, Error, { property?: Property; name: string; code: string; timeZoneId: string }>>; onClose: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ property: state?.property, name: String(data.get("name")), code: String(data.get("code")).toUpperCase(), timeZoneId: String(data.get("timeZoneId")) }); }
  return <Modal open={Boolean(state)} title={state?.property ? "Edit property" : "New property"} description="Property details are shared across topology, inventory and reservations." onClose={onClose}><form onSubmit={submit} className="space-y-4"><Input label="Property name" name="name" defaultValue={state?.property?.name} placeholder="Harbour House Hostel" /><div className="grid gap-4 sm:grid-cols-2"><Input label="Short code" name="code" defaultValue={state?.property?.code} placeholder="HBR" maxLength={16} /><TimeZoneSelect defaultValue={state?.property?.timeZoneId} /></div>{mutation.error && <ErrorState error={mutation.error} title="Couldn't save the property" />}<FormActions submitting={mutation.isPending} submitLabel={state?.property ? "Save changes" : "Create property"} onCancel={onClose} /></form></Modal>;
}

function RoomForm({ state, mutation, onClose }: { state: RoomFormState; mutation: ReturnType<typeof useMutation<Room, Error, { room?: Room; name: string; buildingLabel: string; floorLabel: string }>>; onClose: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ room: state?.room, name: String(data.get("name")), buildingLabel: String(data.get("buildingLabel")), floorLabel: String(data.get("floorLabel")) }); }
  return <Modal open={Boolean(state)} title={state?.room ? "Edit room" : "Add room"} description="Use labels your staff will recognize at a glance." onClose={onClose}><form onSubmit={submit} className="space-y-4"><Input label="Room name or number" name="name" defaultValue={state?.room?.name} placeholder="Room 204" /><div className="grid gap-4 sm:grid-cols-2"><Input label="Building (optional)" name="buildingLabel" defaultValue={state?.room?.buildingLabel ?? ""} placeholder="Main building" required={false} /><Input label="Floor (optional)" name="floorLabel" defaultValue={state?.room?.floorLabel ?? ""} placeholder="Second floor" required={false} /></div>{mutation.error && <ErrorState error={mutation.error} />}<FormActions submitting={mutation.isPending} submitLabel={state?.room ? "Save room" : "Add room"} onCancel={onClose} /></form></Modal>;
}

function BedForm({ state, existingBeds, mutation, onClose }: { state: BedFormState; existingBeds: Bed[]; mutation: ReturnType<typeof useMutation<Bed[], Error, BedMutationInput>>; onClose: () => void }) {
  const editing = Boolean(state?.bed);
  return <Modal open={Boolean(state)} title={editing ? "Edit bed" : "Add beds"} description={editing ? "Keep the label short and easy to find in the room." : "Choose how many beds the room has, then customize any labels you need."} onClose={onClose}>{state && <BedFormFields state={state} existingBeds={existingBeds} mutation={mutation} onClose={onClose} />}</Modal>;
}

function BedFormFields({ state, existingBeds, mutation, onClose }: { state: NonNullable<BedFormState>; existingBeds: Bed[]; mutation: ReturnType<typeof useMutation<Bed[], Error, BedMutationInput>>; onClose: () => void }) {
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
  return <form onSubmit={submit} className="space-y-4">{!editing && <label className="form-control block max-w-40"><span className="label-text mb-1.5 block text-sm font-semibold">Number of beds</span><input className="input input-bordered w-full" type="number" min={1} max={50} value={count} onChange={(event) => changeCount(Number(event.target.value))} /></label>}<div><div className="mb-3"><p className="text-sm font-semibold">{editing ? "Bed label" : "Bed labels"}</p>{!editing && <p className="mt-1 text-xs text-base-content/50">Numbered automatically. Edit only the labels you want to change.</p>}</div><div className="grid gap-3 sm:max-h-64 sm:grid-cols-2 sm:overflow-y-auto sm:pr-1">{labels.map((label, index) => <label key={index} className="form-control block"><span className="label-text mb-1.5 block text-xs font-semibold">{editing ? "Label" : `Bed ${index + 1}`}</span><input className="input input-bordered w-full" value={label} maxLength={128} onChange={(event) => changeLabel(index, event.target.value)} required /></label>)}</div></div>{(formError || mutation.error) && <ErrorState error={formError || mutation.error} title={editing ? "Couldn't save the bed" : "Couldn't add the beds"} />}<FormActions submitting={mutation.isPending} submitLabel={editing ? "Save bed" : count === 1 ? "Add bed" : `Add ${count} beds`} onCancel={onClose} /></form>;
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
