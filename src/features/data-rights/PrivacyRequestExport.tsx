import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, FileClock, KeyRound, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import type { DataRightsCase, DataRightsExportArtifact } from "../../api/types";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { ErrorState, StatusBadge } from "../../components/ui/primitives";
import {
  dataRightsExportNeedsLiveRefresh,
  dataRightsExportStatusKey,
  dataRightsExportStatusLabel,
} from "./dataRightsWorkflow";
import {
  dataRightsExportGenerationRequest,
  resolveDataRightsExportGenerationAttempt,
  type DataRightsExportGenerationAttempt,
  type DataRightsExportGenerationIntent,
} from "./dataRightsExportGenerationAttempt";
import {
  dataRightsCaseMatches,
  dataRightsExportQueryKey,
  dataRightsMutationAllowed,
  dataRightsSourceChangedError,
  dataRightsSubmissionMatches,
  type DataRightsCaseSnapshot,
} from "./dataRightsSourceAuthority";

type ExportGenerationSubmission = {
  intent: DataRightsExportGenerationIntent;
  basePath: string;
  scopeKey: string;
  operatorScopeKey: string;
  caseSnapshot: DataRightsCaseSnapshot;
};

type ExportDownloadSubmission = {
  artifact: DataRightsExportArtifact;
  basePath: string;
  scopeKey: string;
  operatorScopeKey: string;
  caseSnapshot: DataRightsCaseSnapshot;
};

export function PrivacyRequestExport({
  basePath,
  scopeKey,
  dataRightsCase,
  canGenerate,
  canDownload,
  operatorScopeKey,
  permissionCurrent,
  caseCurrent,
  selectedEvidenceCurrent,
  onTerminalState,
}: {
  basePath: string;
  scopeKey: string;
  dataRightsCase: DataRightsCase;
  canGenerate: boolean;
  canDownload: boolean;
  operatorScopeKey: string;
  permissionCurrent: boolean;
  caseCurrent: boolean;
  selectedEvidenceCurrent: boolean;
  onTerminalState: () => Promise<void>;
}) {
  const { download, request, stepUpWithPassword } = useSession();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [stepUpError, setStepUpError] = useState<unknown>(null);
  const [showPasswordStepUp, setShowPasswordStepUp] = useState(false);
  const [downloadNeedsMfa, setDownloadNeedsMfa] = useState(false);
  const generationAttempt = useRef<DataRightsExportGenerationAttempt | null>(null);
  const observedTerminal = useRef<string | null>(null);
  const artifactQueryKey = dataRightsExportQueryKey(
    scopeKey,
    dataRightsCase.id,
    operatorScopeKey,
  );
  const artifact = useQuery({
    queryKey: artifactQueryKey,
    queryFn: async () => {
      try {
        return await request<DataRightsExportArtifact>(`${basePath}/export`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
    refetchInterval: (query) => dataRightsExportNeedsLiveRefresh(query.state.data?.status)
      ? 2_000
      : false,
    refetchIntervalInBackground: false,
  });
  const artifactSource = createCompositeSource({
    label: "Protected export artifact",
    hasData: artifact.data !== undefined,
    isLoading: artifact.isLoading,
    error: artifact.error,
    isFetching: artifact.isFetching,
    refetch: () => artifact.refetch(),
  });
  const artifactCurrent = compositeSourceCurrent(artifactSource);
  const artifactUsable = compositeSourceUsable(artifactSource.state);
  const authorityRef = useRef({
    permissionCurrent,
    caseCurrent,
    selectedEvidenceCurrent,
    artifactCurrent,
    operatorScopeKey,
    scopeKey,
    dataRightsCase,
    artifact: artifact.data,
  });
  authorityRef.current = {
    permissionCurrent,
    caseCurrent,
    selectedEvidenceCurrent,
    artifactCurrent,
    operatorScopeKey,
    scopeKey,
    dataRightsCase,
    artifact: artifact.data,
  };
  const generation = useMutation({
    mutationFn: (submission: ExportGenerationSubmission) => {
      const current = authorityRef.current;
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      ) || !dataRightsCaseMatches(current.dataRightsCase, submission.caseSnapshot) ||
        !exportIntentMatchesArtifact(submission.intent, current.artifact) ||
        !dataRightsMutationAllowed("generate-export", {
          permissionsCurrent: current.permissionCurrent,
          caseCurrent: current.caseCurrent,
          selectedEvidenceCurrent: current.selectedEvidenceCurrent,
          supportingSourceCurrent: current.artifactCurrent,
        })) {
        throw dataRightsSourceChangedError();
      }
      generationAttempt.current = resolveDataRightsExportGenerationAttempt(
        generationAttempt.current,
        submission.intent,
      );
      const generationRequest = dataRightsExportGenerationRequest(
        submission.basePath,
        generationAttempt.current,
      );
      return request<DataRightsExportArtifact>(generationRequest.path, {
        method: "POST",
        body: JSON.stringify(generationRequest.body),
      });
    },
    onSuccess: (result, submission) => {
      const current = authorityRef.current;
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      )) return;
      if (!dataRightsCaseMatches(current.dataRightsCase, submission.caseSnapshot) ||
        !dataRightsMutationAllowed("generate-export", {
          permissionsCurrent: current.permissionCurrent,
          caseCurrent: current.caseCurrent,
          supportingSourceCurrent: current.artifactCurrent,
        })) {
        generationAttempt.current = null;
        void queryClient.invalidateQueries({
          queryKey: dataRightsExportQueryKey(
            submission.scopeKey,
            submission.caseSnapshot.id,
            submission.operatorScopeKey,
          ),
        });
        return;
      }
      const cached = queryClient.getQueryData<DataRightsExportArtifact | null>(
        artifactQueryKey,
      );
      if (cached && (cached.id !== result.id || cached.version > result.version)) {
        generationAttempt.current = null;
        void queryClient.invalidateQueries({ queryKey: artifactQueryKey });
        return;
      }
      generationAttempt.current = null;
      setPassword("");
      setShowPasswordStepUp(false);
      setStepUpError(null);
      queryClient.setQueryData(artifactQueryKey, result);
    },
    onError: (error, submission) => {
      const current = authorityRef.current;
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      )) return;
      if (!dataRightsCaseMatches(current.dataRightsCase, submission.caseSnapshot) ||
        !exportIntentMatchesArtifact(submission.intent, current.artifact) ||
        !dataRightsMutationAllowed("generate-export", {
          permissionsCurrent: current.permissionCurrent,
          caseCurrent: current.caseCurrent,
          supportingSourceCurrent: current.artifactCurrent,
        })) {
        generationAttempt.current = null;
        void queryClient.invalidateQueries({
          queryKey: dataRightsExportQueryKey(
            submission.scopeKey,
            submission.caseSnapshot.id,
            submission.operatorScopeKey,
          ),
        });
        return;
      }
      if (isInsufficientAuthenticationError(error)) {
        setShowPasswordStepUp(true);
      } else {
        void queryClient.invalidateQueries({
          queryKey: dataRightsExportQueryKey(
            submission.scopeKey,
            submission.caseSnapshot.id,
            submission.operatorScopeKey,
          ),
        });
      }
    },
  });
  const downloadArtifact = useMutation({
    mutationFn: async (submission: ExportDownloadSubmission) => {
      const current = authorityRef.current;
      const artifactMatches = current.artifact?.id === submission.artifact.id &&
        current.artifact.version === submission.artifact.version &&
        current.artifact.status === submission.artifact.status;
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      ) || !dataRightsCaseMatches(current.dataRightsCase, submission.caseSnapshot) ||
        !artifactMatches || !dataRightsMutationAllowed("download-export", {
          permissionsCurrent: current.permissionCurrent,
          caseCurrent: current.caseCurrent,
          supportingSourceCurrent: current.artifactCurrent,
        })) {
        throw dataRightsSourceChangedError();
      }
      return download(
        `${submission.basePath}/export/${submission.artifact.id}/download`,
      );
    },
    onSuccess: (result, submission) => {
      const current = authorityRef.current;
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      ) || !dataRightsCaseMatches(current.dataRightsCase, submission.caseSnapshot) ||
        current.artifact?.id !== submission.artifact.id ||
        current.artifact.version !== submission.artifact.version ||
        !dataRightsMutationAllowed("download-export", {
          permissionsCurrent: current.permissionCurrent,
          caseCurrent: current.caseCurrent,
          supportingSourceCurrent: current.artifactCurrent,
        })) return;
      const url = URL.createObjectURL(result.blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName ||
          `bunkfy-data-export-${submission.caseSnapshot.id}.json`;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setDownloadNeedsMfa(false);
    },
    onError: (error, submission) => {
      const current = authorityRef.current;
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      )) return;
      const artifactMatches = current.artifact?.id === submission.artifact.id &&
        current.artifact.version === submission.artifact.version &&
        current.artifact.status === submission.artifact.status;
      if (!dataRightsCaseMatches(current.dataRightsCase, submission.caseSnapshot) ||
        !artifactMatches || !dataRightsMutationAllowed("download-export", {
          permissionsCurrent: current.permissionCurrent,
          caseCurrent: current.caseCurrent,
          supportingSourceCurrent: current.artifactCurrent,
        })) return;
      if (isInsufficientAuthenticationError(error)) {
        setDownloadNeedsMfa(true);
      }
    },
  });

  useEffect(() => {
    generationAttempt.current = null;
    observedTerminal.current = null;
    setPassword("");
    setShowPasswordStepUp(false);
    setStepUpError(null);
    setDownloadNeedsMfa(false);
  }, [basePath, dataRightsCase.id, operatorScopeKey, scopeKey]);

  useEffect(() => {
    const current = artifact.data;
    if (!artifactCurrent || !current || dataRightsExportNeedsLiveRefresh(current.status)) return;
    const terminalKey = `${current.id}:${current.version}:${current.status}`;
    if (observedTerminal.current === terminalKey) return;
    observedTerminal.current = terminalKey;
    void onTerminalState();
  }, [artifact.data, artifactCurrent, onTerminalState]);

  async function confirmPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStepUpError(null);
    try {
      await stepUpWithPassword(password);
      if (!generationAttempt.current) {
        throw new Error("The export generation attempt is no longer available.");
      }

      const intent = generationAttempt.current.intent;
      generation.reset();
      generation.mutate(generationSubmission(intent));
    } catch (error) {
      setStepUpError(error);
    }
  }

  const current = artifactUsable ? artifact.data : undefined;
  const status = current ? dataRightsExportStatusKey(current.status) : "notRequested";
  const busy = generation.isPending || dataRightsExportNeedsLiveRefresh(current?.status);
  const generationError = generation.error &&
    !isInsufficientAuthenticationError(generation.error)
    ? generation.error
    : null;
  const downloadError = downloadArtifact.error &&
    !isInsufficientAuthenticationError(downloadArtifact.error)
    ? downloadArtifact.error
    : null;
  const createIntent: DataRightsExportGenerationIntent = {
    kind: "create",
    caseId: dataRightsCase.id,
    decisionRevision: dataRightsCase.decisionRevision,
    selectedSubjectCount: dataRightsCase.selectedSubjectCount,
    expectedCaseVersion: dataRightsCase.version,
  };
  const generationAuthorityCurrent = canGenerate && dataRightsMutationAllowed(
    "generate-export",
    {
      permissionsCurrent: permissionCurrent,
      caseCurrent,
      selectedEvidenceCurrent,
      supportingSourceCurrent: artifactCurrent,
    },
  );
  const downloadAuthorityCurrent = canDownload && dataRightsMutationAllowed(
    "download-export",
    {
      permissionsCurrent: permissionCurrent,
      caseCurrent,
      supportingSourceCurrent: artifactCurrent,
    },
  );

  function generationSubmission(
    intent: DataRightsExportGenerationIntent,
  ): ExportGenerationSubmission {
    return {
      intent,
      basePath,
      scopeKey,
      operatorScopeKey,
      caseSnapshot: dataRightsCase,
    };
  }

  return (
    <section className="border-t border-base-300 pt-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            {status === "available" ? <FileCheck2 size={18} /> : <FileClock size={18} />}
          </span>
          <div>
            <h3 className="font-display text-lg font-semibold">Protected export</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-base-content/55">
              BunkFy encrypts the generated file and removes it after its fixed expiry time.
            </p>
          </div>
        </div>
        {current && <StatusBadge status={dataRightsExportStatusLabel(current.status)} />}
      </div>

      <CompositeSourceNotice
        className="mt-4"
        sources={[artifactSource]}
        title="Protected export status is delayed"
      />

      {artifact.isLoading && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-base-200 px-4 py-4 text-sm text-base-content/55">
          <span className="loading loading-spinner loading-sm text-primary" />
          Checking export status
        </div>
      )}

      {!artifact.isLoading && !artifactUsable && (
        <CompositeSourceFallback state={artifactSource.state} label="protected export status" />
      )}

      {!artifact.isLoading && artifactUsable && (
        <div className="mt-4 rounded-lg border border-base-300 bg-base-200/55 p-4">
          {status === "notRequested" && !artifactCurrent && (
            <ExportAction
              title="Export status is not confirmed"
              description="Refresh the protected export status before starting generation. BunkFy will not assume that no artifact exists."
            />
          )}
          {status === "notRequested" && artifactCurrent && (
            <ExportAction
              title="Ready to generate"
              description="Generation uses the records approved in this case and cannot expand its scope."
              action={canGenerate && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || !generationAuthorityCurrent}
                  onClick={() => generation.mutate(generationSubmission(createIntent))}
                >
                  <FileCheck2 size={15} />
                  Generate export
                </button>
              )}
            />
          )}
          {(status === "requested" || status === "generating") && (
            <ExportAction
              title={status === "requested" ? "Generation queued" : "Generating export"}
              description="This panel refreshes only while the protected artifact is being prepared."
              action={<span className="loading loading-spinner loading-sm text-primary" />}
            />
          )}
          {status === "failed" && current && (
            <ExportAction
              title="Generation did not finish"
              description="Retry keeps the approved case scope and creates no second artifact."
              action={canGenerate && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={generation.isPending || !generationAuthorityCurrent}
                  onClick={() => generation.mutate(generationSubmission({
                    kind: "retry",
                    caseId: dataRightsCase.id,
                    artifactId: current.id,
                    expectedCaseVersion: dataRightsCase.version,
                    expectedArtifactVersion: current.version,
                  }))}
                >
                  <RefreshCw size={15} />
                  Retry generation
                </button>
              )}
            />
          )}
          {status === "available" && current && (
            <ExportAction
              title="Export is available"
              description={`Download before ${formatDateTime(current.expiresAtUtc)}. The server verifies the complete encrypted artifact before releasing it.`}
              action={canDownload
                ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={downloadArtifact.isPending || !downloadAuthorityCurrent}
                    onClick={() => downloadArtifact.mutate({
                      artifact: current,
                      basePath,
                      scopeKey,
                      operatorScopeKey,
                      caseSnapshot: dataRightsCase,
                    })}
                  >
                    {downloadArtifact.isPending
                      ? <span className="loading loading-spinner loading-xs" />
                      : <Download size={15} />}
                    Download
                  </button>
                )
                : (
                  <span className="text-xs font-semibold text-base-content/45">
                    Download permission required
                  </span>
                )}
            />
          )}
          {["expired", "deleting", "deleted"].includes(status) && (
            <ExportAction
              title="Export expired"
              description="The protected file is no longer available. Open a new privacy request if another export is required."
            />
          )}
        </div>
      )}

      {showPasswordStepUp && generationAuthorityCurrent && (
        <form
          className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-4"
          onSubmit={confirmPassword}
        >
          <div className="flex items-start gap-3">
            <KeyRound size={18} className="mt-0.5 shrink-0 text-warning-content" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                Confirm your password to {generationAttempt.current?.intent.kind === "retry" ? "retry" : "generate"} this export
              </p>
              <p className="mt-1 text-xs leading-5 text-base-content/55">
                Generation requires a recent privileged sign-in.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  className="input input-bordered input-sm min-w-0 flex-1 bg-base-100"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  aria-label="Current password"
                  required
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!password || generation.isPending}
                >
                  Confirm and {generationAttempt.current?.intent.kind === "retry" ? "retry" : "generate"}
                </button>
              </div>
            </div>
          </div>
          {stepUpError !== null && (
            <div className="mt-3"><ErrorState error={stepUpError} /></div>
          )}
        </form>
      )}

      {downloadNeedsMfa && downloadAuthorityCurrent && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/8 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning-content" />
            <div>
              <p className="text-sm font-semibold">A recent MFA sign-in is required</p>
              <p className="mt-1 text-xs leading-5 text-base-content/55">
                Complete a fresh MFA sign-in, then retry. You can configure and
                manage MFA in account security.
              </p>
            </div>
          </div>
          <Link className="btn btn-outline btn-sm shrink-0" to="/account">
            Account security
          </Link>
        </div>
      )}

      {(artifact.error || generationError || downloadError) && (
        <div className="mt-4">
          <ErrorState error={artifact.error ?? generationError ?? downloadError} />
        </div>
      )}
    </section>
  );
}

function ExportAction({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-base-content/55">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function exportIntentMatchesArtifact(
  intent: DataRightsExportGenerationIntent,
  artifact: DataRightsExportArtifact | null | undefined,
): boolean {
  return intent.kind === "create"
    ? artifact === null
    : artifact?.id === intent.artifactId &&
      artifact.version === intent.expectedArtifactVersion;
}
