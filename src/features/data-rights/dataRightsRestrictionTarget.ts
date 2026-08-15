import { ApiError } from "../../api/client";
import type {
  DataRightsRestrictionReleaseTarget,
  DataRightsRestrictionReleaseTargetCandidate,
} from "../../api/types";

export type DataRightsRestrictionTargetFailure =
  | "unavailable"
  | "configuration"
  | "changed"
  | "forbidden"
  | "missing"
  | "unknown";

export function dataRightsRestrictionTargetFailure(
  error: unknown,
): DataRightsRestrictionTargetFailure {
  if (!(error instanceof ApiError)) return "unknown";
  if (
    error.code === "DataRights.RestrictionOwnerUnavailable" ||
    error.code === "DataRights.RestrictionOwnerRetryRequired"
  ) return "unavailable";
  if (
    error.code === "DataRights.RestrictionOwnerCatalogInvalid" ||
    error.code === "DataRights.RestrictionReleaseTargetResultInvalid"
  ) return "configuration";
  if (
    error.code === "DataRights.RestrictionReleaseTargetStale" ||
    error.code === "DataRights.VersionConflict" ||
    error.status === 409
  ) return "changed";
  if (error.status === 403) return "forbidden";
  if (
    error.code === "DataRights.RestrictionReleaseTargetNotFound" ||
    error.status === 404
  ) return "missing";
  return "unknown";
}

export function dataRightsRestrictionTargetErrorMessage(error: unknown): string {
  const failure = dataRightsRestrictionTargetFailure(error);
  if (failure === "unavailable") {
    return "Processing-limit records are temporarily unavailable. The selected guest is still retained; try loading the records again.";
  }
  if (failure === "configuration") {
    return "Processing-limit discovery is not configured correctly. Contact a system administrator before reviewing this request.";
  }
  if (failure === "changed") {
    return "The request or selected processing limit changed. Refresh the available records and choose the current version.";
  }
  if (failure === "forbidden") {
    return "Your account cannot inspect processing limits for this request.";
  }
  if (failure === "missing") {
    return "The selected processing limit is no longer active. Choose another active record or remove the selected guest.";
  }
  return "Processing-limit records could not be loaded. Try again before reviewing this request.";
}

export function restrictionTargetMatchesCandidate(
  target: DataRightsRestrictionReleaseTarget | null,
  candidate: DataRightsRestrictionReleaseTargetCandidate,
): boolean {
  return target?.ownerOperationId === candidate.ownerOperationId &&
    target.ownerOperationVersion === candidate.ownerOperationVersion;
}

export function shortRestrictionTargetId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
}
