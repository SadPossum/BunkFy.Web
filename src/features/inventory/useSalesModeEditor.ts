import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { RoomInventory, RoomInventoryChangeImpact, RoomInventoryMutationReceipt } from "../../api/types";
import { inventorySalesModeValue } from "../../api/labels";
import { compositeSourceCurrent, createCompositeSource } from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import { sessionIdentityKey } from "../../app/singleFlightRefresh";
import { resolveSalesModeMutationAttempt, type SalesModeMutationAttempt } from "./salesModeMutationAttempt";
import { canonicalSalesMode, salesAttemptCurrent, salesChangeAllowed, salesImpactMatches, salesKnownRejection, salesModeLabel, salesReceiptMatches, salesRoomCurrent, salesRoomEditable, type SalesMode, type SalesModeEvidence, type SalesModeTarget } from "./salesModeEditorModel";

type Target = SalesModeTarget & { originParams: string };
type Submission = { context: string; instance: number; tenantId: string; target: Target; attempt: SalesModeMutationAttempt; replay: boolean };

export function useSalesModeEditor({ evidence, selectionKey, refreshAuthority }: { evidence: SalesModeEvidence; selectionKey: string; refreshAuthority: () => Promise<unknown> }) {
  const { session, request } = useSession();
  const queryClient = useQueryClient();
  const context = `${sessionIdentityKey(session)}:${evidence.propertyId}:${selectionKey}`;
  const current = useRef({ context, instance: 0 });
  current.current.context = context;
  const latestEvidence = useRef(evidence);
  latestEvidence.current = evidence;
  const authorityRefresh = useRef(refreshAuthority);
  authorityRefresh.current = refreshAuthority;
  const [target, setTarget] = useState<Target | null>(null);
  const [notice, setNotice] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [resume, setResume] = useState<Submission | null>(null);
  const attempt = useRef<SalesModeMutationAttempt | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const currentRoom = target ? evidence.rooms.find((room) => room.propertyId === target.room.propertyId && room.roomId === target.room.roomId) : undefined;
  const mayReview = Boolean(target && salesRoomCurrent(target.room, evidence, true));
  const impactQuery = useQuery({
    queryKey: ["room-sales-mode-impact", evidence.propertyId, target?.room.roomId],
    queryFn: ({ signal }) => request<RoomInventoryChangeImpact>(`/api/inventory/properties/${evidence.propertyId}/rooms/${target!.room.roomId}/change-impact`, { signal }),
    enabled: mayReview,
    refetchInterval: mayReview ? 15_000 : false,
    refetchIntervalInBackground: false,
  });
  const impactMismatch = Boolean(target && impactQuery.data && !salesImpactMatches(impactQuery.data, target.room));
  const impactSource = createCompositeSource({
    label: "Room impact", hasData: impactQuery.data !== undefined && !impactMismatch,
    isLoading: impactQuery.isLoading, isFetching: impactQuery.isFetching,
    error: impactMismatch ? new Error("The impact response did not confirm this exact room.") : impactQuery.error,
    refetch: () => target && salesRoomCurrent(target.room, latestEvidence.current, true) ? impactQuery.refetch() : Promise.resolve(undefined),
  });
  const impact = impactMismatch ? undefined : impactQuery.data;
  const impactCurrent = compositeSourceCurrent(impactSource);
  const latestImpact = useRef({ impact, impactCurrent });
  latestImpact.current = { impact, impactCurrent };
  async function refresh(input: { propertyId: string; roomId: string; tenantId: string }, afterSave = false) {
    const keys = [["inventory-rooms", input.propertyId], ["room-sales-mode-impact", input.propertyId, input.roomId]];
    if (afterSave) keys.push(["availability", input.propertyId], ["reservation-calendar", input.propertyId], ["reservation-operations", input.propertyId], ["operational-preview", input.tenantId, input.propertyId]);
    // Read errors remain owned by current scoped source notices, not by the receipt.
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).catch(() => {});
  }
  const mutation = useMutation<RoomInventoryMutationReceipt, Error, Submission>({
    mutationFn: async (input) => {
      const allowed = input.replay ? salesRoomCurrent(input.target.room, latestEvidence.current, true)
        : salesChangeAllowed(input.target, latestEvidence.current, latestImpact.current.impact, latestImpact.current.impactCurrent);
      if (!salesAttemptCurrent(input, current.current) || !allowed) throw new Error("Current access and the exact room are required before sending this change.");
      const receipt = await request<RoomInventoryMutationReceipt>(`/api/inventory/properties/${input.target.room.propertyId}/rooms/${input.target.room.roomId}/sales-mode`, {
        method: "PUT", body: JSON.stringify({ operationId: input.attempt.operationId, salesMode: inventorySalesModeValue(input.target.salesMode as SalesMode), expectedVersion: input.attempt.expectedVersion }),
      });
      if (!salesReceiptMatches(receipt, input.target, input.attempt.expectedVersion)) throw new Error("The response did not confirm this exact selling change. Its outcome is unconfirmed; retry the same request.");
      return receipt;
    },
    onSuccess: async (_receipt, input) => {
      await refresh({ propertyId: input.target.room.propertyId, roomId: input.target.room.roomId, tenantId: input.tenantId }, true);
      if (!salesAttemptCurrent(input, current.current)) return;
      reset();
      setNotice(`${input.target.room.roomName} saved: ${salesModeLabel(input.target.salesMode).toLowerCase()}. Date availability is checked separately.`);
    },
    onError: async (_error, input) => { await refresh({ propertyId: input.target.room.propertyId, roomId: input.target.room.roomId, tenantId: input.tenantId }); },
  });
  function reset() {
    current.current.instance += 1;
    attempt.current = null;
    mutation.reset(); setTarget(null); setReviewed(false); setResume(null);
  }
  useEffect(() => { reset(); setNotice(""); }, [context]);
  useEffect(() => {
    if (evidence.permissionsCurrent && (!evidence.mayRead || !evidence.mayConfigure)) reset();
  }, [evidence.permissionsCurrent, evidence.mayRead, evidence.mayConfigure]);
  const rejected = salesKnownRejection(mutation.error);
  const canSubmit = Boolean(target && !mutation.error && salesChangeAllowed(target, evidence, impact, impactCurrent));
  const canRetry = Boolean(mutation.variables && !rejected && salesAttemptCurrent(mutation.variables, current.current) && salesRoomCurrent(mutation.variables.target.room, evidence, true));
  const reviewTarget = target && currentRoom ? { ...target, room: currentRoom } : null;
  const canUseCurrent = Boolean(reviewed && reviewTarget && salesRoomEditable(reviewTarget.room, evidence) && impactCurrent && salesImpactMatches(impact, reviewTarget.room));
  useEffect(() => {
    if (!resume || mutation.isPending) return;
    if (!salesAttemptCurrent(resume, current.current)) { setResume(null); return; }
    if (salesRoomCurrent(resume.target.room, evidence, true)) {
      setResume(null); mutation.mutate({ ...resume, replay: true });
    }
  }, [resume, evidence.permissionsCurrent, evidence.propertyCurrent, evidence.inventoryCurrent, evidence.mayRead, evidence.mayConfigure, evidence.rooms, mutation.isPending]);
  return {
    target, notice, opener, mutation, impact, impactSource, impactError: impactMismatch ? new Error("The impact response did not confirm this exact room.") : impactQuery.error,
    context, instance: current.current.instance, busy: mutation.isPending, rejected, canSubmit, canRetry, canUseCurrent, currentRoom, resumePending: Boolean(resume),
    canOpen: (room: RoomInventory) => salesRoomEditable(room, evidence),
    targetCurrent: Boolean(target && salesRoomCurrent(target.room, evidence)),
    roomReadCurrent: Boolean(currentRoom && evidence.inventoryCurrent && evidence.propertyCurrent && evidence.permissionsCurrent),
    open: (room: RoomInventory, trigger: HTMLElement, originParams: URLSearchParams, initialMode?: SalesMode) => {
      if (mutation.isPending || !salesRoomEditable(room, latestEvidence.current)) return;
      reset(); setNotice(""); opener.current = trigger;
      setTarget({ room, salesMode: initialMode ?? canonicalSalesMode(room.salesMode)!, originParams: originParams.toString() });
    },
    setMode: (salesMode: SalesMode) => { if (!mutation.isPending && !mutation.error && target) { attempt.current = null; setTarget({ ...target, salesMode }); } },
    close: () => { if (!mutation.isPending) reset(); },
    save: () => {
      if (!target || !canSubmit || mutation.isPending || !session) return;
      const next = attempt.current = resolveSalesModeMutationAttempt(attempt.current, { propertyId: target.room.propertyId, roomId: target.room.roomId, salesMode: target.salesMode as SalesMode, expectedVersion: target.room.version });
      mutation.mutate({ ...current.current, tenantId: session.tenantId, target, attempt: next, replay: false });
    },
    retry: () => { if (canRetry && mutation.variables && !mutation.isPending) mutation.mutate({ ...mutation.variables, replay: true }); },
    resumeAfterAuthentication: () => { if (mutation.variables && salesAttemptCurrent(mutation.variables, current.current)) setResume(mutation.variables); },
    refresh: async () => {
      if (!target || !session) return;
      const captured = { ...current.current };
      await Promise.all([authorityRefresh.current(), refresh({ propertyId: target.room.propertyId, roomId: target.room.roomId, tenantId: session.tenantId })]).catch(() => {});
      if (salesAttemptCurrent(captured, current.current)) setReviewed(true);
    },
    useCurrent: () => {
      if (!canUseCurrent || !reviewTarget || mutation.isPending) return;
      attempt.current = null; mutation.reset(); setResume(null); setReviewed(false); setTarget(reviewTarget);
    },
  };
}
export type SalesModeEditor = ReturnType<typeof useSalesModeEditor>;
