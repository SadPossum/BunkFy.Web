import { ApiError } from "../../api/client";
import type {
  AuthSelfRegistration,
  BrowserAuthResponse,
  ExternalAuthenticationProviderList,
  MultiFactorChallenge,
  MultiFactorCodeType,
} from "../../api/types";

export type ExternalAuthenticationIntent = "sign-in" | "link";

export type ExternalAuthenticationCallback = {
  code: string;
  provider: string;
  intent: ExternalAuthenticationIntent | null;
  providerRejected: boolean;
};

export function isMultiFactorChallenge(
  response: BrowserAuthResponse | MultiFactorChallenge,
): response is MultiFactorChallenge {
  return "challengeToken" in response &&
    typeof response.challengeToken === "string";
}

export function preferredMultiFactorCodeType(
  challenge: Pick<MultiFactorChallenge, "availableCodeTypes">,
): MultiFactorCodeType | null {
  if (challenge.availableCodeTypes.includes("totp")) return "totp";
  return challenge.availableCodeTypes[0] ?? null;
}

export function passwordRegistrationAllowed(
  sourceCurrent: boolean,
  registration: Pick<AuthSelfRegistration, "passwordEnabled"> | undefined,
): boolean {
  return sourceCurrent && registration?.passwordEnabled === true;
}

export function externalProviderAllowed(
  sourceCurrent: boolean,
  catalogue: Pick<ExternalAuthenticationProviderList, "providers"> | undefined,
  provider: string,
): boolean {
  const normalized = provider.trim().toLowerCase();
  return Boolean(
    sourceCurrent && normalized && catalogue?.providers.some((candidate) =>
      candidate.trim().toLowerCase() === normalized),
  );
}

export function parseExternalAuthenticationCallback(
  search: string,
): ExternalAuthenticationCallback {
  const parameters = new URLSearchParams(search);
  const intent = parameters.get("intent");
  return {
    code: parameters.get("code")?.trim() ?? "",
    provider: parameters.get("provider")?.trim() ?? "",
    intent: intent === "sign-in" || intent === "link" ? intent : null,
    providerRejected: parameters.has("error"),
  };
}

export function publicAuthenticationErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof ApiError) {
    if (error.status === 429 || (error.retryAfterMs ?? 0) > 0) {
      return "Too many attempts were made. Wait a moment before trying again.";
    }
    if (error.code === "Auth.SelfRegistrationDisabled") {
      return "Account registration is no longer available. Sign in or ask your workspace administrator.";
    }
    if (error.code === "Auth.PasswordBlocked") {
      return "That password cannot be used. Choose a different password.";
    }
    if (error.code === "Auth.ExternalVerifiedEmailRequired") {
      return "The provider must share a verified email address to use BunkFy.";
    }
    if (error.code === "Auth.ExternalAccountLinkRequired" ||
      error.code === "Auth.ExternalIdentityAlreadyLinked") {
      return "Sign in another way, then review the linked provider from your account page.";
    }
    if (error.code?.includes("MultiFactor") || error.code?.includes("Totp")) {
      return "The verification code was not accepted. Check it and try again.";
    }
    return fallback;
  }

  return fallback;
}
