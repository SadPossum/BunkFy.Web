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
  BrowserTotpActivation,
  ExternalAuthenticationChallenge,
  ExternalAuthenticationResult,
  MultiFactorChallenge,
  MultiFactorCodeType,
} from "../api/types";
import {
  hasSessionBoundaryChanged,
  hasSessionIdentityChanged,
  createSingleFlightRefresh,
  runWithBrowserSessionLock,
  startBrowserSessionSignOut,
  type SessionIdentity,
} from "./singleFlightRefresh";
import { useQueryClient } from "@tanstack/react-query";
import {
  isMultiFactorChallenge,
  type ExternalAuthenticationIntent,
} from "../features/auth/authenticationFlow";

const STORAGE_KEY = "bunkfy.session.identity.v2";
const EXTERNAL_AUTH_KEY = "bunkfy.auth.external.pending.v1";
const GLOBAL_IDENTITY_SCOPE = "global";

export type Credentials = {
  username: string;
  password: string;
};

export type ExternalAuthenticationCompletion =
  | {
      kind: "redirect";
      destination: "/" | "/account?external=linked";
    }
  | {
      kind: "mfa";
      challenge: MultiFactorChallenge;
      username: string;
    };

type SessionContextValue = {
  session: ApiSession | null;
  isRestoring: boolean;
  login: (credentials: Credentials) => Promise<MultiFactorChallenge | null>;
  register: (credentials: Credentials) => Promise<void>;
  completeMultiFactorSignIn: (
    challengeToken: string,
    codeType: MultiFactorCodeType,
    code: string,
    username: string,
  ) => Promise<void>;
  activateTotp: (code: string) => Promise<string[]>;
  disableTotp: (codeType: MultiFactorCodeType, code: string) => Promise<void>;
  beginExternalSignIn: (provider: string) => Promise<void>;
  beginExternalLink: (provider: string) => Promise<void>;
  completeExternalAuthentication: (
    code: string,
    provider: string,
    intent: ExternalAuthenticationIntent | null,
  ) => Promise<ExternalAuthenticationCompletion>;
  cancelExternalAuthentication: () => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  stepUpWithPassword: (password: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  download: (path: string, options?: RequestInit) => Promise<ApiDownload>;
  stream: (path: string, signal: AbortSignal) => Promise<Response>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const initialIdentity = useRef(readSessionIdentity());
  const [session, setSessionState] = useState<ApiSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(
    initialIdentity.current !== null,
  );
  const sessionRef = useRef<ApiSession | null>(null);
  const acceptsRefreshRef = useRef(true);
  const externalCompletionRef = useRef<Promise<
    ExternalAuthenticationCompletion
  > | null>(null);

  const setSession = useCallback((next: ApiSession | null) => {
    if (hasSessionIdentityChanged(sessionRef.current, next)) {
      queryClient.removeQueries();
    } else if (hasSessionBoundaryChanged(sessionRef.current, next)) {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "organizations",
      });
    }
    sessionRef.current = next;
    setSessionState(next);
    writeSessionIdentity(next);
  }, [queryClient]);

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
            headers: { "X-Tenant-Id": GLOBAL_IDENTITY_SCOPE },
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
    async (
      mode: "login" | "register",
      credentials: Credentials,
    ): Promise<MultiFactorChallenge | null> => {
      return await runWithBrowserSessionLock(async () => {
        const response = await apiRequest<BrowserAuthResponse | MultiFactorChallenge>(
          `/api/auth/browser/${mode}`,
          {
            method: "POST",
            headers: { "X-Tenant-Id": GLOBAL_IDENTITY_SCOPE },
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
        if (isMultiFactorChallenge(response)) {
          return response;
        }
        acceptsRefreshRef.current = true;
        setSession({
          ...response,
          tenantId: GLOBAL_IDENTITY_SCOPE,
          username: credentials.username,
        });
        return null;
      });
    },
    [setSession],
  );

  const completeMultiFactorSignIn = useCallback(
    async (
      challengeToken: string,
      codeType: MultiFactorCodeType,
      code: string,
      username: string,
    ) => {
      await runWithBrowserSessionLock(async () => {
        const response = await apiRequest<BrowserAuthResponse>(
          "/api/auth/browser/mfa/challenges/complete",
          {
            method: "POST",
            headers: { "X-Tenant-Id": GLOBAL_IDENTITY_SCOPE },
            body: JSON.stringify({ challengeToken, codeType, code }),
          },
        );
        acceptsRefreshRef.current = true;
        const authenticated: ApiSession = {
          ...response,
          tenantId: GLOBAL_IDENTITY_SCOPE,
          username,
        };
        try {
          const methods = await apiRequest<AuthenticationMethods>(
            "/api/auth/methods",
            {},
            authenticated,
          );
          authenticated.username =
            methods.emails.find((email) => email.isActive)?.email ||
            authenticated.username;
        } catch {
          // The authenticated session remains valid if profile metadata is unavailable.
        }
        setSession(authenticated);
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
    async (provider: string) => {
      clearPendingExternalAuth();
      const returnUrl = externalReturnUrl("sign-in");
      const challenge = await apiRequest<ExternalAuthenticationChallenge>(
        `/api/auth/external/${encodeURIComponent(provider)}/sign-in/challenge`,
        {
          method: "POST",
          headers: { "X-Tenant-Id": GLOBAL_IDENTITY_SCOPE },
          body: JSON.stringify({ returnUrl }),
        },
      );
      writePendingExternalAuth({
        intent: "sign-in",
        provider,
      });
      window.location.assign(apiUrl(challenge.startUrl));
    },
    [],
  );

  const beginExternalLink = useCallback(
    async (provider: string) => {
      const active = sessionRef.current;
      if (!active) throw new Error("You are signed out.");
      clearPendingExternalAuth();
      const returnUrl = externalReturnUrl("link");
      const challenge = await request<ExternalAuthenticationChallenge>(
        `/api/auth/external/${encodeURIComponent(provider)}/link/challenge`,
        { method: "POST", body: JSON.stringify({ returnUrl }) },
      );
      writePendingExternalAuth({
        intent: "link",
        provider,
      });
      window.location.assign(apiUrl(challenge.startUrl));
    },
    [request],
  );

  const completeExternalAuthentication = useCallback(
    (
      code: string,
      provider: string,
      intent: ExternalAuthenticationIntent | null,
    ) => {
      if (externalCompletionRef.current) return externalCompletionRef.current;

      const completion = (async (): Promise<ExternalAuthenticationCompletion> => {
        const pending = readPendingExternalAuth(
          intent ? { intent, provider } : null,
        );
        if (
          !pending ||
          pending.provider.toLowerCase() !== provider.toLowerCase() ||
          (intent !== null && pending.intent !== intent)
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
          return {
            kind: "redirect",
            destination: "/account?external=linked",
          };
        }

        const response = await runWithBrowserSessionLock(async () => {
          return await apiRequest<BrowserAuthResponse | MultiFactorChallenge>(
            "/api/auth/browser/external/exchange",
            {
              method: "POST",
              headers: { "X-Tenant-Id": GLOBAL_IDENTITY_SCOPE },
              body: JSON.stringify({ code }),
            },
          );
        });
        clearPendingExternalAuth();
        if (isMultiFactorChallenge(response)) {
          return {
            kind: "mfa",
            challenge: response,
            username: `${providerLabel(provider)} account`,
          };
        }

        await runWithBrowserSessionLock(async () => {
          const provisional: ApiSession = {
            ...response,
            tenantId: GLOBAL_IDENTITY_SCOPE,
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
        return { kind: "redirect", destination: "/" };
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

  const cancelExternalAuthentication = useCallback(() => {
    clearPendingExternalAuth();
  }, []);

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

  const stepUpWithPassword = useCallback(
    async (password: string) => {
      const active = sessionRef.current;
      if (!active) throw new Error("You are signed out.");
      const response = await apiRequest<BrowserAuthResponse>(
        "/api/auth/browser/step-up/password",
        {
          method: "POST",
          body: JSON.stringify({ password }),
        },
        active,
      );
      setSession({ ...active, accessToken: response.accessToken });
    },
    [setSession],
  );

  const activateTotp = useCallback(
    async (code: string): Promise<string[]> => {
      const active = sessionRef.current;
      if (!active) throw new Error("You are signed out.");
      const response = await apiRequest<BrowserTotpActivation>(
        "/api/auth/browser/mfa/totp/activate",
        {
          method: "POST",
          body: JSON.stringify({ code }),
        },
        active,
      );
      setSession({ ...active, accessToken: response.accessToken });
      return response.recoveryCodes;
    },
    [setSession],
  );

  const disableTotp = useCallback(
    async (codeType: MultiFactorCodeType, code: string) => {
      const active = sessionRef.current;
      if (!active) throw new Error("You are signed out.");
      await apiRequest<void>(
        "/api/auth/browser/mfa/totp/disable",
        {
          method: "POST",
          body: JSON.stringify({ codeType, code }),
        },
        active,
      );
      setSession(null);
    },
    [setSession],
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

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      const active = sessionRef.current;
      if (!active) return;
      const tenantId = workspaceId.trim() || GLOBAL_IDENTITY_SCOPE;
      if (active.tenantId === tenantId) return;
      setSession({ ...active, tenantId });
    },
    [setSession],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      isRestoring,
      login: (credentials) => authenticate("login", credentials),
      register: async (credentials) => {
        await authenticate("register", credentials);
      },
      completeMultiFactorSignIn,
      activateTotp,
      disableTotp,
      beginExternalSignIn,
      beginExternalLink,
      completeExternalAuthentication,
      cancelExternalAuthentication,
      logout,
      logoutAll,
      stepUpWithPassword,
      selectWorkspace,
      request,
      download,
      stream,
    }),
    [
      authenticate,
      activateTotp,
      beginExternalLink,
      beginExternalSignIn,
      cancelExternalAuthentication,
      completeMultiFactorSignIn,
      completeExternalAuthentication,
      disableTotp,
      download,
      isRestoring,
      logout,
      logoutAll,
      request,
      selectWorkspace,
      session,
      stepUpWithPassword,
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
  intent: ExternalAuthenticationIntent;
  provider: string;
};

function externalReturnUrl(intent: PendingExternalAuth["intent"]): string {
  const url = new URL("/auth/complete", window.location.origin);
  url.searchParams.set("intent", intent);
  const apiBaseUrl = resolveApiBaseUrl();
  const apiOrigin = apiBaseUrl
    ? new URL(apiBaseUrl, window.location.origin).origin
    : window.location.origin;

  return apiOrigin === window.location.origin
    ? `${url.pathname}${url.search}`
    : url.toString();
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

function readPendingExternalAuth(
  fallback: PendingExternalAuth | null,
): PendingExternalAuth | null {
  try {
    const raw = sessionStorage.getItem(EXTERNAL_AUTH_KEY);
    if (raw) {
      const candidate = JSON.parse(raw) as Partial<PendingExternalAuth>;
      if (
        (candidate.intent === "sign-in" || candidate.intent === "link") &&
        typeof candidate.provider === "string" &&
        candidate.provider.trim().length > 0
      ) {
        return candidate as PendingExternalAuth;
      }
    }
  } catch {
    // Fall through to the callback metadata.
  }

  return fallback?.provider.trim() ? fallback : null;
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
