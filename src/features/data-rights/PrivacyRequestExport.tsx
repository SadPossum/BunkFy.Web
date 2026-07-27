import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, FileClock, KeyRound, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import type { DataRightsCase, DataRightsExportArtifact } from "../../api/types";
import { useSession } from "../../app/session";
import { ErrorState, StatusBadge } from "../../components/ui/primitives";
import {
  dataRightsExportNeedsLiveRefresh,
  dataRightsExportStatusKey,
  dataRightsExportStatusLabel,
} from "./dataRightsWorkflow";

export function PrivacyRequestExport({
  basePath,
  scopeKey,
  dataRightsCase,
  canGenerate,
  canDownload,
  onTerminalState,
}: {
  basePath: string;
  scopeKey: string;
  dataRightsCase: DataRightsCase;
  canGenerate: boolean;
  canDownload: boolean;
  onTerminalState: () => Promise<void>;
}) {
  const { download, request, stepUpWithPassword } = useSession();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [stepUpError, setStepUpError] = useState<unknown>(null);
  const [showPasswordStepUp, setShowPasswordStepUp] = useState(false);
  const [downloadNeedsMfa, setDownloadNeedsMfa] = useState(false);
  const generationAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const observedTerminal = useRef<string | null>(null);
  const artifactQueryKey = ["data-rights-export", scopeKey, dataRightsCase.id] as const;
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
  const generation = useMutation({
    mutationFn: () => {
      const fingerprint = [
        dataRightsCase.id,
        dataRightsCase.decisionRevision ?? "none",
        dataRightsCase.selectedSubjectCount,
      ].join(":");
      if (
        !generationAttempt.current ||
        generationAttempt.current.fingerprint !== fingerprint
      ) {
        generationAttempt.current = {
          fingerprint,
          idempotencyKey: crypto.randomUUID(),
        };
      }
      return request<DataRightsExportArtifact>(`${basePath}/export`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: generationAttempt.current.idempotencyKey,
          expectedVersion: dataRightsCase.version,
        }),
      });
    },
    onSuccess: (result) => {
      setPassword("");
      setShowPasswordStepUp(false);
      setStepUpError(null);
      queryClient.setQueryData(artifactQueryKey, result);
    },
    onError: (error) => {
      if (isInsufficientAuthentication(error)) {
        setShowPasswordStepUp(true);
      }
    },
  });
  const downloadArtifact = useMutation({
    mutationFn: async (current: DataRightsExportArtifact) => {
      const result = await download(
        `${basePath}/export/${current.id}/download`,
      );
      const url = URL.createObjectURL(result.blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName ||
          `bunkfy-data-export-${dataRightsCase.id}.json`;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    onSuccess: () => setDownloadNeedsMfa(false),
    onError: (error) => {
      if (isInsufficientAuthentication(error)) {
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
  }, [basePath, dataRightsCase.id]);

  useEffect(() => {
    const current = artifact.data;
    if (!current || dataRightsExportNeedsLiveRefresh(current.status)) return;
    const terminalKey = `${current.id}:${current.version}:${current.status}`;
    if (observedTerminal.current === terminalKey) return;
    observedTerminal.current = terminalKey;
    void onTerminalState();
  }, [artifact.data, onTerminalState]);

  async function confirmPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStepUpError(null);
    try {
      await stepUpWithPassword(password);
      generation.reset();
      generation.mutate();
    } catch (error) {
      setStepUpError(error);
    }
  }

  const current = artifact.data;
  const status = current ? dataRightsExportStatusKey(current.status) : "notRequested";
  const busy = generation.isPending || dataRightsExportNeedsLiveRefresh(current?.status);
  const generationError = generation.error &&
    !isInsufficientAuthentication(generation.error)
    ? generation.error
    : null;
  const downloadError = downloadArtifact.error &&
    !isInsufficientAuthentication(downloadArtifact.error)
    ? downloadArtifact.error
    : null;

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

      {artifact.isLoading && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-base-200 px-4 py-4 text-sm text-base-content/55">
          <span className="loading loading-spinner loading-sm text-primary" />
          Checking export status
        </div>
      )}

      {!artifact.isLoading && !artifact.error && (
        <div className="mt-4 rounded-lg border border-base-300 bg-base-200/55 p-4">
          {status === "notRequested" && (
            <ExportAction
              title="Ready to generate"
              description="Generation uses the records approved in this case and cannot expand its scope."
              action={canGenerate && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => generation.mutate()}
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
          {status === "failed" && (
            <ExportAction
              title="Generation did not finish"
              description="Retry keeps the approved case scope and creates no second artifact."
              action={canGenerate && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={generation.isPending}
                  onClick={() => generation.mutate()}
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
                    disabled={downloadArtifact.isPending}
                    onClick={() => downloadArtifact.mutate(current)}
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

      {showPasswordStepUp && (
        <form
          className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-4"
          onSubmit={confirmPassword}
        >
          <div className="flex items-start gap-3">
            <KeyRound size={18} className="mt-0.5 shrink-0 text-warning-content" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Confirm your password to generate this export</p>
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
                  Confirm and generate
                </button>
              </div>
            </div>
          </div>
          {stepUpError !== null && (
            <div className="mt-3"><ErrorState error={stepUpError} /></div>
          )}
        </form>
      )}

      {downloadNeedsMfa && (
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

function isInsufficientAuthentication(error: unknown): boolean {
  return error instanceof ApiError &&
    error.code === "Security.InsufficientAuthentication";
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
