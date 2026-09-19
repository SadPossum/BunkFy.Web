import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReservationPreviewLifecycleOwner, ReservationPreviewQuickAction } from "./reservationPreviewLifecycle";

export function ReservationPreviewLifecycleAction({ action, owner, current, readAllowed, recoveryAllowed, stayLabel, onBegin, onConfirm, onCancel, onCheck, onRetry, onContinue }: {
  action: ReservationPreviewQuickAction | null;
  owner: ReservationPreviewLifecycleOwner | null;
  current: boolean;
  readAllowed: boolean;
  recoveryAllowed: boolean;
  stayLabel: string;
  onBegin: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onCheck: () => void;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const restoreIdleFocus = useRef<ReservationPreviewQuickAction | null>(null);
  const phase = owner?.phase ?? "idle";
  useLayoutEffect(() => {
    const requestedAction = restoreIdleFocus.current;
    restoreIdleFocus.current = null;
    const element = root.current;
    if (!requestedAction || phase !== "idle" || action !== requestedAction || !current || !readAllowed || !element) return;
    if (element.contains(document.activeElement) || document.activeElement === document.body) {
      element.querySelector<HTMLButtonElement>("[data-lifecycle-quick-action]:not(:disabled)")?.focus({ preventScroll: true });
    }
  }, [phase, action, current, readAllowed]);
  useEffect(() => {
    const element = root.current;
    if (!element || phase === "idle") return;
    if (element.contains(document.activeElement) || document.activeElement === document.body) {
      element.querySelector<HTMLElement>("[data-lifecycle-focus]")?.focus({ preventScroll: true });
    }
  }, [phase]);
  if (!owner && !action) return null;
  const checkIn = (owner?.intent.action ?? action) === "check-in";
  const label = checkIn ? "Check in" : "Check out";
  const pending = phase === "sending" || phase === "checking" || phase === "pending";
  const resolved = phase === "success" || phase === "rejected" || phase === "changed";
  const cancel = () => {
    restoreIdleFocus.current = owner && root.current?.contains(document.activeElement) ? owner.intent.action : null;
    onCancel();
  };
  return (
    <div ref={root} className="mt-3 text-sm font-normal" data-reservation-preview-lifecycle={phase}>
      {!owner ? <button type="button" data-lifecycle-quick-action={action} className="btn btn-primary btn-sm min-h-11 w-full" disabled={!current} onClick={onBegin}>{label}</button> : (
        <div className="rounded-lg border border-base-300 bg-base-200/50 p-3">
          <p tabIndex={-1} data-lifecycle-focus={phase !== "confirm" ? "true" : undefined} role="status" aria-live="polite" className="rounded font-medium leading-5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary">
            {phase === "confirm" ? `${label} ${stayLabel}?`
              : phase === "sending" ? `${checkIn ? "Check-in" : "Checkout"} request in progress…`
                : phase === "checking" ? "Checking the current reservation…"
                  : phase === "pending" ? "Checkout requested. Inventory release is still pending."
                    : phase === "success" ? (checkIn ? "Current reservation confirms check-in." : "Current reservation confirms checkout and inventory release.")
                      : phase === "rejected" ? "Inventory release was not completed. The stay remains in house."
                        : phase === "changed" ? "The stay or business date changed. Review the current details before trying again."
                          : "The result is unconfirmed. The original request is kept here."}
          </p>
          <p className="mt-2 text-xs leading-5 text-base-content/70">Property business date: {owner.intent.businessDate}.</p>
          {phase === "confirm" && <p className="mt-1 text-xs leading-5 text-base-content/70">{checkIn ? "Marks this guest as in house." : "Requests release of the occupied inventory; checkout completes after release."} No payment or cleaning change.</p>}
          {phase === "unknown" && <p className="mt-1 text-xs leading-5 text-base-content/70">Check the result, or retry this same operation. Closing is safe here; a full reload loses this local recovery reference.</p>}
          {phase === "rejected" && <p className="mt-1 text-xs leading-5 text-base-content/70">Review the full reservation before starting a new checkout.</p>}
          {!current && !pending && <p className="mt-2 text-xs leading-5 text-warning-content">Refresh current access and stay details before continuing.</p>}
          {owner.deferred && <p className="mt-2 text-xs leading-5 text-base-content/70">Navigation is waiting for the result. It will not happen automatically.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === "confirm" && <><button type="button" data-lifecycle-focus="true" className="btn btn-primary btn-sm min-h-11" disabled={!current} onClick={onConfirm}>Confirm {checkIn ? "check-in" : "checkout"}</button><button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={cancel}>Keep reservation</button></>}
            {phase === "unknown" && <><button type="button" className="btn btn-outline btn-sm min-h-11" disabled={!readAllowed} onClick={onCheck}>Check result</button><button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={!recoveryAllowed} onClick={onRetry}>Retry same request</button></>}
            {resolved && <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={cancel}>Done</button>}
            {resolved && owner.deferred && <button type="button" className="btn btn-outline btn-sm min-h-11" onClick={onContinue}>{owner.deferred === "close" ? "Close preview" : "Continue to selected page"}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
