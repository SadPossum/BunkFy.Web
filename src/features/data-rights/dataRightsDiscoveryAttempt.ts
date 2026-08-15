export type DataRightsDiscoveryOwner =
  | "guests"
  | "reservations"
  | "ingestion"
  | "staff";

export type DataRightsDiscoveryLookupKind =
  | "recordId"
  | "email"
  | "phone"
  | "accountSubjectId";

export type DataRightsDiscoveryCriteria = {
  caseId: string;
  caseVersion: number;
  scopeKind: "guest" | "staff";
  ownerKey: DataRightsDiscoveryOwner;
  lookupKind: DataRightsDiscoveryLookupKind;
  lookup: string;
  name: string;
};

export type DataRightsDiscoveryRequest = {
  recordId: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  dateOfBirth: null;
  accountSubjectId: string | null;
  ownerKey: DataRightsDiscoveryOwner;
};

export type DataRightsDiscoveryAttempt = {
  generation: number;
  fingerprint: string;
  request: DataRightsDiscoveryRequest;
};

export function createDataRightsDiscoveryAttempt(
  criteria: DataRightsDiscoveryCriteria,
  generation: number,
): DataRightsDiscoveryAttempt {
  const normalized = normalizeCriteria(criteria);
  return {
    generation,
    fingerprint: JSON.stringify([
      normalized.caseId,
      normalized.caseVersion,
      normalized.scopeKind,
      normalized.request.ownerKey,
      normalized.lookupKind,
      normalized.request.recordId,
      normalized.request.email,
      normalized.request.phone,
      normalized.request.name,
      normalized.request.accountSubjectId,
    ]),
    request: normalized.request,
  };
}

export function isDataRightsDiscoveryAttemptCurrent(
  attempt: DataRightsDiscoveryAttempt,
  criteria: DataRightsDiscoveryCriteria,
  generation: number,
): boolean {
  if (attempt.generation !== generation) return false;
  return attempt.fingerprint ===
    createDataRightsDiscoveryAttempt(criteria, generation).fingerprint;
}

function normalizeCriteria(criteria: DataRightsDiscoveryCriteria): {
  caseId: string;
  caseVersion: number;
  scopeKind: "guest" | "staff";
  lookupKind: DataRightsDiscoveryLookupKind;
  request: DataRightsDiscoveryRequest;
} {
  const scopeKind = criteria.scopeKind;
  const ownerKey = scopeKind === "staff" ? "staff" : criteria.ownerKey;
  const lookupKind = normalizeLookupKind(
    scopeKind,
    ownerKey,
    criteria.lookupKind,
  );
  const lookup = criteria.lookup.trim();
  const name = scopeKind === "guest" && ownerKey !== "ingestion"
    ? criteria.name.trim() || null
    : null;

  return {
    caseId: criteria.caseId.trim().toLowerCase(),
    caseVersion: criteria.caseVersion,
    scopeKind,
    lookupKind,
    request: {
      recordId: lookupKind === "recordId" ? lookup : null,
      email: lookupKind === "email" ? lookup : null,
      phone: lookupKind === "phone" ? lookup : null,
      name,
      dateOfBirth: null,
      accountSubjectId: lookupKind === "accountSubjectId" ? lookup : null,
      ownerKey,
    },
  };
}

function normalizeLookupKind(
  scopeKind: "guest" | "staff",
  ownerKey: DataRightsDiscoveryOwner,
  lookupKind: DataRightsDiscoveryLookupKind,
): DataRightsDiscoveryLookupKind {
  if (ownerKey === "ingestion") return "recordId";
  if (scopeKind === "staff") {
    return lookupKind === "accountSubjectId" ? lookupKind : "recordId";
  }
  return lookupKind === "email" || lookupKind === "phone"
    ? lookupKind
    : "recordId";
}
