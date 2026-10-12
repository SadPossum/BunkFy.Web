import { apiRequest, parseRetryAfterMilliseconds, setRememberedBrowserTransport, type ApiSession } from "../../api/client";
import type { SessionIdentity } from "../../app/singleFlightRefresh";
import { readAccessTokenIdentity, SessionIdentityMismatchError } from "../../app/sessionTokenIdentity";
import type { AccountOperation } from "./accountSwitchRecovery";
import { rememberedOutcome, rememberedState, type RememberedBrowser, type RememberedOperationResult } from "./accountSwitchTypes";

export const rememberedEndpoint = "/api/auth/browser/remembered";
const globalHeaders = { "X-Tenant-Id": "global" };
const resultStatuses = [401, 404, 409, 429, 503] as const;
const outcomeStatuses = [200, 409, 401, 401, 429, 409, 503, 404] as const;
type RememberedTransport = { generation: number; csrfToken: string };
type CurrentReadTag = { readSequence: number; epochAtStart: number; revisionAtStart: number };
let installedTransport: RememberedTransport | null = null;
let epoch = 0;
let revision = 0;
let readSequence = 0;
let lastInstalledReadSequence = 0;
const currentReadTags = new WeakMap<object, CurrentReadTag>();
const guid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const containsControl = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const optionalText = (value: unknown) => value === undefined || value === null || (typeof value === "string" && value.length <= 256 && !containsControl(value));
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalDate = (value: unknown) => value === undefined || value === null || date(value);
const username = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 512 && !containsControl(value);

function validateRememberedBrowser(value: unknown): RememberedBrowser {
  if (!record(value) || !Number.isSafeInteger(value.generation) || typeof value.generation !== "number" || value.generation < 0 ||
    typeof value.pinDigits !== "number" || !Number.isInteger(value.pinDigits) || value.pinDigits < 4 || value.pinDigits > 12 ||
    typeof value.state !== "number" || ![0, 1, 2, 3, 4, 5].includes(value.state) ||
    !Array.isArray(value.accounts) || !value.accounts.every(account => record(account) && guid(account.proofId) &&
      username(account.username) && optionalText(account.label) && optionalText(account.displayName) && optionalText(account.jobTitle) &&
      date(account.expiresAtUtc) && typeof account.requiresSignIn === "boolean") ||
    new Set(value.accounts.map(account => account.proofId)).size !== value.accounts.length ||
    !optionalDate(value.idleExpiresAtUtc) || !optionalDate(value.absoluteExpiresAtUtc) ||
    (value.csrfToken != null && (typeof value.csrfToken !== "string" || value.csrfToken.length === 0 || value.csrfToken.length > 4096)) ||
    ([1, 2, 3].includes(value.state) && !value.csrfToken) ||
    (value.state === rememberedState.active ? !record(value.active) : value.active != null) ||
    (value.active != null && (!record(value.active) || !guid(value.active.memberId) || !guid(value.active.sessionId) ||
      (value.active.proofId != null && !guid(value.active.proofId)) || !username(value.active.username) || !optionalText(value.active.label)))) {
    throw new Error("The browser status could not be verified.");
  }
  return value as RememberedBrowser;
}

export class RememberedBrowserBoundaryError extends Error {
  constructor(message = "The remembered-browser boundary changed before refresh.") {
    super(message);
    this.name = "RememberedBrowserBoundaryError";
  }
}

function contextFor(current: RememberedBrowser): RememberedTransport | null {
  return current.csrfToken ? { generation: current.generation, csrfToken: current.csrfToken } : null;
}

function rejectTransport(message: string): never {
  throw new RememberedBrowserBoundaryError(message);
}

function installTransport(next: RememberedTransport | null): void {
  installedTransport = next ? { ...next } : null;
  setRememberedBrowserTransport(installedTransport ? { ...installedTransport } : null);
}

function currentTag(current: RememberedBrowser): CurrentReadTag {
  const tag = currentReadTags.get(current as object);
  if (!tag) rejectTransport("The browser status was not read authoritatively.");
  return tag;
}

function acceptCurrent(current: RememberedBrowser): RememberedBrowser {
  const tag = currentTag(current);
  currentReadTags.delete(current as object);
  if (tag.epochAtStart !== epoch || tag.revisionAtStart !== revision || tag.readSequence <= lastInstalledReadSequence) {
    rejectTransport("The browser status is stale.");
  }
  if (current.state === rememberedState.missing) {
    installedTransport = null;
    setRememberedBrowserTransport(null);
    epoch += 1;
    revision += 1;
    lastInstalledReadSequence = tag.readSequence;
    return current;
  }
  if (installedTransport && current.generation < installedTransport.generation) {
    rejectTransport("The browser status has an older generation.");
  }
  const next = contextFor(current);
  if (next) installTransport(next);
  revision += 1;
  lastInstalledReadSequence = tag.readSequence;
  return current;
}

export function installRememberedContext(current: RememberedBrowser): RememberedBrowser {
  validateRememberedBrowser(current);
  return acceptCurrent(current);
}

export function installRememberedOperationContext(current: RememberedBrowser): RememberedBrowser {
  validateRememberedBrowser(current);
  if (installedTransport && current.generation < installedTransport.generation) {
    rejectTransport("The account-change result has an older generation.");
  }
  const next = contextFor(current);
  if (next) installTransport(next);
  revision += 1;
  return current;
}

export function resetRememberedBrowserTransport(): void {
  installedTransport = null;
  epoch += 1;
  revision += 1;
  setRememberedBrowserTransport(null);
}

export async function readRememberedBrowser(signal?: AbortSignal): Promise<RememberedBrowser> {
  const tag: CurrentReadTag = { readSequence: ++readSequence, epochAtStart: epoch, revisionAtStart: revision };
  const current = validateRememberedBrowser(await apiRequest<RememberedBrowser>(`${rememberedEndpoint}/current`, {
    headers: globalHeaders, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  }));
  currentReadTags.set(current as object, tag);
  return current;
}

export async function prepareRememberedBrowserRefresh(identity: SessionIdentity): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const current = await readRememberedBrowser();
      if (current.state === rememberedState.missing) {
        installRememberedContext(current);
        return;
      }
      if (current.state !== rememberedState.active || !current.active || !identity.subjectId || !identity.sessionId ||
        current.active.memberId !== identity.subjectId || current.active.sessionId !== identity.sessionId) {
        throw new RememberedBrowserBoundaryError("The remembered browser is no longer active for this session.");
      }
      installRememberedContext(current);
      return;
    } catch (error) {
      // A status observer may install a newer authoritative Current between
      // this preflight's read and install. Re-read that one transient race;
      // actor/state mismatches still fail closed without retry.
      if (attempt === 0 && error instanceof RememberedBrowserBoundaryError && error.message === "The browser status is stale.") continue;
      throw error;
    }
  }
}

function validateOperationResult(value: unknown, response: Response, mayIssueToken: boolean): RememberedOperationResult {
  if (!record(value) || typeof value.outcome !== "number" || !Number.isInteger(value.outcome) ||
    ![0, 1, 2, 3, 4, 5, 6, 7].includes(value.outcome) || outcomeStatuses[value.outcome] !== response.status) {
    throw new Error("The account-change result could not be verified.");
  }
  const current = validateRememberedBrowser(value.current);
  if (value.accessToken != null) {
    const identity = typeof value.accessToken === "string" ? readAccessTokenIdentity(value.accessToken) : null;
    if (!mayIssueToken || value.outcome !== rememberedOutcome.applied || current.state !== rememberedState.active ||
      !current.active?.proofId || !identity || identity.subjectId !== current.active.memberId || identity.sessionId !== current.active.sessionId) {
      throw new Error("The account-change result could not be verified.");
    }
  }
  const retryAfterMs = parseRetryAfterMilliseconds(response.headers.get("retry-after"));
  return { ...(value as RememberedOperationResult), current, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
}

export async function readRememberedOperation(operationId: string): Promise<RememberedOperationResult> {
  return apiRequest<RememberedOperationResult>(`${rememberedEndpoint}/operations/${operationId}`, {
    headers: globalHeaders, signal: AbortSignal.timeout(15_000),
  }, undefined, { statuses: resultStatuses, parse: (value, response) => validateOperationResult(value, response, false) });
}

export async function rememberedOperation(path: string, body: object, session?: ApiSession): Promise<RememberedOperationResult> {
  return apiRequest<RememberedOperationResult>(`${rememberedEndpoint}/${path}`, {
    method: "POST", headers: globalHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  }, session ? { accessToken: session.accessToken, tenantId: "global" } : undefined,
  { statuses: resultStatuses, parse: (value, response) => validateOperationResult(value, response, ["remember", "select", "recover"].includes(path)) });
}

export function confirmedRememberedSession(result: RememberedOperationResult, operation: AccountOperation): ApiSession {
  const current = result.current;
  const active = current.active;
  const token = result.accessToken ? readAccessTokenIdentity(result.accessToken) : null;
  if (result.outcome !== rememberedOutcome.applied || current.state !== rememberedState.active ||
    current.generation <= operation.expectedGeneration || !active || !token ||
    token.subjectId !== active.memberId || token.sessionId !== active.sessionId ||
    (operation.kind === "select" && active.proofId !== operation.proofId) ||
    !active.username || !result.accessToken) throw new SessionIdentityMismatchError();
  return { accessToken: result.accessToken, subjectId: active.memberId, sessionId: active.sessionId,
    username: active.username, tenantId: "global", generation: `remembered-${current.generation}` };
}

export function rememberedOutcomeMessage(outcome: RememberedOperationResult["outcome"], retryAfterMs?: number): string {
  switch (outcome) {
    case rememberedOutcome.pinRejected: return "That PIN was not accepted. Try again, or sign in with your password.";
    case rememberedOutcome.rateLimited: return retryAfterMs !== undefined && retryAfterMs > 0
      ? `Too many attempts. Wait ${Math.ceil(retryAfterMs / 1000)} seconds before trying again.`
      : "Too many attempts. Wait a moment before trying again.";
    case rememberedOutcome.authenticationRequired: return "Sign in with your password and any required verification to renew access.";
    case rememberedOutcome.stateChanged: return "This browser changed in another tab. Refresh its status before continuing.";
    case rememberedOutcome.sessionLimitReached: return "Your account has reached its session limit. Sign in normally to review your sessions.";
    case rememberedOutcome.notFound: return "No result is recorded for this account change yet. Retry the original change, not a new one.";
    default: return "Account switching is unavailable. Your previous account remains hidden. Retry when the connection returns.";
  }
}
