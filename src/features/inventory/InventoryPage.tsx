import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Blocks, CalendarSearch, CheckCircle2, CircleSlash2, DoorOpen, Plus, Unlock } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { InventoryAvailabilityResponse, InventoryUnit, ManualBlockListResponse, RoomInventory, RoomInventoryListResponse } from "../../api/types";
import { inventoryKindLabel, inventorySalesModeValue } from "../../api/labels";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, FormActions, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { sellableInventorySummary } from "./inventorySummary";

export function InventoryPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [blockOpen, setBlockOpen] = useState(false);
  const [range, setRange] = useState(defaultRange);
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
  const inventory = useQuery({ queryKey: ["inventory-rooms", selectedPropertyId], queryFn: () => request<RoomInventoryListResponse>(`/api/inventory/properties/${selectedPropertyId}/rooms?page=1&pageSize=100`), enabled });
  const availability = useQuery({ queryKey: ["availability", selectedPropertyId, range.arrival, range.departure], queryFn: () => request<InventoryAvailabilityResponse>(`/api/inventory/properties/${selectedPropertyId}/availability?arrival=${range.arrival}&departure=${range.departure}`), enabled: enabled && Boolean(range.arrival && range.departure) });
  const blocks = useQuery({ queryKey: ["blocks", selectedPropertyId, false], queryFn: () => request<ManualBlockListResponse>(`/api/inventory/properties/${selectedPropertyId}/blocks?includeReleased=false&page=1&pageSize=100`), enabled });
  const allUnits = useMemo(() => inventory.data?.rooms.flatMap((room) => room.units) ?? [], [inventory.data]);

  const salesModeMutation = useMutation({
    mutationFn: ({ room, salesMode }: { room: RoomInventory; salesMode: "roomLevel" | "bedLevel" }) => request(`/api/inventory/properties/${selectedPropertyId}/rooms/${room.roomId}/sales-mode`, { method: "PUT", body: JSON.stringify({ salesMode: inventorySalesModeValue(salesMode), expectedVersion: room.version }) }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ["inventory-rooms", selectedPropertyId] }), queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] })]),
  });
  const createBlock = useMutation({
    mutationFn: (payload: { inventoryUnitId: string; arrival: string; departure: string; reason: string }) => request(`/api/inventory/properties/${selectedPropertyId}/blocks`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["blocks", selectedPropertyId] }), queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] })]); setBlockOpen(false); },
  });
  const releaseBlock = useMutation({
    mutationFn: ({ blockId, expectedVersion }: { blockId: string; expectedVersion: number }) => request(`/api/inventory/properties/${selectedPropertyId}/blocks/${blockId}/release`, { method: "POST", body: JSON.stringify({ expectedVersion }) }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ["blocks", selectedPropertyId] }), queryClient.invalidateQueries({ queryKey: ["availability", selectedPropertyId] })]),
  });

  if (!selectedProperty) return <EmptyState icon={<DoorOpen />} title="Choose a property first" description="Inventory is managed within a property. Create or select one to continue." />;
  if (inventory.isLoading || blocks.isLoading) return <LoadingState label="Loading inventory" />;
  if (inventory.error || blocks.error) return <ErrorState error={inventory.error ?? blocks.error} />;

  const availableCount = availability.data?.units.filter((item) => item.isAvailable).length ?? 0;
  const unavailableCount = availability.data?.units.filter((item) => !item.isAvailable).length ?? 0;

  return (
    <>
      <PageHeader eyebrow={selectedProperty.name} title="Inventory" description="Control how each room is sold, check availability and block units when operations need them." action={canManageBlocks ? <button className="btn btn-primary" onClick={() => setBlockOpen(true)} disabled={!allUnits.some((unit) => unit.isSellable)}><Plus size={17} />Block a unit</button> : undefined} />

      <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-base-300 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h2 className="font-display text-xl font-semibold">Availability check</h2><p className="mt-1 text-sm text-base-content/50">See what can be assigned for a stay range.</p></div><form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setRange({ arrival: String(data.get("arrival")), departure: String(data.get("departure")) }); }}><input className="input input-bordered input-sm" type="date" name="arrival" aria-label="Arrival date" defaultValue={range.arrival} required /><span className="hidden self-center text-base-content/30 sm:block">→</span><input className="input input-bordered input-sm" type="date" name="departure" aria-label="Departure date" defaultValue={range.departure} required /><button className="btn btn-sm btn-secondary"><CalendarSearch size={16} />Check</button></form></div>
        {availability.isLoading ? <LoadingState label="Checking availability" /> : availability.error ? <div className="p-6"><ErrorState error={availability.error} /></div> : <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6"><AvailabilityStat icon={<CheckCircle2 />} label="Available" value={availableCount} tone="success" /><AvailabilityStat icon={<CircleSlash2 />} label="Unavailable" value={unavailableCount} tone="error" /><AvailabilityStat icon={<BedDouble />} label="Total sellable" value={availability.data?.units.length ?? 0} tone="primary" /></div>}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="border-b border-base-300 px-5 py-5 sm:px-6"><h2 className="font-display text-xl font-semibold">Sales setup</h2><p className="mt-1 text-sm text-base-content/50">Choose whether guests reserve the whole room or individual beds.</p></div>
          {!inventory.data?.rooms.length ? <div className="p-6"><EmptyState icon={<DoorOpen />} title="No rooms available" description="Set up rooms and beds in Properties before configuring inventory." /></div> : <div className="divide-y divide-base-300">{inventory.data.rooms.map((room) => {
            const mode = normalizeSalesMode(room.salesMode);
            return <div key={room.roomId} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-secondary/15 text-secondary"><DoorOpen size={18} /></div><div><p className="font-semibold">{room.roomName}</p><p className="mt-1 text-xs text-base-content/45">{sellableInventorySummary(room.units)}</p></div></div><div className="flex items-center gap-3"><StatusBadge status={mode} />{canConfigure && <select className="select select-bordered select-sm" aria-label={`Sales mode for ${room.roomName}`} value={mode} onChange={(event) => salesModeMutation.mutate({ room, salesMode: event.target.value as "roomLevel" | "bedLevel" })}><option value="unconfigured" disabled>Not configured</option><option value="roomLevel">Sell whole room</option><option value="bedLevel">Sell individual beds</option></select>}</div></div>;
          })}</div>}
          {salesModeMutation.error && <div className="p-5"><ErrorState error={salesModeMutation.error} /></div>}
        </section>

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="flex items-center justify-between border-b border-base-300 px-5 py-5 sm:px-6"><div><h2 className="font-display text-xl font-semibold">Active blocks</h2><p className="mt-1 text-sm text-base-content/50">Out-of-service and operational holds.</p></div><span className="badge badge-neutral">{blocks.data?.blocks.length ?? 0}</span></div>
          {!blocks.data?.blocks.length ? <div className="p-6"><EmptyState icon={<Blocks />} title="No active blocks" description="All configured inventory is free from manual blocks." /></div> : <div className="divide-y divide-base-300">{blocks.data.blocks.map((block) => { const unit = allUnits.find((item) => item.inventoryUnitId === block.inventoryUnitId); return <div key={block.blockId} className="px-5 py-4 sm:px-6"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{unit?.label ?? "Inventory unit"}</p><p className="mt-1 text-xs text-base-content/45">{formatDate(block.arrival)} → {formatDate(block.departure)}</p></div>{canManageBlocks && <button className="btn btn-ghost btn-sm text-primary" onClick={() => releaseBlock.mutate({ blockId: block.blockId, expectedVersion: block.version })} disabled={releaseBlock.isPending}><Unlock size={15} />Release</button>}</div><p className="mt-3 rounded-lg bg-base-200 px-3 py-2 text-xs text-base-content/60">{block.reason}</p></div>; })}</div>}
          {releaseBlock.error && <div className="p-5"><ErrorState error={releaseBlock.error} /></div>}
        </section>
      </div>

      <BlockForm open={blockOpen && canManageBlocks} units={allUnits.filter((unit) => unit.isSellable && unit.isTopologyActive)} mutation={createBlock} onClose={() => setBlockOpen(false)} />
    </>
  );
}

function BlockForm({ open, units, mutation, onClose }: { open: boolean; units: InventoryUnit[]; mutation: ReturnType<typeof useMutation<unknown, Error, { inventoryUnitId: string; arrival: string; departure: string; reason: string }>>; onClose: () => void }) {
  const range = defaultRange();
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ inventoryUnitId: String(data.get("inventoryUnitId")), arrival: String(data.get("arrival")), departure: String(data.get("departure")), reason: String(data.get("reason")) }); }
  return <Modal open={open} title="Block inventory" description="Use a clear reason so staff understand why the unit cannot be assigned." onClose={onClose}><form onSubmit={submit} className="space-y-4"><label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">Room or bed</span><select className="select select-bordered w-full" name="inventoryUnitId" required><option value="">Choose inventory</option>{units.map((unit) => <option key={unit.inventoryUnitId} value={unit.inventoryUnitId}>{unit.label} · {inventoryKindLabel(unit.kind)}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><DateInput label="From" name="arrival" defaultValue={range.arrival} /><DateInput label="Until" name="departure" defaultValue={range.departure} /></div><label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">Reason</span><textarea className="textarea textarea-bordered min-h-24 w-full" name="reason" placeholder="Maintenance, private use, deep clean…" required /></label>{mutation.error && <ErrorState error={mutation.error} />}<FormActions submitting={mutation.isPending} submitLabel="Block unit" onCancel={onClose} /></form></Modal>;
}

function AvailabilityStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "success" | "error" | "primary" }) { const tones = { success: "bg-success/12 text-success", error: "bg-error/12 text-error", primary: "bg-primary/12 text-primary" }; return <div className="flex items-center gap-4 rounded-2xl bg-base-200 p-4"><div className={`grid size-11 place-items-center rounded-xl ${tones[tone]}`}>{icon}</div><div><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-base-content/45">{label}</p></div></div>; }
function DateInput({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) { return <label className="form-control block"><span className="label-text mb-2 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" type="date" name={name} defaultValue={defaultValue} required /></label>; }
function normalizeSalesMode(value: RoomInventory["salesMode"]): "unconfigured" | "roomLevel" | "bedLevel" { if (value === 2 || String(value).toLowerCase() === "roomlevel") return "roomLevel"; if (value === 3 || String(value).toLowerCase() === "bedlevel") return "bedLevel"; return "unconfigured"; }
function defaultRange() { const arrival = new Date(); arrival.setDate(arrival.getDate() + 1); const departure = new Date(arrival); departure.setDate(departure.getDate() + 2); return { arrival: arrival.toISOString().slice(0, 10), departure: departure.toISOString().slice(0, 10) }; }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
