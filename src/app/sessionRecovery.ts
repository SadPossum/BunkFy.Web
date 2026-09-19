import { ApiError } from "../api/client";

export function refreshFailureInvalidatesSession(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
