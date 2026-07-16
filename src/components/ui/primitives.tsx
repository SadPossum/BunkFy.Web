import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { ApiError } from "../../api/client";

type ModalFooterContextValue = {
  footerHost: HTMLDivElement | null;
  registerFooter: () => () => void;
};

const ModalFooterContext = createContext<ModalFooterContextValue | null>(null);

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
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
  const [footerCount, setFooterCount] = useState(0);
  const registerFooter = useCallback(() => {
    setFooterCount((count) => count + 1);
    return () => setFooterCount((count) => Math.max(0, count - 1));
  }, []);
  const footerContext = useMemo(() => ({ footerHost, registerFooter }), [footerHost, registerFooter]);

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
      <div ref={dialogRef} tabIndex={-1} className={`modal-box flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${widthClass} flex-col overflow-hidden border border-base-300 p-0 shadow-2xl outline-none sm:max-h-[90vh]`}>
        <div className="z-10 flex shrink-0 items-start justify-between gap-4 border-b border-base-300 bg-base-100 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-xl font-semibold">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 max-w-2xl text-sm leading-5 text-base-content/60">{description}</p>}
          </div>
          <button type="button" className="btn btn-circle btn-ghost btn-sm shrink-0" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </div>
        <ModalFooterContext.Provider value={footerContext}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
          <div
            ref={setFooterHost}
            className={footerCount > 0
              ? "z-20 shrink-0 border-t border-base-300 bg-base-100 px-4 py-3 shadow-[0_-10px_24px_-18px_rgba(13,35,29,0.35)] sm:px-6 sm:py-4"
              : "hidden"}
          />
        </ModalFooterContext.Provider>
      </div>
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
    </div>
  );
}

export function LoadingState({ label = "Loading workspace" }: { label?: string }) {
  return <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-base-content/55"><LoaderCircle className="animate-spin text-primary" size={20} />{label}</div>;
}

export function ErrorState({ error, retry, title = "Something went wrong" }: { error: unknown; retry?: () => void; title?: string }) {
  const message = friendlyErrorMessage(error);
  return (
    <div className="alert border border-error/20 bg-error/8 text-error">
      <AlertCircle size={19} />
      <div><p className="font-semibold">{title}</p><p className="text-sm opacity-80">{message}</p></div>
      {retry && <button className="btn btn-sm" onClick={retry}>Try again</button>}
    </div>
  );
}

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "Organizations.MembershipConflict") return "You already belong to this workspace.";
    if (error.status === 403) return "Your account does not have access to this action.";
    if (error.status === 404) return "The requested item is no longer available.";
  }

  const message = error instanceof Error ? error.message : "Please try again.";
  return message
    .replace(/\bthe subject\b/gi, "this account")
    .replace(/\bsubject\b/gi, "account");
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
  const tone = normalized.includes("confirmed") || normalized === "active" || normalized === "available" || normalized === "checked in" || normalized === "configured" || normalized === "verified" || normalized === "success" || normalized === "succeeded" || normalized === "unread"
    ? surface === "dark" ? "bg-success text-white" : "bg-primary text-white"
    : normalized.includes("pending") || normalized.includes("unconfigured") || normalized === "suspended" || normalized === "warning"
      ? "bg-warning-content text-white"
      : normalized.includes("cancel") || normalized.includes("retired") || normalized.includes("rejected") || normalized.includes("archived") || normalized.includes("failed") || normalized === "error" || normalized === "no-show" || normalized === "checked out" || normalized === "released" || normalized === "read"
        ? "badge-ghost"
        : "bg-info-content text-white";
  return <span className={`badge badge-sm border-0 font-semibold capitalize ${tone}`}>{normalized}</span>;
}

export function FormActions({ submitting, submitLabel, onCancel, disabled = false }: {
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <ModalActions>
      <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn btn-primary btn-sm min-w-28 sm:btn-md sm:min-w-36" disabled={submitting || disabled}>
        {submitting && <span className="loading loading-spinner loading-sm" />}{submitLabel}
      </button>
    </ModalActions>
  );
}

export function ModalActions({ children, className = "" }: { children: ReactNode; className?: string }) {
  const footerContext = useContext(ModalFooterContext);
  const markerRef = useRef<HTMLSpanElement>(null);
  const generatedFormId = useId();
  const [associatedFormId, setAssociatedFormId] = useState<string | null>(null);

  useEffect(() => footerContext?.registerFooter(), [footerContext?.registerFooter]);

  useLayoutEffect(() => {
    const form = markerRef.current?.closest("form");
    if (!form) {
      setAssociatedFormId(null);
      return;
    }

    if (!form.id) form.id = `modal-form-${generatedFormId.replaceAll(":", "")}`;
    setAssociatedFormId(form.id);
  }, [generatedFormId]);

  if (!footerContext) {
    return <div className={`mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-base-300 pt-4 ${className}`}>{children}</div>;
  }

  const associatedChildren = Children.map(children, (child) => {
    if (!associatedFormId || !isValidElement(child) || child.type !== "button") return child;
    const button = child as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
    return button.props.type === "submit" ? cloneElement(button, { form: associatedFormId }) : child;
  });

  return (
    <>
      <span ref={markerRef} className="hidden" aria-hidden="true" />
      {footerContext.footerHost && createPortal(
        <div className={`flex min-h-10 w-full flex-wrap items-center justify-end gap-2 sm:gap-3 ${className}`}>
          {associatedChildren}
        </div>,
        footerContext.footerHost,
      )}
    </>
  );
}

export function InlineFormActions({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-base-300 pt-4 ${className}`}>
      {children}
    </div>
  );
}
