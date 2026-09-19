import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createSearchParams, useLocation, useNavigate, type Location, type SetURLSearchParams } from "react-router";
import { spacesNavigationAuthorityKey, spacesRouteIsPaused, type SpacesEditorNavigationState } from "../features/spaces/spacesSectionRoute";
import { useSession } from "./session";
import { sessionIdentityKey } from "./singleFlightRefresh";
import { useWorkspace } from "./workspace";

type HeldLocation = SpacesEditorNavigationState & { authority: string; location: Location };
type State = { held: HeldLocation | null; epoch: number; collapsedRequest: string | null };
export function sameLeasedLocation(left: Location, right: Location): boolean {
  return left.pathname === right.pathname && left.hash === right.hash && !spacesRouteIsPaused(left.search, right.search);
}

export function reservationLeaseAdmissionAllowed(actor: string, params: URLSearchParams, propertyId: string): boolean {
  const reservation = params.get("reservation");
  return Boolean(actor && propertyId && reservation && /^[A-Za-z0-9._:-]{1,200}$/.test(reservation)
    && params.getAll("reservation").length === 1 && !params.has("new")
    && (!params.has("property") || (params.getAll("property").length === 1 && params.get("property") === propertyId)));
}

// One transient Spaces or selected-reservation location owner, above Routes. It never stores drafts,
// grants or request payloads. Existing controllers own those and evaluate live access.
export function useRouteNavigationLease(actor: string, selectedPropertyId: string) {
  const rawLocation = useLocation(), navigate = useNavigate();
  const rawParams = new URLSearchParams(rawLocation.search);
  const authority = JSON.stringify([actor, selectedPropertyId]);
  const admissionAllowed = rawLocation.pathname === "/reservations"
    ? reservationLeaseAdmissionAllowed(actor, rawParams, selectedPropertyId)
    : rawLocation.pathname === "/spaces" && spacesNavigationAuthorityKey(actor, rawParams, selectedPropertyId) === authority;
  const [state, setState] = useState<State>({ held: null, epoch: 0, collapsedRequest: null });
  // The browser's requested URL is never authority. Validate it only when first
  // acquiring an editor; a foreign/malformed Back remains pending until Discard.
  const held = state.held?.authority === authority ? state.held : null;
  const effectiveLocation = held?.location ?? rawLocation;
  const editorKey = `${authority}:${state.epoch}`;
  const requestKey = `${rawLocation.key}:${rawLocation.pathname}${rawLocation.search}${rawLocation.hash}`;
  const live = useRef({ state, admissionAllowed, authority, rawLocation, effectiveLocation, editorKey, requestKey, navigate });
  live.current = { state, admissionAllowed, authority, rawLocation, effectiveLocation, editorKey, requestKey, navigate };
  const lastReplace = useRef<string | null>(null);
  const commit = useCallback((next: State) => { live.current.state = next; setState(next); }, []);
  const replaceOnce = useCallback((next: Location) => {
    const current = live.current;
    if (sameLeasedLocation(current.rawLocation, next)) return;
    const writeKey = `${current.editorKey}:${current.requestKey}:${next.pathname}${next.search}${next.hash}`;
    if (lastReplace.current === writeKey) return;
    lastReplace.current = writeKey;
    current.navigate({ pathname: next.pathname, search: next.search, hash: next.hash }, { replace: true, state: next.state });
  }, []);

  const reportOwner = useCallback((owner: SpacesEditorNavigationState) => {
    const current = live.current;
    if (current.editorKey !== editorKey || !["/spaces", "/reservations"].includes(current.effectiveLocation.pathname)) return;
    const previous = current.state.held?.authority === current.authority ? current.state.held : null;
    if (owner.authorityLost) {
      if (current.state.held) {
        commit({ held: null, epoch: current.state.epoch + 1, collapsedRequest: null });
        current.editorKey = "authority-reset";
      }
      return;
    }
    if (owner.engaged) {
      if (!previous && !current.admissionAllowed) return;
      const next = { ...owner, authority: current.authority, location: previous?.location ?? current.effectiveLocation };
      if (!previous || !previous.engaged || previous.pending !== next.pending || previous.label !== next.label) commit({ ...current.state, held: next });
    } else if (previous?.engaged) {
      // Keep the canonical location rendered until the one replace is observed.
      // Clearing first would briefly mount the queued destination on Cancel/save.
      commit({ ...current.state, held: { ...previous, engaged: false, pending: false }, collapsedRequest: null });
      replaceOnce(previous.location);
    }
  }, [commit, editorKey, replaceOnce]);

  const setParams = useCallback<SetURLSearchParams>((next, options) => {
    const current = live.current;
    if (current.editorKey !== editorKey || !["/spaces", "/reservations"].includes(current.effectiveLocation.pathname)) return;
    const search = createSearchParams(typeof next === "function" ? next(new URLSearchParams(current.effectiveLocation.search)) : next).toString();
    const location = { ...current.effectiveLocation, search: search ? "?" + search : "" };
    const previous = current.state.held?.authority === current.authority ? current.state.held : null;
    if (previous) {
      current.effectiveLocation = location;
      commit({ ...current.state, held: { ...previous, location }, collapsedRequest: null });
      replaceOnce(location);
    } else current.navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, options);
  }, [commit, editorKey, replaceOnce]);
  const discard = useCallback(() => {
    const current = live.current, previous = current.state.held;
    if (current.editorKey !== editorKey || previous?.authority !== current.authority
      || !previous.engaged || previous.pending || sameLeasedLocation(previous.location, current.rawLocation)) return false;
    commit({ held: null, epoch: current.state.epoch + 1, collapsedRequest: null });
    current.editorKey = "discarded";
    return true; // existing raw destination, no push/replace/back
  }, [commit, editorKey]);
  const stay = useCallback(() => {
    const current = live.current;
    if (current.editorKey === editorKey) commit({ ...current.state, collapsedRequest: current.requestKey });
  }, [commit, editorKey]);
  const review = useCallback(() => {
    if (live.current.editorKey === editorKey) commit({ ...live.current.state, collapsedRequest: null });
  }, [commit, editorKey]);

  useEffect(() => {
    const current = live.current, previous = current.state.held;
    if (previous && (previous.authority !== current.authority
      || (!previous.engaged && sameLeasedLocation(previous.location, current.rawLocation)))) {
      commit({ ...current.state, held: null, collapsedRequest: null });
    }
  }, [authority, commit, rawLocation, state.held]);
  useLayoutEffect(() => {
    live.current.editorKey = editorKey;
    return () => { if (live.current.editorKey === editorKey) live.current.editorKey = "unmounted"; };
  }, [editorKey]);
  useEffect(() => {
    if (!held?.engaged) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [held?.engaged]);

  return { rawLocation, effectiveLocation, params: new URLSearchParams(effectiveLocation.search), rawParams,
    setParams, reportOwner, editorKey, engaged: Boolean(held?.engaged), pending: Boolean(held?.pending), ownerLabel: held?.label ?? "this task",
    paused: Boolean(held?.engaged && !sameLeasedLocation(held.location, rawLocation)), expanded: state.collapsedRequest !== requestKey,
    stay, review, discard };
}

export type RouteNavigationLease = ReturnType<typeof useRouteNavigationLease>;
const RouteNavigationLeaseContext = createContext<RouteNavigationLease | null>(null);
export function RouteNavigationLeaseProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const workspace = useWorkspace();
  const lease = useRouteNavigationLease(JSON.stringify([sessionIdentityKey(session), workspace.selectedWorkspaceId]), workspace.selectedPropertyId);
  return <RouteNavigationLeaseContext.Provider value={lease}>{children}</RouteNavigationLeaseContext.Provider>;
}
export function useCurrentRouteNavigationLease() {
  const lease = useContext(RouteNavigationLeaseContext);
  if (!lease) throw new Error("Editor navigation requires its authenticated route lease.");
  return lease;
}
