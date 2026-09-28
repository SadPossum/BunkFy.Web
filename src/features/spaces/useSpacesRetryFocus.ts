import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { useNetworkStatus } from "../../app/networkStatus";

// Spaces owns the successor task; the shared source notice only owns Retry.
// Same keyboard-origin/intent pattern as Reservations, without changing other
// consumers or retaining a hidden recovery notice after success.
type NoticeId = "layout" | "availability";
type SourceState = { pending: boolean; retryable: boolean };
type NoticeState = SourceState & { active: boolean; cold?: SourceState };
type RetryLocation = { key: string; pathname: string; search: string; hash: string; effectiveSearch: string; action: string };
const locationKey = (location?: RetryLocation) => location ? JSON.stringify([
  location.key, location.pathname, location.search, location.hash, location.effectiveSearch,
]) : "";

export function useSpacesRetryFocus({ owner, location, awaitingDefaultRoom = false, enabled, current, ready, denied, notices }: {
  owner: string; enabled: boolean; current: boolean; ready: boolean; denied: boolean;
  location?: RetryLocation; awaitingDefaultRoom?: boolean;
  notices: Record<NoticeId, NoticeState>;
}) {
  const { isOffline } = useNetworkStatus();
  const surface = useRef<HTMLElement>(null);
  const layoutNotice = useRef<HTMLDivElement>(null);
  const availabilityNotice = useRef<HTMLDivElement>(null);
  const layoutFallback = useRef<HTMLDivElement>(null);
  const availabilityFallback = useRef<HTMLDivElement>(null);
  const retry = useRef<{
    owner: string; location: string; notice: NoticeId; cold: boolean; button: HTMLButtonElement; cancel: () => void;
    canonical?: { pathname: string; search: string; hash: string };
    canonicalUsed: boolean;
  } | null>(null);
  function remember(event: MouseEvent<HTMLDivElement>) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    const notice = event.currentTarget === layoutNotice.current || event.currentTarget === layoutFallback.current ? "layout"
      : event.currentTarget === availabilityNotice.current || event.currentTarget === availabilityFallback.current ? "availability" : null;
    const cold = event.currentTarget === layoutFallback.current || event.currentTarget === availabilityFallback.current;
    if (!notice || !button) return;
    const source = cold ? notices[notice].cold : notices[notice];
    // The shared cold fallback has no network props. This exact local owner
    // blocks both pointer and native keyboard activation before its callback.
    if (isOffline || source?.pending) { event.preventDefault(); event.stopPropagation(); return; }
    if (!enabled || !current || denied || !notices[notice].active || !source || event.detail !== 0 || button.disabled
      || button.getAttribute("aria-disabled") === "true" || document.activeElement !== button) return;
    retry.current?.cancel();
    const cancel = () => {
      document.removeEventListener("focusin", moved);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
      retry.current = null;
    };
    const moved = (event: FocusEvent) => { if (event.target !== button) cancel(); };
    const pointer = () => cancel();
    const key = (event: KeyboardEvent) => { if (event.key === "Tab" || event.key === "Escape") cancel(); };
    retry.current = { owner, location: locationKey(location), notice, cold, button, cancel, canonicalUsed: false };
    document.addEventListener("focusin", moved);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
  }
  function prepareDefaultRoom(roomId: string, next: URLSearchParams) {
    const intent = retry.current;
    if (!intent || intent.canonicalUsed || !location
      || intent.owner !== owner || intent.location !== locationKey(location) || !enabled || denied) return;
    const previous = new URLSearchParams(location.search);
    if (["room", "bed", "unit", "blockGroup"].some(key => previous.has(key))) return;
    previous.set("room", roomId);
    // The global source notice can recover the same no-room task as a cold
    // fallback. Its DOM slot does not change this exact one-use receipt.
    // No other canonicalization, filter, date or authority change can hitch a
    // ride. Only the caller's immediate automatic default-room REPLACE counts.
    if (previous.toString() !== next.toString() || location.effectiveSearch !== new URLSearchParams(location.search).toString()) return;
    intent.canonicalUsed = true;
    intent.canonical = { pathname: location.pathname, search: "?" + next, hash: location.hash };
  }
  useLayoutEffect(() => {
    for (const [ref, state] of [[layoutFallback, notices.layout.cold], [availabilityFallback, notices.availability.cold]] as const) {
      const button = ref.current?.querySelector("button");
      if (!button) continue;
      button.setAttribute("aria-disabled", String(isOffline || Boolean(state?.pending)));
      if (state?.pending && !isOffline) button.setAttribute("aria-busy", "true"); else button.removeAttribute("aria-busy");
      if (isOffline) button.setAttribute("title", "Reconnect before refreshing."); else button.removeAttribute("title");
    }
    const intent = retry.current;
    if (!intent) return;
    const notice = notices[intent.notice];
    if (intent.owner !== owner || !enabled || denied || !notice.active || !surface.current?.isConnected) { intent.cancel(); return; }
    if (intent.location !== locationKey(location)) {
      const receipt = intent.canonical;
      intent.canonical = undefined;
      if (!receipt || !location || location.action !== "REPLACE" || location.pathname !== receipt.pathname
        || location.search !== receipt.search || location.hash !== receipt.hash
        || location.effectiveSearch !== new URLSearchParams(receipt.search).toString()) { intent.cancel(); return; }
      intent.location = locationKey(location);
    }
    // Reconnecting refreshes the property directory independently. Keep the
    // same task's intent, but never transfer focus until authority is current.
    if (!current || isOffline || awaitingDefaultRoom || intent.canonical) return;
    const source = intent.cold ? notice.cold : notice;
    if (!source) { intent.cancel(); return; }
    if (source.pending || intent.button.isConnected) return;
    const visible = (target: HTMLElement) => target.isConnected && !target.matches(":disabled")
      && !target.closest('[hidden], [inert], [aria-hidden="true"]') && target.getClientRects().length > 0
      && getComputedStyle(target).visibility === "visible";
    if (source.retryable) {
      // A no-data retry can remove the warning during loading, then mount a
      // new Retry on another failure. Bind to the original notice slot, never
      // the first unrelated recovery button elsewhere in the workspace.
      const fallback = intent.notice === "layout" ? layoutFallback.current : availabilityFallback.current;
      const current = intent.cold && fallback?.querySelector("button") ? fallback
        : intent.notice === "layout" ? layoutNotice.current : availabilityNotice.current;
      const buttons = current?.querySelectorAll<HTMLButtonElement>("button");
      const target = buttons?.length === 1 ? buttons[0] : null;
      const shouldRestore = document.activeElement === document.body && target && visible(target)
        && target.getAttribute("aria-disabled") !== "true" && target.getAttribute("aria-busy") !== "true";
      intent.cancel();
      if (shouldRestore) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest", behavior: "instant" }); }
      return;
    }
    if (!ready) return;
    // Prefer exact selected context; Back is also truthful for an unavailable
    // requested target. In navigator mode only its search remains visible.
    const target = [
      surface.current.querySelector<HTMLElement>('#spaces-selection-inspector [data-inspector-heading]'),
      surface.current.querySelector<HTMLElement>(".spaces-room-back"),
      surface.current.querySelector<HTMLElement>('input[type="search"]'),
    ].find((candidate): candidate is HTMLElement => Boolean(candidate && visible(candidate)));
    const shouldRestore = document.activeElement === document.body && target;
    intent.cancel();
    if (shouldRestore) { target!.focus({ preventScroll: true }); target!.scrollIntoView({ block: "nearest", behavior: "instant" }); }
  });
  useLayoutEffect(() => () => retry.current?.cancel(), []);
  return { surface, layoutNotice, availabilityNotice, layoutFallback, availabilityFallback, remember, prepareDefaultRoom, isOffline };
}
