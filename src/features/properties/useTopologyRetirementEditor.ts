import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useSearchParams, type SetURLSearchParams } from "react-router";
import type { Bed, RetirementContext, RetirementProcessSummary, Room, TopologyRetirement } from "../../api/types";
import { useSession } from "../../app/session";
import { sessionIdentityKey } from "../../app/singleFlightRefresh";
import { LIVE_DETAIL_REFRESH_INTERVAL_MS, topologyRetirementNeedsLiveRefresh } from "../../app/liveUpdates";
import { retirementActionAllowed, retirementAttemptCurrent, retirementAuthority, retirementContextMatches, retirementKnownRejection, retirementReceiptMatches, retirementReceiptSummary, retirementReadbackState, retirementReplayAllowed, retirementUuid, type RetirementCoordinates, type RetirementEditorEvidence, type RetirementEditorTarget } from "./topologyRetirementEditorModel";
import { retirementTargetFromRoute, withRetirementTarget, withoutRetirementTarget } from "./topologyRetirementRoutes";
import { resolveTopologyRetirementCancellationAttempt, resolveTopologyRetirementRequestAttempt, resolveTopologyRetirementRetryAttempt, topologyRetirementCancellationPayload, topologyRetirementRequestPayload } from "./topologyRetirementMutationAttempt";
import { advanceRetirementObservation, refreshRetirementDependents, retirementDependentReadState, retirementObservation, type RetirementObservation } from "./topologyRetirementReadback";

type Submission = { context: string; instance: number; target: RetirementEditorTarget; tenantId: string; action: "request" | "retry" | "cancel"; processId?: string; payload: { operationId: string; expectedVersion?: number; confirmed?: true; reason?: string }; replay: boolean };

export function useTopologyRetirementEditor({ evidence, rooms, beds, selectionKey, refreshAuthority, routeInput }: {
  evidence: RetirementEditorEvidence; rooms: readonly Room[]; beds: readonly Bed[]; selectionKey: string; refreshAuthority: () => Promise<unknown>;
  routeInput?: { params: URLSearchParams; setParams: SetURLSearchParams };
}) {
  const { session, request } = useSession();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [routerParams, setRouterParams] = useSearchParams();
  const { params, setParams } = routeInput ?? { params: routerParams, setParams: setRouterParams };
  const route = retirementTargetFromRoute(params, evidence.propertyId);
  const routeKey = route ? [route.kind, route.roomId, route.bedId ?? ""].join(":") : "closed";
  const context = [sessionIdentityKey(session), evidence.propertyId, selectionKey, routeKey].join("|");
  const current = useRef({ context, instance: 0 });
  current.current.context = context;
  const latest = useRef(evidence); latest.current = evidence;
  const refreshAccess = useRef(refreshAuthority); refreshAccess.current = refreshAuthority;
  const opener = useRef<HTMLElement | null>(null);
  const label = useRef({ key: "", value: "" });
  const entityLabel = route?.kind === "bed" ? beds.find((bed) => bed.bedId === route.bedId && bed.roomId === route.roomId)?.label
    : rooms.find((room) => room.roomId === route?.roomId && room.propertyId === route.propertyId)?.name;
  if (entityLabel) label.current = { key: routeKey, value: entityLabel };
  const target: RetirementEditorTarget | null = route ? { ...route, label: entityLabel ?? (label.current.key === routeKey ? label.current.value : route.kind === "bed" ? "Selected bed" : "Selected room") } : null;
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState<RetirementProcessSummary | null>(null);
  const confirmedReadAt = useRef(-1);
  const [reviewed, setReviewed] = useState(false);
  const [resume, setResume] = useState<Submission | null>(null);
  const [startingNew, setStartingNew] = useState(false);
  const observed = useRef<RetirementObservation | null>(null);
  const [relatedContext, setRelatedContext] = useState<string | null>(null);
  const mayRead = Boolean(target && retirementAuthority(target, evidence));
  const readScope = useMemo(() => ({ tenantId: session?.tenantId ?? "", propertyId: evidence.propertyId, roomId: route?.roomId ?? "" }), [session?.tenantId, evidence.propertyId, route?.roomId]);
  const relatedReadState = useSyncExternalStore(
    useCallback((notify) => queryClient.getQueryCache().subscribe(notify), [queryClient]),
    useCallback(() => mayRead && relatedContext === context ? retirementDependentReadState(queryClient, readScope) : "current", [queryClient, readScope, mayRead, relatedContext, context]),
    () => "current" as const,
  );
  const base = target ? `/api/inventory/properties/${target.propertyId}/rooms/${target.roomId}${target.bedId ? "/beds/" + target.bedId : ""}/retirement` : "";
  const contextKey = ["retirement-context", sessionIdentityKey(session), evidence.propertyId, route?.roomId, route?.bedId];
  const contextQuery = useQuery({
    queryKey: contextKey,
    queryFn: async ({ signal }) => {
      const result = await request<RetirementContext>(base, { signal });
      if (!target || !retirementContextMatches(result, target)) throw new Error("The retirement response did not confirm this exact room or bed.");
      return result;
    },
    enabled: mayRead,
    refetchInterval: (query) => mayRead && topologyRetirementNeedsLiveRefresh(query.state.data?.process?.status) ? LIVE_DETAIL_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const data = mayRead ? contextQuery.data : undefined;
  const contextCurrent = mayRead && Boolean(data) && !contextQuery.error && !contextQuery.isFetching;
  const savedId = params.get("retirement");
  const invalidSavedId = savedId !== null && !retirementUuid(savedId);
  const receiptAwaitingRead = Boolean(confirmed && contextQuery.dataUpdatedAt === confirmedReadAt.current);
  const { older, process: freshestProcess } = retirementReadbackState(data, confirmed, receiptAwaitingRead, savedId);
  const knownQuery = useQuery({
    queryKey: ["retirement-known", sessionIdentityKey(session), evidence.propertyId, target?.kind, savedId],
    queryFn: async ({ signal }) => {
      const result = await request<TopologyRetirement>(`/api/inventory/properties/${target!.propertyId}/${target!.kind}-retirements/${savedId}`, { signal });
      if (!target || !retirementReceiptMatches(result, target, savedId!)) throw new Error("The saved process does not belong to this exact room or bed.");
      return result;
    },
    enabled: Boolean(mayRead && older && !invalidSavedId),
    refetchInterval: false,
  });
  const process = !mayRead ? null : older ? (knownQuery.data ? retirementReceiptSummary(knownQuery.data) : confirmed?.topologyChangeId === savedId ? confirmed : null)
    : freshestProcess;
  const latestRead = useRef({ data, contextCurrent, older, invalidSavedId, updatedAt: contextQuery.dataUpdatedAt }); latestRead.current = { data, contextCurrent, older, invalidSavedId, updatedAt: contextQuery.dataUpdatedAt };
  async function invalidateContext(input: Submission) {
    if (!retirementAttemptCurrent(input, current.current) || !retirementAuthority(input.target, latest.current)) return;
    const p = input.target.propertyId;
    // Receipt success is stable even if a following current-source read fails.
    await queryClient.invalidateQueries({ predicate: (query) => ["retirement-context", "retirement-known"].includes(String(query.queryKey[0])) && query.queryKey[2] === p }).catch(() => {});
  }
  async function observeTransition(input: { context: string; instance: number; target: RetirementCoordinates; tenantId: string }, summary: RetirementProcessSummary, topologyActive: boolean | null) {
    const isCurrent = () => retirementAttemptCurrent(input, current.current) && retirementAuthority(input.target, latest.current);
    if (!isCurrent()) return;
    const next = advanceRetirementObservation(observed.current, retirementObservation(input.context, input.instance, summary, topologyActive));
    observed.current = next.observation;
    if (!next.refresh) return;
    setRelatedContext(input.context);
    await refreshRetirementDependents(queryClient, { tenantId: input.tenantId, propertyId: input.target.propertyId, roomId: input.target.roomId }, isCurrent);
  }
  const mutation = useMutation<TopologyRetirement, Error, Submission>({
    mutationFn: async (input) => {
      const read = latestRead.current;
      const allowed = input.replay ? retirementReplayAllowed(input.target, latest.current, read.data, read.contextCurrent)
        : !read.older && !read.invalidSavedId && retirementActionAllowed(input.action, input.target, latest.current, read.data, read.contextCurrent);
      if (!retirementAttemptCurrent(input, current.current) || !allowed) throw new Error("Current access and the exact retirement context are required before sending this action.");
      const path = input.action === "request"
        ? `/api/inventory/properties/${input.target.propertyId}/rooms/${input.target.roomId}${input.target.bedId ? "/beds/" + input.target.bedId : ""}/retirement`
        : `/api/inventory/properties/${input.target.propertyId}/${input.target.kind}-retirements/${input.processId}/${input.action}`;
      const receipt = await request<TopologyRetirement>(path, { method: "POST", body: JSON.stringify(input.payload) });
      if (!retirementReceiptMatches(receipt, input.target, input.processId)
        || (input.action === "request" && receipt.reason.trim() !== input.payload.reason)
        || (input.action === "cancel" && receipt.cancellationReason?.trim() !== input.payload.reason)) {
        throw new Error("The response did not confirm this exact retirement action. Its outcome is unconfirmed; retry the same request.");
      }
      return receipt;
    },
    onSuccess: async (receipt, input) => {
      if (retirementAttemptCurrent(input, current.current)) {
        confirmedReadAt.current = latestRead.current.updatedAt;
        setConfirmed(retirementReceiptSummary(receipt)); setStartingNew(false); setResume(null); setReviewed(false);
        setNotice(input.action === "cancel" ? "Retirement stopped. Existing reservations and blocks are unchanged."
          : input.action === "retry" ? "Retirement retry confirmed." : "Retirement request confirmed.");
        setParams((previous) => withRetirementTarget(previous, input.target, receipt.topologyChangeId), { replace: true });
      }
      await Promise.all([observeTransition(input, retirementReceiptSummary(receipt), null), invalidateContext(input)]);
    },
    onError: async (_error, input) => { await invalidateContext(input); },
  });
  useEffect(() => {
    current.current.instance += 1; confirmedReadAt.current = -1; mutation.reset(); setConfirmed(null); setNotice(""); setReviewed(false); setResume(null); setStartingNew(false);
    observed.current = null; setRelatedContext(null);
  }, [context]);
  useEffect(() => {
    // Only the exact authoritative context owns lifecycle observation, not a
    // saved older process or a response still predating a confirmed mutation.
    if (!target || !session || !contextCurrent || receiptAwaitingRead || !data?.process) return;
    void observeTransition({ ...current.current, target, tenantId: session.tenantId }, data.process, data.isTopologyActive);
  }, [context, contextCurrent, receiptAwaitingRead, data]);
  const rejected = retirementKnownRejection(mutation.error);
  const mayReplay = Boolean(mutation.variables && !rejected && retirementAttemptCurrent(mutation.variables, current.current)
    && target && retirementReplayAllowed(target, evidence, data, contextCurrent));
  useEffect(() => {
    if (!resume || mutation.isPending) return;
    if (!retirementAttemptCurrent(resume, current.current)) { setResume(null); return; }
    if (retirementReplayAllowed(resume.target, evidence, data, contextCurrent)) { setResume(null); mutation.mutate({ ...resume, replay: true }); }
  }, [resume, mutation.isPending, contextCurrent, evidence.permissionsCurrent, evidence.propertyCurrent, evidence.mayRead, evidence.mayRetire]);
  function allowed(action: Submission["action"]) {
    return Boolean(target && !older && !invalidSavedId && retirementActionAllowed(action, target, evidence, data, contextCurrent));
  }
  function send(action: Submission["action"], reason = "") {
    if (!target || !session || mutation.isPending || mutation.error || !allowed(action)) return;
    const processId = action === "request" ? undefined : data!.process!.topologyChangeId;
    const version = data?.process?.version ?? 0;
    const input = { propertyId: target.propertyId, targetKind: target.kind, topologyChangeId: processId ?? "", expectedVersion: version, reason: reason.trim() };
    const attempt = action === "request" ? resolveTopologyRetirementRequestAttempt(null, { ...input, roomId: target.roomId, targetId: target.bedId ?? target.roomId })
      : action === "cancel" ? resolveTopologyRetirementCancellationAttempt(null, input) : resolveTopologyRetirementRetryAttempt(null, input);
    const payload = action === "request" ? topologyRetirementRequestPayload(attempt, reason)
      : action === "cancel" ? topologyRetirementCancellationPayload(attempt, version, reason) : { operationId: attempt.operationId, expectedVersion: version };
    mutation.mutate({ ...current.current, target, tenantId: session.tenantId, action, processId, payload, replay: false });
  }
  return {
    target, propertyId: evidence.propertyId, context, instance: current.current.instance, opener, mutation, busy: mutation.isPending, notice, process, data, older, startingNew,
    readPending: contextQuery.isLoading || (older && knownQuery.isLoading),
    readRefreshing: contextQuery.isFetching,
    readError: invalidSavedId ? new Error("This saved retirement link is invalid.") : contextQuery.error ?? (older ? knownQuery.error : null),
    contextCurrent, authorityCurrent: mayRead, relatedReadState, rejected, reviewed, resumePending: Boolean(resume), canReplay: mayReplay,
    canRequest: allowed("request"), canRetry: allowed("retry"), canCancel: allowed("cancel"),
    origin: { pathname: location.pathname, params },
    canOpen: (coordinates: RetirementCoordinates) => retirementAuthority(coordinates, evidence) && evidence.roomsCurrent && (coordinates.kind === "room" || evidence.bedsCurrent),
    open: (coordinates: RetirementEditorTarget, trigger: HTMLElement) => {
      if (mutation.isPending || !retirementAuthority(coordinates, latest.current)) return;
      opener.current = trigger; label.current = { key: [coordinates.kind, coordinates.roomId, coordinates.bedId ?? ""].join(":"), value: coordinates.label };
      setParams((previous) => withRetirementTarget(previous, coordinates));
    },
    close: () => { if (!mutation.isPending) setParams(withoutRetirementTarget(params)); },
    request: (reason: string) => send("request", reason),
    retryFinalization: () => send("retry"),
    stop: (reason: string) => send("cancel", reason),
    retrySame: () => { if (mayReplay && mutation.variables && !mutation.isPending) mutation.mutate({ ...mutation.variables, replay: true }); },
    resumeAfterAuthentication: () => { if (mutation.variables && retirementAttemptCurrent(mutation.variables, current.current)) setResume(mutation.variables); },
    refreshRelated: () => {
      const captured = { ...current.current };
      if (!target || !mayRead || relatedReadState === "refreshing") return;
      return refreshRetirementDependents(queryClient, readScope, () => retirementAttemptCurrent(captured, current.current) && retirementAuthority(target, latest.current));
    },
    refresh: async () => {
      const captured = { ...current.current };
      await Promise.all([refreshAccess.current(), contextQuery.refetch(), ...(older ? [knownQuery.refetch()] : [])]).catch(() => {});
      if (retirementAttemptCurrent(captured, current.current)) setReviewed(true);
    },
    reviewCurrent: () => { if (rejected && reviewed && contextCurrent && !mutation.isPending) { mutation.reset(); setReviewed(false); } },
    showCurrent: () => { if (!mutation.isPending) setParams((previous) => { const next = new URLSearchParams(previous); next.delete("retirement"); return next; }); },
    startNew: () => { if (allowed("request") && !mutation.isPending) { mutation.reset(); setStartingNew(true); setNotice(""); setParams((previous) => { const next = new URLSearchParams(previous); next.delete("retirement"); return next; }); } },
  };
}
export type TopologyRetirementEditor = ReturnType<typeof useTopologyRetirementEditor>;
