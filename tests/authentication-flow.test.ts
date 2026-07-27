import { describe, expect, it } from "vitest";
import {
  isMultiFactorChallenge,
  preferredMultiFactorCodeType,
} from "../src/features/auth/authenticationFlow";

describe("browser authentication flow", () => {
  it("distinguishes a challenge from an authenticated browser response", () => {
    expect(isMultiFactorChallenge({ accessToken: "access-token" })).toBe(false);
    expect(isMultiFactorChallenge({
      challengeToken: "challenge-token",
      expiresAtUtc: "2026-07-27T12:10:00Z",
      availableCodeTypes: ["totp"],
    })).toBe(true);
  });

  it("prefers an authenticator code and falls back to a recovery code", () => {
    expect(preferredMultiFactorCodeType({
      availableCodeTypes: ["recovery-code", "totp"],
    })).toBe("totp");
    expect(preferredMultiFactorCodeType({
      availableCodeTypes: ["recovery-code"],
    })).toBe("recovery-code");
    expect(preferredMultiFactorCodeType({ availableCodeTypes: [] })).toBeNull();
  });
});
