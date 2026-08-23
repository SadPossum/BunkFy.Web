export type CompositeSourceState =
  | "loading"
  | "ready"
  | "stale"
  | "unavailable";

export type CompositeSource = {
  label: string;
  state: CompositeSourceState;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

export function compositeSourceState(
  hasData: boolean,
  isLoading: boolean,
  hasError: boolean,
): CompositeSourceState {
  if (hasData) return hasError ? "stale" : "ready";
  if (hasError) return "unavailable";
  return isLoading ? "loading" : "unavailable";
}

export function createCompositeSource({
  label,
  hasData,
  isLoading,
  error,
  isFetching,
  refetch,
}: {
  label: string;
  hasData: boolean;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}): CompositeSource {
  return {
    label,
    state: compositeSourceState(hasData, isLoading, Boolean(error)),
    isFetching,
    refetch,
  };
}

export function compositeSourceUsable(state: CompositeSourceState): boolean {
  return state === "ready" || state === "stale";
}

export function compositeSourceNeedsRetry(
  state: CompositeSourceState,
): boolean {
  return state === "stale" || state === "unavailable";
}
