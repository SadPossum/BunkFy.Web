import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ManualBlock, ManualBlockGroupMutationReceipt, RoomInventory } from "../../api/types";
import { useSession } from "../../app/session";
import { sessionIdentityKey } from "../../app/singleFlightRefresh";
import { buildBlockTargetOptions, type BlockTargetOption } from "./inventoryBlocking";
import { blockTargetIsCurrent, inventoryMutationAllowed, type InventoryMutationEvidence } from "./inventoryMutationAuthority";
import { manualBlockListMatchesProperty, roomInventoryMatchesProperty } from "./inventoryApi";
import { resolveManualBlockCreateAttempt, resolveManualBlockGroupReleaseAttempt, type ManualBlockMutationAttempt } from "./manualBlockMutationAttempt";
import {
  blockEditorScopeCurrent, blockReleaseTargetCurrent, makeBlockReleaseTarget, selectedBlockTargetCurrent,
  validCreateBlockPayload, validCreateBlockReceipt, type BlockEditorScope, type BlockReleaseTarget, type CreateBlockPayload,
} from "./blockEditorModel";

type CreateInput = BlockEditorScope & { payload: CreateBlockPayload; selected: BlockTargetOption };
type ReleaseInput = BlockEditorScope & { target: BlockReleaseTarget };
export type BlockEditorNotice = { action: "created" | "released"; receipt: ManualBlockGroupMutationReceipt;
  createdTarget?: BlockTargetOption; createdRange?: { arrival: string; departure: string } };

export function useManualBlockEditor(input: {
  propertyId: string;
  propertyName: string;
  rooms: RoomInventory[];
  blocks: ManualBlock[];
  mayManage: boolean;
  selectionKey?: string;
  evidence: InventoryMutationEvidence;
  onSuccess: (notice: BlockEditorNotice) => void;
}) {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const contextKey = `${sessionIdentityKey(session)}:${input.propertyId}:${input.selectionKey ?? ""}`;
  const latest = useRef(input);
  latest.current = input;
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const mounted = useRef(true);
  const sequence = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const createAttempt = useRef<ManualBlockMutationAttempt | null>(null);
  const releaseAttempt = useRef<ManualBlockMutationAttempt | null>(null);
  const [editor, setEditor] = useState<({ kind: "create" } | { kind: "release"; target: BlockReleaseTarget }) & BlockEditorScope | null>(null);
  const [notice, setNotice] = useState<BlockEditorNotice | null>(null);
  const options = useMemo(() => buildBlockTargetOptions(input.propertyName, input.rooms), [input.propertyName, input.rooms]);

  function scope(): BlockEditorScope {
    return { contextKey: currentContext.current, editorSession: sequence.current, propertyId: latest.current.propertyId };
  }
  function scopeCurrent(candidate: BlockEditorScope) {
    return mounted.current && blockEditorScopeCurrent(candidate, scope());
  }
  function authorityCurrent(action: "create-block" | "release-block") {
    const current = latest.current;
    return Boolean(current.propertyId && current.mayManage
      && roomInventoryMatchesProperty(current.rooms, current.propertyId)
      && manualBlockListMatchesProperty(current.blocks, current.propertyId)
      && inventoryMutationAllowed(action, { ...current.evidence, targetCurrent: true }));
  }
  function targetCurrent(target: BlockTargetOption) {
    return selectedBlockTargetCurrent(buildBlockTargetOptions(latest.current.propertyName, latest.current.rooms), target);
  }
  async function invalidate(propertyId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["blocks", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", propertyId] }),
    ]);
  }
  async function complete(receipt: ManualBlockGroupMutationReceipt, candidate: CreateInput | ReleaseInput, action: BlockEditorNotice["action"]) {
    await invalidate(candidate.propertyId);
    if (!scopeCurrent(candidate)) return;
    createAttempt.current = null;
    releaseAttempt.current = null;
    setEditor(null);
    const next: BlockEditorNotice = { action, receipt, ...("payload" in candidate
      ? { createdTarget: candidate.selected, createdRange: { arrival: candidate.payload.arrival, departure: candidate.payload.departure } } : {}) };
    setNotice(next);
    latest.current.onSuccess(next);
  }
  const createMutation = useMutation({
    mutationFn: async (candidate: CreateInput) => {
      requireCurrent(scopeCurrent(candidate) && authorityCurrent("create-block") && targetCurrent(candidate.selected)
        && blockTargetIsCurrent([candidate.selected], candidate.payload.target)
        && validCreateBlockPayload(candidate.payload), "Refresh access and inventory, then review the exact target, dates and reason before adding this block.");
      createAttempt.current = resolveManualBlockCreateAttempt(createAttempt.current, { propertyId: candidate.propertyId, ...candidate.payload });
      const receipt = await request<ManualBlockGroupMutationReceipt>(`/api/inventory/properties/${candidate.propertyId}/block-groups`, {
        method: "POST", body: JSON.stringify({ operationId: createAttempt.current.operationId, ...candidate.payload }),
      });
      requireCurrent(validCreateBlockReceipt(receipt, candidate.propertyId), "The block receipt could not be confirmed. Refresh to check the outcome before starting another block.");
      return receipt;
    },
    onSuccess: (receipt, candidate) => complete(receipt, candidate, "created"),
    onError: async (_error, candidate) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-rooms", candidate.propertyId] }),
        invalidate(candidate.propertyId),
      ]);
    },
  });
  const releaseMutation = useMutation({
    mutationFn: async (candidate: ReleaseInput) => {
      requireCurrent(scopeCurrent(candidate) && authorityCurrent("release-block")
        && blockReleaseTargetCurrent(latest.current.blocks, candidate.target),
      "This block group or your access changed. Refresh and review the exact group before releasing it.");
      releaseAttempt.current = resolveManualBlockGroupReleaseAttempt(releaseAttempt.current, candidate.propertyId, candidate.target.blockGroupId);
      const receipt = await request<ManualBlockGroupMutationReceipt>(`/api/inventory/properties/${candidate.propertyId}/block-groups/${candidate.target.blockGroupId}/release`, {
        method: "POST", body: JSON.stringify({ operationId: releaseAttempt.current.operationId }),
      });
      requireCurrent(receipt.propertyId === candidate.propertyId && receipt.blockGroupId === candidate.target.blockGroupId,
        "The release receipt did not match this group. Refresh to check the outcome.");
      return receipt;
    },
    onSuccess: (receipt, candidate) => complete(receipt, candidate, "released"),
    onError: (_error, candidate) => invalidate(candidate.propertyId),
  });
  const busy = createMutation.isPending || releaseMutation.isPending;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  function reset() {
    sequence.current += 1;
    createAttempt.current = null;
    releaseAttempt.current = null;
    createMutation.reset();
    releaseMutation.reset();
    setEditor(null);
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; opener.current = null; sequence.current += 1; };
  }, []);
  useEffect(() => {
    opener.current = null;
    reset();
    setNotice(null);
  }, [contextKey]);
  useEffect(() => {
    if (input.evidence.permissionsCurrent && !input.mayManage) {
      opener.current = null;
      reset();
      setNotice(null);
    }
  }, [input.evidence.permissionsCurrent, input.mayManage]);

  const visibleEditor = editor && scopeCurrent(editor) ? editor : null;
  return {
    editor: visibleEditor, options, notice, opener, busy, createMutation, releaseMutation,
    releaseGroupId: visibleEditor?.kind === "release" ? visibleEditor.target.blockGroupId : null,
    ready: authorityCurrent(visibleEditor?.kind === "release" ? "release-block" : "create-block"),
    createCanSubmit: (selected: BlockTargetOption | null) => Boolean(visibleEditor?.kind === "create"
      && authorityCurrent("create-block") && selected && targetCurrent(selected)),
    releaseCanSubmit: Boolean(visibleEditor?.kind === "release" && authorityCurrent("release-block")
      && blockReleaseTargetCurrent(input.blocks, visibleEditor.target)),
    releaseTargetCurrent: visibleEditor?.kind === "release" && blockReleaseTargetCurrent(input.blocks, visibleEditor.target),
    openCreate: (trigger: HTMLElement) => {
      if (busyRef.current || !authorityCurrent("create-block") || !options.length) return;
      reset(); opener.current = trigger; setNotice(null);
      setEditor({ kind: "create", ...scope() });
    },
    openRelease: (blockGroupId: string, label: string, detail: string, trigger: HTMLElement) => {
      if (busyRef.current || !authorityCurrent("release-block")) return;
      const target = makeBlockReleaseTarget(latest.current.blocks, blockGroupId, label, detail);
      if (!target) return;
      reset(); opener.current = trigger; setNotice(null);
      setEditor({ kind: "release", target, ...scope() });
    },
    close: () => { if (!busyRef.current) reset(); },
    create: (payload: CreateBlockPayload, selected: BlockTargetOption) => {
      if (visibleEditor?.kind !== "create" || busyRef.current) return;
      createMutation.mutate({ ...visibleEditor, payload: { ...payload, target: { ...payload.target }, reason: payload.reason.trim() }, selected });
    },
    release: () => {
      if (visibleEditor?.kind === "release" && !busyRef.current) releaseMutation.mutate(visibleEditor);
    },
    retryCreate: () => {
      const candidate = createMutation.variables;
      if (candidate && !busyRef.current && scopeCurrent(candidate)) createMutation.mutate(candidate);
    },
    retryRelease: () => {
      const candidate = releaseMutation.variables;
      if (candidate && !busyRef.current && scopeCurrent(candidate)) releaseMutation.mutate(candidate);
    },
    editCreateDraft: () => {
      if (busyRef.current) return;
      createAttempt.current = null;
      createMutation.reset();
    },
    refresh: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", input.propertyId] }),
      invalidate(input.propertyId),
    ]),
  };
}

function requireCurrent(allowed: boolean, message: string) {
  if (!allowed) throw new Error(message);
}
