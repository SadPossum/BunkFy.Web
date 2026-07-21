import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Cable, ChevronLeft, ChevronRight, ClipboardCheck, Plus, Radio, ShieldAlert, Zap } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { adapterConflictPolicyLabel, adapterConflictPolicyValue, adapterConnectionStatusLabel, adapterExecutionModeLabel, adapterExecutionModeValue } from "../../api/labels";
import type { AdapterConnection, AdapterConnectionListResponse, AdapterTypeCapability, AdapterTypeCapabilityListResponse } from "../../api/types";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useTargetProperty } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, FormActions, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { ConnectionDetail } from "./ConnectionDetail";
import { IngestionActivity } from "./IngestionActivity";
import { ProposalQueue } from "./ProposalQueue";

const PAGE_SIZE = 30;
type IntegrationsTab = "connections" | "review" | "activity";
type ConnectionStatusFilter = "all" | "enabled" | "disabled";

export function IntegrationsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const [tab, setTab] = useState<IntegrationsTab>(() => integrationsTab(searchParams.get("tab")));
  const [status, setStatus] = useState<ConnectionStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const scope = session && selectedPropertyId ? propertyAccessScope(session.tenantId, selectedPropertyId) : "";
  const access = usePermissions(scope ? [
    { permission: permissions.ingestionRead, scope },
    { permission: permissions.ingestionConnectionsManage, scope },
    { permission: permissions.ingestionCredentialsManage, scope },
    { permission: permissions.ingestionRawPayloadsRead, scope },
    { permission: permissions.ingestionSensitiveHistoryRead, scope },
    { permission: permissions.ingestionProposalsDecide, scope },
    { permission: permissions.guestsRead, scope },
    { permission: permissions.guestsCreate, scope },
    { permission: permissions.reservationsManageGuests, scope },
  ] : []);
  const canRead = access.allows(permissions.ingestionRead, scope);
  const canManage = access.allows(permissions.ingestionConnectionsManage, scope);
  const canManageCredentials = access.allows(permissions.ingestionCredentialsManage, scope);
  const canReadRawPayloads = access.allows(permissions.ingestionRawPayloadsRead, scope);
  const canReadSensitiveHistory = access.allows(permissions.ingestionSensitiveHistoryRead, scope);
  const canDecideProposals = access.allows(permissions.ingestionProposalsDecide, scope);
  const canSuggestGuestRecords = access.allows(permissions.guestsRead, scope)
    && access.allows(permissions.guestsCreate, scope)
    && access.allows(permissions.reservationsManageGuests, scope);
  useEffect(() => setTab(integrationsTab(searchParams.get("tab"))), [searchParams]);
  useEffect(() => setPage(1), [status, selectedPropertyId]);
  const connectionParams = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status !== "all") connectionParams.set("status", status === "enabled" ? "1" : "2");
  const connections = useQuery({ queryKey: ["ingestion-connections", selectedPropertyId, status, page], queryFn: () => request<AdapterConnectionListResponse>(`/api/ingestion/properties/${selectedPropertyId}/connections?${connectionParams}`), enabled: canRead });
  const allConnections = useQuery({ queryKey: ["ingestion-connections", selectedPropertyId, "all-options"], queryFn: () => request<AdapterConnectionListResponse>(`/api/ingestion/properties/${selectedPropertyId}/connections?page=1&pageSize=100`), enabled: canRead, staleTime: 15_000 });
  const adapterTypes = useQuery({ queryKey: ["ingestion-adapter-types", selectedPropertyId], queryFn: () => request<AdapterTypeCapabilityListResponse>(`/api/ingestion/properties/${selectedPropertyId}/adapter-types`), enabled: canRead, staleTime: 30_000 });

  function selectConnection(id: string | null) { const next = new URLSearchParams(searchParams); if (id) next.set("connection", id); else next.delete("connection"); setSearchParams(next, { replace: true }); }

  if (!selectedProperty) return <EmptyState icon={<Cable />} title="Choose a property first" description="Integration connections are configured for one property at a time." />;
  if (access.isLoading) return <LoadingState label="Checking integration access" />;
  if (access.error) return <ErrorState error={access.error} />;
  if (!canRead) return <EmptyState icon={<ShieldAlert />} title="Integration access is restricted" description="Your account does not have permission to view ingestion activity for this property." />;

  const capabilityItems = adapterTypes.data?.adapterTypes ?? [];
  const connectionItems = connections.data?.connections ?? [];
  const allConnectionItems = allConnections.data?.connections ?? connectionItems;
  return <>
    <PageHeader eyebrow={selectedProperty.name} title="Integrations" description="Connect reservation sources, review suggested changes, and trace every ingestion event." action={tab === "connections" && canManage ? <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={17} />New connection</button> : undefined} />
    <SegmentedTabs
      className="mb-5"
      value={tab}
      ariaLabel="Integration workspace"
      onValueChange={setTab}
      options={[
        { value: "connections", label: "Connections", icon: <Cable size={15} /> },
        { value: "review", label: "Review", icon: <ClipboardCheck size={15} /> },
        { value: "activity", label: "Activity", icon: <Activity size={15} /> },
      ]}
    />
    {tab === "connections" && <section className="card border border-base-300 bg-base-100 shadow-sm"><div className="flex flex-col gap-3 border-b border-base-300 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h2 className="font-display text-xl font-semibold">Connections</h2><p className="mt-1 text-sm text-base-content/50">Configured adapter endpoints and execution modes.</p></div><SelectPicker className="w-full sm:w-44" size="sm" value={status} ariaLabel="Connection status" onValueChange={(value) => setStatus(value as ConnectionStatusFilter)} options={[{ value: "all", label: "All statuses" }, { value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }]} /></div>{connections.isLoading || adapterTypes.isLoading ? <LoadingState label="Loading connections" /> : connections.error || adapterTypes.error ? <div className="p-6"><ErrorState error={connections.error || adapterTypes.error} retry={() => { void connections.refetch(); void adapterTypes.refetch(); }} /></div> : !connectionItems.length ? <div className="p-6"><EmptyState icon={<Cable />} title={status === "all" ? "No connections yet" : `No ${status} connections`} description={status === "all" ? "Create a connection to bring an external reservation source into BunkFy." : "Choose another status filter."} action={canManage && status === "all" ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>Create connection</button> : undefined} /></div> : <><div className="divide-y divide-base-300">{connectionItems.map((connection) => <ConnectionRow key={connection.connectionId} connection={connection} onOpen={() => selectConnection(connection.connectionId)} />)}</div><div className="flex items-center justify-between border-t border-base-300 px-4 py-3 sm:px-6"><p className="text-xs text-base-content/45">{connections.data?.totalCount ?? connectionItems.length} total · page {page}</p><div className="join"><button className="btn btn-sm join-item" disabled={page === 1} onClick={() => setPage((current) => current - 1)} aria-label="Previous connections"><ChevronLeft size={16} /></button><button className="btn btn-sm join-item" disabled={page * PAGE_SIZE >= (connections.data?.totalCount ?? 0)} onClick={() => setPage((current) => current + 1)} aria-label="Next connections"><ChevronRight size={16} /></button></div></div></>}</section>}
    {tab === "review" && <ProposalQueue propertyId={selectedPropertyId} canReadSensitiveHistory={canReadSensitiveHistory} canDecide={canDecideProposals} canSuggestGuestRecords={canSuggestGuestRecords} />}
    {tab === "activity" && <IngestionActivity propertyId={selectedPropertyId} connections={allConnectionItems} adapterTypes={capabilityItems} canReadRawPayloads={canReadRawPayloads} />}
    <CreateConnectionModal open={createOpen} propertyId={selectedPropertyId} adapterTypes={capabilityItems} onClose={() => setCreateOpen(false)} onCreated={async (created) => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["ingestion-connections", selectedPropertyId] }), queryClient.invalidateQueries({ queryKey: ["ingestion-connection", selectedPropertyId, created.connectionId] })]); setCreateOpen(false); selectConnection(created.connectionId); }} />
    <ConnectionDetail propertyId={selectedPropertyId} connectionId={searchParams.get("connection")} adapterTypes={capabilityItems} canManage={canManage} canManageCredentials={canManageCredentials} onClose={() => selectConnection(null)} />
  </>;
}

function ConnectionRow({ connection, onOpen }: { connection: AdapterConnection; onOpen: () => void }) { return <button type="button" className="grid w-full gap-3 p-5 text-left transition hover:bg-base-200/70 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-6" onClick={onOpen}><div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary/15 text-secondary"><Radio size={18} /></div><div className="min-w-0"><p className="truncate font-semibold">{connection.adapterType}</p><p className="mt-1 truncate text-xs text-base-content/45">{connection.configurationReference}</p></div></div><div className="text-xs text-base-content/50 sm:text-right"><p className="font-semibold capitalize text-base-content/70">{adapterExecutionModeLabel(connection.executionMode)}</p><p className="mt-1">{connection.pollingIntervalSeconds ? `Every ${formatDuration(connection.pollingIntervalSeconds)}` : adapterConflictPolicyLabel(connection.conflictPolicy)}</p></div><StatusBadge status={adapterConnectionStatusLabel(connection.status)} /></button>; }

function CreateConnectionModal({ open, propertyId, adapterTypes, onClose, onCreated }: { open: boolean; propertyId: string; adapterTypes: AdapterTypeCapability[]; onClose: () => void; onCreated: (connection: AdapterConnection) => Promise<void> }) {
  const { request } = useSession(); const [adapterType, setAdapterType] = useState(adapterTypes[0]?.adapterType ?? ""); const capability = adapterTypes.find((item) => item.adapterType === adapterType); const modes = capability?.executionModes.map(modeKey).filter((value): value is "polling" | "continuous" | "push" | "remotePolling" => value !== "unknown") ?? []; const [executionMode, setExecutionMode] = useState<"polling" | "continuous" | "push" | "remotePolling">(modes[0] ?? "polling"); const [conflictPolicy, setConflictPolicy] = useState<"suggestionsOnly" | "autoApplyWhenAdapterBaselineUnchanged">("suggestionsOnly"); useEffect(() => { if (!open) return; const first = adapterTypes[0]; setAdapterType(first?.adapterType ?? ""); const firstMode = first?.executionModes.map(modeKey).find((value) => value !== "unknown"); setExecutionMode(firstMode || "polling"); setConflictPolicy("suggestionsOnly"); }, [adapterTypes, open]); useEffect(() => { if (modes.length && !modes.includes(executionMode)) setExecutionMode(modes[0]); }, [executionMode, modes]); const mutation = useMutation({ mutationFn: (payload: Record<string, unknown>) => request<AdapterConnection>(`/api/ingestion/properties/${propertyId}/connections`, { method: "POST", body: JSON.stringify(payload) }), onSuccess: onCreated });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ adapterType, executionMode: adapterExecutionModeValue(executionMode), conflictPolicy: adapterConflictPolicyValue(conflictPolicy), configurationReference: String(data.get("configurationReference") ?? "").trim(), secretReference: emptyToNull(data.get("secretReference")) }); }
  return <Modal open={open} title="New integration connection" description="Choose a registered adapter and how it should exchange observations with BunkFy." onClose={onClose}>{adapterTypes.length ? <form className="space-y-4" onSubmit={submit}><label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Adapter type</span><SelectPicker className="w-full" value={adapterType} onValueChange={setAdapterType} ariaLabel="Adapter type" options={adapterTypes.map((adapter) => ({ value: adapter.adapterType, label: adapter.adapterType }))} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Execution mode</span><SelectPicker className="w-full" value={executionMode} onValueChange={(value) => setExecutionMode(value as typeof executionMode)} ariaLabel="Execution mode" options={modes.map((mode) => ({ value: mode, label: capitalize(adapterExecutionModeLabel(mode)) }))} /></label><label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Conflict policy</span><SelectPicker className="w-full" value={conflictPolicy} onValueChange={(value) => setConflictPolicy(value as typeof conflictPolicy)} ariaLabel="Conflict policy" options={[{ value: "suggestionsOnly", label: "Suggestions only" }, { value: "autoApplyWhenAdapterBaselineUnchanged", label: "Auto-apply safe updates" }]} /></label></div><div className="rounded-lg bg-base-200 p-4"><div className="flex items-start gap-3"><Zap size={17} className="mt-0.5 text-primary" /><div><p className="text-sm font-semibold">{conflictPolicy === "suggestionsOnly" ? "Staff review every conflicting update" : "Apply only against an unchanged adapter baseline"}</p><p className="mt-1 text-xs leading-5 text-base-content/50">You can change this policy later without recreating the connection.</p></div></div></div><TextField label="Configuration reference" name="configurationReference" placeholder="config://booking-provider/property-a" /><TextField label="Secret reference (optional)" name="secretReference" placeholder="secret://booking-provider/property-a" required={false} />{mutation.error && <ErrorState error={mutation.error} />}<FormActions submitting={mutation.isPending} submitLabel="Create connection" onCancel={onClose} disabled={!adapterType || !modes.length} /></form> : <div><EmptyState icon={<Cable />} title="No adapter types registered" description="Install or register an adapter capability before creating a connection." /><div className="mt-4 flex justify-end"><button className="btn btn-ghost" onClick={onClose}>Close</button></div></div>}</Modal>;
}

function TextField({ label, name, placeholder, required = true }: { label: string; name: string; placeholder?: string; required?: boolean }) { return <label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} placeholder={placeholder} required={required} /></label>; }
function modeKey(mode: AdapterTypeCapability["executionModes"][number]): "polling" | "continuous" | "push" | "remotePolling" | "unknown" { if (typeof mode === "string") { const normalized = mode.replace(/[ -](.)/g, (_, letter: string) => letter.toUpperCase()); return (["polling", "continuous", "push", "remotePolling"] as const).find((value) => value.toLowerCase() === normalized.toLowerCase()) ?? "unknown"; } return ({ 1: "polling", 2: "continuous", 3: "push", 4: "remotePolling" } as const)[mode as 1 | 2 | 3 | 4] ?? "unknown"; }
function emptyToNull(value: FormDataEntryValue | null) { const normalized = String(value ?? "").trim(); return normalized || null; }
function formatDuration(seconds: number) { if (seconds % 3600 === 0) return `${seconds / 3600}h`; if (seconds % 60 === 0) return `${seconds / 60}m`; return `${seconds}s`; }
function capitalize(value: string) { return value.slice(0, 1).toUpperCase() + value.slice(1); }
function integrationsTab(value: string | null): IntegrationsTab { return value === "review" || value === "activity" ? value : "connections"; }
