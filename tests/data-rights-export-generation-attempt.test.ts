import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dataRightsExportGenerationRequest,
  resolveDataRightsExportGenerationAttempt,
  type DataRightsExportGenerationIntent,
} from "../src/features/data-rights/dataRightsExportGenerationAttempt";

const createIntent: DataRightsExportGenerationIntent = {
  kind: "create",
  caseId: "CASE-A",
  decisionRevision: 7,
  selectedSubjectCount: 2,
  expectedCaseVersion: 11,
};

describe("Data Rights export generation attempt", () => {
  it("keeps one creation idempotency key across an exact auth retry", () => {
    const first = resolveDataRightsExportGenerationAttempt(
      null,
      createIntent,
      () => "key-1",
    );
    const retry = resolveDataRightsExportGenerationAttempt(
      first,
      { ...createIntent, caseId: " case-a " },
      () => "key-2",
    );

    expect(retry).toBe(first);
    expect(dataRightsExportGenerationRequest("/api/cases/case-a", retry))
      .toEqual({
        path: "/api/cases/case-a/export",
        body: { idempotencyKey: "key-1", expectedVersion: 11 },
      });
  });

  it("rotates creation identity when the approved snapshot changes", () => {
    const first = resolveDataRightsExportGenerationAttempt(
      null,
      createIntent,
      () => "key-1",
    );
    const changed = resolveDataRightsExportGenerationAttempt(
      first,
      { ...createIntent, expectedCaseVersion: 12 },
      () => "key-2",
    );

    expect(changed.idempotencyKey).toBe("key-2");
  });

  it("uses the explicit version-pinned retry route without a creation key", () => {
    const attempt = resolveDataRightsExportGenerationAttempt(
      null,
      {
        kind: "retry",
        caseId: "case-a",
        artifactId: "ARTIFACT-A",
        expectedCaseVersion: 11,
        expectedArtifactVersion: 4,
      },
      () => "unused",
    );

    expect(attempt.idempotencyKey).toBeNull();
    expect(dataRightsExportGenerationRequest("/api/cases/case-a", attempt))
      .toEqual({
        path: "/api/cases/case-a/export/artifact-a/retry",
        body: { expectedCaseVersion: 11, expectedArtifactVersion: 4 },
      });
  });

  it("keeps the pending intent wired through recent-authentication retry", () => {
    const source = readFileSync(join(
      process.cwd(),
      "src",
      "features",
      "data-rights",
      "PrivacyRequestExport.tsx",
    ), "utf8");

    expect(source).toContain("resolveDataRightsExportGenerationAttempt");
    expect(source).toContain("generationAttempt.current.intent");
    expect(source).toContain("expectedArtifactVersion: current.version");
  });
});
