import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest, type ApiSession } from "../api/client";
import type { AuthTokens } from "../api/types";

const STORAGE_KEY = "bunkfy.session.v1";

type Credentials = { tenantId: string; username: string; password: string };

type SessionContextValue = {
  session: ApiSession | null;
  login: (credentials: Credentials) => Promise<void>;
  register: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<ApiSession | null>(readSession);
  const sessionRef = useRef(session);

  const setSession = useCallback((next: ApiSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const authenticate = useCallback(async (mode: "login" | "register", credentials: Credentials) => {
    const tokens = await apiRequest<AuthTokens>(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "X-Tenant-Id": credentials.tenantId },
      body: JSON.stringify(mode === "login"
        ? { username: credentials.username, password: credentials.password }
        : { username: credentials.username, usernameType: "Email", password: credentials.password }),
    });
    setSession({ ...tokens, tenantId: credentials.tenantId, username: credentials.username });
  }, [setSession]);

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    const active = sessionRef.current;
    if (!active) throw new Error("You are signed out.");

    try {
      return await apiRequest<T>(path, options, active);
    } catch (error) {
      if (!(error instanceof Error) || !("status" in error) || error.status !== 401) throw error;
      try {
        const tokens = await apiRequest<AuthTokens>("/api/auth/refresh", {
          method: "POST",
          headers: { "X-Tenant-Id": active.tenantId },
          body: JSON.stringify({ accessToken: active.accessToken, refreshToken: active.refreshToken }),
        });
        const refreshed = { ...active, ...tokens };
        setSession(refreshed);
        return await apiRequest<T>(path, options, refreshed);
      } catch (refreshError) {
        setSession(null);
        throw refreshError;
      }
    }
  }, [setSession]);

  const logout = useCallback(async () => {
    const active = sessionRef.current;
    try {
      if (active) {
        await apiRequest<void>("/api/auth/sign-out", {
          method: "POST",
          body: JSON.stringify({ refreshToken: active.refreshToken }),
        }, active);
      }
    } finally {
      setSession(null);
    }
  }, [setSession]);

  const value = useMemo<SessionContextValue>(() => ({
    session,
    login: (credentials) => authenticate("login", credentials),
    register: (credentials) => authenticate("register", credentials),
    logout,
    request,
  }), [authenticate, logout, request, session]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

function readSession(): ApiSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as ApiSession : null;
  } catch {
    return null;
  }
}
