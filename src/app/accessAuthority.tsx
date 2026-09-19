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
import { ApiError } from "../api/client";
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

export function AccessAuthorityProvider({ children }: { children: ReactNode }) {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const [registered, setRegistered] = useState<RegisteredChecks>(() => new Map());
  const authorityBoundary = session
    ? `${session.tenantId}:${session.username.trim().toLowerCase()}`
    : "";

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
  const query = useQuery({
    queryKey: [ACCESS_PERMISSION_QUERY_ROOT, authorityBoundary, ...checkKeys],
    queryFn: () => request<AccessPermissionEvaluationResponse>(
      "/api/access/permissions/evaluate",
      {
        method: "POST",
        body: JSON.stringify({ checks }),
      },
    ),
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

  const authorityRejected = query.error instanceof ApiError && query.error.status === 403;
  const responseKeys = useMemo(() => new Set(
    authorityRejected
      ? checkKeys
      : (query.data?.permissions ?? []).map(accessPermissionCheckKey),
  ), [authorityRejected, checkKeys, query.data]);
  const decisionKeys = useMemo(() => new Set(
    authorityRejected
      ? []
      : (query.data?.permissions ?? [])
        .filter((decision) => decision.allowed)
        .map(accessPermissionCheckKey),
  ), [authorityRejected, query.data]);
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
    if (!query.data) return;

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
      scrubRevokedAccessQueries(queryClient);
    }
    if (granted.length > 0) {
      refreshGrantedAccessQueries(queryClient);
    }
  }, [authorityBoundary, checkKeys, decisionKeys, query.data, queryClient]);

  useLayoutEffect(() => {
    if (!(query.error instanceof ApiError) || query.error.status !== 403) return;
    if (!authorityBoundary || deniedBoundaryRef.current === authorityBoundary) return;

    deniedBoundaryRef.current = authorityBoundary;
    previousAllowedRef.current = {
      boundary: authorityBoundary,
      keys: new Set(),
      observedKeys: new Set(checkKeys),
      evaluated: true,
    };
    scrubRevokedAccessQueries(queryClient);
  }, [authorityBoundary, query.error, queryClient]);

  const value = useMemo<AccessAuthorityContextValue>(() => ({
    decisionKeys,
    responseKeys,
    error: query.error,
    hasSnapshot: query.data !== undefined || authorityRejected,
    // Background authority checks keep the last confirmed decision usable. A
    // failed refresh still exposes its error and locks source-authority gates.
    isFetching: query.isFetching && query.data === undefined,
    isLoading: checks.length > 0 && (!canEvaluate || query.isLoading),
    refetch: async () => {
      await query.refetch();
    },
    register,
    unregister,
  }), [
    authorityRejected,
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
    unregister,
  ]);

  return (
    <AccessAuthorityContext.Provider value={value}>
      {children}
    </AccessAuthorityContext.Provider>
  );
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
