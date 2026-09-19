import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  Braces,
  ChevronRight,
  Clock3,
  Database,
  Download,
  FileJson2,
  GitBranch,
  ListRestart,
  PlayCircle,
  Rows3,
} from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  adapterExecutionModeLabel,
  ingestionRunStatusLabel,
  rawPayloadStatusLabel,
  receiptStatusLabel,
  reprocessingStatusLabel,
} from "../../api/labels";
import type {
  AdapterConnectionListItem,
  AdapterTypeCapability,
  IngestionRun,
  IngestionRunListResponse,
  ObservationParserCapabilityListResponse,
  ObservationReceipt,
  ObservationReceiptListResponse,
  ObservationReprocessingAttemptDetails,
  ObservationReprocessingAttemptListResponse,
} from "../../api/types";
import { compositeSourceUsable, type CompositeSource } from "../../app/compositeSourceState";
import {
  ingestionRunNeedsLiveRefresh,
  LIVE_DETAIL_REFRESH_INTERVAL_MS,
  LIVE_LIST_REFRESH_INTERVAL_MS,
  receiptNeedsLiveRefresh,
  reprocessingNeedsLiveRefresh,
} from "../../app/liveUpdates";
import { useSession } from "../../app/session";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  ModalActions,
  StatusBadge,
} from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  activityConnectionSearchParams,
  activityPageSearchParams,
  ingestionActivityTabSearchParams,
  integrationSelectionSearchParams,
  integrationViewState,
} from "./integrationViewState";

const PAGE_SIZE = 30;

export function IngestionActivity({
  propertyId,
  connections,
  connectionSource,
  adapterTypes,
  adapterTypeSource,
  canReadRawPayloads,
}: {
  propertyId: string;
  connections: AdapterConnectionListItem[];
  connectionSource: CompositeSource;
  adapterTypes: AdapterTypeCapability[];
  adapterTypeSource: CompositeSource;
  canReadRawPayloads: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = integrationViewState(searchParams);
  const contextSources = view.activityTab === "runs" || view.activityTab === "receipts"
    ? [connectionSource]
    : view.activityTab === "capabilities"
      ? [adapterTypeSource]
      : [];

  return (
    <div className="space-y-4">
      <SegmentedTabs
        value={view.activityTab}
        ariaLabel="Ingestion evidence"
        narrowGrid
        onValueChange={(tab) => setSearchParams(
          ingestionActivityTabSearchParams(searchParams, tab),
          { replace: true },
        )}
        options={[
          { value: "runs", label: "Runs", icon: <PlayCircle size={15} /> },
          { value: "receipts", label: "Receipts", icon: <Rows3 size={15} /> },
          { value: "reprocessing", label: "Reprocessing", compactLabel: "Replay", icon: <ListRestart size={15} /> },
          { value: "capabilities", label: "Capabilities", compactLabel: "Installed", icon: <Braces size={15} /> },
        ]}
      />
      <CompositeSourceNotice sources={contextSources} title="Some activity context is delayed" />
      {view.activityTab === "runs" && (
        <RunsPanel propertyId={propertyId} connections={connections} />
      )}
      {view.activityTab === "receipts" && (
        <ReceiptsPanel
          propertyId={propertyId}
          connections={connections}
          canReadRawPayloads={canReadRawPayloads}
        />
      )}
      {view.activityTab === "reprocessing" && <ReprocessingPanel propertyId={propertyId} />}
      {view.activityTab === "capabilities" && (
        <CapabilitiesPanel
          propertyId={propertyId}
          adapterTypes={adapterTypes}
          adapterTypeSource={adapterTypeSource}
        />
      )}
    </div>
  );
}

function RunsPanel({
  propertyId,
  connections,
}: {
  propertyId: string;
  connections: AdapterConnectionListItem[];
}) {
  const { request } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = integrationViewState(searchParams);
  const params = activityQueryParams(view.activityPage, view.activityConnectionId);
  const runs = useQuery({
    queryKey: ["ingestion-runs", propertyId, view.activityConnectionId ?? "", view.activityPage],
    queryFn: () => request<IngestionRunListResponse>(
      `/api/ingestion/properties/${propertyId}/runs?${params}`,
    ),
    refetchInterval: (query) => !view.selectedRunId
      && query.state.data?.runs.some((item) => ingestionRunNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const items = runs.data?.runs ?? [];

  function select(id: string | null) {
    setSearchParams(
      integrationSelectionSearchParams(searchParams, "run", id),
      { replace: true },
    );
  }

  return (
    <>
      <ActivityPanel
        title="Adapter runs"
        description="One record for each bounded adapter execution and its outcome."
        filter={(
          <ConnectionFilter
            value={view.activityConnectionId}
            connections={connections}
            onChange={(connectionId) => setSearchParams(
              activityConnectionSearchParams(searchParams, connectionId),
              { replace: true },
            )}
          />
        )}
      >
        {runs.isLoading ? (
          <LoadingState label="Loading adapter runs" />
        ) : runs.error ? (
          <div className="p-6"><ErrorState error={runs.error} retry={() => void runs.refetch()} /></div>
        ) : !items.length ? (
          <EmptyState
            icon={<Activity />}
            title="No runs recorded"
            description={view.activityConnectionId
              ? "This connection has no execution history on the selected page."
              : "Adapter execution history will appear here after processing begins."}
          />
        ) : (
          <>
            <div className="divide-y divide-base-300">
              {items.map((run) => (
                <EvidenceRow
                  key={run.runId}
                  icon={<PlayCircle size={18} />}
                  title={connectionName(run.connectionId, connections)}
                  detail={`${run.observedCount} observed · ${run.acceptedCount} accepted · ${run.rejectedCount} rejected`}
                  timestamp={run.startedAtUtc}
                  status={ingestionRunStatusLabel(run.status)}
                  onOpen={() => select(run.runId)}
                />
              ))}
            </div>
            <ActivityPagination
              page={view.activityPage}
              itemCount={items.length}
              hasMore={runs.data?.hasMore}
              itemLabel="run"
              disabled={runs.isFetching}
              onPageChange={(page) => setSearchParams(
                activityPageSearchParams(searchParams, page),
                { replace: true },
              )}
            />
          </>
        )}
      </ActivityPanel>
      <RunDetail
        propertyId={propertyId}
        runId={view.selectedRunId}
        connection={connections.find((item) => item.connectionId === runs.data?.runs.find(
          (run) => run.runId === view.selectedRunId,
        )?.connectionId)}
        onClose={() => select(null)}
      />
    </>
  );
}

function RunDetail({
  propertyId,
  runId,
  connection,
  onClose,
}: {
  propertyId: string;
  runId: string | null;
  connection?: AdapterConnectionListItem;
  onClose: () => void;
}) {
  const { request } = useSession();
  const run = useQuery({
    queryKey: ["ingestion-run", propertyId, runId],
    queryFn: () => request<IngestionRun>(`/api/ingestion/properties/${propertyId}/runs/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: (query) => ingestionRunNeedsLiveRefresh(query.state.data?.status)
      ? LIVE_DETAIL_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const item = run.data;

  return (
    <Modal
      open={Boolean(runId)}
      title="Adapter run"
      description={item
        ? `${connection?.adapterType || "Connection"} · run ${item.runId.slice(0, 8).toUpperCase()}`
        : "Loading run"}
      onClose={onClose}
    >
      {run.isLoading ? (
        <LoadingState label="Loading adapter run" />
      ) : run.error ? (
        <ErrorState error={run.error} retry={() => void run.refetch()} />
      ) : item ? (
        <div className="space-y-5">
          <DetailSummary
            title={`Started ${formatDateTime(item.startedAtUtc)}`}
            detail={item.completedAtUtc ? `Completed ${formatDateTime(item.completedAtUtc)}` : "Still running"}
            status={ingestionRunStatusLabel(item.status)}
          />
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Metric label="Observed" value={item.observedCount} />
            <Metric label="Accepted" value={item.acceptedCount} />
            <Metric label="Rejected" value={item.rejectedCount} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoRow icon={<GitBranch />} label="Starting checkpoint" value={item.startingCheckpoint || "None"} />
            <InfoRow icon={<GitBranch />} label="Accepted checkpoint" value={item.acceptedCheckpoint || "None"} />
            <InfoRow icon={<Activity />} label="Execution" value={executionKindLabel(item.executionKind)} />
            <InfoRow icon={<Clock3 />} label="Task attempt" value={item.taskAttempt != null ? String(item.taskAttempt) : "Not applicable"} />
          </div>
          {item.errorCode && <TechnicalError code={item.errorCode} />}
          <ModalActions>
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Close</button>
          </ModalActions>
        </div>
      ) : null}
    </Modal>
  );
}

function ReceiptsPanel({
  propertyId,
  connections,
  canReadRawPayloads,
}: {
  propertyId: string;
  connections: AdapterConnectionListItem[];
  canReadRawPayloads: boolean;
}) {
  const { request } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = integrationViewState(searchParams);
  const params = activityQueryParams(view.activityPage, view.activityConnectionId);
  const receipts = useQuery({
    queryKey: ["ingestion-receipts", propertyId, view.activityConnectionId ?? "", view.activityPage],
    queryFn: () => request<ObservationReceiptListResponse>(
      `/api/ingestion/properties/${propertyId}/receipts?${params}`,
    ),
    refetchInterval: (query) => !view.selectedReceiptId
      && query.state.data?.receipts.some((item) => receiptNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const items = receipts.data?.receipts ?? [];

  function select(id: string | null) {
    setSearchParams(
      integrationSelectionSearchParams(searchParams, "receipt", id),
      { replace: true },
    );
  }

  return (
    <>
      <ActivityPanel
        title="Observation receipts"
        description="Durable evidence for every source record accepted or rejected by Ingestion."
        filter={(
          <ConnectionFilter
            value={view.activityConnectionId}
            connections={connections}
            onChange={(connectionId) => setSearchParams(
              activityConnectionSearchParams(searchParams, connectionId),
              { replace: true },
            )}
          />
        )}
      >
        {receipts.isLoading ? (
          <LoadingState label="Loading observation receipts" />
        ) : receipts.error ? (
          <div className="p-6"><ErrorState error={receipts.error} retry={() => void receipts.refetch()} /></div>
        ) : !items.length ? (
          <EmptyState
            icon={<Database />}
            title="No receipts recorded"
            description={view.activityConnectionId
              ? "This connection has no source records on the selected page."
              : "Source records will appear here after an adapter submits observations."}
          />
        ) : (
          <>
            <div className="divide-y divide-base-300">
              {items.map((receipt) => (
                <EvidenceRow
                  key={receipt.receiptId}
                  icon={<FileJson2 size={18} />}
                  title={`${receipt.sourceRecordType} · ${receipt.externalId}`}
                  detail={`${connectionName(receipt.connectionId, connections)}${receipt.parserType ? ` · ${receipt.parserType} v${receipt.parserVersion}` : ""}`}
                  timestamp={receipt.receivedAtUtc}
                  status={receiptStatusLabel(receipt.status)}
                  onOpen={() => select(receipt.receiptId)}
                />
              ))}
            </div>
            <ActivityPagination
              page={view.activityPage}
              itemCount={items.length}
              hasMore={receipts.data?.hasMore}
              itemLabel="receipt"
              disabled={receipts.isFetching}
              onPageChange={(page) => setSearchParams(
                activityPageSearchParams(searchParams, page),
                { replace: true },
              )}
            />
          </>
        )}
      </ActivityPanel>
      <ReceiptDetail
        propertyId={propertyId}
        receiptId={view.selectedReceiptId}
        canReadRawPayloads={canReadRawPayloads}
        onClose={() => select(null)}
      />
    </>
  );
}

function ReceiptDetail({
  propertyId,
  receiptId,
  canReadRawPayloads,
  onClose,
}: {
  propertyId: string;
  receiptId: string | null;
  canReadRawPayloads: boolean;
  onClose: () => void;
}) {
  const { request, download } = useSession();
  const receipt = useQuery({
    queryKey: ["ingestion-receipt", propertyId, receiptId],
    queryFn: () => request<ObservationReceipt>(
      `/api/ingestion/properties/${propertyId}/receipts/${receiptId}`,
    ),
    enabled: Boolean(receiptId),
    refetchInterval: (query) => receiptNeedsLiveRefresh(query.state.data?.status)
      ? LIVE_DETAIL_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const downloadMutation = useMutation({
    mutationFn: async () => {
      const result = await download(
        `/api/ingestion/properties/${propertyId}/receipts/${receiptId}/raw-payload`,
      );
      const url = URL.createObjectURL(result.blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName || `ingestion-receipt-${receiptId}.payload`;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  });
  const item = receipt.data;
  const rawAvailable = item && rawPayloadStatusLabel(item.rawPayloadStatus) === "available";

  return (
    <Modal
      open={Boolean(receiptId)}
      size="lg"
      title={item ? `${item.sourceRecordType} observation` : "Observation receipt"}
      description={item ? `External record ${item.externalId}` : "Loading receipt"}
      onClose={onClose}
    >
      {receipt.isLoading ? (
        <LoadingState label="Loading observation receipt" />
      ) : receipt.error ? (
        <ErrorState error={receipt.error} retry={() => void receipt.refetch()} />
      ) : item ? (
        <div className="space-y-5">
          <DetailSummary
            title={`Received ${formatDateTime(item.receivedAtUtc)}`}
            detail={`Source observed ${formatDateTime(item.observedAtUtc)}`}
            status={receiptStatusLabel(item.status)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoRow icon={<FileJson2 />} label="Source record" value={item.sourceRecordType} />
            <InfoRow icon={<Database />} label="External ID" value={item.externalId} />
            <InfoRow icon={<GitBranch />} label="Source revision" value={item.sourceRevision || "Not provided"} />
            <InfoRow icon={<Braces />} label="Parser" value={item.parserType ? `${item.parserType} v${item.parserVersion}` : "Not parsed"} />
            <InfoRow
              icon={<FileJson2 />}
              label="Raw payload"
              value={`${capitalize(rawPayloadStatusLabel(item.rawPayloadStatus))} until ${formatDateTime(item.rawPayloadRetainUntilUtc)}`}
            />
            <InfoRow icon={<GitBranch />} label="Content hash" value={item.contentHash} />
          </div>
          {item.rejectionReason && <TechnicalError title="Rejection reason" code={item.rejectionReason} />}
          {downloadMutation.error && <ErrorState error={downloadMutation.error} />}
          <ModalActions>
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Close</button>
            {canReadRawPayloads && rawAvailable && (
              <button
                type="button"
                className="btn btn-primary btn-sm sm:btn-md"
                onClick={() => downloadMutation.mutate()}
                disabled={downloadMutation.isPending}
              >
                <Download size={16} />
                {downloadMutation.isPending ? "Preparing…" : "Download raw payload"}
              </button>
            )}
          </ModalActions>
        </div>
      ) : null}
    </Modal>
  );
}

function ReprocessingPanel({ propertyId }: { propertyId: string }) {
  const { request } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = integrationViewState(searchParams);
  const attempts = useQuery({
    queryKey: ["ingestion-reprocessing", propertyId, view.activityPage],
    queryFn: () => request<ObservationReprocessingAttemptListResponse>(
      `/api/ingestion/properties/${propertyId}/reprocessing-attempts?page=${view.activityPage}&pageSize=${PAGE_SIZE}`,
    ),
    refetchInterval: (query) => !view.selectedAttemptId
      && query.state.data?.attempts.some((item) => reprocessingNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const items = attempts.data?.attempts ?? [];

  function select(id: string | null) {
    setSearchParams(
      integrationSelectionSearchParams(searchParams, "attempt", id),
      { replace: true },
    );
  }

  return (
    <>
      <ActivityPanel
        title="Reprocessing attempts"
        description="Retained observations parsed again without changing their original source evidence."
      >
        {attempts.isLoading ? (
          <LoadingState label="Loading reprocessing attempts" />
        ) : attempts.error ? (
          <div className="p-6"><ErrorState error={attempts.error} retry={() => void attempts.refetch()} /></div>
        ) : !items.length ? (
          <EmptyState
            icon={<ListRestart />}
            title="No reprocessing attempts"
            description="Reprocessing evidence will appear here when a retained observation is parsed again."
          />
        ) : (
          <>
            <div className="divide-y divide-base-300">
              {items.map((attempt) => (
                <EvidenceRow
                  key={attempt.attemptId}
                  icon={<ListRestart size={18} />}
                  title={`${attempt.parserType} v${attempt.parserVersion}`}
                  detail={`${attempt.parsedCount} parsed · ${attempt.acceptedCount} accepted · ${attempt.duplicateCount} duplicates · ${attempt.rejectedCount} rejected`}
                  timestamp={attempt.requestedAtUtc}
                  status={reprocessingStatusLabel(attempt.status)}
                  onOpen={() => select(attempt.attemptId)}
                />
              ))}
            </div>
            <ActivityPagination
              page={view.activityPage}
              itemCount={items.length}
              hasMore={attempts.data?.hasMore}
              itemLabel="attempt"
              disabled={attempts.isFetching}
              onPageChange={(page) => setSearchParams(
                activityPageSearchParams(searchParams, page),
                { replace: true },
              )}
            />
          </>
        )}
      </ActivityPanel>
      <ReprocessingDetail
        propertyId={propertyId}
        attemptId={view.selectedAttemptId}
        onClose={() => select(null)}
      />
    </>
  );
}

function ReprocessingDetail({
  propertyId,
  attemptId,
  onClose,
}: {
  propertyId: string;
  attemptId: string | null;
  onClose: () => void;
}) {
  const { request } = useSession();
  const details = useQuery({
    queryKey: ["ingestion-reprocessing-attempt", propertyId, attemptId],
    queryFn: () => request<ObservationReprocessingAttemptDetails>(
      `/api/ingestion/properties/${propertyId}/reprocessing-attempts/${attemptId}`,
    ),
    enabled: Boolean(attemptId),
    refetchInterval: (query) => reprocessingNeedsLiveRefresh(query.state.data?.attempt.status)
      ? LIVE_DETAIL_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const item = details.data?.attempt;

  return (
    <Modal
      open={Boolean(attemptId)}
      size="lg"
      title={item ? `${item.parserType} reprocessing` : "Reprocessing attempt"}
      description={item ? `Attempt ${item.attemptId.slice(0, 8).toUpperCase()}` : "Loading attempt"}
      onClose={onClose}
    >
      {details.isLoading ? (
        <LoadingState label="Loading reprocessing attempt" />
      ) : details.error ? (
        <ErrorState error={details.error} retry={() => void details.refetch()} />
      ) : item ? (
        <div className="space-y-5">
          <DetailSummary
            title={`Requested ${formatDateTime(item.requestedAtUtc)}`}
            detail={`Parser version ${item.parserVersion} · task attempt ${item.lastTaskAttempt}`}
            status={reprocessingStatusLabel(item.status)}
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <Metric label="Parsed" value={item.parsedCount} />
            <Metric label="Accepted" value={item.acceptedCount} />
            <Metric label="Duplicates" value={item.duplicateCount} />
            <Metric label="Rejected" value={item.rejectedCount} />
          </div>
          {item.lastErrorCode && <TechnicalError code={item.lastErrorCode} />}
          <section aria-labelledby="reprocessing-output-heading">
            <h3 id="reprocessing-output-heading" className="font-display text-lg font-semibold">Outputs</h3>
            {details.data?.outputs.length ? (
              <div className="mt-3 overflow-hidden rounded-lg border border-base-300">
                <div className="divide-y divide-base-300">
                  {details.data.outputs.map((output) => (
                    <div key={output.outputIndex} className="grid gap-2 p-3 text-sm sm:grid-cols-[3rem_1fr_auto] sm:items-center sm:px-4">
                      <span className="font-mono text-xs text-base-content/45">#{output.outputIndex}</span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{output.recordType} · {output.externalId}</p>
                        <p className="mt-1 truncate font-mono text-xs text-base-content/45">{output.errorCode || output.contentHash}</p>
                      </div>
                      <StatusBadge status={outputStatusLabel(output.status)} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-base-300 p-5 text-center text-sm text-base-content/50">
                No parser outputs were recorded.
              </p>
            )}
          </section>
          <ModalActions>
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Close</button>
          </ModalActions>
        </div>
      ) : null}
    </Modal>
  );
}

function CapabilitiesPanel({
  propertyId,
  adapterTypes,
  adapterTypeSource,
}: {
  propertyId: string;
  adapterTypes: AdapterTypeCapability[];
  adapterTypeSource: CompositeSource;
}) {
  const { request } = useSession();
  const parsers = useQuery({
    queryKey: ["ingestion-parser-types", propertyId],
    queryFn: () => request<ObservationParserCapabilityListResponse>(
      `/api/ingestion/properties/${propertyId}/parser-types`,
    ),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <CapabilitySection
        title="Adapter capabilities"
        description="Acquisition types and execution modes registered in this deployment."
      >
        {!compositeSourceUsable(adapterTypeSource.state) ? (
          <CompositeSourceFallback state={adapterTypeSource.state} label="adapter capabilities" />
        ) : adapterTypes.length ? (
          <div className="divide-y divide-base-300">
            {adapterTypes.map((adapter) => (
              <article key={adapter.adapterType} className="p-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-semibold">{adapter.adapterType}</h3>
                  <span className="text-xs text-base-content/45">
                    Protocol v{adapter.protocolVersion} · config v{adapter.configurationSchemaVersion}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {adapter.executionModes.map((mode) => (
                    <span key={String(mode)} className="badge badge-ghost capitalize">
                      {adapterExecutionModeLabel(mode)}
                    </span>
                  ))}
                </div>
                {(adapter.minimumPollingIntervalSeconds || adapter.recommendedPollingIntervalSeconds) && (
                  <p className="mt-3 text-xs text-base-content/50">
                    Polling {adapter.minimumPollingIntervalSeconds ? `minimum ${formatDuration(adapter.minimumPollingIntervalSeconds)}` : ""}
                    {adapter.minimumPollingIntervalSeconds && adapter.recommendedPollingIntervalSeconds ? " · " : ""}
                    {adapter.recommendedPollingIntervalSeconds ? `recommended ${formatDuration(adapter.recommendedPollingIntervalSeconds)}` : ""}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Braces />}
            title="No adapter types registered"
            description="Connection creation remains unavailable until this deployment registers an adapter capability."
          />
        )}
      </CapabilitySection>
      <CapabilitySection
        title="Parser capabilities"
        description="Parsers available for retained-observation reprocessing."
      >
        {parsers.isLoading ? (
          <LoadingState label="Loading parser capabilities" />
        ) : parsers.error ? (
          <div className="p-5"><ErrorState error={parsers.error} retry={() => void parsers.refetch()} /></div>
        ) : parsers.data?.parsers.length ? (
          <div className="divide-y divide-base-300">
            {parsers.data.parsers.map((parser) => (
              <article key={`${parser.parserType}-${parser.parserVersion}`} className="p-4 sm:px-5">
                <h3 className="font-semibold">{parser.parserType} v{parser.parserVersion}</h3>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-base-content/45">Inputs</dt>
                    <dd className="mt-1 break-words font-medium text-base-content/70">
                      {parser.supportedSourceRecordTypes.join(", ") || "None"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/45">Outputs</dt>
                    <dd className="mt-1 break-words font-medium text-base-content/70">
                      {parser.outputRecordTypes.join(", ") || "None"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Braces />}
            title="No parser types registered"
            description="Retained observations cannot be reprocessed until a parser capability is installed."
          />
        )}
      </CapabilitySection>
    </div>
  );
}

function ActivityPanel({
  title,
  description,
  filter,
  children,
}: {
  title: string;
  description: string;
  filter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-base-300 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-base-content/55">{description}</p>
        </div>
        {filter}
      </div>
      {children}
    </section>
  );
}

function CapabilitySection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
      <header className="border-b border-base-300 p-5">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-base-content/55">{description}</p>
      </header>
      {children}
    </section>
  );
}

function EvidenceRow({
  icon,
  title,
  detail,
  timestamp,
  status,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  timestamp: string;
  status: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex w-full items-start gap-3 p-4 text-left transition hover:bg-base-200/65 focus-visible:bg-base-200/65 sm:items-center sm:px-6 sm:py-5"
      onClick={onOpen}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center sm:gap-5">
        <span className="block min-w-0">
          <span className="block truncate font-semibold">{title}</span>
          <span className="mt-1 block truncate text-xs text-base-content/45">{detail}</span>
        </span>
        <time className="mt-2 block text-xs text-base-content/50 sm:mt-0" dateTime={timestamp}>
          {formatDateTime(timestamp)}
        </time>
        <span className="mt-2 block sm:mt-0"><StatusBadge status={status} /></span>
      </span>
      <ChevronRight className="mt-2 shrink-0 text-base-content/35 transition-transform group-hover:translate-x-0.5 sm:mt-0" size={18} aria-hidden="true" />
    </button>
  );
}

function ActivityPagination({
  page,
  itemCount,
  hasMore,
  itemLabel,
  disabled,
  onPageChange,
}: {
  page: number;
  itemCount: number;
  hasMore?: boolean;
  itemLabel: string;
  disabled: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <PaginationBar
      page={page}
      pageSize={PAGE_SIZE}
      itemCount={itemCount}
      hasMore={hasMore}
      itemLabel={itemLabel}
      disabled={disabled}
      onPageChange={onPageChange}
    />
  );
}

function ConnectionFilter({
  value,
  connections,
  onChange,
}: {
  value: string | null;
  connections: AdapterConnectionListItem[];
  onChange: (value: string | null) => void;
}) {
  return (
    <SelectPicker
      className="w-full sm:w-60"
      size="sm"
      ariaLabel="Filter by connection"
      value={value || "all"}
      onValueChange={(next) => onChange(next === "all" ? null : next)}
      options={[
        { value: "all", label: "All connections" },
        ...connections.map((connection) => ({
          value: connection.connectionId,
          label: `${connection.adapterType} · ${connection.connectionId.slice(0, 6).toUpperCase()}`,
        })),
      ]}
    />
  );
}

function DetailSummary({ title, detail, status }: { title: string; detail: string; status: string }) {
  return (
    <section className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-base-300 bg-base-200/55 p-4">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-xs text-base-content/50">{detail}</p>
      </div>
      <StatusBadge status={status} />
    </section>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border border-base-300 p-4">
      <span className="mt-0.5 shrink-0 text-primary" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-base-content/45">{label}</p>
        <p className="mt-1 break-all text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-base-300 p-3 text-center sm:p-4">
      <p className="text-lg font-semibold sm:text-xl">{value}</p>
      <p className="mt-1 text-[0.7rem] text-base-content/45 sm:text-xs">{label}</p>
    </div>
  );
}

function TechnicalError({ title = "Processing error", code }: { title?: string; code: string }) {
  return (
    <section className="rounded-lg border border-error/20 bg-error/8 p-4">
      <p className="text-xs font-semibold uppercase text-error/70">{title}</p>
      <p className="mt-2 break-words font-mono text-xs leading-5 text-error">{code}</p>
    </section>
  );
}

function activityQueryParams(page: number, connectionId: string | null) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (connectionId) params.set("connectionId", connectionId);
  return params;
}

function connectionName(id: string, connections: AdapterConnectionListItem[]) {
  const connection = connections.find((item) => item.connectionId === id);
  return connection
    ? `${connection.adapterType} · ${id.slice(0, 6).toUpperCase()}`
    : `Connection ${id.slice(0, 8).toUpperCase()}`;
}

function executionKindLabel(value: number | string) {
  if (typeof value === "string") return humanize(value);
  return ({ 1: "Task runtime", 2: "Remote lease" } as Record<number, string>)[value] ?? "Unknown";
}

function outputStatusLabel(value: number | string) {
  if (typeof value === "string") return humanize(value);
  return ({ 1: "accepted", 2: "duplicate", 3: "rejected" } as Record<number, string>)[value] ?? "unknown";
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function capitalize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatDuration(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
