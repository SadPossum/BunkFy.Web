import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDataRightsDiscoveryAttempt,
  isDataRightsDiscoveryAttemptCurrent,
  type DataRightsDiscoveryCriteria,
} from "../src/features/data-rights/dataRightsDiscoveryAttempt";

const baseCriteria: DataRightsDiscoveryCriteria = {
  caseId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
  caseVersion: 7,
  scopeKind: "guest",
  ownerKey: "guests",
  lookupKind: "email",
  lookup: "  guest@example.test  ",
  name: "  Maya Chen  ",
};

describe("Data Rights discovery attempt", () => {
  it("snapshots only normalized criteria into the request", () => {
    const attempt = createDataRightsDiscoveryAttempt(baseCriteria, 3);

    expect(attempt.generation).toBe(3);
    expect(attempt.request).toEqual({
      recordId: null,
      email: "guest@example.test",
      phone: null,
      name: "Maya Chen",
      dateOfBirth: null,
      accountSubjectId: null,
      ownerKey: "guests",
    });
  });

  it("removes lookup fields that are not valid for the active owner", () => {
    expect(createDataRightsDiscoveryAttempt({
      ...baseCriteria,
      ownerKey: "ingestion",
      lookupKind: "email",
      lookup: "8d135f31-5131-43f8-8ccc-77726210618c",
    }, 1).request).toMatchObject({
      recordId: "8d135f31-5131-43f8-8ccc-77726210618c",
      email: null,
      name: null,
      ownerKey: "ingestion",
    });

    expect(createDataRightsDiscoveryAttempt({
      ...baseCriteria,
      scopeKind: "staff",
      ownerKey: "guests",
      lookupKind: "accountSubjectId",
      lookup: "auth0|staff-42",
    }, 1).request).toMatchObject({
      accountSubjectId: "auth0|staff-42",
      email: null,
      name: null,
      ownerKey: "staff",
    });
  });

  it("rejects late results after criteria, case, or generation drift", () => {
    const attempt = createDataRightsDiscoveryAttempt(baseCriteria, 5);

    expect(isDataRightsDiscoveryAttemptCurrent(attempt, baseCriteria, 5))
      .toBe(true);
    expect(isDataRightsDiscoveryAttemptCurrent(attempt, {
      ...baseCriteria,
      lookup: "another@example.test",
    }, 5)).toBe(false);
    expect(isDataRightsDiscoveryAttemptCurrent(attempt, {
      ...baseCriteria,
      caseVersion: 8,
    }, 5)).toBe(false);
    expect(isDataRightsDiscoveryAttemptCurrent(attempt, baseCriteria, 6))
      .toBe(false);
  });

  it("keeps cancellation and current-attempt fencing wired into the UI", () => {
    const source = readFileSync(join(
      process.cwd(),
      "src",
      "features",
      "data-rights",
      "PrivacyRequestDiscovery.tsx",
    ), "utf8");

    expect(source).toContain("createDataRightsDiscoveryAttempt");
    expect(source).toContain("isDataRightsDiscoveryAttemptCurrent");
    expect(source).toContain("controller.abort()");
    expect(source).toContain("signal: controller.signal");
    expect(source).not.toContain("discover.data?.limitReached");
  });
});
