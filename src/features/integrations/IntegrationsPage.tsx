import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Cable, ChevronRight, ClipboardCheck, Plus, Radio, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { adapterConflictPolicyLabel, adapterConflictPolicyValue, adapterConnectionStatusLabel, adapterExecutionModeKey, adapterExecutionModeLabel, adapterExecutionModeValue } from "../../api/labels";
import type { AdapterConnectionCreateRequest, AdapterConnectionListItem, AdapterConnectionListResponse, AdapterConnectionMutationReceipt, AdapterTypeCapability, AdapterTypeCapabilityListResponse } from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useTargetProperty } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { EmptyState, ErrorState, FormActions, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { ConnectionDetail } from "./ConnectionDetail";
import {
  resolveConnectionCreateAttempt,
  type ConnectionCreateAttempt,
  type ConnectionCreatePayload,
} from "./connectionCreateAttempt";
import { loadAllAdapterConnections } from "./ingestionApi";
import { IngestionActivity } from "./IngestionActivity";
import {
  clearIntegrationViewSearchParams,
  connectionFilterSearchParams,
  connectionPageSearchParams,
  integrationPrimaryTabSearchParams,
  integrationSelectionSearchParams,
  integrationViewState,
  type ConnectionStatusFilter,
} from "./integrationViewState";
import { ProposalQueue } from "./ProposalQueue";

const PAGE_SIZE = 30;

export function IntegrationsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const view = integrationViewState(searchParams);
  const tab = view.tab;
  const status = view.connectionStatus;
  const page = view.connectionPage;
  const [createOpen, setCreateOpen] = useState(false);
  const previousPropertyId = useRef<string | null>(null);
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
  useEffect(() => {
    const previous = previousPropertyId.current;
    previousPropertyId.current = selectedPropertyId ?? null;
    if (!previous || !selectedPropertyId || previous === selectedPropertyId) return;
    if (searchParams.get("property") === selectedPropertyId) return;
    setSearchParams(clearIntegrationViewSearchParams(searchParams), { replace: true });
  }, [searchParams, selectedPropertyId, setSearchParams]);
  const connectionParams = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status !== "all") connectionParams.set("status", status === "enabled" ? "1" : "2");
  const selectedConnectionId = view.selectedConnectionId;
  const connections = useQuery({ queryKey: ["ingestion-connections", selectedPropertyId, status, page], queryFn: () => request<AdapterConnectionListResponse>(`/api/ingestion/properties/${selectedPropertyId}/connections?${connectionParams}`), enabled: canRead && tab === "connections" });
  const allConnections = useQuery({ queryKey: ["ingestion-connections", selectedPropertyId, "all-options"], queryFn: (context) => loadAllAdapterConnections(request, selectedPropertyId!, context.signal), enabled: canRead && tab === "activity", staleTime: 15_000 });
  const adapterTypes = useQuery({ queryKey: ["ingestion-adapter-types", selectedPropertyId], queryFn: () => request<AdapterTypeCapabilityListResponse>(`/api/ingestion/properties/${selectedPropertyId}/adapter-types`), enabled: canRead && (tab === "connections" || tab === "activity" || Boolean(selectedConnectionId)), staleTime: 30_000 });
  const connectionSource = createCompositeSource({ label: "Connection directory", hasData: connections.data !== undefined, isLoading: connections.isLoading, error: connections.error, isFetching: connections.isFetching, refetch: () => connections.refetch() });
  const allConnectionSource = createCompositeSource({ label: "Connection filter directory", hasData: allConnections.data !== undefined, isLoading: allConnections.isLoading, error: allConnections.error, isFetching: allConnections.isFetching, refetch: () => allConnections.refetch() });
  const adapterTypeSource = createCompositeSource({ label: "Adapter capabilities", hasData: adapterTypes.data !== undefined, isLoading: adapterTypes.isLoading, error: adapterTypes.error, isFetching: adapterTypes.isFetching, refetch: () => adapterTypes.refetch() });
  const pageHeaderProps = {
    eyebrow: selectedProperty?.name ?? "Data sources",
    title: "Integrations",
    description: "Connect external booking sources, decide changes that need staff review, and inspect the evidence behind every import.",
  };

  function selectConnection(id: string | null) {
    setSearchParams(
      integrationSelectionSearchParams(searchParams, "connection", id),
      { replace: true },
    );
  }

  if (!selectedProperty) return (
    <>
      <PageHeader {...pageHeaderProps} />
      <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
        <EmptyState icon={<Cable />} title="Choose a property first" description="Integration connections are configured for one property at a time." />
      </section>
    </>
  );
  if (access.isLoading) return (
    <>
      <PageHeader {...pageHeaderProps} />
      <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
        <LoadingState label="Checking integration access" />
      </section>
    </>
  );
  if (access.error) return (
    <>
      <PageHeader {...pageHeaderProps} />
      <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 p-4 shadow-sm sm:p-6">
        <ErrorState error={access.error} retry={() => void access.refetch()} title="Integration access could not be checked" />
      </section>
    </>
  );
  if (!canRead) return (
    <>
      <PageHeader {...pageHeaderProps} />
      <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
        <EmptyState icon={<ShieldAlert />} title="Integration access is restricted" description="Your account does not have permission to view ingestion activity for this property." />
      </section>
    </>
  );

  const capabilityItems = compositeSourceUsable(adapterTypeSource.state)
    ? adapterTypes.data?.adapterTypes ?? []
    : [];
  const connectionItems = compositeSourceUsable(connectionSource.state)
    ? connections.data?.connections ?? []
    : [];
  const allConnectionItems = compositeSourceUsable(allConnectionSource.state)
    ? allConnections.data?.connections ?? []
    : [];
  const capabilitiesCurrent = compositeSourceCurrent(adapterTypeSource);
  const createUnavailableReason = adapterTypeSource.state === "loading" || adapterTypeSource.isFetching
    ? "Adapter capabilities are being refreshed."
    : "Refresh adapter capabilities before creating a connection.";

  return (
    <>
      <PageHeader
        {...pageHeaderProps}
        action={tab === "connections" && canManage ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
            disabled={!capabilitiesCurrent}
            title={capabilitiesCurrent ? undefined : createUnavailableReason}
          >
            <Plus size={17} />
            New connection
          </button>
        ) : undefined}
      />
      <SegmentedTabs
        className="mb-5"
        value={tab}
        ariaLabel="Integration workspace"
        onValueChange={(nextTab) => setSearchParams(
          integrationPrimaryTabSearchParams(searchParams, nextTab),
          { replace: true },
        )}
        options={[
          { value: "connections", label: "Connections", icon: <Cable size={15} /> },
          { value: "review", label: "Review", icon: <ClipboardCheck size={15} /> },
          { value: "activity", label: "Activity", icon: <Activity size={15} /> },
        ]}
      />
      {tab === "connections" && (
        <>
          <CompositeSourceNotice
            sources={[connectionSource, adapterTypeSource]}
            title="Some connection data is delayed"
          />
          <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm" aria-labelledby="connections-heading">
            <div className="flex flex-col gap-3 border-b border-base-300 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 id="connections-heading" className="font-display text-xl font-semibold">Source connections</h2>
                <p className="mt-1 text-sm text-base-content/55">Each connection owns how one external source reaches this property.</p>
              </div>
              <SelectPicker
                className="w-full sm:w-44"
                size="sm"
                value={status}
                ariaLabel="Connection status"
                onValueChange={(value) => setSearchParams(
                  connectionFilterSearchParams(searchParams, value as ConnectionStatusFilter),
                  { replace: true },
                )}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "enabled", label: "Enabled" },
                  { value: "disabled", label: "Disabled" },
                ]}
              />
            </div>
            {!compositeSourceUsable(connectionSource.state) ? (
              <CompositeSourceFallback state={connectionSource.state} label="connections" />
            ) : !connectionItems.length ? (
              <div className="p-6">
                <EmptyState
                  icon={<Cable />}
                  title={status === "all" ? "No connections yet" : `No ${status} connections`}
                  description={status === "all" ? "Create a connection to bring an external reservation source into BunkFy." : "Choose another status filter."}
                  action={canManage && status === "all" ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => setCreateOpen(true)}
                      disabled={!capabilitiesCurrent}
                      title={capabilitiesCurrent ? undefined : createUnavailableReason}
                    >
                      Create connection
                    </button>
                  ) : undefined}
                />
              </div>
            ) : (
              <>
                <div className="divide-y divide-base-300">
                  {connectionItems.map((connection) => (
                    <ConnectionRow
                      key={connection.connectionId}
                      connection={connection}
                      onOpen={() => selectConnection(connection.connectionId)}
                    />
                  ))}
                </div>
                <PaginationBar
                  page={page}
                  pageSize={PAGE_SIZE}
                  itemCount={connectionItems.length}
                  hasMore={connections.data?.hasMore}
                  itemLabel="connection"
                  disabled={connections.isFetching}
                  onPageChange={(nextPage) => setSearchParams(
                    connectionPageSearchParams(searchParams, nextPage),
                    { replace: true },
                  )}
                />
              </>
            )}
          </section>
        </>
      )}
      {tab === "review" && (
        <ProposalQueue
          propertyId={selectedPropertyId}
          canReadSensitiveHistory={canReadSensitiveHistory}
          canDecide={canDecideProposals}
          canSuggestGuestRecords={canSuggestGuestRecords}
        />
      )}
      {tab === "activity" && (
        <IngestionActivity
          propertyId={selectedPropertyId}
          connections={allConnectionItems}
          connectionSource={allConnectionSource}
          adapterTypes={capabilityItems}
          adapterTypeSource={adapterTypeSource}
          canReadRawPayloads={canReadRawPayloads}
        />
      )}
      <CreateConnectionModal
        open={createOpen}
        propertyId={selectedPropertyId}
        adapterTypes={capabilityItems}
        adapterTypeSource={adapterTypeSource}
        onClose={() => setCreateOpen(false)}
        onCreated={async (created) => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["ingestion-connections", selectedPropertyId] }),
            queryClient.invalidateQueries({ queryKey: ["ingestion-connection", selectedPropertyId, created.connectionId] }),
          ]);
          setCreateOpen(false);
          selectConnection(created.connectionId);
        }}
      />
      <ConnectionDetail
        propertyId={selectedPropertyId}
        connectionId={selectedConnectionId}
        adapterTypes={capabilityItems}
        adapterTypeSource={adapterTypeSource}
        canManage={canManage}
        canManageCredentials={canManageCredentials}
        onClose={() => selectConnection(null)}
      />
    </>
  );
}

function ConnectionRow({ connection, onOpen }: { connection: AdapterConnectionListItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="group flex w-full items-start gap-3 p-4 text-left transition hover:bg-base-200/65 focus-visible:bg-base-200/65 sm:items-center sm:px-6 sm:py-5"
      onClick={onOpen}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary/12 text-secondary" aria-hidden="true">
        <Radio size={18} />
      </span>
      <span className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.15fr)_minmax(10rem,.85fr)_minmax(11rem,1fr)] sm:items-center sm:gap-5">
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{connection.adapterType}</span>
            <span className="sm:hidden"><StatusBadge status={adapterConnectionStatusLabel(connection.status)} /></span>
          </span>
          <span className="mt-1 block truncate text-xs text-base-content/45">
            Connection {connection.connectionId.slice(0, 8).toUpperCase()}
          </span>
        </span>
        <span className="mt-3 block text-xs sm:mt-0">
          <span className="block font-semibold capitalize text-base-content/75">{adapterExecutionModeLabel(connection.executionMode)}</span>
          <span className="mt-1 block text-base-content/50">{executionModeSummary(connection)}</span>
        </span>
        <span className="mt-2 block text-xs sm:mt-0">
          <span className="block font-semibold text-base-content/75">Change handling</span>
          <span className="mt-1 block text-base-content/50">{adapterConflictPolicyLabel(connection.conflictPolicy)}</span>
        </span>
      </span>
      <span className="hidden shrink-0 sm:block"><StatusBadge status={adapterConnectionStatusLabel(connection.status)} /></span>
      <ChevronRight className="mt-2 shrink-0 text-base-content/35 transition-transform group-hover:translate-x-0.5 sm:mt-0" size={18} aria-hidden="true" />
    </button>
  );
}

function CreateConnectionModal({ open, propertyId, adapterTypes, adapterTypeSource, onClose, onCreated }: { open: boolean; propertyId: string; adapterTypes: AdapterTypeCapability[]; adapterTypeSource: CompositeSource; onClose: () => void; onCreated: (connection: AdapterConnectionMutationReceipt) => Promise<void> }) {
  const { request } = useSession();
  const [adapterType, setAdapterType] = useState(
    adapterTypes[0]?.adapterType ?? "",
  );
  const [executionMode, setExecutionMode] = useState<
    "polling" | "continuous" | "push" | "remotePolling"
  >("polling");
  const [conflictPolicy, setConflictPolicy] = useState<
    "suggestionsOnly" | "autoApplyWhenAdapterBaselineUnchanged"
  >("suggestionsOnly");
  const attempt = useRef<ConnectionCreateAttempt | null>(null);
  const wasOpen = useRef(false);
  const capability = adapterTypes.find(
    (item) => item.adapterType === adapterType,
  );
  const modes = capability?.executionModes
    .map(adapterExecutionModeKey)
    .filter((value): value is typeof executionMode => value !== "unknown") ?? [];
  const mutation = useMutation({
    mutationFn: (payload: ConnectionCreatePayload & { operationId: string }) => {
      const requestBody: AdapterConnectionCreateRequest = {
        operationId: payload.operationId,
        adapterType: payload.adapterType,
        executionMode: payload.executionMode,
        conflictPolicy: payload.conflictPolicy,
        configurationReference: payload.configurationReference,
        secretReference: payload.secretReference,
      };
      return request<AdapterConnectionMutationReceipt>(
        `/api/ingestion/properties/${propertyId}/connections`,
        { method: "POST", body: JSON.stringify(requestBody) },
      );
    },
    onSuccess: async (created) => {
      attempt.current = null;
      await onCreated(created);
    },
  });

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      attempt.current = null;
      return;
    }

    const selectedAdapterExists = adapterTypes.some(
      (item) => item.adapterType === adapterType,
    );
    if (!wasOpen.current || !selectedAdapterExists) {
      const first = adapterTypes[0];
      setAdapterType(first?.adapterType ?? "");
      const firstMode = first?.executionModes
        .map(adapterExecutionModeKey)
        .find((value) => value !== "unknown");
      setExecutionMode(firstMode || "polling");
      if (!wasOpen.current) {
        setConflictPolicy("suggestionsOnly");
        attempt.current = null;
      }
    }
    wasOpen.current = true;
  }, [adapterType, adapterTypes, open]);

  useEffect(() => {
    if (modes.length && !modes.includes(executionMode)) {
      setExecutionMode(modes[0]);
    }
  }, [executionMode, modes]);

  function close() {
    if (mutation.isPending) return;
    attempt.current = null;
    mutation.reset();
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!compositeSourceCurrent(adapterTypeSource)) return;
    const data = new FormData(event.currentTarget);
    const payload: ConnectionCreatePayload = {
      propertyId,
      adapterType,
      executionMode: adapterExecutionModeValue(executionMode),
      conflictPolicy: adapterConflictPolicyValue(conflictPolicy),
      configurationReference: String(
        data.get("configurationReference") ?? "",
      ).trim(),
      secretReference: emptyToNull(data.get("secretReference")),
    };
    attempt.current = resolveConnectionCreateAttempt(
      attempt.current,
      payload,
    );
    mutation.mutate({
      ...payload,
      operationId: attempt.current.operationId,
    });
  }

  return (
    <Modal
      open={open}
      title="New integration connection"
      description="Choose a registered adapter and how it should exchange observations with BunkFy."
      onClose={close}
    >
      {!compositeSourceCurrent(adapterTypeSource) ? (
        <div>
          {adapterTypeSource.state === "loading" || (adapterTypeSource.state === "ready" && adapterTypeSource.isFetching) ? (
            <LoadingState label="Loading current adapter capabilities" />
          ) : (
            <>
              <CompositeSourceNotice
                sources={[adapterTypeSource]}
                title="Current adapter capabilities are required"
              />
              <p className="text-sm leading-6 text-base-content/60">
                Existing connection data remains available, but BunkFy will not create a connection from delayed capability information.
              </p>
            </>
          )}
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn btn-ghost" onClick={close}>Close</button>
          </div>
        </div>
      ) : adapterTypes.length ? (
        <form className="space-y-4" onSubmit={submit}>
          <label className="form-control block">
            <span className="label-text mb-1.5 block text-sm font-semibold">
              Adapter type
            </span>
            <SelectPicker
              className="w-full"
              value={adapterType}
              onValueChange={setAdapterType}
              ariaLabel="Adapter type"
              options={adapterTypes.map((adapter) => ({
                value: adapter.adapterType,
                label: adapter.adapterType,
              }))}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="form-control block">
              <span className="label-text mb-1.5 block text-sm font-semibold">
                Execution mode
              </span>
              <SelectPicker
                className="w-full"
                value={executionMode}
                onValueChange={(value) =>
                  setExecutionMode(value as typeof executionMode)}
                ariaLabel="Execution mode"
                options={modes.map((mode) => ({
                  value: mode,
                  label: capitalize(adapterExecutionModeLabel(mode)),
                }))}
              />
            </label>
            <label className="form-control block">
              <span className="label-text mb-1.5 block text-sm font-semibold">
                Conflict policy
              </span>
              <SelectPicker
                className="w-full"
                value={conflictPolicy}
                onValueChange={(value) =>
                  setConflictPolicy(value as typeof conflictPolicy)}
                ariaLabel="Conflict policy"
                options={[
                  { value: "suggestionsOnly", label: "Suggestions only" },
                  {
                    value: "autoApplyWhenAdapterBaselineUnchanged",
                    label: "Auto-apply safe updates",
                  },
                ]}
              />
            </label>
          </div>
          <div className="rounded-lg border border-primary/15 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck size={17} className="mt-0.5 text-primary" />
              <div>
                <p className="text-sm font-semibold">
                  {conflictPolicy === "suggestionsOnly"
                    ? "Staff review every conflicting update"
                    : "Apply only against an unchanged adapter baseline"}
                </p>
                <p className="mt-1 text-xs leading-5 text-base-content/50">
                  {conflictPolicy === "suggestionsOnly"
                    ? "Nothing changes a reservation until an authorized staff member accepts the proposal."
                    : "BunkFy applies an update only while the reservation still matches the last accepted adapter revision."}
                </p>
              </div>
            </div>
          </div>
          <TextField
            label="Configuration reference"
            name="configurationReference"
            placeholder="config://booking-provider/property-a"
          />
          <TextField
            label="Secret reference (optional)"
            name="secretReference"
            placeholder="secret://booking-provider/property-a"
            required={false}
          />
          {mutation.error && <ErrorState error={mutation.error} />}
          <FormActions
            submitting={mutation.isPending}
            submitLabel="Create connection"
            onCancel={close}
            disabled={!adapterType || !modes.length}
          />
        </form>
      ) : (
        <div>
          <EmptyState
            icon={<Cable />}
            title="No adapter types registered"
            description="Install or register an adapter capability before creating a connection."
          />
          <div className="mt-4 flex justify-end">
            <button className="btn btn-ghost" onClick={close}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TextField({ label, name, placeholder, required = true }: { label: string; name: string; placeholder?: string; required?: boolean }) { return <label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} placeholder={placeholder} required={required} /></label>; }
function emptyToNull(value: FormDataEntryValue | null) { const normalized = String(value ?? "").trim(); return normalized || null; }
function formatDuration(seconds: number) { if (seconds % 3600 === 0) return `${seconds / 3600}h`; if (seconds % 60 === 0) return `${seconds / 60}m`; return `${seconds}s`; }
function executionModeSummary(connection: AdapterConnectionListItem) {
  if (connection.pollingIntervalSeconds) return `Every ${formatDuration(connection.pollingIntervalSeconds)}`;
  const mode = adapterExecutionModeKey(connection.executionMode);
  if (mode === "push") return "Source sends updates";
  if (mode === "remotePolling") return "External worker claims runs";
  if (mode === "continuous") return "Long-running adapter";
  return "Schedule not configured";
}
function capitalize(value: string) { return value.slice(0, 1).toUpperCase() + value.slice(1); }
