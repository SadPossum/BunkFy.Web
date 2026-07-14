import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  apiDownload,
  apiRequest,
  apiStream,
  resolveApiBaseUrl,
  type ApiDownload,
  type ApiSession,
} from "../api/client";
import type {
  AuthenticationMethods,
  BrowserAuthResponse,
  ExternalAuthenticationChallenge,
  ExternalAuthenticationResult,
} from "../api/types";
import {
  createSingleFlightRefresh,
  runWithBrowserSessionLock,
  startBrowserSessionSignOut,
  type SessionIdentity,
} from "./singleFlightRefresh";

const STORAGE_KEY = "bunkfy.session.identity.v2";
const EXTERNAL_AUTH_KEY = "bunkfy.auth.external.pending.v1";

export type Credentials = {
  tenantId: string;
  username: string;
  password: string;
};

type SessionContextValue = {
  session: ApiSession | null;
  isRestoring: boolean;
  login: (credentials: Credentials) => Promise<void>;
  register: (credentials: Credentials) => Promise<void>;
  beginExternalSignIn: (provider: string, tenantId: string) => Promise<void>;
  beginExternalLink: (provider: string) => Promise<void>;
  completeExternalAuthentication: (
    code: string,
    provider: string,
  ) => Promise<"/" | "/account?external=linked">;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  download: (path: string, options?: RequestInit) => Promise<ApiDownload>;
  stream: (path: string, signal: AbortSignal) => Promise<Response>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const initialIdentity = useRef(readSessionIdentity());
  const [session, setSessionState] = useState<ApiSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(
    initialIdentity.current !== null,
  );
  const sessionRef = useRef<ApiSession | null>(null);
  const acceptsRefreshRef = useRef(true);
  const externalCompletionRef = useRef<Promise<
    "/" | "/account?external=linked"
  > | null>(null);

  const setSession = useCallback((next: ApiSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
    writeSessionIdentity(next);
  }, []);

  const performRefresh = useCallback(
    async (identity: SessionIdentity): Promise<ApiSession> => {
      return runWithBrowserSessionLock(async () => {
        if (!acceptsRefreshRef.current) {
          throw new Error("You are signed out.");
        }

        const { accessToken } = await apiRequest<BrowserAuthResponse>(
          "/api/auth/browser/refresh",
          {
            method: "POST",
            headers: { "X-Tenant-Id": identity.tenantId },
          },
        );
        const refreshed = { ...identity, accessToken };
        if (!acceptsRefreshRef.current) {
          throw new Error("You are signed out.");
        }

        setSession(refreshed);
        return refreshed;
      });
    },
    [setSession],
  );

  const refreshSession = useMemo(
    () =>
      createSingleFlightRefresh(async (identity: SessionIdentity) => {
        try {
          return await performRefresh(identity);
        } catch (error) {
          setSession(null);
          throw error;
        }
      }),
    [performRefresh, setSession],
  );

  useEffect(() => {
    const identity = initialIdentity.current;
    if (!identity) return;

    void refreshSession(identity).finally(() => setIsRestoring(false));
  }, [refreshSession]);

  const authenticate = useCallback(
    async (mode: "login" | "register", credentials: Credentials) => {
      await runWithBrowserSessionLock(async () => {
        const response = await apiRequest<BrowserAuthResponse>(
          `/api/auth/browser/${mode}`,
          {
            method: "POST",
            headers: { "X-Tenant-Id": credentials.tenantId },
            body: JSON.stringify(
              mode === "login"
                ? {
                    username: credentials.username,
                    password: credentials.password,
                  }
                : {
                    username: credentials.username,
                    usernameType: "Email",
                    password: credentials.password,
                  },
            ),
          },
        );
        acceptsRefreshRef.current = true;
        setSession({
          ...response,
          tenantId: credentials.tenantId,
          username: credentials.username,
        });
      });
    },
    [setSession],
  );

  const request = useCallback(
    async <T,>(path: string, options: RequestInit = {}) => {
      const active = sessionRef.current;
      if (!active) throw new Error("You are signed out.");

      try {
        return await apiRequest<T>(path, options, active);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("status" in error) ||
          error.status !== 401
        )
          throw error;

        const refreshed = await refreshSession(active);
        return await apiRequest<T>(path, options, refreshed);
      }
    },
    [refreshSession],
  );

  const beginExternalSignIn = useCallback(
    async (provider: string, tenantId: string) => {
      const normalizedTenantId = tenantId.trim();
      if (!normalizedTenantId) throw new Error("Workspace ID is required.");
      const returnUrl = externalReturnUrl("sign-in", normalizedTenantId);
      const challenge = await apiRequest<ExternalAuthenticationChallenge>(
        `/api/auth/external/${encodeURIComponent(provider)}/sign-in/challenge`,
        {
          method: "POST",
          headers: { "X-Tenant-Id": normalizedTenantId },
          body: JSON.stringify({ returnUrl }),
        },
      );
      writePendingExternalAuth({
        intent: "sign-in",
        provider,
        tenantId: normalizedTenantId,
      });
      window.location.assign(apiUrl(challenge.startUrl));
    },
    [],
  );

  const beginExternalLink = useCallback(
    async (provider: string) => {
      const active = sessionRef.current;
      if (!active) throw new Error("You are signed out.");
      const returnUrl = externalReturnUrl("link", active.tenantId);
      const challenge = await request<ExternalAuthenticationChallenge>(
        `/api/auth/external/${encodeURIComponent(provider)}/link/challenge`,
        { method: "POST", body: JSON.stringify({ returnUrl }) },
      );
      writePendingExternalAuth({
        intent: "link",
        provider,
        tenantId: active.tenantId,
      });
      window.location.assign(apiUrl(challenge.startUrl));
    },
    [request],
  );

  const completeExternalAuthentication = useCallback(
    (code: string, provider: string) => {
      if (externalCompletionRef.current) return externalCompletionRef.current;

      const completion = (async (): Promise<
        "/" | "/account?external=linked"
      > => {
        const pending = readPendingExternalAuth();
        if (
          !pending ||
          pending.provider.toLowerCase() !== provider.toLowerCase()
        ) {
          throw new Error(
            "The external sign-in state is missing or does not match this provider.",
          );
        }

        if (pending.intent === "link") {
          const result = await request<ExternalAuthenticationResult>(
            "/api/auth/browser/external/exchange",
            {
              method: "POST",
              body: JSON.stringify({ code }),
            },
          );
          if (externalStatus(result.status) !== "linked") {
            throw new Error("The external account was not linked.");
          }
          clearPendingExternalAuth();
          return "/account?external=linked";
        }

        await runWithBrowserSessionLock(async () => {
          const response = await apiRequest<BrowserAuthResponse>(
            "/api/auth/browser/external/exchange",
            {
              method: "POST",
              headers: { "X-Tenant-Id": pending.tenantId },
              body: JSON.stringify({ code }),
            },
          );
          const provisional: ApiSession = {
            ...response,
            tenantId: pending.tenantId,
            username: `${providerLabel(provider)} account`,
          };
          try {
            const methods = await apiRequest<AuthenticationMethods>(
              "/api/auth/methods",
              {},
              provisional,
            );
            provisional.username =
              methods.emails.find((email) => email.isActive)?.email ||
              provisional.username;
          } catch {
            // The access token is still valid; account metadata can load after navigation.
          }
          acceptsRefreshRef.current = true;
          setSession(provisional);
        });
        clearPendingExternalAuth();
        return "/";
      })();

      externalCompletionRef.current = completion;
      void completion.then(
        () => {
          externalCompletionRef.current = null;
        },
        () => {
          externalCompletionRef.current = null;
        },
      );
      return completion;
    },
    [request, setSession],
  );

  const download = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const active = sessionRef.current;
      if (!active) throw new Error("You are signed out.");
      try {
        return await apiDownload(path, options, active);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("status" in error) ||
          error.status !== 401
        )
          throw error;
        const refreshed = await refreshSession(active);
        return await apiDownload(path, options, refreshed);
      }
    },
    [refreshSession],
  );

  const stream = useCallback(
    async (path: string, signal: AbortSignal) => {
      const active = sessionRef.current;
      if (!active) throw new Error("You are signed out.");
      try {
        return await apiStream(path, signal, active);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("status" in error) ||
          error.status !== 401 ||
          signal.aborted
        )
          throw error;
        const refreshed = await refreshSession(active);
        return await apiStream(path, signal, refreshed);
      }
    },
    [refreshSession],
  );

  const logout = useCallback(async () => {
    const active = sessionRef.current;
    acceptsRefreshRef.current = false;
    startBrowserSessionSignOut(
      () => setSession(null),
      active
        ? () =>
          apiRequest<void>(
            "/api/auth/browser/sign-out",
            { method: "POST" },
            active,
          )
        : undefined,
    );
  }, [setSession]);

  const logoutAll = useCallback(async () => {
    const active = sessionRef.current;
    try {
      if (active)
        await apiRequest<void>(
          "/api/auth/sign-out-all",
          { method: "POST" },
          active,
        );
    } finally {
      acceptsRefreshRef.current = false;
      try {
        if (active)
          await apiRequest<void>(
            "/api/auth/browser/sign-out",
            { method: "POST" },
            active,
          );
      } catch {
        // The global revocation can make the cookie sign-out request unauthorized.
      }
      setSession(null);
    }
  }, [setSession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      isRestoring,
      login: (credentials) => authenticate("login", credentials),
      register: (credentials) => authenticate("register", credentials),
      beginExternalSignIn,
      beginExternalLink,
      completeExternalAuthentication,
      logout,
      logoutAll,
      request,
      download,
      stream,
    }),
    [
      authenticate,
      beginExternalLink,
      beginExternalSignIn,
      completeExternalAuthentication,
      download,
      isRestoring,
      logout,
      logoutAll,
      request,
      session,
      stream,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value)
    throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

function readSessionIdentity(): SessionIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const candidate = JSON.parse(raw) as Partial<SessionIdentity>;
    return typeof candidate.tenantId === "string" &&
      typeof candidate.username === "string"
      ? { tenantId: candidate.tenantId, username: candidate.username }
      : null;
  } catch {
    return null;
  }
}

function writeSessionIdentity(session: SessionIdentity | null) {
  if (session) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tenantId: session.tenantId,
        username: session.username,
      }),
    );
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

type PendingExternalAuth = {
  intent: "sign-in" | "link";
  provider: string;
  tenantId: string;
};

function externalReturnUrl(
  intent: PendingExternalAuth["intent"],
  tenantId: string,
): string {
  const url = new URL("/auth/complete", window.location.origin);
  url.searchParams.set("intent", intent);
  url.searchParams.set("tenant", tenantId);
  return url.toString();
}

function apiUrl(path: string): string {
  return path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${resolveApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function writePendingExternalAuth(pending: PendingExternalAuth) {
  try {
    sessionStorage.setItem(EXTERNAL_AUTH_KEY, JSON.stringify(pending));
  } catch {
    // The callback URL also carries non-secret recovery metadata.
  }
}

function readPendingExternalAuth(): PendingExternalAuth | null {
  try {
    const raw = sessionStorage.getItem(EXTERNAL_AUTH_KEY);
    if (raw) {
      const candidate = JSON.parse(raw) as Partial<PendingExternalAuth>;
      if (
        (candidate.intent === "sign-in" || candidate.intent === "link") &&
        typeof candidate.provider === "string" &&
        typeof candidate.tenantId === "string"
      ) {
        return candidate as PendingExternalAuth;
      }
    }
  } catch {
    // Fall through to the callback metadata.
  }

  const parameters = new URLSearchParams(window.location.search);
  const intent = parameters.get("intent");
  const provider = parameters.get("provider");
  const tenantId = parameters.get("tenant");
  return (intent === "sign-in" || intent === "link") && provider && tenantId
    ? { intent, provider, tenantId }
    : null;
}

function clearPendingExternalAuth() {
  try {
    sessionStorage.removeItem(EXTERNAL_AUTH_KEY);
  } catch {
    // Storage can be unavailable in hardened browser modes.
  }
}

function externalStatus(
  status: ExternalAuthenticationResult["status"],
): string {
  const value: unknown = status;
  if (typeof value === "string") return value.toLowerCase();
  return value === 2 ? "linked" : value === 1 ? "authenticated" : "unknown";
}

function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
