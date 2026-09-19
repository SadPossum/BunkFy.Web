import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams, type SetURLSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import type { Property, PropertyMutationReceipt } from "../../api/types";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import { useSession } from "../../app/session";
import { sessionIdentityKey } from "../../app/singleFlightRefresh";
import { resolvePropertySimpleLifecycleAttempt } from "./propertyLifecycleAttempt";
import { retirementUuid } from "./topologyRetirementEditorModel";
import { propertyRetirementLayoutHref } from "./propertyRetirementRoutes";

type Evidence = { property: Property | null; permissionsCurrent: boolean; propertyCurrent: boolean; mayManage: boolean };
type Context = { context: string; instance: number };
export type PropertyRetirementInput = Context & {
  property: Property; tenantId: string; replay: boolean;
  payload: { operationId: string; confirmed: true; expectedVersion: number };
};
export function propertyRetirementAttemptCurrent(input: Context, current: Context): boolean {
  return input.context === current.context && input.instance === current.instance;
}
export function propertyRetirementAllowed(input: PropertyRetirementInput, evidence: Evidence, current: Context): boolean {
  if (!propertyRetirementAttemptCurrent(input, current) || !evidence.permissionsCurrent || !evidence.propertyCurrent || !evidence.mayManage
    || evidence.property?.propertyId !== input.property.propertyId) return false;
  return input.replay || (evidence.property.status === "active" && evidence.property.version === input.payload.expectedVersion);
}
export function propertyRetirementReceiptMatches(value: unknown, input: Pick<PropertyRetirementInput, "property" | "payload">): value is PropertyMutationReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return retirementUuid(receipt.propertyId) && receipt.propertyId === input.property.propertyId && receipt.status === "retired"
    && ["unconfigured", "enabled", "suspended"].includes(String(receipt.processingStatus))
    && receipt.processingStatus === input.property.processingStatus
    && Number.isSafeInteger(receipt.version) && receipt.version === input.payload.expectedVersion + 1 && Number(receipt.version) > 1;
}
export function propertyRetirementKnownRejection(error: unknown): boolean {
  return error instanceof ApiError && !isInsufficientAuthenticationError(error) && [400, 403, 404, 409, 423].includes(error.status);
}

export function usePropertyRetirementEditor({ property, permissionsCurrent, propertyCurrent, mayManage, competingEditor = false, refreshAuthority, routeInput }: Evidence & {
  competingEditor?: boolean; refreshAuthority: () => Promise<unknown>;
  routeInput?: { params: URLSearchParams; setParams: SetURLSearchParams };
}) {
  const { session, request } = useSession();
  const client = useQueryClient();
  const location = useLocation();
  const [routerParams, setRouterParams] = useSearchParams();
  const { params, setParams } = routeInput ?? { params: routerParams, setParams: setRouterParams };
  const context = [sessionIdentityKey(session), property?.propertyId ?? "", location.pathname].join("|");
  const routeOpen = params.get("retire") === "property" && params.get("property") === property?.propertyId;
  const current = useRef({ context, instance: 0, mounted: true }); current.current.context = context;
  const latest = useRef({ property, permissionsCurrent, propertyCurrent, mayManage, competingEditor });
  latest.current = { property, permissionsCurrent, propertyCurrent, mayManage, competingEditor };
  const refreshAccess = useRef(refreshAuthority); refreshAccess.current = refreshAuthority;
  const [target, setTarget] = useState<Property | null>(null);
  const [confirmed, setConfirmed] = useState<{ property: Property; receipt: PropertyMutationReceipt } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resume, setResume] = useState<PropertyRetirementInput | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const active = (input: Context) => current.current.mounted && propertyRetirementAttemptCurrent(input, current.current);
  async function invalidate(input: PropertyRetirementInput) {
    if (!active(input)) return;
    const p = input.property.propertyId;
    await client.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey;
      if (key[0] === "properties") return key[1] === input.tenantId;
      if (key[0] === "operational-preview") return key[1] === input.tenantId && key[2] === p;
      return key[1] === p && ["rooms", "beds", "property-processing", "inventory-rooms", "availability", "reservation-calendar", "reservation-operations"].includes(String(key[0]));
    } }).catch(() => {});
  }
  const mutation = useMutation<PropertyMutationReceipt, Error, PropertyRetirementInput>({
    mutationFn: async (input) => {
      if (!active(input) || !propertyRetirementAllowed(input, latest.current, current.current) || (!input.replay && latest.current.competingEditor)) {
        throw new Error("Current access and the exact property are required before retirement.");
      }
      const receipt = await request<PropertyMutationReceipt>(`/api/properties/${input.property.propertyId}/retire`, { method: "POST", body: JSON.stringify(input.payload) });
      if (!propertyRetirementReceiptMatches(receipt, input)) throw new Error("The response did not confirm this property retirement. Its outcome is unconfirmed; retry the same request.");
      return receipt;
    },
    onSuccess: async (receipt, input) => {
      if (!active(input) || !latest.current.mayManage) return;
      // A receipt remains successful even if directory readback fails. Close the
      // confirmation and retain the result, never offer another POST for a GET failure.
      setConfirmed({ property: input.property, receipt }); setTarget(null); setResume(null); setReviewed(false);
      setParams((previous) => { const next = new URLSearchParams(previous); if (next.get("retire") === "property") next.delete("retire"); return next; }, { replace: true });
      await invalidate(input);
    },
  });
  function reset() {
    current.current.instance += 1; mutation.reset(); setTarget(null); setConfirmed(null); setResume(null); setReviewed(false); setRefreshing(false);
  }
  useEffect(() => {
    current.current.mounted = true; reset();
    return () => { current.current.mounted = false; current.current.instance += 1; };
  }, [context]);
  useEffect(() => { if (permissionsCurrent && !mayManage) reset(); }, [permissionsCurrent, mayManage]);
  useEffect(() => {
    if (!routeOpen) {
      if (target) { current.current.instance += 1; mutation.reset(); setTarget(null); setResume(null); setReviewed(false); }
      return;
    }
    if (!target && !confirmed && !mutation.isPending && property && property.status === "active" && permissionsCurrent && propertyCurrent && mayManage && !competingEditor) {
      current.current.instance += 1; setTarget(property);
    }
  }, [context, routeOpen, permissionsCurrent, propertyCurrent, mayManage, competingEditor, property, target, confirmed, mutation.isPending]);
  const rejected = propertyRetirementKnownRejection(mutation.error);
  const authorityCurrent = permissionsCurrent && propertyCurrent && mayManage && Boolean(property);
  const canOpen = authorityCurrent && property?.status === "active" && !target && !confirmed && !mutation.isPending && !competingEditor;
  const canConfirm = Boolean(target && authorityCurrent && !competingEditor && !mutation.isPending && !mutation.error && !mutation.data
    && property?.propertyId === target.propertyId && property.status === "active" && property.version === target.version);
  const canReplay = Boolean(mutation.variables && !rejected && !confirmed && !mutation.isPending && active(mutation.variables)
    && propertyRetirementAllowed({ ...mutation.variables, replay: true }, latest.current, current.current));
  useEffect(() => {
    if (!resume || mutation.isPending) return;
    if (!active(resume)) { setResume(null); return; }
    if (propertyRetirementAllowed({ ...resume, replay: true }, latest.current, current.current)) {
      setResume(null); mutation.mutate({ ...resume, replay: true });
    }
  }, [resume, mutation.isPending, authorityCurrent]);
  return {
    context, instance: current.current.instance, property, target, confirmed, opener, mutation, busy: mutation.isPending,
    authorityCurrent, canOpen, canConfirm, canReplay, rejected, reviewed, refreshing, resumePending: Boolean(resume),
    activeRooms: mutation.error instanceof ApiError && mutation.error.code === "Properties.PropertyHasActiveRooms",
    readbackCurrent: Boolean(confirmed && propertyCurrent && property?.propertyId === confirmed.receipt.propertyId
      && property.status === "retired" && property.version >= confirmed.receipt.version),
    layoutHref: propertyRetirementLayoutHref(target?.propertyId ?? property?.propertyId ?? "", params, location.pathname),
    open: (trigger: HTMLElement) => {
      if (!canOpen || !property) return;
      reset(); opener.current = trigger;
      setParams((previous) => { const next = new URLSearchParams(previous); next.set("property", property.propertyId); next.set("retire", "property"); next.delete("retirement"); return next; });
    },
    close: () => {
      if (!mutation.isPending) {
        current.current.instance += 1; mutation.reset(); setTarget(null); setResume(null); setReviewed(false);
        setParams((previous) => { const next = new URLSearchParams(previous); if (next.get("retire") === "property") next.delete("retire"); return next; }, { replace: true });
      }
    },
    confirm: () => {
      if (!canConfirm || !target || !session || !Number.isSafeInteger(target.version) || target.version < 1 || target.version >= Number.MAX_SAFE_INTEGER) return;
      const attempt = resolvePropertySimpleLifecycleAttempt(null, "retirement", target.propertyId, target.version);
      mutation.mutate({ ...current.current, property: target, tenantId: session.tenantId, replay: false,
        payload: { operationId: attempt.operationId, confirmed: true, expectedVersion: target.version } });
    },
    retrySame: () => { if (canReplay && mutation.variables) mutation.mutate({ ...mutation.variables, replay: true }); },
    resumeAfterAuthentication: () => { if (mutation.variables && active(mutation.variables)) setResume(mutation.variables); },
    refresh: async () => {
      const captured = { ...current.current };
      if (refreshing || mutation.isPending) return;
      setRefreshing(true);
      await refreshAccess.current().catch(() => {});
      if (active(captured)) { setRefreshing(false); setReviewed(true); }
    },
    reconfirm: () => {
      if (!reviewed || !authorityCurrent || !target || !property || property.status !== "active" || property.propertyId !== target.propertyId || mutation.isPending) return;
      current.current.instance += 1; mutation.reset(); setResume(null); setReviewed(false); setTarget(property);
    },
  };
}
export type PropertyRetirementEditor = ReturnType<typeof usePropertyRetirementEditor>;
