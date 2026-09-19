import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(join(process.cwd(), "src", "features", "account", file), "utf8");
}

const account = source("AccountPage.tsx");
const security = source("AccountSecurityPanels.tsx");
const profile = source("AccountStaffProfilePanel.tsx");
const sessions = source("AccountSessionsPanel.tsx");
const overview = source("AccountOverview.tsx");

describe("account source recovery", () => {
  it("keeps independent account sources and section-scoped loading", () => {
    expect(account).toContain("<CompositeSourceNotice");
    expect(account).toContain("<CompositeSourceFallback");
    expect(account).toContain("<MultiFactorPanel");
    expect(account).toContain("enabled: needsMethods");
    expect(account).toContain("enabled: needsProviders");
    expect(account).toContain("enabled: needsSessions");
    expect(account).toContain("enabled: needsMfa");
    expect(account).not.toContain("methods.isLoading ?");
    expect(account).not.toContain("methods.error ?");
  });

  it("requires current evidence for security, profile, and session mutations", () => {
    expect(account).toContain("const methodsCurrent = compositeSourceCurrent(methodsSource)");
    expect(account).toContain("const providersCurrent = compositeSourceCurrent(providerSource)");
    expect(account).toContain("const sessionsCurrent = compositeSourceCurrent(sessionSource)");
    expect(account).toContain("const mfaCurrent = compositeSourceCurrent(mfaSource)");
    expect(account).toContain("const staffProfileCurrent = compositeSourceCurrent(staffProfileSource)");
    expect(account).toContain("canLink={methodsCurrent && providersCurrent}");
    expect(account).toContain("canUnlink={methodsCurrent}");
    expect(account).toContain("canMutate={mfaCurrent}");
    expect(account).toContain("canMutate={staffProfileCurrent}");
    expect(account).toContain("canRevoke={sessionsCurrent}");
    expect(account).toContain("if (!methodsCurrent)");
    expect(security).toContain("if (!canMutate) return");
    expect(profile).toContain("if (canMutate) return");
    expect(sessions).toContain("disabled={revokePending || !canRevoke}");
  });

  it("keeps errors with their owning controls", () => {
    expect(account).toContain("providerLinkError");
    expect(account).toContain("signOutError");
    expect(account).not.toContain("sessionError");
    expect(security).toContain('mutation.variables?.kind === "set-password"');
    expect(security).toContain('mutation.variables?.kind === "request-verification"');
    expect(security).toContain('mutation.variables?.kind === "unlink-provider"');
  });

  it("returns external-link callbacks to the router-owned security section", () => {
    expect(account).toContain('searchParams.get("external") !== "linked"');
    expect(account).toContain('next.set("section", "security")');
    expect(account).toContain("setSearchParams(next, { replace: true })");
    expect(account).not.toContain("window.history.replaceState");
  });

  it("loads and recovers the Staff-owned profile only when its section needs it", () => {
    expect(account).toContain("const needsStaffProfile = Boolean(selectedWorkspace)");
    expect(account).toContain("enabled: needsStaffProfile");
    expect(account).toContain('label="workspace profile"');
    expect(account).toContain("staffProfileUsable && staffProfile.data");
    expect(profile).toContain("This profile does not control workspace membership, roles, or sign-in methods.");
    expect(overview).toContain("Staff profile created");
    expect(overview).not.toContain("Member since");
  });
});
