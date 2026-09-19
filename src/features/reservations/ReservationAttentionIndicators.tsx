import { CircleAlert, Hourglass, LogIn, LogOut } from "lucide-react";
import type { ReservationAttention } from "./reservationOperationalView";

// Decorative children of a single reservation control, never extra tab stops.
export function ReservationAttentionIndicators({ reasons, compact = false }: { reasons: readonly ReservationAttention[]; compact?: boolean }) {
  if (!reasons.length) return null;
  const shown = compact ? reasons.slice(0, 1) : reasons.slice(0, 2);
  return <span aria-hidden="true" data-reservation-attention className="pointer-events-none inline-flex shrink-0 items-center gap-1">
    {shown.map(reason => {
      const Icon = reason.key === "arrival-overdue" ? LogIn : reason.key === "checkout-overdue" ? LogOut : reason.key === "allocation-rejected" ? CircleAlert : Hourglass;
      return <span key={reason.key} data-attention-reason={reason.key} className={`grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${reason.tone === "error" ? "border-error/50 bg-base-100 text-error" : "border-warning/60 bg-base-100 text-warning-content"}`}>
        {compact && reasons.length > 1 ? reasons.length : <Icon size={13} strokeWidth={2} />}
      </span>;
    })}
    {!compact && reasons.length > 2 && <span className="text-[11px] font-semibold">+{reasons.length - 2}</span>}
  </span>;
}
