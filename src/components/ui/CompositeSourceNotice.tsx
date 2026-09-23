import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  compositeSourceNeedsRetry,
  type CompositeSource,
  type CompositeSourceState,
} from "../../app/compositeSourceState";
import { useNetworkStatus } from "../../app/networkStatus";
import { ErrorState, LoadingState } from "./primitives";

export function CompositeSourceNotice({
  className = "mb-4",
  sources,
  title,
  keepRetryFocusable = false,
}: {
  className?: string;
  sources: CompositeSource[];
  title?: string;
  keepRetryFocusable?: boolean;
}) {
  const { isOffline } = useNetworkStatus();
  const affectedSources = sources.filter((source) => compositeSourceNeedsRetry(source.state));
  if (affectedSources.length === 0) return null;

  const retrying = affectedSources.some((source) => source.isFetching);
  const resolvedTitle = title ?? (affectedSources.some((source) => source.state === "unavailable")
    ? "Some information is unavailable"
    : "Showing last confirmed information");
  return (
    <div
      className={`alert flex flex-col items-stretch gap-3 border border-warning/25 bg-warning/10 text-base-content sm:flex-row sm:items-center ${className}`}
      role="status"
      aria-live="polite"
    >
      <AlertTriangle className="shrink-0 self-start text-warning sm:self-auto" size={19} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{resolvedTitle}</p>
        <p className="mt-1 text-sm text-base-content/60">
          {affectedSources
            .map((source) => `${source.label} ${source.state === "stale" ? "is showing its last confirmed snapshot" : "could not be confirmed"}`)
            .join(". ")}.
        </p>
      </div>
      <button
        type="button"
        className={`btn btn-ghost btn-sm self-end sm:self-auto ${keepRetryFocusable && (retrying || isOffline) ? "pointer-events-auto cursor-not-allowed text-base-content/60" : ""}`}
        disabled={!keepRetryFocusable && (retrying || isOffline)}
        aria-disabled={keepRetryFocusable ? retrying || isOffline : undefined}
        aria-busy={keepRetryFocusable && retrying && !isOffline ? true : undefined}
        title={isOffline ? "Reconnect before refreshing." : undefined}
        onClick={() => { if (!retrying && !isOffline) void Promise.all(affectedSources.map((source) => source.refetch())); }}
      >
        <RotateCcw className={retrying ? "animate-spin" : ""} size={16} />
        {isOffline ? "Reconnect to retry" : "Try again"}
      </button>
    </div>
  );
}

export function CompositeSourceFallback({
  error,
  state,
  label,
  retry,
  title,
}: {
  error?: unknown;
  state: CompositeSourceState;
  label: string;
  retry?: () => void;
  title?: string;
}) {
  if (state === "loading") return <LoadingState label={`Loading ${label}`} />;
  if (error) {
    return (
      <div className="p-4 sm:p-5">
        <ErrorState error={error} retry={retry} title={title} />
      </div>
    );
  }

  return (
    <div className="grid min-h-48 place-items-center px-6 py-7 text-center">
      <div>
        <AlertTriangle className="mx-auto text-warning" size={22} />
        <p className="mt-3 text-sm font-semibold">{label[0].toUpperCase() + label.slice(1)} unavailable</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-base-content/50">
          {state === "stale"
            ? "Use the last confirmed snapshot carefully and refresh before making a change."
            : `No current ${label} could be confirmed. Other visible sections keep their own source status.`}
        </p>
      </div>
    </div>
  );
}
