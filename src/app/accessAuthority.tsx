import {
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, type ApiSession } from "../api/client";
import type {
  AccessPermissionCheck,
  AccessPermissionEvaluationResponse,
} from "../api/types";
import { browserIsOnline } from "../api/requestConnectivity";
import { useSession } from "./session";

export const ACCESS_AUTHORITY_REFRESH_INTERVAL_MS = 3_000;
export const ACCESS_PERMISSION_QUERY_ROOT = "access-permissions";

type RegisteredChecks = ReadonlyMap<string, readonly AccessPermissionCheck[]>;

type AccessAuthorityContextValue = {
  decisionKeys: ReadonlySet<string>;
  responseKeys: ReadonlySet<string>;
  error: unknown;
  hasSnapshot: boolean;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => Promise<void>;
  register: (registrationId: string, checks: readonly AccessPermissionCheck[]) => void;
  unregister: (registrationId: string) => void;
};

const AccessAuthorityContext = createContext<AccessAuthorityContextValue | null>(null);

type AuthoritySnapshot = {
  identity: string;
  evaluation: number;
  response: AccessPermissionEvaluationResponse;
};

export function AccessAuthorityProvider({ children }: { children: ReactNode }) {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const [registered, setRegistered] = useState<RegisteredChecks>(() => new Map());
  const authorityBoundary = accessAuthorityIdentity(session);
  const retained = useRef<AuthoritySnapshot | null>(null);
  const evaluation = useRef(0);
  const [barrier, setBarrier] = useState({ identity: "", evaluation: 0 });
  const [rejection, setRejection] = useState<{ identity: string; error: ApiError } | null>(null);
  const scrubbedBoundary = useRef("");
  const processedEvaluation = useRef(0);
  useLayoutEffect(() => {
    scrubbedBoundary.current = "";
    setRejection(current => current?.identity === authorityBoundary ? current : null);
  }, [authorityBoundary]);
  const scrubRevokedQueriesOnce = useCallback(() => {
    if (scrubbedBoundary.current === authorityBoundary) return;
    scrubbedBoundary.current = authorityBoundary;
    // Removing the property catalogue changes consumers' registered checks.
    // One denial episode must not scrub again for every resulting query key.
    scrubRevokedAccessQueries(queryClient);
  }, [authorityBoundary, queryClient]);

  const register = useCallback((registrationId: string, checks: readonly AccessPermissionCheck[]) => {
    const normalized = normalizeAccessPermissionChecks(checks);
    setRegistered((current) => {
      const existing = current.get(registrationId) ?? [];
      if (samePermissionChecks(existing, normalized)) return current;
      const next = new Map(current);
      next.set(registrationId, normalized);
      return next;
    });
  }, []);

  const unregister = useCallback((registrationId: string) => {
    setRegistered((current) => {
      if (!current.has(registrationId)) return current;
      const next = new Map(current);
      next.delete(registrationId);
      return next;
    });
  }, []);

  const checks = useMemo(
    () => mergeAccessPermissionChecks([...registered.values()]),
    [registered],
  );
  const checkKeys = useMemo(() => checks.map(accessPermissionCheckKey), [checks]);
  const canEvaluate = Boolean(
    session &&
    checks.length &&
    accessAuthorityChecksMatchTenant(session.tenantId, checks),
  );
  const evaluationKey = JSON.stringify([authorityBoundary, ...checkKeys]);
  const currentEvaluationKey = useRef(evaluationKey);
  currentEvaluationKey.current = evaluationKey;
  useEffect(() => () => { currentEvaluationKey.current = ""; }, []);
  const query = useQuery({
    queryKey: [ACCESS_PERMISSION_QUERY_ROOT, authorityBoundary, ...checkKeys],
    queryFn: async ({ signal }): Promise<AuthoritySnapshot> => {
      const current = ++evaluation.current;
      const owned = () => !signal.aborted && currentEvaluationKey.current === evaluationKey && evaluation.current === current;
      let invalidated = false;
      const invalidateOlder = (error?: unknown) => {
        if (!owned()) return;
        // A later rejected chunk is still a known denial even if an earlier
        // revoked-200 chunk already invalidated this aggregate.
        if (accessAuthorityRejected(error)) setRejection({ identity: authorityBoundary, error });
        if (invalidated) return;
        invalidated = true;
        retained.current = null;
        setBarrier({ identity: authorityBoundary, evaluation: current });
        scrubRevokedQueriesOnce();
      };
      const previous = retained.current?.identity === authorityBoundary
        ? new Set(retained.current.response.permissions.filter(decision => decision.allowed).map(accessPermissionCheckKey))
        : new Set<string>();
      const response = await evaluateAccessPermissionChecks(checks, async batch => {
        try {
          const result = await request<AccessPermissionEvaluationResponse>("/api/access/permissions/evaluate", {
            method: "POST", body: JSON.stringify({ checks: batch }), signal,
          });
          // New grants wait for every chunk, but an observed revocation must
          // conceal old authority even if another chunk is slow or fails.
          if (result.permissions.some(decision => !decision.allowed && previous.has(accessPermissionCheckKey(decision)))) invalidateOlder();
          return result;
        } catch (error) {
          if (accessAuthorityRejected(error)) invalidateOlder(error);
          throw error;
        }
      });
      if (!owned()) throw new DOMException("Permission evaluation superseded", "AbortError");
      return { identity: authorityBoundary, evaluation: current, response };
    },
    enabled: canEvaluate,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: () => accessAuthorityPollingEnabled()
      ? ACCESS_AUTHORITY_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: 1,
  });

  const freshQuerySnapshot = canEvaluate && query.data?.identity === authorityBoundary &&
    (barrier.identity !== authorityBoundary || query.data.evaluation >= barrier.evaluation)
    ? query.data : undefined;
  // Keep a known denial visible across polling and registration changes. A
  // qualified complete response, not a pending/partial result, can replace it.
  const authorityError = query.error ?? (!freshQuerySnapshot && rejection?.identity === authorityBoundary ? rejection.error : null);
  const authorityRejected = accessAuthorityRejected(authorityError);
  const candidate = query.data ?? retained.current;
  const snapshot = canEvaluate && !authorityRejected && candidate?.identity === authorityBoundary &&
    (barrier.identity !== authorityBoundary || candidate.evaluation >= barrier.evaluation)
    ? candidate : undefined;
  useLayoutEffect(() => {
    if (!canEvaluate || authorityRejected || (retained.current && retained.current.identity !== authorityBoundary)) retained.current = null;
    if (query.data && snapshot === query.data) retained.current = query.data;
  }, [authorityBoundary, authorityRejected, canEvaluate, query.data, snapshot]);
  const responseKeys = useMemo(() => new Set(
    authorityRejected
      ? checkKeys
      : (snapshot?.response.permissions ?? []).map(accessPermissionCheckKey),
  ), [authorityRejected, checkKeys, snapshot]);
  const decisionKeys = useMemo(() => new Set(
    authorityRejected
      ? []
      : (snapshot?.response.permissions ?? [])
        .filter((decision) => decision.allowed)
        .map(accessPermissionCheckKey),
  ), [authorityRejected, snapshot]);
  const previousAllowedRef = useRef<{
    boundary: string;
    keys: ReadonlySet<string>;
    observedKeys: ReadonlySet<string>;
    evaluated: boolean;
  }>({ boundary: authorityBoundary, keys: new Set(), observedKeys: new Set(), evaluated: false });
  const deniedBoundaryRef = useRef("");

  useLayoutEffect(() => {
    if (previousAllowedRef.current.boundary !== authorityBoundary) {
      previousAllowedRef.current = {
        boundary: authorityBoundary,
        keys: new Set(),
        observedKeys: new Set(),
        evaluated: false,
      };
      deniedBoundaryRef.current = "";
    }
    if (!query.data || snapshot !== query.data) return;

    const previous = previousAllowedRef.current;
    const revoked = previous.evaluated
      ? revokedAccessPermissionKeys(previous.keys, decisionKeys, checkKeys)
      : [];
    const granted = previous.evaluated
      ? grantedAccessPermissionKeys(previous.keys, previous.observedKeys, decisionKeys, checkKeys)
      : [];
    const initialAllowedSnapshot = !previous.evaluated && decisionKeys.size > 0;
    previousAllowedRef.current = {
      boundary: authorityBoundary,
      keys: decisionKeys,
      observedKeys: responseKeys,
      evaluated: true,
    };
    deniedBoundaryRef.current = "";
    if (initialAllowedSnapshot) {
      refreshInitialAccessQueries(queryClient);
    }
    if (revoked.length > 0) {
      scrubRevokedQueriesOnce();
    }
    if (granted.length > 0) {
      refreshGrantedAccessQueries(queryClient);
    }
    // Re-arm only after processing a new, complete, owned aggregate. Retained
    // snapshots, cached replay, failed chunks and query-key churn cannot do so.
    if (query.data.evaluation === evaluation.current && query.data.evaluation > processedEvaluation.current) {
      processedEvaluation.current = query.data.evaluation;
      scrubbedBoundary.current = "";
      setRejection(null);
    }
  }, [authorityBoundary, checkKeys, decisionKeys, query.data, queryClient, scrubRevokedQueriesOnce, snapshot]);

  useLayoutEffect(() => {
    if (!accessAuthorityRejected(authorityError)) return;
    if (!authorityBoundary || deniedBoundaryRef.current === authorityBoundary) return;

    deniedBoundaryRef.current = authorityBoundary;
    previousAllowedRef.current = {
      boundary: authorityBoundary,
      keys: new Set(),
      observedKeys: new Set(checkKeys),
      evaluated: true,
    };
    scrubRevokedQueriesOnce();
  }, [authorityBoundary, authorityError, scrubRevokedQueriesOnce]);

  const value = useMemo<AccessAuthorityContextValue>(() => ({
    decisionKeys,
    responseKeys,
    error: authorityError,
    hasSnapshot: snapshot !== undefined || authorityRejected,
    // Background authority checks keep the last confirmed decision usable. A
    // failed refresh still exposes its error and locks source-authority gates.
    isFetching: query.isFetching && query.data === undefined,
    isLoading: checks.length > 0 && !authorityError && (!canEvaluate || query.isLoading),
    refetch: async () => {
      await query.refetch();
    },
    register,
    unregister,
  }), [
    authorityRejected,
    authorityError,
    canEvaluate,
    checks.length,
    decisionKeys,
    query.data,
    query.error,
    query.isFetching,
    query.isLoading,
    query.refetch,
    register,
    responseKeys,
    snapshot,
    unregister,
  ]);

  return (
    <AccessAuthorityContext.Provider value={value}>
      {children}
    </AccessAuthorityContext.Provider>
  );
}

export function accessAuthorityIdentity(session: Omit<ApiSession, "accessToken"> | null): string {
  return session ? JSON.stringify([session.tenantId, session.username.trim().toLowerCase(), session.subjectId ?? "", session.sessionId ?? "", session.generation ?? ""]) : "";
}

function accessAuthorityRejected(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

// The API accepts at most32 checks. Normalize before partitioning; callers only
// receive grants after all batches finish. Observation of denials stays live in
// the supplied evaluator so a partial failure cannot revive revoked authority.
export async function evaluateAccessPermissionChecks(
  checks: readonly AccessPermissionCheck[],
  evaluate: (batch: AccessPermissionCheck[]) => Promise<AccessPermissionEvaluationResponse>,
): Promise<AccessPermissionEvaluationResponse> {
  const normalized = normalizeAccessPermissionChecks(checks);
  const batches: AccessPermissionCheck[][] = [];
  for (let index = 0; index < normalized.length; index += 32) batches.push(normalized.slice(index, index + 32));
  const results = await Promise.all(batches.map(evaluate));
  return { permissions: results.flatMap(result => result.permissions) };
}

export function useAccessPermissions(checks: AccessPermissionCheck[]) {
  const authority = useContext(AccessAuthorityContext);
  if (!authority) {
    throw new Error("usePermissions must be used inside AccessAuthorityProvider.");
  }

  const registrationId = useId();
  const normalized = normalizeAccessPermissionChecks(checks);
  const signature = normalized.map(accessPermissionCheckKey).join("\n");
  const normalizedRef = useRef(normalized);
  normalizedRef.current = normalized;

  useEffect(() => {
    authority.register(registrationId, normalizedRef.current);
    return () => authority.unregister(registrationId);
  }, [authority.register, authority.unregister, registrationId, signature]);

  const requestedKeys = useMemo(
    () => new Set(normalized.map(accessPermissionCheckKey)),
    [signature],
  );
  const hasData = normalized.length === 0 || (
    authority.hasSnapshot &&
    normalized.every((check) => authority.responseKeys.has(accessPermissionCheckKey(check)))
  );

  return {
    hasData,
    isLoading: normalized.length > 0 && (
      authority.isLoading || (!hasData && !authority.error)
    ),
    isFetching: normalized.length > 0 && authority.isFetching,
    error: normalized.length > 0 ? authority.error : null,
    refetch: authority.refetch,
    allows: (permission: string, scope: string) => {
      const key = accessPermissionCheckKey({ permission, scope });
      return requestedKeys.has(key) && authority.decisionKeys.has(key);
    },
  };
}

export function accessPermissionCheckKey(
  check: Pick<AccessPermissionCheck, "permission" | "scope">,
): string {
  return `${check.permission}@${check.scope}`;
}

export function normalizeAccessPermissionChecks(
  checks: readonly AccessPermissionCheck[],
): AccessPermissionCheck[] {
  return [...new Map(checks.map((check) => [accessPermissionCheckKey(check), check])).values()]
    .sort((left, right) => accessPermissionCheckKey(left).localeCompare(accessPermissionCheckKey(right)));
}

export function mergeAccessPermissionChecks(
  groups: readonly (readonly AccessPermissionCheck[])[],
): AccessPermissionCheck[] {
  return normalizeAccessPermissionChecks(groups.flat());
}

export function revokedAccessPermissionKeys(
  previousAllowed: ReadonlySet<string>,
  nextAllowed: ReadonlySet<string>,
  currentKeys: readonly string[],
): string[] {
  return currentKeys.filter((key) => previousAllowed.has(key) && !nextAllowed.has(key));
}

export function grantedAccessPermissionKeys(
  previousAllowed: ReadonlySet<string>,
  previousObserved: ReadonlySet<string>,
  nextAllowed: ReadonlySet<string>,
  currentKeys: readonly string[],
): string[] {
  return currentKeys.filter((key) =>
    previousObserved.has(key) &&
    !previousAllowed.has(key) &&
    nextAllowed.has(key)
  );
}

export function accessAuthorityQuerySurvivesScrub(queryKey: QueryKey): boolean {
  return queryKey[0] === ACCESS_PERMISSION_QUERY_ROOT ||
    (queryKey[0] === "organizations" && queryKey[1] === "mine");
}

export function accessAuthorityPollingEnabled(): boolean {
  return typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    browserIsOnline();
}

export function accessAuthorityChecksMatchTenant(
  tenantId: string | undefined,
  checks: readonly AccessPermissionCheck[],
): boolean {
  if (!tenantId || tenantId === "global") return false;

  const tenantScope = `tenant:${tenantId}`;
  return checks.every(({ scope }) =>
    scope === tenantScope || scope.startsWith(`${tenantScope}/`)
  );
}

function samePermissionChecks(
  left: readonly AccessPermissionCheck[],
  right: readonly AccessPermissionCheck[],
): boolean {
  return left.length === right.length && left.every(
    (check, index) => accessPermissionCheckKey(check) === accessPermissionCheckKey(right[index]),
  );
}

function scrubRevokedAccessQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.removeQueries({
    predicate: (candidate) => !accessAuthorityQuerySurvivesScrub(candidate.queryKey),
  });
  void queryClient.invalidateQueries({ queryKey: ["organizations", "mine"] });
}

function refreshGrantedAccessQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({
    predicate: (candidate) => candidate.queryKey[0] !== ACCESS_PERMISSION_QUERY_ROOT,
  });
}

function refreshInitialAccessQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["properties"] });
}
