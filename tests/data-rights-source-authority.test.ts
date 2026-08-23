import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataRightsCase } from "../src/api/types";
import {
  dataRightsCaseMatches,
  dataRightsCaseQueryKey,
  dataRightsCasesQueryKey,
  dataRightsCorrectionQueryKey,
  dataRightsExecutionQueryKey,
  dataRightsExportQueryKey,
  dataRightsMutationAllowed,
  dataRightsOperatorScopeKey,
  dataRightsRestrictionTargetsQueryKey,
  dataRightsSubmissionMatches,
  dataRightsSubjectsQueryKey,
} from "../src/features/data-rights/dataRightsSourceAuthority";

const repositoryRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("Data Rights operator source authority", () => {
  it("binds every query family to the normalized user and workspace identity", () => {
    const operator = dataRightsOperatorScopeKey({
      tenantId: "tenant-a",
      username: " Maya@Example.Test ",
    });

    expect(operator).toBe('["tenant-a","maya@example.test"]');
    expect(dataRightsOperatorScopeKey(null)).toBe("");
    expect(dataRightsOperatorScopeKey({ tenantId: "tenant-a", username: " " })).toBe("");
    expect(dataRightsCasesQueryKey("guest:property-a", operator, "all", 2)).toEqual([
      "data-rights-cases",
      "guest:property-a",
      operator,
      "all",
      2,
    ]);
    expect(dataRightsCaseQueryKey("staff", "case-a", operator)).toEqual([
      "data-rights-case",
      "staff",
      "case-a",
      operator,
    ]);
    expect(dataRightsSubjectsQueryKey("staff", "case-a", operator, 7, "/evidence")[3])
      .toBe(operator);
    expect(dataRightsExecutionQueryKey("staff", "case-a", operator)[3]).toBe(operator);
    expect(dataRightsExportQueryKey("staff", "case-a", operator)[3]).toBe(operator);
    expect(dataRightsCorrectionQueryKey("staff", "case-a", operator)[3]).toBe(operator);
    expect(dataRightsRestrictionTargetsQueryKey(
      "guest:property-a",
      "case-a",
      operator,
      7,
    )[3]).toBe(operator);
  });

  it("requires only the current evidence consumed by each command", () => {
    const current = {
      permissionsCurrent: true,
      caseCurrent: true,
      selectedEvidenceCurrent: true,
      supportingSourceCurrent: true,
      erasePermissionCurrent: true,
    };

    for (const kind of [
      "create-case",
      "case-action",
      "review-action",
      "discovery",
      "selection",
      "restriction-target",
      "generate-export",
      "download-export",
      "start-correction",
      "claim-correction",
      "apply-correction",
      "execute-restriction",
      "execute-removal",
    ] as const) {
      expect(dataRightsMutationAllowed(kind, current)).toBe(true);
      expect(dataRightsMutationAllowed(kind, {
        ...current,
        permissionsCurrent: false,
      })).toBe(false);
    }

    expect(dataRightsMutationAllowed("create-case", {
      permissionsCurrent: true,
    })).toBe(true);
    expect(dataRightsMutationAllowed("case-action", {
      permissionsCurrent: true,
      caseCurrent: false,
    })).toBe(false);
    expect(dataRightsMutationAllowed("review-action", {
      permissionsCurrent: true,
      caseCurrent: true,
      selectedEvidenceCurrent: false,
    })).toBe(false);
    expect(dataRightsMutationAllowed("selection", {
      permissionsCurrent: true,
      caseCurrent: true,
      supportingSourceCurrent: false,
    })).toBe(false);
    expect(dataRightsMutationAllowed("generate-export", {
      permissionsCurrent: true,
      caseCurrent: true,
      supportingSourceCurrent: false,
    })).toBe(false);
    expect(dataRightsMutationAllowed("generate-export", {
      permissionsCurrent: true,
      caseCurrent: true,
      selectedEvidenceCurrent: false,
      supportingSourceCurrent: true,
    })).toBe(true);
    expect(dataRightsMutationAllowed("execute-removal", {
      permissionsCurrent: true,
      caseCurrent: true,
      erasePermissionCurrent: false,
    })).toBe(false);
    expect(dataRightsMutationAllowed("execute-removal", {
      permissionsCurrent: true,
      caseCurrent: true,
      selectedEvidenceCurrent: false,
      erasePermissionCurrent: true,
    })).toBe(true);
  });

  it("rejects a command after its case or active source advances", () => {
    const candidate = dataRightsCase();

    expect(dataRightsCaseMatches(candidate, candidate)).toBe(true);
    expect(dataRightsCaseMatches({ ...candidate, version: 8 }, candidate)).toBe(false);
    expect(dataRightsCaseMatches({ ...candidate, selectedSubjectCount: 2 }, candidate)).toBe(false);
    expect(dataRightsCaseMatches({ ...candidate, decisionRevision: 4 }, candidate)).toBe(false);
    expect(dataRightsSubmissionMatches("operator-a", "staff", "operator-a", "staff"))
      .toBe(true);
    expect(dataRightsSubmissionMatches("operator-a", "staff", "operator-b", "staff"))
      .toBe(false);
    expect(dataRightsSubmissionMatches("operator-a", "staff", "operator-a", "guest:p1"))
      .toBe(false);
    expect(dataRightsSubmissionMatches("", "staff", "", "staff")).toBe(false);
  });

  it("keeps privacy sources independent and fences every mutation family", () => {
    const page = source("features/data-rights/PrivacyRequestsPage.tsx");
    const detail = source("features/data-rights/PrivacyRequestDetail.tsx");
    const discovery = source("features/data-rights/PrivacyRequestDiscovery.tsx");
    const exportPanel = source("features/data-rights/PrivacyRequestExport.tsx");
    const correction = source("features/data-rights/PrivacyRequestCorrection.tsx");
    const correctionOwner = source(
      "features/data-rights/PrivacyRequestCorrectionOwnerEditor.tsx",
    );

    expect(page).toContain("const activeAccess = usePermissions(");
    expect(page).toContain("const eraseAccess = usePermissions(");
    expect(page).toContain("dataRightsCasesQueryKey(");
    expect(page).toContain("const casesSource = createCompositeSource({");
    expect(page).toContain("dataRightsMutationAllowed(\"create-case\"");
    expect(page).toContain(
      'key={`${operatorScopeKey}:${scopeKey}:${selectedCaseId ?? "closed"}`}',
    );
    expect(page).toContain("<CompositeSourceNotice");
    expect(page).toContain("<CompositeSourceFallback");
    expect(page).not.toContain("cases.error ?");

    expect(detail).toContain("dataRightsCaseQueryKey(");
    expect(detail).toContain("const caseSource = createCompositeSource({");
    expect(detail).toContain("dataRightsCaseMatches(");
    expect(detail).toContain("authority.dataRightsCase,");
    expect(detail).toContain("dataRightsMutationAllowed(");
    expect(detail).not.toContain("caseQuery.error || !dataRightsCase");

    expect(discovery).toContain("authorityCurrent");
    expect(discovery).toContain("dataRightsMutationAllowed(\"selection\"");
    expect(exportPanel).toContain("const artifactSource = createCompositeSource({");
    expect(exportPanel).toContain("dataRightsMutationAllowed(\"generate-export\"");
    expect(exportPanel).toContain("exportIntentMatchesArtifact(");
    expect(exportPanel).toContain("Export status is not confirmed");
    expect(exportPanel).toContain("cached.version > result.version");
    expect(correction).toContain("const correctionSource = createCompositeSource({");
    expect(correction).toContain("dataRightsMutationAllowed(\"apply-correction\"");
    expect(correctionOwner).toContain("ownerSubmissionCurrent(");
    expect(correctionOwner).toContain("supportingSourceCurrent: current.ownerRecordCurrent");
  });
});

function dataRightsCase(): DataRightsCase {
  return {
    id: "case-a",
    version: 7,
    status: 5,
    decisionRevision: 3,
    selectedSubjectCount: 1,
  } as DataRightsCase;
}
