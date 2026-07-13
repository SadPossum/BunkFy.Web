import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-base-content sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Modal({ open, title, description, children, onClose, size = "md" }: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  size?: "md" | "lg";
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === dialogRef.current || document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  const widthClass = size === "lg" ? "max-w-4xl" : "max-w-2xl";
  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <div ref={dialogRef} tabIndex={-1} className={`modal-box max-h-[90vh] ${widthClass} overflow-y-auto border border-base-300 p-0 shadow-2xl outline-none`}>
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-base-300 bg-base-100 px-6 py-5">
          <div>
            <h2 id={titleId} className="font-display text-xl font-semibold">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-base-content/60">{description}</p>}
          </div>
          <button className="btn btn-circle btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
    </div>
  );
}

export function LoadingState({ label = "Loading workspace" }: { label?: string }) {
  return <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-base-content/55"><LoaderCircle className="animate-spin text-primary" size={20} />{label}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="alert border border-error/20 bg-error/8 text-error">
      <AlertCircle size={19} />
      <div><p className="font-semibold">We couldn’t load this</p><p className="text-sm opacity-80">{message}</p></div>
      {retry && <button className="btn btn-sm" onClick={retry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-base-300 bg-base-100 p-8 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-base-content/55">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function InitialAvatar({ name, size = "md", variant = "soft" }: {
  name?: string | null;
  size?: "sm" | "md";
  variant?: "soft" | "solid";
}) {
  const initial = name?.trim().slice(0, 1).toUpperCase() || "?";
  const sizeClass = size === "sm" ? "size-9 text-sm" : "size-10 text-sm";
  const toneClass = variant === "solid" ? "bg-secondary text-white" : "bg-secondary/15 text-secondary";
  return <span className={`grid shrink-0 place-items-center rounded-full font-bold ${sizeClass} ${toneClass}`} aria-hidden="true">{initial}</span>;
}

export function StatusBadge({ status, surface = "light" }: { status: string | number; surface?: "light" | "dark" }) {
  const normalized = String(status).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const tone = normalized.includes("confirmed") || normalized === "active" || normalized === "available" || normalized === "checked in" || normalized === "success" || normalized === "succeeded" || normalized === "unread"
    ? surface === "dark" ? "badge-success" : "bg-primary text-primary-content"
    : normalized.includes("pending") || normalized.includes("unconfigured") || normalized === "suspended" || normalized === "warning"
      ? "badge-warning"
      : normalized.includes("cancel") || normalized.includes("retired") || normalized.includes("rejected") || normalized.includes("archived") || normalized.includes("failed") || normalized === "error" || normalized === "no-show" || normalized === "checked out" || normalized === "released" || normalized === "read"
        ? "badge-ghost"
        : "badge-info";
  return <span className={`badge badge-sm border-0 font-semibold capitalize ${tone}`}>{normalized}</span>;
}

export function FormActions({ submitting, submitLabel, onCancel, disabled = false }: {
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="sticky -bottom-6 z-[1] -mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t border-base-300 bg-base-100 px-6 pb-6 pt-5">
      <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={submitting || disabled}>
        {submitting && <span className="loading loading-spinner loading-sm" />}{submitLabel}
      </button>
    </div>
  );
}
