import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authPasswordLengthHelp,
  authPasswordPolicy,
} from "../src/features/auth/authPasswordPolicy";

describe("browser password policy", () => {
  it("matches the published GMA Auth plaintext length contract", () => {
    expect(authPasswordPolicy).toEqual({ minimumLength: 15, maximumLength: 128 });
    expect(authPasswordLengthHelp()).toBe("15-128 characters");
  });

  it("uses the shared policy for registration and account password changes", () => {
    const auth = readFileSync(join(process.cwd(), "src", "features", "auth", "AuthPage.tsx"), "utf8");
    const account = readFileSync(join(process.cwd(), "src", "features", "account", "AccountSecurityPanels.tsx"), "utf8");
    expect(auth).toContain("authPasswordPolicy.minimumLength");
    expect(auth).toContain("authPasswordPolicy.maximumLength");
    expect(account).toContain("authPasswordPolicy.minimumLength");
    expect(account).toContain("authPasswordPolicy.maximumLength");
  });
});
