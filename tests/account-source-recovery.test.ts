import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const account = readFileSync(
  join(process.cwd(), "src", "features", "account", "AccountPage.tsx"),
  "utf8",
);

describe("account source recovery", () => {
  it("keeps independent account sources out of one security loading branch", () => {
    expect(account).toContain("<CompositeSourceNotice");
    expect(account).toContain("<CompositeSourceFallback");
    expect(account).toContain("<MultiFactorPanel />");
    expect(account).not.toContain("methods.isLoading ?");
    expect(account).not.toContain("methods.error ?");
  });

  it("requires current method and provider evidence for security changes", () => {
    expect(account).toContain("const methodsCurrent = compositeSourceCurrent(methodsSource)");
    expect(account).toContain("const providersCurrent = compositeSourceCurrent(providerSource)");
    expect(account).toContain("canLink={methodsCurrent && providersCurrent}");
    expect(account).toContain("canUnlink={methodsCurrent}");
    expect(account).toContain("if (!methodsCurrent)");
  });

  it("keeps provider-link and sign-out failures with their owning controls", () => {
    expect(account).toContain("providerLinkError");
    expect(account).toContain("signOutError");
    expect(account).not.toContain("sessionError");
  });

  it("loads and recovers the staff profile only for a selected workspace", () => {
    expect(account).toContain("enabled: Boolean(selectedWorkspace)");
    expect(account).toContain('label="workspace profile"');
    expect(account).toContain("staffProfileUsable && staffProfile.data");
  });
});
