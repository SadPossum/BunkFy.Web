import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { useSession } from "../../app/session";
import { writeCalendarViewport } from "../calendar/calendarWindow";
import type {
  ManualBlock,
  ReservationListItem,
} from "../../api/types";
import {
  hasOperationalPreviewRouteParams,
  isOperationalRouteForProperty,
  operationalOriginMatchesLocation,
  operationalPreviewTriggerKey,
  parseOperationalPreviewRoute,
  withOperationalPreviewRoute,
  writeTodayQueue,
  withoutOperationalPreviewRoute,
  type OperationalPreviewRoute,
  type OperationalUnitState,
} from "./operationalPreviewRoute";

export type OperationalInventoryContext = {
  inventoryUnitId: string;
  roomId: string;
  bedId?: string;
  roomName: string;
  unitLabel: string;
  unitDetail: string;
};

export type OperationalPreviewSeed =
  | {
      kind: "reservation";
      reservation: ReservationListItem;
      inventory?: OperationalInventoryContext;
    }
  | {
      kind: "inventoryBlock";
      block: ManualBlock;
      inventory: OperationalInventoryContext;
    }
  | {
      kind: "inventoryUnit";
      inventory: OperationalInventoryContext;
      state: OperationalUnitState;
      stateReason?: string;
    };

type OpenPreviewInput = {
  route: OperationalPreviewRoute;
  seed: OperationalPreviewSeed;
  trigger: HTMLElement;
};

type OperationalPreviewContextValue = {
  activeRoute: OperationalPreviewRoute | null;
  activeSeed: OperationalPreviewSeed | null;
  activeTriggerKey: string | null;
  closePreview: () => void;
  discardPreview: () => void;
  findActiveTrigger: () => HTMLElement | null;
  openPreview: (input: OpenPreviewInput) => void;
  suppressNextFocusRestore: () => void;
};

const OperationalPreviewContext = createContext<OperationalPreviewContextValue | null>(null);

export function OperationalPreviewProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useSession();
  const authorityIdentity = JSON.stringify([
    session?.tenantId, session?.subjectId, session?.sessionId,
    session?.generation, session?.username,
  ]);
  const restoreContext = JSON.stringify([
    location.key, location.pathname, location.search, location.hash, authorityIdentity,
  ]);
  const restoreContextRef = useRef(restoreContext);
  restoreContextRef.current = restoreContext;
  const navigationState = location.state as { operationalPreviewSource?: unknown } | null;
  const previewSource = typeof navigationState?.operationalPreviewSource === "string"
    ? navigationState.operationalPreviewSource : null;
  const parsedRoute = useMemo(
    () => parseOperationalPreviewRoute(new URLSearchParams(location.search)),
    [location.search],
  );
  const hasPreviewRouteParams = useMemo(
    () => hasOperationalPreviewRouteParams(new URLSearchParams(location.search)),
    [location.search],
  );
  const activeRoute = parsedRoute && operationalOriginMatchesLocation(
    parsedRoute.origin,
    location.pathname,
    new URLSearchParams(location.search),
  ) ? parsedRoute : null;
  const activeTriggerKey = activeRoute
    ? operationalPreviewTriggerKey(activeRoute)
    : null;
  const [seedState, setSeedState] = useState<{
    key: string;
    seed: OperationalPreviewSeed;
  } | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const previousRouteRef = useRef<{
    route: OperationalPreviewRoute | null;
    authorityIdentity: string;
    source: string | null;
  } | null>(null);
  const suppressRestoreRef = useRef(false);

  useEffect(() => {
    if (!hasPreviewRouteParams || activeRoute) return;
    const next = withoutOperationalPreviewRoute(new URLSearchParams(location.search));
    navigate(
      { pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : "" },
      { replace: true },
    );
  }, [activeRoute, hasPreviewRouteParams, location.pathname, location.search, navigate]);

  const findActiveTrigger = useCallback(() => {
    if (lastTriggerRef.current?.isConnected) return lastTriggerRef.current;
    if (!activeTriggerKey) return null;
    const candidates = document.querySelectorAll<HTMLElement>(
      "[data-operational-preview-trigger]",
    );
    const matching = [...candidates].filter((candidate) =>
      candidate.dataset.operationalPreviewTrigger === activeTriggerKey);
    return matching.find(elementIsVisible) ?? matching[0] ?? null;
  }, [activeTriggerKey]);

  const openPreview = useCallback(({ route, seed, trigger }: OpenPreviewInput) => {
    if (!isOperationalRouteForProperty(route, route.selection.propertyId)) return;
    const originParams = new URLSearchParams(location.search);
    if (route.origin.surface === "calendar") {
      originParams.set("date", route.origin.date);
      originParams.set("day", route.origin.day);
      writeCalendarViewport(originParams, route.origin.viewport);
    } else if (route.origin.view === "visual") {
      originParams.set("view", "visual");
      originParams.delete("todayQueue");
    } else {
      originParams.delete("view");
      writeTodayQueue(originParams, route.origin.queue);
    }
    const next = withOperationalPreviewRoute(
      originParams,
      route,
    );
    const key = operationalPreviewTriggerKey(route);
    lastTriggerRef.current = trigger;
    setSeedState({ key, seed });
    navigate(
      { pathname: location.pathname, search: `?${next.toString()}` },
      {
        state: {
          operationalPreviewEntry: true,
          operationalPreviewSource: `${location.pathname}${location.search}`,
        },
      },
    );
  }, [location.pathname, location.search, navigate]);

  const discardPreview = useCallback(() => {
    const next = withoutOperationalPreviewRoute(new URLSearchParams(location.search));
    suppressRestoreRef.current = true;
    navigate(
      { pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : "" },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  const closePreview = useCallback(() => {
    const state = location.state as { operationalPreviewEntry?: unknown } | null;
    if (state?.operationalPreviewEntry === true && window.history.length > 1) {
      navigate(-1);
      return;
    }
    const next = withoutOperationalPreviewRoute(new URLSearchParams(location.search));
    navigate(
      { pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : "" },
      { replace: true },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  const suppressNextFocusRestore = useCallback(() => {
    suppressRestoreRef.current = true;
  }, []);

  useLayoutEffect(() => {
    const previousState = previousRouteRef.current;
    const previous = previousState?.route;
    previousRouteRef.current = { route: activeRoute, authorityIdentity, source: previewSource };
    if (!previous || activeRoute) return;

    const shouldSuppress = suppressRestoreRef.current;
    suppressRestoreRef.current = false;
    if (shouldSuppress) return;
    const params = new URLSearchParams(location.search);
    // A panned Calendar's source dates can differ from the clicked stay's origin.
    const sourceMatches = previousState.source !== null
      ? previousState.source === `${location.pathname}${location.search}`
      : operationalOriginMatchesLocation(previous.origin, location.pathname, params);
    if (previousState.authorityIdentity !== authorityIdentity
      || !sourceMatches
      || (params.has("property") && params.get("property") !== previous.selection.propertyId)) return;

    let finished = false;
    let animationFrame = 0;
    let fallbackTimer = 0;
    let deadlineTimer = 0;
    let observer: MutationObserver | null = null;
    let stableFrames = 0;
    let restoringFocus = false;
    let restoredTrigger: HTMLElement | null = null;
    const deadlineAt = Date.now() + 10_000;

    const stop = () => {
      if (finished) return;
      finished = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      if (deadlineTimer) window.clearTimeout(deadlineTimer);
      observer?.disconnect();
      document.removeEventListener("focusin", onFocusMoved);
    };

    const onFocusMoved = () => {
      if (!restoringFocus && operatorMovedFocus()) stop();
    };
    const operatorMovedFocus = () => {
      const focused = document.activeElement as HTMLElement | null;
      return Boolean(focused && focused.isConnected && focused !== restoredTrigger
        && focused !== document.body && focused.id !== "main-content"
        && focused.id !== "operational-preview" && !focused.closest("#operational-preview"));
    };
    const findExactTrigger = () => {
      const retained = lastTriggerRef.current;
      const trigger = retained?.isConnected && elementIsVisible(retained)
        && retained.dataset.operationalPreviewTrigger === operationalPreviewTriggerKey(previous)
        ? retained : findTriggerForRoute(previous);
      return trigger && elementIsVisible(trigger) ? trigger : null;
    };
    const restoreExactTrigger = (confirmStability = true) => {
      if (finished) return true;
      if (Date.now() >= deadlineAt
        || restoreContextRef.current !== restoreContext || operatorMovedFocus()) {
        stop();
        return true;
      }
      const focused = document.activeElement as HTMLElement | null;
      const trigger = findExactTrigger();
      if (trigger) {
        if (focused === trigger) {
          if (confirmStability) stableFrames += 1;
          if (stableFrames >= 2) {
            stop();
            return true;
          }
          return false;
        }
        stableFrames = 0;
        restoredTrigger = trigger;
        restoringFocus = true;
        trigger.scrollIntoView({ block: "nearest", inline: "nearest" });
        trigger.focus({ preventScroll: true });
        restoringFocus = false;
        return false;
      }
      stableFrames = 0;
      return false;
    };

    if (restoreExactTrigger()) return;

    document.addEventListener("focusin", onFocusMoved);
    observer = new MutationObserver(() => {
      restoreExactTrigger(false);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const restoreAfterCommit = () => {
      if (finished) return;
      restoreExactTrigger();
      if (!finished) animationFrame = window.requestAnimationFrame(restoreAfterCommit);
    };
    animationFrame = window.requestAnimationFrame(restoreAfterCommit);
    fallbackTimer = window.setTimeout(() => {
      if (restoreExactTrigger()) return;
      if (!findExactTrigger()) {
        restoringFocus = true;
        document.querySelector<HTMLElement>("#main-content")?.focus({ preventScroll: true });
        restoringFocus = false;
      }
    }, 1_000);
    // MAIN is promptly accessible while a same-context Calendar trigger remounts.
    // Deliberate focus wins immediately; this observation never outlives ten seconds.
    deadlineTimer = window.setTimeout(stop, 10_000);

    return stop;
  }, [activeRoute, authorityIdentity, location.pathname, location.search, previewSource, restoreContext]);

  useEffect(() => {
    if (!activeRoute || !activeTriggerKey) return;
    if (seedState?.key !== activeTriggerKey) setSeedState(null);
  }, [activeRoute, activeTriggerKey, seedState?.key]);

  const value = useMemo<OperationalPreviewContextValue>(() => ({
    activeRoute,
    activeSeed: activeTriggerKey && seedState?.key === activeTriggerKey
      ? seedState.seed
      : null,
    activeTriggerKey,
    closePreview,
    discardPreview,
    findActiveTrigger,
    openPreview,
    suppressNextFocusRestore,
  }), [
    activeRoute,
    activeTriggerKey,
    closePreview,
    discardPreview,
    findActiveTrigger,
    openPreview,
    seedState,
    suppressNextFocusRestore,
  ]);

  return (
    <OperationalPreviewContext.Provider value={value}>
      {children}
    </OperationalPreviewContext.Provider>
  );
}

export function useOperationalPreview() {
  const value = useContext(OperationalPreviewContext);
  if (!value) {
    throw new Error("useOperationalPreview must be used inside OperationalPreviewProvider.");
  }
  return value;
}

function findTriggerForRoute(route: OperationalPreviewRoute): HTMLElement | null {
  const key = operationalPreviewTriggerKey(route);
  const candidates = document.querySelectorAll<HTMLElement>(
    "[data-operational-preview-trigger]",
  );
  const matching = [...candidates].filter((candidate) =>
    candidate.dataset.operationalPreviewTrigger === key);
  return matching.find(elementIsVisible) ?? matching[0] ?? null;
}

function elementIsVisible(element: HTMLElement) {
  return element.getClientRects().length > 0
    && window.getComputedStyle(element).visibility !== "hidden";
}
