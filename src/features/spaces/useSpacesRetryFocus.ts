import { useLayoutEffect, useRef, type MouseEvent } from "react";

// Spaces owns the successor task; the shared source notice only owns Retry.
// Same keyboard-origin/intent pattern as Reservations, without changing other
// consumers or retaining a hidden recovery notice after success.
type NoticeId = "layout" | "availability";
type NoticeState = { active: boolean; pending: boolean; retryable: boolean };

export function useSpacesRetryFocus({ owner, enabled, ready, denied, notices }: {
  owner: string; enabled: boolean; ready: boolean; denied: boolean;
  notices: Record<NoticeId, NoticeState>;
}) {
  const surface = useRef<HTMLElement>(null);
  const layoutNotice = useRef<HTMLDivElement>(null);
  const availabilityNotice = useRef<HTMLDivElement>(null);
  const retry = useRef<{ owner: string; notice: NoticeId; button: HTMLButtonElement; cancel: () => void } | null>(null);
  function remember(event: MouseEvent<HTMLDivElement>) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    const notice = event.currentTarget === layoutNotice.current ? "layout"
      : event.currentTarget === availabilityNotice.current ? "availability" : null;
    if (!enabled || denied || !notice || !notices[notice].active || notices[notice].pending || event.detail !== 0 || !button || button.disabled
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
    const key = (event: KeyboardEvent) => { if (event.key === "Tab") cancel(); };
    retry.current = { owner, notice, button, cancel };
    document.addEventListener("focusin", moved);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
  }
  useLayoutEffect(() => {
    const intent = retry.current;
    if (!intent) return;
    const notice = notices[intent.notice];
    if (intent.owner !== owner || !enabled || denied || !notice.active || !surface.current?.isConnected) { intent.cancel(); return; }
    if (notice.pending || intent.button.isConnected) return;
    const visible = (target: HTMLElement) => target.isConnected && !target.matches(":disabled")
      && !target.closest('[hidden], [inert], [aria-hidden="true"]') && target.getClientRects().length > 0
      && getComputedStyle(target).visibility === "visible";
    if (notice.retryable) {
      // A no-data retry can remove the warning during loading, then mount a
      // new Retry on another failure. Bind to the original notice slot, never
      // the first unrelated recovery button elsewhere in the workspace.
      const current = intent.notice === "layout" ? layoutNotice.current : availabilityNotice.current;
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
  return { surface, layoutNotice, availabilityNotice, remember };
}
