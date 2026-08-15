import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import {
  dataRightsRestrictionTargetErrorMessage,
  dataRightsRestrictionTargetFailure,
  restrictionTargetMatchesCandidate,
  shortRestrictionTargetId,
} from "../src/features/data-rights/dataRightsRestrictionTarget";

describe("Data Rights restriction target", () => {
  it("classifies owner, configuration, concurrency, and permission failures safely", () => {
    expect(dataRightsRestrictionTargetFailure(new ApiError(
      "details",
      503,
      "DataRights.RestrictionOwnerUnavailable",
    ))).toBe("unavailable");
    expect(dataRightsRestrictionTargetFailure(new ApiError(
      "details",
      500,
      "DataRights.RestrictionReleaseTargetResultInvalid",
    ))).toBe("configuration");
    expect(dataRightsRestrictionTargetFailure(new ApiError(
      "details",
      409,
      "DataRights.RestrictionReleaseTargetStale",
    ))).toBe("changed");
    expect(dataRightsRestrictionTargetFailure(new ApiError("details", 403))).toBe("forbidden");
    expect(dataRightsRestrictionTargetFailure(new ApiError("details", 404))).toBe("missing");
  });

  it("never repeats a server-provided error detail", () => {
    const secret = "guest@example.test";
    const message = dataRightsRestrictionTargetErrorMessage(new ApiError(
      secret,
      503,
      "DataRights.RestrictionOwnerRetryRequired",
    ));

    expect(message).not.toContain(secret);
    expect(message).toContain("temporarily unavailable");
  });

  it("matches the exact opaque owner operation and version", () => {
    const target = {
      ownerKey: "guests",
      ownerOperationId: "8d000000-0000-0000-0000-000000000020",
      ownerOperationVersion: 4,
      selectedAtUtc: "2026-08-15T12:00:00Z",
    };
    const candidate = {
      ownerOperationId: target.ownerOperationId,
      ownerOperationVersion: target.ownerOperationVersion,
      sourceCaseId: "8d000000-0000-0000-0000-000000000021",
      appliedAtUtc: "2026-08-15T11:00:00Z",
    };

    expect(restrictionTargetMatchesCandidate(target, candidate)).toBe(true);
    expect(restrictionTargetMatchesCandidate(target, {
      ...candidate,
      ownerOperationVersion: 5,
    })).toBe(false);
    expect(shortRestrictionTargetId(target.ownerOperationId)).toBe("8D000000");
  });
});
