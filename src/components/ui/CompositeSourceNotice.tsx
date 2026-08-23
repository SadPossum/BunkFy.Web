import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  compositeSourceNeedsRetry,
  type CompositeSource,
  type CompositeSourceState,
} from "../../app/compositeSourceState";
import { LoadingState } from "./primitives";

export function CompositeSourceNotice({
  sources,
  title = "Some data is delayed",
}: {
  sources: CompositeSource[];
  title?: string;
}) {
  const affectedSources = sources.filter((source) => compositeSourceNeedsRetry(source.state));
  if (affectedSources.length === 0) return null;

  const retrying = affectedSources.some((source) => source.isFetching);
  return (
    <div
      className="alert mb-4 flex-col items-stretch gap-3 border border-warning/25 bg-warning/10 text-base-content sm:flex-row sm:items-center"
      role="status"
    >
      <AlertTriangle className="shrink-0 self-start text-warning sm:self-auto" size={19} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-base-content/60">
          {affectedSources
            .map((source) => `${source.label} ${source.state === "stale" ? "is showing its last loaded snapshot" : "is unavailable"}`)
            .join(". ")}.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm self-end sm:self-auto"
        disabled={retrying}
        onClick={() => void Promise.all(affectedSources.map((source) => source.refetch()))}
      >
        <RotateCcw className={retrying ? "animate-spin" : ""} size={16} />
        Try again
      </button>
    </div>
  );
}

export function CompositeSourceFallback({
  state,
  label,
}: {
  state: CompositeSourceState;
  label: string;
}) {
  if (state === "loading") return <LoadingState label={`Loading ${label}`} />;

  return (
    <div className="grid min-h-48 place-items-center px-6 py-7 text-center">
      <div>
        <AlertTriangle className="mx-auto text-warning" size={22} />
        <p className="mt-3 text-sm font-semibold">{label[0].toUpperCase() + label.slice(1)} unavailable</p>
        <p className="mt-1 text-xs text-base-content/50">Other page data remains available.</p>
      </div>
    </div>
  );
}
