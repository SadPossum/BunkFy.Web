import { describe, expect, it } from "vitest";
import {
  accountSection,
  accountSectionSearchParams,
} from "../src/features/account/accountSections";

describe("account section routing", () => {
  it("falls back safely for unknown and unavailable sections", () => {
    expect(accountSection(null, true)).toBe("overview");
    expect(accountSection("unknown", true)).toBe("overview");
    expect(accountSection("profile", false)).toBe("overview");
    expect(accountSection("security", false)).toBe("security");
  });

  it("persists exact sections while clearing transient focus", () => {
    const current = new URLSearchParams("focus=workspace-profile&return=notification");
    expect(accountSectionSearchParams(current, "sessions").toString()).toBe("return=notification&section=sessions");
    expect(accountSectionSearchParams(current, "overview").toString()).toBe("return=notification");
  });
});
