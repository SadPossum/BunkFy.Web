import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { isInsufficientAuthenticationError } from "../src/app/authenticationAssurance";

describe("authentication assurance", () => {
  it("recognizes only the stable insufficient-authentication challenge", () => {
    expect(isInsufficientAuthenticationError(
      new ApiError("Recent authentication required.", 403, "Security.InsufficientAuthentication"),
    )).toBe(true);
    expect(isInsufficientAuthenticationError(
      new ApiError("Permission denied.", 403, "Security.PermissionDenied"),
    )).toBe(false);
    expect(isInsufficientAuthenticationError(new Error("network"))).toBe(false);
  });
});
