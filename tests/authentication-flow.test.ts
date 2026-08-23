import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import {
  externalProviderAllowed,
  isMultiFactorChallenge,
  parseExternalAuthenticationCallback,
  passwordRegistrationAllowed,
  preferredMultiFactorCodeType,
  publicAuthenticationErrorMessage,
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

  it("requires current registration and provider discovery evidence", () => {
    expect(passwordRegistrationAllowed(true, { passwordEnabled: true })).toBe(true);
    expect(passwordRegistrationAllowed(false, { passwordEnabled: true })).toBe(false);
    expect(passwordRegistrationAllowed(true, { passwordEnabled: false })).toBe(false);

    const providers = { providers: ["Google", "microsoft"] };
    expect(externalProviderAllowed(true, providers, " google ")).toBe(true);
    expect(externalProviderAllowed(false, providers, "google")).toBe(false);
    expect(externalProviderAllowed(true, providers, "github")).toBe(false);
  });

  it("captures callback metadata without retaining unknown intent", () => {
    expect(parseExternalAuthenticationCallback(
      "?code= code-123 &provider= Google &intent=sign-in",
    )).toEqual({
      code: "code-123",
      provider: "Google",
      intent: "sign-in",
      providerRejected: false,
    });
    expect(parseExternalAuthenticationCallback(
      "?provider=google&intent=unexpected&error=access_denied",
    )).toEqual({
      code: "",
      provider: "google",
      intent: null,
      providerRejected: true,
    });
  });

  it("uses deliberate public authentication copy instead of API details", () => {
    expect(publicAuthenticationErrorMessage(
      new ApiError("internal subject detail", 500, "Auth.Internal"),
      "Authentication is unavailable.",
    )).toBe("Authentication is unavailable.");
    expect(publicAuthenticationErrorMessage(
      new ApiError("blocked", 400, "Auth.PasswordBlocked"),
      "Registration failed.",
    )).toContain("cannot be used");
    expect(publicAuthenticationErrorMessage(
      new ApiError("limited", 429, "Auth.AttemptLimited", 30_000),
      "Verification failed.",
    )).toContain("Too many attempts");
    expect(publicAuthenticationErrorMessage(
      new TypeError("Failed to fetch"),
      "Authentication is unavailable.",
    )).toBe("Authentication is unavailable.");
  });
});
