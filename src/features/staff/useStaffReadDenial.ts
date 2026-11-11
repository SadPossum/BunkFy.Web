import { useQueryClient, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";

const permissionDenials = [401, 403];

// A denied read is not an ordinary stale-data outage. Conceal immediately, then
// evict only its settled exact cache entry. The observer can retain old data
// after removal, so keep a latch until it receives a fresh successful result.
// Eviction also prevents a later modal mount from reviving that data on503.
export function useStaffReadDenial(
  query: UseQueryResult<unknown, Error>,
  queryKey: QueryKey,
  deniedStatuses: readonly number[] = permissionDenials,
) {
  const client = useQueryClient();
  const identity = JSON.stringify(queryKey);
  const [deniedIdentity, setDeniedIdentity] = useState<string | null>(null);
  const observedDenial = query.error instanceof ApiError && deniedStatuses.includes(query.error.status);
  const successfulRead = query.isSuccess && !query.isFetching && query.data !== undefined;
  const denied = observedDenial || (deniedIdentity === identity && !successfulRead);

  useEffect(() => {
    if (observedDenial) {
      setDeniedIdentity(identity);
      if (query.isFetching || query.data === undefined) return;
      const key = JSON.parse(identity) as QueryKey;
      const cached = client.getQueryState(key);
      if (cached?.status === "error" && cached.fetchStatus === "idle"
        && cached.error === query.error && cached.data === query.data
        && cached.errorUpdatedAt === query.errorUpdatedAt && cached.dataUpdatedAt === query.dataUpdatedAt) {
        client.removeQueries({ queryKey: key, exact: true });
      }
    } else if (successfulRead && deniedIdentity === identity) {
      setDeniedIdentity(null);
    }
  }, [client, identity, observedDenial, successfulRead, deniedIdentity, query.isFetching, query.data, query.error, query.errorUpdatedAt, query.dataUpdatedAt]);
  return denied;
}
