import type {
  AdapterConnectionCheckpointResetRequest,
  AdapterConnectionControlRequest,
} from "../../api/types";

export type ConnectionControlAction =
  | "enable"
  | "disable"
  | "reset-checkpoint"
  | "clear-schedule"
  | "configure-schedule";

export type ConnectionControlPayload = {
  propertyId: string;
  connectionId: string;
  action: ConnectionControlAction;
  expectedVersion: number;
  intervalSeconds?: number;
  maxAttempts?: number;
};

export type ConnectionControlAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveConnectionControlAttempt(
  current: ConnectionControlAttempt | null,
  payload: ConnectionControlPayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): ConnectionControlAttempt {
  const fingerprint = connectionControlFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function connectionControlFingerprint(
  payload: ConnectionControlPayload,
): string {
  const schedule = payload.action === "configure-schedule"
    ? {
        intervalSeconds: payload.intervalSeconds,
        maxAttempts: payload.maxAttempts,
      }
    : null;

  return JSON.stringify({
    propertyId: payload.propertyId.trim().toLowerCase(),
    connectionId: payload.connectionId.trim().toLowerCase(),
    action: payload.action,
    expectedVersion: payload.expectedVersion,
    schedule,
  });
}

export function createConnectionControlRequest(
  action: ConnectionControlAction,
  operationId: string,
  expectedVersion: number,
): AdapterConnectionControlRequest | AdapterConnectionCheckpointResetRequest {
  const request = { operationId, expectedVersion };
  return action === "reset-checkpoint"
    ? { ...request, confirmed: true }
    : request;
}
