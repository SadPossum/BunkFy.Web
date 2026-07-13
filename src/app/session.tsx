import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiDownload, apiRequest, apiStream, type ApiDownload, type ApiSession } from "../api/client";
import type { BrowserAuthResponse } from "../api/types";
import { createSingleFlightRefresh, runWithBrowserSessionLock, type SessionIdentity } from "./singleFlightRefresh";

const STORAGE_KEY = "bunkfy.session.identity.v2";

export type Credentials = { tenantId: string; username: string; password: string };

type SessionContextValue = {
  session: ApiSession | null;
  isRestoring: boolean;
  login: (credentials: Credentials) => Promise<void>;
  register: (credentials: Credentials) => Promise<void>;
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
  const [isRestoring, setIsRestoring] = useState(initialIdentity.current !== null);
  const sessionRef = useRef<ApiSession | null>(null);

  const setSession = useCallback((next: ApiSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
    writeSessionIdentity(next);
  }, []);

  const performRefresh = useCallback(async (identity: SessionIdentity): Promise<ApiSession> => {
    return runWithBrowserSessionLock(async () => {
      const { accessToken } = await apiRequest<BrowserAuthResponse>("/api/auth/browser/refresh", {
        method: "POST",
        headers: { "X-Tenant-Id": identity.tenantId },
      });
      const refreshed = { ...identity, accessToken };
      setSession(refreshed);
      return refreshed;
    });
  }, [setSession]);

  const refreshSession = useMemo(() => createSingleFlightRefresh(async (identity: SessionIdentity) => {
    try {
      return await performRefresh(identity);
    } catch (error) {
      setSession(null);
      throw error;
    }
  }), [performRefresh, setSession]);

  useEffect(() => {
    const identity = initialIdentity.current;
    if (!identity) return;

    void refreshSession(identity).finally(() => setIsRestoring(false));
  }, [refreshSession]);

  const authenticate = useCallback(async (mode: "login" | "register", credentials: Credentials) => {
    await runWithBrowserSessionLock(async () => {
      const response = await apiRequest<BrowserAuthResponse>(`/api/auth/browser/${mode}`, {
        method: "POST",
        headers: { "X-Tenant-Id": credentials.tenantId },
        body: JSON.stringify(mode === "login"
          ? { username: credentials.username, password: credentials.password }
          : { username: credentials.username, usernameType: "Email", password: credentials.password }),
      });
      setSession({ ...response, tenantId: credentials.tenantId, username: credentials.username });
    });
  }, [setSession]);

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    const active = sessionRef.current;
    if (!active) throw new Error("You are signed out.");

    try {
      return await apiRequest<T>(path, options, active);
    } catch (error) {
      if (!(error instanceof Error) || !("status" in error) || error.status !== 401) throw error;

      const refreshed = await refreshSession(active);
      return await apiRequest<T>(path, options, refreshed);
    }
  }, [refreshSession]);

  const download = useCallback(async (path: string, options: RequestInit = {}) => {
    const active = sessionRef.current;
    if (!active) throw new Error("You are signed out.");
    try {
      return await apiDownload(path, options, active);
    } catch (error) {
      if (!(error instanceof Error) || !("status" in error) || error.status !== 401) throw error;
      const refreshed = await refreshSession(active);
      return await apiDownload(path, options, refreshed);
    }
  }, [refreshSession]);

  const stream = useCallback(async (path: string, signal: AbortSignal) => {
    const active = sessionRef.current;
    if (!active) throw new Error("You are signed out.");
    try {
      return await apiStream(path, signal, active);
    } catch (error) {
      if (!(error instanceof Error) || !("status" in error) || error.status !== 401 || signal.aborted) throw error;
      const refreshed = await refreshSession(active);
      return await apiStream(path, signal, refreshed);
    }
  }, [refreshSession]);

  const logout = useCallback(async () => {
    const active = sessionRef.current;
    try {
      if (active) {
        await runWithBrowserSessionLock(() =>
          apiRequest<void>("/api/auth/browser/sign-out", { method: "POST" }, active));
      }
    } finally {
      setSession(null);
    }
  }, [setSession]);

  const logoutAll = useCallback(async () => {
    const active = sessionRef.current;
    try {
      if (active) await apiRequest<void>("/api/auth/sign-out-all", { method: "POST" }, active);
    } finally {
      try {
        if (active) await apiRequest<void>("/api/auth/browser/sign-out", { method: "POST" }, active);
      } catch {
        // The global revocation can make the cookie sign-out request unauthorized.
      }
      setSession(null);
    }
  }, [setSession]);

  const value = useMemo<SessionContextValue>(() => ({
    session,
    isRestoring,
    login: (credentials) => authenticate("login", credentials),
    register: (credentials) => authenticate("register", credentials),
    logout,
    logoutAll,
    request,
    download,
    stream,
  }), [authenticate, download, isRestoring, logout, logoutAll, request, session, stream]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

function readSessionIdentity(): SessionIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const candidate = JSON.parse(raw) as Partial<SessionIdentity>;
    return typeof candidate.tenantId === "string" && typeof candidate.username === "string"
      ? { tenantId: candidate.tenantId, username: candidate.username }
      : null;
  } catch {
    return null;
  }
}

function writeSessionIdentity(session: SessionIdentity | null) {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tenantId: session.tenantId,
      username: session.username,
    }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
