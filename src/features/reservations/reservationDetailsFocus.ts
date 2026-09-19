import { modalControlVisible, modalIsTopmost } from "../../components/ui/modalFocus";

export type ReservationDetailsFocusIntent = {
  identity: string;
  source: HTMLElement;
  modal: HTMLElement;
  cancelled: boolean;
  cancel: () => void;
};

// One explicit local transition, never an initial-open or delayed retry policy.
// A disabled/removed initiating control may hand focus to its own modal trap.
export function captureReservationDetailsFocus(area: HTMLElement | null, identity: string): ReservationDetailsFocusIntent | null {
  const source = document.activeElement;
  const modal = area?.closest<HTMLElement>("[data-bunkfy-modal-box]");
  if (!(source instanceof HTMLElement) || !area?.contains(source) || !modal?.isConnected) return null;
  const intent: ReservationDetailsFocusIntent = { identity, source, modal, cancelled: false,
    cancel: () => { intent.cancelled = true; document.removeEventListener("focusin", observeFocus); } };
  function observeFocus() {
    const active = document.activeElement;
    const handingOff = !intent.source.isConnected || intent.source.matches(":disabled");
    if (active !== source && !(handingOff && (active === modal || active === document.body))) intent.cancel();
  }
  document.addEventListener("focusin", observeFocus);
  return intent;
}

export function finishReservationDetailsFocus(intent: ReservationDetailsFocusIntent | null, target: HTMLElement | null, identity: string, authorityCurrent: boolean): boolean {
  if (!intent) return false;
  const active = document.activeElement;
  const allowed = !intent.cancelled && intent.identity === identity && authorityCurrent
    && intent.modal.isConnected && target !== null && intent.modal.contains(target)
    && target.closest("[data-bunkfy-modal-box]") === intent.modal
    && modalControlVisible(target) && modalIsTopmost(intent.modal)
    && (active === intent.source || (!intent.source.isConnected && (active === document.body || active === intent.modal)));
  intent.cancel(); // no listener survives completion, rejection or unmount
  if (!allowed || !target) return false;
  target.focus({ preventScroll: true });
  if (document.activeElement !== target || target.closest("[data-bunkfy-modal-box]") !== intent.modal || !modalControlVisible(target) || !modalIsTopmost(intent.modal)) return false;
  // Reveal only inside this modal's actual scrollport, never the page/header.
  for (let scrollport = target.parentElement; scrollport && scrollport !== intent.modal; scrollport = scrollport.parentElement) {
    if (!/^(auto|scroll)$/.test(getComputedStyle(scrollport).overflowY) || scrollport.clientHeight <= 0 || scrollport.scrollHeight <= scrollport.clientHeight) continue;
    const viewportTop = scrollport.getBoundingClientRect().top + scrollport.clientTop;
    const top = viewportTop + 8, bottom = viewportTop + scrollport.clientHeight - 8;
    const rect = target.getBoundingClientRect();
    const delta = rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
    if (delta) scrollport.scrollTop = Math.max(0, Math.min(scrollport.scrollHeight - scrollport.clientHeight, scrollport.scrollTop + delta));
    break;
  }
  return true;
}
