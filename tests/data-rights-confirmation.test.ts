import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataRightsCase } from "../src/api/types";
import {
  createDataRightsConfirmation,
  isDataRightsConfirmationCurrent,
} from "../src/features/data-rights/dataRightsConfirmation";
import type { DataRightsAction } from "../src/features/data-rights/dataRightsWorkflow";

const dataRightsCase = {
  id: "8d000000-0000-0000-0000-000000000010",
  version: 7,
  status: 5,
  selectedSubjectCount: 1,
} as DataRightsCase;
const actions: DataRightsAction[] = ["execute-removal", "cancel"];

describe("Data Rights confirmation", () => {
  it("snapshots only the reviewed case and action coordinates", () => {
    expect(createDataRightsConfirmation(
      "execute-removal",
      dataRightsCase,
      "removal",
    )).toEqual({
      action: "execute-removal",
      caseId: dataRightsCase.id,
      caseVersion: 7,
      caseStatus: 5,
      selectedSubjectCount: 1,
      operationKind: "removal",
      restrictionTargetId: null,
      restrictionTargetVersion: null,
    });
  });

  it("accepts only the exact current review snapshot", () => {
    const confirmation = createDataRightsConfirmation(
      "execute-removal",
      dataRightsCase,
      "removal",
    );

    expect(isDataRightsConfirmationCurrent(
      confirmation,
      dataRightsCase,
      "removal",
      actions,
    )).toBe(true);
    expect(isDataRightsConfirmationCurrent(
      confirmation,
      { ...dataRightsCase, id: "8d000000-0000-0000-0000-000000000011" },
      "removal",
      actions,
    )).toBe(false);
    expect(isDataRightsConfirmationCurrent(
      confirmation,
      { ...dataRightsCase, version: 8 },
      "removal",
      actions,
    )).toBe(false);
    expect(isDataRightsConfirmationCurrent(
      confirmation,
      { ...dataRightsCase, status: 7 },
      "removal",
      actions,
    )).toBe(false);
    expect(isDataRightsConfirmationCurrent(
      confirmation,
      { ...dataRightsCase, selectedSubjectCount: 2 },
      "removal",
      actions,
    )).toBe(false);
    expect(isDataRightsConfirmationCurrent(
      confirmation,
      dataRightsCase,
      "export",
      actions,
    )).toBe(false);
    expect(isDataRightsConfirmationCurrent(
      confirmation,
      dataRightsCase,
      "removal",
      ["cancel"],
    )).toBe(false);
  });

  it("invalidates a confirmation when the reviewed restriction target changes", () => {
    const releaseCase = {
      ...dataRightsCase,
      restrictionReleaseTarget: {
        ownerKey: "guests",
        ownerOperationId: "8d000000-0000-0000-0000-000000000020",
        ownerOperationVersion: 4,
        selectedAtUtc: "2026-08-15T12:00:00Z",
      },
    };
    const confirmation = createDataRightsConfirmation(
      "execute-restriction",
      releaseCase,
      "restriction-release",
    );

    expect(confirmation.restrictionTargetId).toBe(
      releaseCase.restrictionReleaseTarget.ownerOperationId,
    );
    expect(isDataRightsConfirmationCurrent(
      confirmation,
      {
        ...releaseCase,
        restrictionReleaseTarget: {
          ...releaseCase.restrictionReleaseTarget,
          ownerOperationVersion: 5,
        },
      },
      "restriction-release",
      ["execute-restriction"],
    )).toBe(false);
  });

  it("pins rendering and submission to the reviewed version", () => {
    const detail = readFileSync(join(
      process.cwd(),
      "src",
      "features",
      "data-rights",
      "PrivacyRequestDetail.tsx",
    ), "utf8");
    const actionsSource = readFileSync(join(
      process.cwd(),
      "src",
      "features",
      "data-rights",
      "PrivacyRequestActions.tsx",
    ), "utf8");

    expect(detail).toContain("isDataRightsConfirmationCurrent");
    expect(detail).toContain("confirmation={activeConfirmation}");
    expect(detail).toContain("expectedVersion ?? dataRightsCase.version");
    expect(detail).toContain("dataRightsCase.restrictionExecutionProof");
    expect(actionsSource).toContain("confirmation.caseVersion");
    expect(actionsSource).not.toContain("confirmation={confirmation}");
  });
});
