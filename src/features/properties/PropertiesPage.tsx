import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Building2, Edit3, Layers3, MapPin, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { Bed, BedListResponse, Property, Room, RoomListResponse } from "../../api/types";
import { permissions, propertyAccessScope, tenantAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, FormActions, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";

type PropertyFormState = { property?: Property } | null;
type RoomFormState = { room?: Room } | null;
type BedFormState = { bed?: Bed } | null;

export function PropertiesPage() {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const { selectedProperty, selectedPropertyId } = workspace;
  const [propertyForm, setPropertyForm] = useState<PropertyFormState>(null);
  const [roomForm, setRoomForm] = useState<RoomFormState>(null);
  const [bedForm, setBedForm] = useState<BedFormState>(null);
  const [selectedRoomId, setSelectedRoomId] = useState("");
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
    ] : []),
  ]);
  const canCreateProperty = access.allows(permissions.propertiesManage, tenantScope);
  const canManageProperty = access.allows(permissions.propertiesManage, propertyScope);
  const canManageRooms = access.allows(permissions.roomsManage, propertyScope);
  const canManageBeds = access.allows(permissions.bedsManage, propertyScope);

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

  useEffect(() => {
    if (roomItems.length && !roomItems.some((room) => room.roomId === selectedRoomId)) setSelectedRoomId(roomItems[0].roomId);
    if (!roomItems.length) setSelectedRoomId("");
  }, [roomItems, selectedRoomId]);

  const invalidateProperty = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["properties"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", selectedPropertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }),
    ]);
    workspace.refetchProperties();
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
    mutationFn: async (input: { bed?: Bed; label: string }) => request<Bed>(input.bed ? `/api/properties/${selectedPropertyId}/rooms/${selectedRoom?.roomId}/beds/${input.bed.bedId}` : `/api/properties/${selectedPropertyId}/rooms/${selectedRoom?.roomId}/beds`, {
      method: input.bed ? "PUT" : "POST",
      body: JSON.stringify({ label: input.label, expectedRoomVersion: input.bed?.roomVersion ?? selectedRoom?.version ?? 0 }),
    }),
    onSuccess: async () => { await Promise.all([invalidateProperty(), queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId] })]); setBedForm(null); },
  });
  const retireMutation = useMutation({
    mutationFn: async ({ kind, entity }: { kind: "property" | "room" | "bed"; entity: Property | Room | Bed }) => {
      const path = kind === "property" ? `/api/properties/${entity.propertyId}/retire` : kind === "room" ? `/api/properties/${selectedPropertyId}/rooms/${(entity as Room).roomId}/retire` : `/api/properties/${selectedPropertyId}/rooms/${selectedRoom?.roomId}/beds/${(entity as Bed).bedId}/retire`;
      const version = kind === "bed" ? (entity as Bed).roomVersion : entity.version;
      await request<void>(path, { method: "POST", body: JSON.stringify(kind === "room" ? { confirmed: true, expectedVersion: version, cascadeBeds: false } : kind === "bed" ? { confirmed: true, expectedRoomVersion: version } : { confirmed: true, expectedVersion: version }) });
    },
    onSuccess: async () => { await Promise.all([invalidateProperty(), queryClient.invalidateQueries({ queryKey: ["beds", selectedPropertyId, selectedRoom?.roomId] })]); },
  });

  if (workspace.propertiesLoading) return <LoadingState />;
  if (workspace.propertiesError) return <ErrorState error={workspace.propertiesError} />;

  return (
    <>
      <PageHeader eyebrow="Setup" title="Properties" description="Keep each hostel’s physical layout accurate so availability and reservations stay trustworthy." action={canCreateProperty ? <button className="btn btn-primary" onClick={() => setPropertyForm({})}><Plus size={17} />New property</button> : undefined} />

      {!workspace.properties.length ? <EmptyState icon={<Building2 />} title="No properties yet" description="Create your first hostel property to begin adding rooms and beds." action={canCreateProperty ? <button className="btn btn-primary" onClick={() => setPropertyForm({})}><Plus size={17} />Add property</button> : undefined} /> : (
        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <aside className="space-y-3">
            {workspace.properties.map((property) => (
              <button key={property.propertyId} onClick={() => workspace.setSelectedPropertyId(property.propertyId)} className={`w-full rounded-2xl border p-4 text-left transition ${property.propertyId === selectedPropertyId ? "border-primary bg-primary text-primary-content shadow-md" : "border-base-300 bg-base-100 hover:border-primary/35"}`}>
                <div className="flex items-start justify-between gap-3"><div className={`grid size-10 place-items-center rounded-xl ${property.propertyId === selectedPropertyId ? "bg-primary-content/10" : "bg-primary/10 text-primary"}`}><Building2 size={19} /></div><StatusBadge status={property.status} surface={property.propertyId === selectedPropertyId ? "dark" : "light"} /></div>
                <h2 className="mt-4 font-display text-lg font-semibold">{property.name}</h2>
                <p className={`mt-1 text-xs ${property.propertyId === selectedPropertyId ? "text-primary-content/55" : "text-base-content/45"}`}>{property.code} · {property.timeZoneId}</p>
              </button>
            ))}
          </aside>

          {selectedProperty && <section className="space-y-6">
            <div className="card border border-base-300 bg-base-100 shadow-sm"><div className="card-body gap-5 p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-3"><h2 className="font-display text-2xl font-semibold">{selectedProperty.name}</h2><StatusBadge status={selectedProperty.status} /></div><p className="mt-2 flex items-center gap-2 text-sm text-base-content/50"><MapPin size={15} />{selectedProperty.timeZoneId} · Code {selectedProperty.code}</p></div>{canManageProperty && <div className="flex gap-2"><button className="btn btn-sm btn-ghost" onClick={() => setPropertyForm({ property: selectedProperty })}><Edit3 size={16} />Edit</button><button className="btn btn-sm btn-ghost text-error" onClick={() => { if (confirm(`Retire ${selectedProperty.name}?`)) retireMutation.mutate({ kind: "property", entity: selectedProperty }); }}><Trash2 size={16} />Retire</button></div>}</div></div></div>

            <div className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="flex items-center justify-between border-b border-base-300 px-5 py-5 sm:px-6"><div><h2 className="font-display text-xl font-semibold">Rooms & beds</h2><p className="mt-1 text-sm text-base-content/50">The physical topology used by inventory.</p></div>{canManageRooms && <button className="btn btn-sm btn-primary" onClick={() => setRoomForm({})}><Plus size={16} />Add room</button>}</div>
              {rooms.isLoading ? <LoadingState label="Loading rooms" /> : rooms.error ? <div className="p-6"><ErrorState error={rooms.error} /></div> : !roomItems.length ? <div className="p-6"><EmptyState icon={<Layers3 />} title="No rooms configured" description="Add the first room, then assign beds or sell it as a whole room." action={canManageRooms ? <button className="btn btn-sm btn-primary" onClick={() => setRoomForm({})}>Add room</button> : undefined} /></div> : (
                <div className="grid min-h-[430px] md:grid-cols-[280px_1fr]">
                  <div className="border-b border-base-300 p-3 md:border-b-0 md:border-r">
                    {roomItems.map((room) => <button key={room.roomId} onClick={() => setSelectedRoomId(room.roomId)} className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selectedRoom?.roomId === room.roomId ? "bg-base-200" : "hover:bg-base-200/60"}`}><div className="grid size-9 place-items-center rounded-lg bg-secondary/15 text-secondary"><BedDouble size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{room.name}</p><p className="truncate text-xs text-base-content/40">{[room.buildingLabel, room.floorLabel].filter(Boolean).join(" · ") || "No location labels"}</p></div><MoreHorizontal size={16} className="text-base-content/30" /></button>)}
                  </div>
                  {selectedRoom && <div className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-display text-xl font-semibold">{selectedRoom.name}</h3><StatusBadge status={selectedRoom.status} /></div><p className="mt-1 text-sm text-base-content/45">{[selectedRoom.buildingLabel, selectedRoom.floorLabel].filter(Boolean).join(" · ") || "No building or floor label"}</p></div>{canManageRooms && <div className="dropdown dropdown-end"><button tabIndex={0} className="btn btn-circle btn-ghost btn-sm" aria-label={`Actions for ${selectedRoom.name}`}><MoreHorizontal size={18} /></button><ul tabIndex={0} className="menu dropdown-content z-10 w-40 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"><li><button onClick={() => setRoomForm({ room: selectedRoom })}><Edit3 size={15} />Edit room</button></li><li><button className="text-error" onClick={() => { if (confirm(`Retire ${selectedRoom.name}?`)) retireMutation.mutate({ kind: "room", entity: selectedRoom }); }}><Trash2 size={15} />Retire</button></li></ul></div>}</div>
                    <div className="my-5 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Beds</p>{canManageBeds && <button className="btn btn-sm btn-outline" onClick={() => setBedForm({})}><Plus size={15} />Add bed</button>}</div>
                    {beds.isLoading ? <LoadingState label="Loading beds" /> : beds.error ? <ErrorState error={beds.error} /> : !beds.data?.beds.length ? <EmptyState icon={<BedDouble />} title="No beds in this room" description="Add beds for bed-level sales, or configure the room for room-level inventory." action={canManageBeds ? <button className="btn btn-sm btn-primary" onClick={() => setBedForm({})}>Add first bed</button> : undefined} /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{beds.data.beds.map((bed) => <div key={bed.bedId} className="rounded-xl border border-base-300 p-4"><div className="flex items-start justify-between"><div className="grid size-9 place-items-center rounded-lg bg-accent/15 text-accent-content"><BedDouble size={17} /></div>{canManageBeds && <div className="dropdown dropdown-end"><button tabIndex={0} className="btn btn-circle btn-ghost btn-xs" aria-label={`Actions for ${bed.label}`}><MoreHorizontal size={15} /></button><ul tabIndex={0} className="menu dropdown-content z-10 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"><li><button onClick={() => setBedForm({ bed })}>Edit</button></li><li><button className="text-error" onClick={() => { if (confirm(`Retire bed ${bed.label}?`)) retireMutation.mutate({ kind: "bed", entity: bed }); }}>Retire</button></li></ul></div>}</div><p className="mt-3 font-semibold">{bed.label}</p><div className="mt-2"><StatusBadge status={bed.status} /></div></div>)}</div>}
                  </div>}
                </div>
              )}
            </div>
          </section>}
        </div>
      )}

      <PropertyForm state={(propertyForm?.property ? canManageProperty : canCreateProperty) ? propertyForm : null} mutation={propertyMutation} onClose={() => setPropertyForm(null)} />
      <RoomForm state={canManageRooms ? roomForm : null} mutation={roomMutation} onClose={() => setRoomForm(null)} />
      <BedForm state={canManageBeds ? bedForm : null} mutation={bedMutation} onClose={() => setBedForm(null)} />
    </>
  );
}

function PropertyForm({ state, mutation, onClose }: { state: PropertyFormState; mutation: ReturnType<typeof useMutation<Property, Error, { property?: Property; name: string; code: string; timeZoneId: string }>>; onClose: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ property: state?.property, name: String(data.get("name")), code: String(data.get("code")).toUpperCase(), timeZoneId: String(data.get("timeZoneId")) }); }
  return <Modal open={Boolean(state)} title={state?.property ? "Edit property" : "New property"} description="Property details are shared across topology, inventory and reservations." onClose={onClose}><form onSubmit={submit} className="space-y-4"><Input label="Property name" name="name" defaultValue={state?.property?.name} placeholder="Harbour House Hostel" /><div className="grid gap-4 sm:grid-cols-2"><Input label="Short code" name="code" defaultValue={state?.property?.code} placeholder="HBR" maxLength={16} /><Input label="Time zone" name="timeZoneId" defaultValue={state?.property?.timeZoneId ?? "Europe/Moscow"} placeholder="Europe/Moscow" /></div>{mutation.error && <ErrorState error={mutation.error} />}<FormActions submitting={mutation.isPending} submitLabel={state?.property ? "Save changes" : "Create property"} onCancel={onClose} /></form></Modal>;
}

function RoomForm({ state, mutation, onClose }: { state: RoomFormState; mutation: ReturnType<typeof useMutation<Room, Error, { room?: Room; name: string; buildingLabel: string; floorLabel: string }>>; onClose: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ room: state?.room, name: String(data.get("name")), buildingLabel: String(data.get("buildingLabel")), floorLabel: String(data.get("floorLabel")) }); }
  return <Modal open={Boolean(state)} title={state?.room ? "Edit room" : "Add room"} description="Use labels your staff will recognize at a glance." onClose={onClose}><form onSubmit={submit} className="space-y-4"><Input label="Room name or number" name="name" defaultValue={state?.room?.name} placeholder="Room 204" /><div className="grid gap-4 sm:grid-cols-2"><Input label="Building (optional)" name="buildingLabel" defaultValue={state?.room?.buildingLabel ?? ""} placeholder="Main building" required={false} /><Input label="Floor (optional)" name="floorLabel" defaultValue={state?.room?.floorLabel ?? ""} placeholder="Second floor" required={false} /></div>{mutation.error && <ErrorState error={mutation.error} />}<FormActions submitting={mutation.isPending} submitLabel={state?.room ? "Save room" : "Add room"} onCancel={onClose} /></form></Modal>;
}

function BedForm({ state, mutation, onClose }: { state: BedFormState; mutation: ReturnType<typeof useMutation<Bed, Error, { bed?: Bed; label: string }>>; onClose: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); mutation.mutate({ bed: state?.bed, label: String(new FormData(event.currentTarget).get("label")) }); }
  return <Modal open={Boolean(state)} title={state?.bed ? "Edit bed" : "Add bed"} description="Keep the label short and easy to find in the room." onClose={onClose}><form onSubmit={submit}><Input label="Bed label" name="label" defaultValue={state?.bed?.label} placeholder="Bed A" />{mutation.error && <div className="mt-4"><ErrorState error={mutation.error} /></div>}<FormActions submitting={mutation.isPending} submitLabel={state?.bed ? "Save bed" : "Add bed"} onCancel={onClose} /></form></Modal>;
}

function Input({ label, name, defaultValue, placeholder, required = true, maxLength }: { label: string; name: string; defaultValue?: string; placeholder?: string; required?: boolean; maxLength?: number }) {
  return <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} defaultValue={defaultValue} placeholder={placeholder} required={required} maxLength={maxLength} /></label>;
}
