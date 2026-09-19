import type { ApiSession } from "../api/client";
import type { SessionIdentity } from "./singleFlightRefresh";

export type AccessTokenIdentity = {
  subjectId: string;
  sessionId: string;
};

export class SessionIdentityMismatchError extends Error {
  constructor() {
    super("The browser session changed. BunkFy stopped the previous actor context.");
    this.name = "SessionIdentityMismatchError";
  }
}

export class SessionBoundarySupersededError extends Error {
  constructor() {
    super("The browser session or workspace changed before this request finished.");
    this.name = "SessionBoundarySupersededError";
  }
}

export function readAccessTokenIdentity(accessToken: string): AccessTokenIdentity | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;

  const subjectId = payload.sub;
  const sessionId = payload.sid;
  return typeof subjectId === "string" && isGuid(subjectId) &&
    typeof sessionId === "string" && isGuid(sessionId)
    ? { subjectId: subjectId.toLowerCase(), sessionId: sessionId.toLowerCase() }
    : null;
}

export function resolveRefreshedSessionIdentity(
  requested: SessionIdentity,
  persisted: SessionIdentity | null,
  token: AccessTokenIdentity,
): SessionIdentity {
  if (sessionIdentityAcceptsToken(requested, token)) return requested;
  if (persisted && sessionIdentityAcceptsToken(persisted, token)) return persisted;
  throw new SessionIdentityMismatchError();
}

export function bindApiSessionIdentity(
  session: ApiSession,
  current: ApiSession | null,
): ApiSession {
  const token = readAccessTokenIdentity(session.accessToken);
  if (!token) throw new SessionIdentityMismatchError();
  if (session.subjectId && session.subjectId.toLowerCase() !== token.subjectId) {
    throw new SessionIdentityMismatchError();
  }
  if (session.sessionId && session.sessionId.toLowerCase() !== token.sessionId) {
    throw new SessionIdentityMismatchError();
  }

  const generation = session.generation || (
    current &&
    current.subjectId?.toLowerCase() === token.subjectId &&
    current.sessionId?.toLowerCase() === token.sessionId
      ? current.generation
      : undefined
  ) || createSessionGeneration();
  return {
    ...session,
    ...token,
    generation,
  };
}

export function createSessionGeneration(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sessionIdentityAcceptsToken(
  identity: SessionIdentity,
  token: AccessTokenIdentity,
): boolean {
  return (!identity.subjectId || identity.subjectId.toLowerCase() === token.subjectId) &&
    (!identity.sessionId || identity.sessionId.toLowerCase() === token.sessionId);
}

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(base64)) as unknown;
    return decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
