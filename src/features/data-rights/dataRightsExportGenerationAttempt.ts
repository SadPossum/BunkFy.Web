export type DataRightsExportGenerationIntent =
  | {
    kind: "create";
    caseId: string;
    decisionRevision: number | null;
    selectedSubjectCount: number;
    expectedCaseVersion: number;
  }
  | {
    kind: "retry";
    caseId: string;
    artifactId: string;
    expectedCaseVersion: number;
    expectedArtifactVersion: number;
  };

export type DataRightsExportGenerationAttempt = {
  fingerprint: string;
  intent: DataRightsExportGenerationIntent;
  idempotencyKey: string | null;
};

export type DataRightsExportGenerationRequest = {
  path: string;
  body:
    | { idempotencyKey: string; expectedVersion: number }
    | { expectedCaseVersion: number; expectedArtifactVersion: number };
};

export function resolveDataRightsExportGenerationAttempt(
  current: DataRightsExportGenerationAttempt | null,
  intent: DataRightsExportGenerationIntent,
  createIdempotencyKey: () => string = () => crypto.randomUUID(),
): DataRightsExportGenerationAttempt {
  const normalizedIntent = normalizeIntent(intent);
  const fingerprint = JSON.stringify(normalizedIntent);
  return current?.fingerprint === fingerprint
    ? current
    : {
      fingerprint,
      intent: normalizedIntent,
      idempotencyKey: normalizedIntent.kind === "create"
        ? createIdempotencyKey()
        : null,
    };
}

export function dataRightsExportGenerationRequest(
  basePath: string,
  attempt: DataRightsExportGenerationAttempt,
): DataRightsExportGenerationRequest {
  if (attempt.intent.kind === "retry") {
    return {
      path: `${basePath}/export/${attempt.intent.artifactId}/retry`,
      body: {
        expectedCaseVersion: attempt.intent.expectedCaseVersion,
        expectedArtifactVersion: attempt.intent.expectedArtifactVersion,
      },
    };
  }

  if (!attempt.idempotencyKey) {
    throw new Error("A create export attempt requires an idempotency key.");
  }

  return {
    path: `${basePath}/export`,
    body: {
      idempotencyKey: attempt.idempotencyKey,
      expectedVersion: attempt.intent.expectedCaseVersion,
    },
  };
}

function normalizeIntent(
  intent: DataRightsExportGenerationIntent,
): DataRightsExportGenerationIntent {
  return intent.kind === "create"
    ? {
      ...intent,
      caseId: normalizeId(intent.caseId),
    }
    : {
      ...intent,
      caseId: normalizeId(intent.caseId),
      artifactId: normalizeId(intent.artifactId),
    };
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}
