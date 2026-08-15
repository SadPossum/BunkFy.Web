import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveDataRightsCaseCreateAttempt,
  type DataRightsCaseCreatePayload,
} from "../src/features/data-rights/dataRightsCaseCreateAttempt";

const payload: DataRightsCaseCreatePayload = {
  scopeKey: "property:property-a",
  requestedOperations: 1,
  restrictionDirective: 0,
  requesterRelationship: 1,
};

describe("Data Rights case create attempt", () => {
  it("reuses one operation id for the same normalized submission", () => {
    const first = resolveDataRightsCaseCreateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolveDataRightsCaseCreateAttempt(
      first,
      { ...payload, scopeKey: "  property:property-a  " },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("allocates a new operation id when scope or intent changes", () => {
    const first = resolveDataRightsCaseCreateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const changedIntent = resolveDataRightsCaseCreateAttempt(
      first,
      { ...payload, requestedOperations: 2 },
      () => "operation-2",
    );
    const changedScope = resolveDataRightsCaseCreateAttempt(
      changedIntent,
      { ...payload, scopeKey: "tenant:tenant-a" },
      () => "operation-3",
    );

    expect(changedIntent.operationId).toBe("operation-2");
    expect(changedScope.operationId).toBe("operation-3");
  });

  it("keeps the operation id wired into the case request", () => {
    const source = readFileSync(join(
      process.cwd(),
      "src",
      "features",
      "data-rights",
      "PrivacyRequestsPage.tsx",
    ), "utf8");

    expect(source).toContain("resolveDataRightsCaseCreateAttempt");
    expect(source).toContain("operationId: createAttempt.current.operationId");
    expect(source).toContain("createAttempt.current = null");
  });
});
