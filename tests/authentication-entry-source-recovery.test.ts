import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("authentication entry source and callback recovery", () => {
  it("keeps registration and provider discovery independent and fail closed", () => {
    const page = source("features/auth/AuthPage.tsx");

    expect(page.match(/createCompositeSource\(\{/g)).toHaveLength(2);
    expect(page).toContain("const providerSourceCurrent = compositeSourceCurrent");
    expect(page).toContain("const registrationSourceCurrent = compositeSourceCurrent");
    expect(page).toContain("const latest = await selfRegistration.refetch();");
    expect(page).toContain("passwordRegistrationAllowed(latestCurrent, latest.data)");
    expect(page).toContain("const latest = await providers.refetch();");
    expect(page).toContain("externalProviderAllowed(latestCurrent, latest.data, provider)");
    expect(page).toContain('(mode === "register" && !passwordRegistrationAvailable)');
    expect(page).toContain("Password sign-in remains available");
    expect(page).not.toContain("Connected to {resolveApiBaseUrl()}");
    expect(page).not.toContain("cause instanceof Error ? cause.message");
  });

  it("captures callback metadata once and scrubs credentials from history", () => {
    const completion = source("features/auth/AuthCompletionPage.tsx");

    expect(completion).toContain("parseExternalAuthenticationCallback(window.location.search)");
    expect(completion).toContain("useLayoutEffect(() => {");
    expect(completion).toContain("window.history.replaceState(");
    expect(completion).toContain("window.location.pathname,");
    expect(completion).toContain("callback.intent,");
    expect(completion).toContain("cancelExternalAuthentication();");
    expect(completion).toContain("publicAuthenticationErrorMessage(");
    expect(completion).not.toContain("new URLSearchParams(window.location.search)");
  });

  it("cross-checks callback intent and clears abandoned browser state", () => {
    const session = source("app/session.tsx");

    expect(session).toContain("clearPendingExternalAuth();\n      const returnUrl");
    expect(session).toContain("intent: ExternalAuthenticationIntent | null");
    expect(session).toContain("(intent !== null && pending.intent !== intent)");
    expect(session).toContain("readPendingExternalAuth(\n          intent ? { intent, provider } : null");
    expect(session).toContain("cancelExternalAuthentication");
    expect(session).not.toContain("new URLSearchParams(window.location.search)");
  });
});
