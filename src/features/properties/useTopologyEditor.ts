import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Bed, BedBatchMutationReceipt, BedMutationReceipt, Property, Room, RoomMutationReceipt } from "../../api/types";
import { useSession } from "../../app/session";
import { sessionIdentityKey } from "../../app/singleFlightRefresh";
import { resolveRoomMutationAttempt, type RoomMutationAttempt } from "./roomMutationAttempt";
import { resolveBedMutationAttempt, type BedMutationAttempt } from "./bedMutationAttempt";
import { topologyAttemptCurrent, topologyInputRejected, topologyReceiptMatches, topologyTargetAllowed, topologyVersionConflict, type TopologyEditorEvidence, type TopologyEditorTarget } from "./topologyEditorModel";

export type TopologyDraft = { name: string; buildingLabel: string; floorLabel: string } | { labels: string[] };
export type TopologyFormDraft = { count: number; labels: string[]; customize: boolean; error: string; roomDraft: { name: string; buildingLabel: string; floorLabel: string } };
type Receipt = RoomMutationReceipt | BedMutationReceipt | BedBatchMutationReceipt;
type Submission = { context: string; instance: number; target: TopologyEditorTarget; draft: TopologyDraft; attempt: RoomMutationAttempt | BedMutationAttempt; replay: boolean };

export function useTopologyEditor({ property, room, selectionKey, evidence, onSaved, onClose }: {
  property: Property | null;
  room: Room | null;
  selectionKey: string;
  evidence: TopologyEditorEvidence;
  onSaved?: (target: TopologyEditorTarget, receipt: Receipt) => void;
  onClose?: () => void;
}) {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const context = `${sessionIdentityKey(session)}:${property?.propertyId ?? ""}:${selectionKey}`;
  const current = useRef({ context, instance: 0 });
  current.current.context = context;
  const latestEvidence = useRef(evidence);
  latestEvidence.current = evidence;
  const callbacks = useRef({ onSaved, onClose });
  callbacks.current = { onSaved, onClose };
  const [target, setTarget] = useState<TopologyEditorTarget | null>(null);
  const [notice, setNotice] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  // The same exact editor can move to its missing-target fallback after refresh.
  // Retain its form values without retaining them across an editor/context reset.
  const formDraft = useRef<TopologyFormDraft | null>(null);
  const roomAttempt = useRef<RoomMutationAttempt | null>(null);
  const bedAttempt = useRef<BedMutationAttempt | null>(null);

  async function refresh(propertyId: string) {
    try {
      await Promise.all(["properties", "rooms", "beds", "inventory-rooms", "availability"].map((key) =>
        queryClient.invalidateQueries({ queryKey: key === "properties" ? [key] : [key, propertyId] }, { throwOnError: true })));
      return true;
    } catch { return false; }
  }
  const mutation = useMutation<Receipt, Error, Submission>({
    mutationFn: async (input) => {
      if (!topologyAttemptCurrent(input, current.current) || !topologyTargetAllowed(input.target, latestEvidence.current, input.replay)) {
        throw new Error("Refresh current room, bed and property access before saving this exact change.");
      }
      const { target: selected, draft, attempt } = input;
      const propertyId = selected.property.propertyId;
      let receipt: Receipt;
      if (selected.kind === "room" && "name" in draft && "expectedVersion" in attempt) {
        receipt = await request<RoomMutationReceipt>(`/api/properties/${propertyId}/rooms${selected.room ? `/${selected.room.roomId}` : ""}`, {
          method: selected.room ? "PUT" : "POST",
          body: JSON.stringify({ operationId: attempt.operationId, name: draft.name.trim(), buildingLabel: draft.buildingLabel.trim() || null, floorLabel: draft.floorLabel.trim() || null,
            ...(selected.room ? { expectedVersion: attempt.expectedVersion } : { expectedPropertyVersion: attempt.expectedVersion }) }),
        });
      } else if (selected.kind === "bed" && "labels" in draft && "expectedRoomVersion" in attempt) {
        const base = `/api/properties/${propertyId}/rooms/${selected.room.roomId}/beds`;
        receipt = await request<BedMutationReceipt | BedBatchMutationReceipt>(selected.bed ? `${base}/${selected.bed.bedId}` : `${base}/batch`, {
          method: selected.bed ? "PUT" : "POST",
          body: JSON.stringify({ operationId: attempt.operationId, expectedRoomVersion: attempt.expectedRoomVersion,
            ...(selected.bed ? { label: draft.labels[0].trim() } : { labels: draft.labels.map((label) => label.trim()) }) }),
        });
      } else throw new Error("The editor no longer matches this change. Reopen the exact room or bed.");
      if (!topologyReceiptMatches(receipt, selected, "labels" in draft ? draft.labels.length : undefined)) {
        throw new Error("The save response did not confirm the exact room or beds. Refresh the records and retry the same request; do not assume the change failed.");
      }
      return receipt;
    },
    onSuccess: async (receipt, input) => {
      // Always refresh the captured property, never the currently selected one.
      await refresh(input.target.property.propertyId);
      if (!topologyAttemptCurrent(input, current.current)) return;
      const message = input.target.kind === "room" ? input.target.room ? "Room details saved." : "Room added."
        : input.target.bed ? "Bed label saved." : `${"labels" in input.draft ? input.draft.labels.length : 0} beds added.`;
      reset();
      // This receipt is confirmed. Live scoped source notices own readback failures
      // and disappear when those sources recover; do not freeze their old state here.
      setNotice(message);
      callbacks.current.onSaved?.(input.target, receipt);
    },
  });
  function reset() {
    current.current.instance += 1;
    roomAttempt.current = null;
    bedAttempt.current = null;
    mutation.reset();
    setReviewed(false);
    formDraft.current = null;
    setTarget(null);
  }
  useEffect(() => { reset(); }, [context]);
  // A confirmed property-scoped notice survives selecting its newly created room.
  // It never crosses a property or actor boundary; opening another editor clears it.
  useEffect(() => { setNotice(""); }, [sessionIdentityKey(session), property?.propertyId]);
  useEffect(() => {
    if (!evidence.permissionsCurrent || !target) return;
    if (!(target.kind === "room" ? evidence.mayManageRooms : evidence.mayManageBeds)) reset();
  }, [evidence.permissionsCurrent, evidence.mayManageRooms, evidence.mayManageBeds]);
  function open(next: TopologyEditorTarget, trigger?: HTMLElement) {
    if (mutation.isPending || !topologyTargetAllowed(next, latestEvidence.current)) return;
    reset();
    opener.current = trigger ?? null;
    setNotice("");
    setTarget(next);
  }
  const conflict = topologyVersionConflict(mutation.error);
  const inputRejected = topologyInputRejected(mutation.error);
  const canSubmit = Boolean(target && !mutation.error && topologyTargetAllowed(target, evidence));
  const canRetry = Boolean(mutation.variables && !conflict && !inputRejected
    && topologyAttemptCurrent(mutation.variables, current.current)
    && topologyTargetAllowed(mutation.variables.target, evidence, true));
  const currentRoom = target?.room ? evidence.rooms.find((item) => item.roomId === target.room?.roomId && item.propertyId === target.property.propertyId) : undefined;
  const currentBed = target?.kind === "bed" && target.bed ? evidence.beds.find((item) => item.bedId === target.bed?.bedId && item.roomId === target.room.roomId) : undefined;
  const reviewTarget: TopologyEditorTarget | null = !target || !property ? null
    : target.kind === "room" ? (!target.room || currentRoom ? { kind: "room", property, room: currentRoom } : null)
    : currentRoom && (!target.bed || currentBed) ? { kind: "bed", property, room: currentRoom, bed: currentBed } : null;
  const canUseCurrentVersion = Boolean(reviewed && reviewTarget && topologyTargetAllowed(reviewTarget, evidence));
  return {
    context, target, notice, opener, formDraft, mutation, conflict, inputRejected, canSubmit, canRetry, canUseCurrentVersion, reviewTarget,
    instance: current.current.instance,
    mayManageRooms: evidence.mayManageRooms,
    mayManageBeds: evidence.mayManageBeds,
    busy: mutation.isPending,
    canCreateRoom: Boolean(property && topologyTargetAllowed({ kind: "room", property }, evidence)),
    canEditRoom: Boolean(property && room && topologyTargetAllowed({ kind: "room", property, room }, evidence)),
    canAddBeds: Boolean(property && room && topologyTargetAllowed({ kind: "bed", property, room }, evidence)),
    canEditBed: (bed: Bed) => Boolean(property && room && topologyTargetAllowed({ kind: "bed", property, room, bed }, evidence)),
    openRoom: (selected?: Room, trigger?: HTMLElement) => { if (property) open({ kind: "room", property, room: selected }, trigger); },
    openBeds: (bed?: Bed, trigger?: HTMLElement) => { if (property && room) open({ kind: "bed", property, room, bed }, trigger); },
    close: () => { if (mutation.isPending) return; reset(); callbacks.current.onClose?.(); },
    refresh: async () => {
      const captured = { ...current.current };
      if (property) await refresh(property.propertyId);
      if (topologyAttemptCurrent(captured, current.current)) setReviewed(true);
    },
    useCurrentVersion: () => {
      if (!canUseCurrentVersion || !reviewTarget || mutation.isPending) return;
      // Deliberate reviewed new attempt. Keep the mounted form and its draft.
      roomAttempt.current = null; bedAttempt.current = null;
      mutation.reset(); setReviewed(false); setTarget(reviewTarget);
    },
    retry: () => { if (canRetry && mutation.variables) mutation.mutate({ ...mutation.variables, replay: true }); },
    editRejectedDraft: () => {
      if (!inputRejected || mutation.isPending) return;
      roomAttempt.current = null; bedAttempt.current = null;
      mutation.reset(); setReviewed(false);
    },
    save: (draft: TopologyDraft) => {
      if (!target || !canSubmit || mutation.isPending) return;
      let attempt: RoomMutationAttempt | BedMutationAttempt;
      if (target.kind === "room" && "name" in draft) {
        attempt = roomAttempt.current = resolveRoomMutationAttempt(roomAttempt.current, { ...draft, propertyId: target.property.propertyId, roomId: target.room?.roomId, expectedVersion: target.room?.version ?? target.property.version });
      } else if (target.kind === "bed" && "labels" in draft) {
        attempt = bedAttempt.current = resolveBedMutationAttempt(bedAttempt.current, { propertyId: target.property.propertyId, roomId: target.room.roomId, bedId: target.bed?.bedId, expectedRoomVersion: target.room.version, labels: draft.labels });
      } else return;
      mutation.mutate({ ...current.current, target, draft, attempt, replay: false });
    },
  };
}

export type TopologyEditor = ReturnType<typeof useTopologyEditor>;
