import type {
  CreateManualBlockGroupRequest,
  ManualBlockListResponse,
  ManualBlockGroup,
  ManualBlockGroupListResponse,
  ManualBlockGroupMemberListResponse,
  ManualBlockGroupMutationReceipt,
  ManualBlockGroupOperation,
  ManualBlockGroupOperationKind,
  ManualBlockGroupSelectionPreview,
  ManualBlockGroupStatus,
  PreviewManualBlockGroupRequest,
  ReleaseManualBlockGroupRequest,
  ReplaceManualBlockGroupRequest,
  RoomInventory,
  RoomInventoryListResponse,
} from "../../api/types";
import { ApiError } from "../../api/client";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const PAGE_SIZE = 100;
export const MANUAL_BLOCK_GROUP_PAGE_SIZE = 50;

export const manualBlockGroupStatuses = {
  unknown: 0,
  active: 1,
  partiallyReleased: 2,
  released: 3,
  replaced: 4,
} as const satisfies Record<string, ManualBlockGroupStatus>;

export const manualBlockGroupOperationKinds = {
  unknown: 0,
  create: 1,
  replace: 2,
  release: 3,
} as const satisfies Record<string, ManualBlockGroupOperationKind>;

type ManualBlockGroupRecoveryExpectation = {
  propertyId: string;
  requestedBlockGroupId: string | null;
  kind: ManualBlockGroupOperationKind;
};

export async function loadAllRoomInventory(
  request: ApiRequest,
  propertyId: string,
  signal?: AbortSignal,
): Promise<RoomInventoryListResponse> {
  const rooms: RoomInventory[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<RoomInventoryListResponse>(
      `/api/inventory/properties/${propertyId}/rooms?page=${page}&pageSize=${PAGE_SIZE}`,
      noStore({ signal }),
    );
    rooms.push(...response.rooms);
    if (!response.hasMore) break;
  }

  return { rooms, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}

export async function loadAllManualInventoryBlocks(
  request: ApiRequest,
  propertyId: string,
  includeReleased: boolean,
  signal?: AbortSignal,
): Promise<ManualBlockListResponse> {
  const blocks: ManualBlockListResponse["blocks"] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<ManualBlockListResponse>(
      `/api/inventory/properties/${propertyId}/blocks?includeReleased=${includeReleased}&page=${page}&pageSize=${PAGE_SIZE}`,
      noStore({ signal }),
    );
    blocks.push(...response.blocks);
    if (!response.hasMore) break;
  }

  return { blocks, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}

export function loadManualBlockGroupPage(
  request: ApiRequest,
  propertyId: string,
  status: ManualBlockGroupStatus | null,
  cursor: string | null,
  signal?: AbortSignal,
  pageSize = MANUAL_BLOCK_GROUP_PAGE_SIZE,
): Promise<ManualBlockGroupListResponse> {
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (status !== null) query.set("status", String(status));
  if (cursor) query.set("cursor", cursor);
  return request<ManualBlockGroupListResponse>(
    `/api/inventory/properties/${propertyId}/block-groups?${query}`,
    noStore({ signal }),
  );
}

export function loadManualBlockGroupMemberPage(
  request: ApiRequest,
  propertyId: string,
  blockGroupId: string,
  cursor: string | null,
  signal?: AbortSignal,
  pageSize = MANUAL_BLOCK_GROUP_PAGE_SIZE,
): Promise<ManualBlockGroupMemberListResponse> {
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (cursor) query.set("cursor", cursor);
  return request<ManualBlockGroupMemberListResponse>(
    `/api/inventory/properties/${propertyId}/block-groups/${blockGroupId}/members?${query}`,
    noStore({ signal }),
  );
}

export function previewManualBlockGroup(
  request: ApiRequest,
  propertyId: string,
  body: PreviewManualBlockGroupRequest,
  signal?: AbortSignal,
): Promise<ManualBlockGroupSelectionPreview> {
  return request<ManualBlockGroupSelectionPreview>(
    `/api/inventory/properties/${propertyId}/block-groups/preview`,
    noStoreJson("POST", body, signal),
  );
}

export function getManualBlockGroup(
  request: ApiRequest,
  propertyId: string,
  blockGroupId: string,
  signal?: AbortSignal,
): Promise<ManualBlockGroup> {
  return request<ManualBlockGroup>(
    `/api/inventory/properties/${propertyId}/block-groups/${blockGroupId}`,
    noStore({ signal }),
  );
}

export function createManualBlockGroup(
  request: ApiRequest,
  propertyId: string,
  body: CreateManualBlockGroupRequest,
): Promise<ManualBlockGroupMutationReceipt> {
  return executeRecoverableBlockGroupMutation(
    request,
    `/api/inventory/properties/${propertyId}/block-groups`,
    "POST",
    body,
    `/api/inventory/properties/${propertyId}/block-group-create-operations/${body.operationId}`,
    {
      propertyId,
      requestedBlockGroupId: null,
      kind: manualBlockGroupOperationKinds.create,
    },
  );
}

export function replaceManualBlockGroup(
  request: ApiRequest,
  propertyId: string,
  blockGroupId: string,
  body: ReplaceManualBlockGroupRequest,
): Promise<ManualBlockGroupMutationReceipt> {
  return executeRecoverableBlockGroupMutation(
    request,
    `/api/inventory/properties/${propertyId}/block-groups/${blockGroupId}`,
    "PUT",
    body,
    `/api/inventory/properties/${propertyId}/block-groups/${blockGroupId}/operations/${body.operationId}`,
    {
      propertyId,
      requestedBlockGroupId: blockGroupId,
      kind: manualBlockGroupOperationKinds.replace,
    },
  );
}

export function releaseManualBlockGroup(
  request: ApiRequest,
  propertyId: string,
  blockGroupId: string,
  body: ReleaseManualBlockGroupRequest,
): Promise<ManualBlockGroupMutationReceipt> {
  return executeRecoverableBlockGroupMutation(
    request,
    `/api/inventory/properties/${propertyId}/block-groups/${blockGroupId}/release`,
    "POST",
    body,
    `/api/inventory/properties/${propertyId}/block-groups/${blockGroupId}/operations/${body.operationId}`,
    {
      propertyId,
      requestedBlockGroupId: blockGroupId,
      kind: manualBlockGroupOperationKinds.release,
    },
  );
}

export async function executeRecoverableBlockGroupMutation<TBody extends object>(
  request: ApiRequest,
  mutationPath: string,
  method: "POST" | "PUT",
  body: TBody & { operationId: string },
  recoveryPath: string,
  expectation: ManualBlockGroupRecoveryExpectation,
): Promise<ManualBlockGroupMutationReceipt> {
  const serializedBody = JSON.stringify(body);
  const send = () => request<ManualBlockGroupMutationReceipt>(
    mutationPath,
    noStore({ method, body: serializedBody }),
  );

  try {
    return await send();
  } catch (initialError) {
    if (!isAmbiguousMutationFailure(initialError)) throw initialError;
    const recovered = await recoverManualBlockGroupOperation(
      request,
      recoveryPath,
      body.operationId,
      expectation,
    );
    if (recovered) return recovered.receipt;
    if (initialError instanceof ApiError && initialError.status === 429) throw initialError;

    try {
      return await send();
    } catch (retryError) {
      if (!isAmbiguousMutationFailure(retryError)) throw retryError;
      const retryRecovery = await recoverManualBlockGroupOperation(
        request,
        recoveryPath,
        body.operationId,
        expectation,
      );
      if (retryRecovery) return retryRecovery.receipt;
      throw retryError;
    }
  }
}

async function recoverManualBlockGroupOperation(
  request: ApiRequest,
  recoveryPath: string,
  expectedOperationId: string,
  expectation: ManualBlockGroupRecoveryExpectation,
): Promise<ManualBlockGroupOperation | null> {
  try {
    const operation = await request<ManualBlockGroupOperation>(recoveryPath, noStore());
    if (operation.operationId.toLocaleLowerCase() !== expectedOperationId.toLocaleLowerCase()) {
      throw new Error("The recovered inventory operation did not match the requested operation.");
    }
    if (operation.kind !== expectation.kind || operation.status !== 1) {
      throw new Error("The recovered inventory operation was not the completed requested action.");
    }
    if (!sameId(operation.propertyId, expectation.propertyId) ||
        !sameOptionalId(operation.requestedBlockGroupId, expectation.requestedBlockGroupId) ||
        !sameId(operation.receipt.propertyId, expectation.propertyId)) {
      throw new Error("The recovered inventory operation did not match the requested property and block group.");
    }
    if (expectation.kind === manualBlockGroupOperationKinds.create &&
        operation.receipt.previousBlockGroupId !== null) {
      throw new Error("The recovered inventory create receipt had unexpected predecessor lineage.");
    }
    if (expectation.kind === manualBlockGroupOperationKinds.replace &&
        !sameOptionalId(operation.receipt.previousBlockGroupId, expectation.requestedBlockGroupId)) {
      throw new Error("The recovered inventory replacement receipt did not match its predecessor.");
    }
    if (expectation.kind === manualBlockGroupOperationKinds.release &&
        (!sameId(operation.receipt.blockGroupId, expectation.requestedBlockGroupId!) ||
         !sameId(operation.receipt.resultBlockGroupId, expectation.requestedBlockGroupId!))) {
      throw new Error("The recovered inventory release receipt did not match its block group.");
    }
    return operation;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function sameId(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function sameOptionalId(left: string | null, right: string | null): boolean {
  return left === null || right === null
    ? left === right
    : sameId(left, right);
}

function isAmbiguousMutationFailure(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 408 || error.status === 429 || error.status >= 500;
}

function noStore(options: RequestInit = {}): RequestInit {
  return { ...options, cache: "no-store" };
}

function noStoreJson(method: "POST" | "PUT", body: object, signal?: AbortSignal): RequestInit {
  return noStore({ method, body: JSON.stringify(body), signal });
}
