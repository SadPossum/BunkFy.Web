import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "../src/api/client";
import {
  NetworkRequestError,
  OfflineRequestError,
  requestNeedsOnlineWrite,
} from "../src/api/requestConnectivity";
import { refreshFailureInvalidatesSession } from "../src/app/sessionRecovery";
import { presentError } from "../src/components/ui/errorPresentation";

afterEach(() => vi.unstubAllGlobals());

describe("shared recovery-state contract", () => {
  it("invalidates a saved browser session only when refresh authoritatively rejects it", () => {
    expect(refreshFailureInvalidatesSession(new ApiError("expired", 401))).toBe(true);
    expect(refreshFailureInvalidatesSession(new ApiError("unavailable", 503))).toBe(false);
    expect(refreshFailureInvalidatesSession(new ApiError("slow down", 429))).toBe(false);
    expect(refreshFailureInvalidatesSession(new OfflineRequestError())).toBe(false);
    expect(refreshFailureInvalidatesSession(new NetworkRequestError())).toBe(false);
  });

  it("blocks offline writes before fetch so they cannot be silently queued", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest<void>("/api/reservations", { method: "POST" }))
      .rejects.toBeInstanceOf(OfflineRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requestNeedsOnlineWrite("post")).toBe(true);
    expect(requestNeedsOnlineWrite("GET")).toBe(false);
  });

  it("distinguishes an interrupted connection from an authoritative API response", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(apiRequest<void>("/api/properties"))
      .rejects.toBeInstanceOf(NetworkRequestError);
  });

  it("maps access, missing, rate-limit, and temporary failures to operator actions", () => {
    expect(presentError(new ApiError("forbidden", 403))).toMatchObject({
      kind: "access",
      title: "Access denied",
    });
    expect(presentError(new ApiError("missing", 404))).toMatchObject({
      kind: "missing",
      title: "No longer available",
    });
    expect(presentError(new ApiError("slow down", 429, undefined, 25_000))).toMatchObject({
      kind: "rate-limit",
      title: "Please wait before trying again",
      retryAfterMs: 25_000,
    });
    expect(presentError(new ApiError("temporarily unavailable", 503))).toMatchObject({
      kind: "temporary",
      title: "Service temporarily unavailable",
    });
  });

  it.each([
    ["Organizations.SubjectVerificationRequired", 403, "Verify your email in Account & security"],
    ["Workspaces.VerifiedIdentityRequired", 403, "Verify your email in Account & security"],
    ["Organizations.SelfServiceCreationDisabled", 403, "New workspaces can't be created here"],
    ["Organizations.CreationRejected", 403, "This account can't create a workspace"],
    ["Organizations.OwnerRequired", 403, "Only a workspace owner"],
    ["Organizations.SlugConflict", 409, "That short name is already in use"],
    ["Organizations.CreationOperationConflict", 409, "This setup attempt can no longer be continued"],
    ["Organizations.CreationAdmissionUnavailable", 503, "Workspace setup is temporarily unavailable"],
    ["Security.InsufficientAuthentication", 401, "Confirm your identity with a recent sign-in"],
    ["Security.InsufficientAuthentication", 403, "Confirm your identity with a recent sign-in"],
  ] as const)("explains %s at HTTP %s before applying a generic status message", (code, status, message) => {
    const error = new ApiError("Internal server detail", status, code, undefined, "trace-1234");
    expect(presentError(error, "Setup couldn't finish")).toMatchObject({
      title: "Setup couldn't finish", referenceId: "trace-1234",
    });
    expect(presentError(error).message).toContain(message);
    expect(presentError(error).message).not.toContain("Internal server detail");
  });

  it("does not expose raw server errors or claim a failed write could not have saved", () => {
    const result = presentError(new ApiError("Database constraint SQL error", 500));
    expect(result.kind).toBe("temporary");
    expect(result.message).not.toContain("SQL");
    expect(result.message).toContain("check whether they were saved before retrying");
  });

  it("preserves a safe request reference for support without leaking malformed values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: "Http.ServiceUnavailable",
      detail: "Temporarily unavailable.",
      traceId: "trace-4f8a2c",
    }), {
      status: 503,
      headers: { "Content-Type": "application/problem+json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await apiRequest<void>("/api/temporary").catch((reason) => reason);

    expect(error).toMatchObject({ referenceId: "trace-4f8a2c" });
    expect(presentError(error)).toMatchObject({ referenceId: "trace-4f8a2c" });
  });
});
