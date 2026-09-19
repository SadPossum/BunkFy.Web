export type OperationalPreviewSourceTone = "current" | "refreshing" | "delayed";

export function operationalPreviewQueryTone(
  data: unknown,
  isFetching: boolean,
  error: unknown,
  isPaused = false,
): OperationalPreviewSourceTone {
  if (error || isPaused) return "delayed";
  if (isFetching) return "refreshing";
  if (data !== undefined) return "current";
  return "delayed";
}

export function combineOperationalPreviewSourceTones(
  ...tones: Array<OperationalPreviewSourceTone | undefined>
): OperationalPreviewSourceTone {
  if (tones.some((tone) => tone === "delayed")) return "delayed";
  if (tones.some((tone) => tone === "refreshing")) return "refreshing";
  return "current";
}

export function shouldShowOperationalPreviewRefresh({
  hasRecoveryFailure,
  explicitRefreshPending,
}: {
  hasRecoveryFailure: boolean;
  explicitRefreshPending: boolean;
}) {
  return explicitRefreshPending
    || hasRecoveryFailure;
}
