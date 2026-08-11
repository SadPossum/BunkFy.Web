import { ApiError } from "../api/client";

export function isInsufficientAuthenticationError(error: unknown): boolean {
  return error instanceof ApiError &&
    error.code === "Security.InsufficientAuthentication";
}
