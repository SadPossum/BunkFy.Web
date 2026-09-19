import {
  ArrowUpRight,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { StatusBadge } from "../../components/ui/primitives";
import type { OperationalPreviewSourceTone } from "./operationalPreviewSourceState";
import { ReservationAttentionIndicators } from "../reservations/ReservationAttentionIndicators";
import type { ReservationAttention } from "../reservations/reservationOperationalView";

export type OperationalPreviewAction = {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
};

export type OperationalPreviewContentModel = {
  kindLabel: string;
  title: string;
  status: string;
  icon: LucideIcon;
  iconTone: string;
  summary: string;
  details: { label: string; value: string }[];
  sourceMessage: string;
  sourceTone: OperationalPreviewSourceTone;
  actions: OperationalPreviewAction[];
  attention?: readonly ReservationAttention[];
  attentionOperatingDate?: string | null;
};

export function OperationalPreviewContent({
  headingId,
  model,
  originLabel,
  refreshLabel,
  refreshPending,
  showRefresh,
  onClose,
  onNavigate,
  onRefresh,
  reservationCommand,
  navigationPending = false,
}: {
  headingId: string;
  model: OperationalPreviewContentModel;
  originLabel: string;
  refreshLabel: string;
  refreshPending: boolean;
  showRefresh: boolean;
  onClose: () => void;
  onNavigate: (href: string) => boolean | void;
  onRefresh: () => void;
  reservationCommand?: ReactNode;
  navigationPending?: boolean;
}) {
  const Icon = model.icon;
  return (
    <div className="flex max-h-full min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-base-300 bg-base-100 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-primary">
                {model.kindLabel}
              </p>
              <span className="text-[0.68rem] text-base-content/40">{originLabel}</span>
            </div>
            <h2 id={headingId} className="mt-1 truncate font-display text-lg font-semibold">
              {model.title}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm shrink-0"
            aria-label="Close operational preview"
            aria-disabled={navigationPending}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex items-center gap-3 border-b border-base-300 px-4 py-4">
          <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${model.iconTone}`}>
            <Icon size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-5 text-base-content/70">{model.summary}</p>
          </div>
          <StatusBadge status={model.status} />
        </div>

        {model.attention && model.attention.length > 0 && <section aria-label="Needs attention" className="border-b border-warning/30 bg-warning/8 px-4 py-3">
          <p className="text-sm font-semibold">Needs attention</p>
          <ul className="mt-2 grid gap-3">
            {model.attention.map(reason => <li key={reason.key}>
              <div className="flex items-center gap-2"><ReservationAttentionIndicators reasons={[reason]} /><strong className="text-sm font-semibold">{reason.label}</strong></div>
              {reason.scheduledDate && <p className="mt-1 text-xs leading-5 text-base-content/75">Scheduled {formatAttentionDate(reason.scheduledDate)} · {reason.daysOverdue} {reason.daysOverdue === 1 ? "day" : "days"} overdue</p>}
              <p className="mt-1 text-sm leading-5 text-base-content/80">{reason.description}</p>
            </li>)}
          </ul>
          {model.attentionOperatingDate && <p className="mt-2 text-xs leading-5 text-base-content/65">Property today: {formatAttentionDate(model.attentionOperatingDate)}</p>}
        </section>}

        <dl className="divide-y divide-base-300">
          {model.details.map((detail) => (
            <div key={detail.label} className="px-4 py-3">
              <dt className="text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-base-content/40">
                {detail.label}
              </dt>
              <dd className="mt-1 text-sm font-medium leading-5">{detail.value}{detail.label === "Stay" && reservationCommand}</dd>
            </div>
          ))}
        </dl>

        {!model.details.some(detail => detail.label === "Stay") && reservationCommand && (
          <div className="px-4 pb-3">{reservationCommand}</div>
        )}

        <div
          className={`border-y px-4 py-2.5 text-xs leading-5 ${sourceToneClass(model.sourceTone)}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {model.sourceMessage}
        </div>

        {(model.actions.length > 0 || showRefresh) && (
          <div className="grid gap-2 p-4">
            {model.actions.map((action) => {
              const ActionIcon = action.icon;
              if (navigationPending) return (
                <button key={`${action.href}-${action.label}`} type="button" aria-disabled="true" className="btn btn-outline btn-sm w-full justify-between opacity-60" onClick={() => onNavigate(action.href)}>
                  <span className="inline-flex items-center gap-2"><ActionIcon size={15} />{action.label}</span><ArrowUpRight size={14} />
                </button>
              );
              return (
                <Link
                  key={`${action.href}-${action.label}`}
                  to={action.href}
                  className={`${action.primary && !reservationCommand ? "btn-primary" : "btn-outline border-base-300 text-primary"} btn btn-sm w-full justify-between`}
                  onClick={(event) => { if (onNavigate(action.href) === false) event.preventDefault(); }}
                >
                  <span className="inline-flex items-center gap-2"><ActionIcon size={15} />{action.label}</span>
                  <ArrowUpRight size={14} />
                </Link>
              );
            })}
            {showRefresh && (
              <button
                type="button"
                className="btn btn-ghost btn-sm w-full"
                data-operational-preview-refresh="true"
                disabled={refreshPending}
                onClick={onRefresh}
              >
                <RefreshCw size={15} className={refreshPending ? "animate-spin" : ""} />
                {refreshPending ? "Refreshing" : refreshLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function sourceToneClass(tone: OperationalPreviewContentModel["sourceTone"]) {
  if (tone === "current") return "border-base-300 bg-base-200/45 text-base-content/55";
  if (tone === "refreshing") return "border-info/20 bg-info/8 text-info-content";
  return "border-warning/30 bg-warning/12 text-warning-content";
}

function formatAttentionDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
