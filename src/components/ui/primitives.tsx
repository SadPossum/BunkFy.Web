import {
  AlertCircle,
  Clock3,
  LoaderCircle,
  RotateCcw,
  SearchX,
  ServerCrash,
  ShieldX,
  WifiOff,
  X,
} from "lucide-react";
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
import { useNetworkStatus } from "../../app/networkStatus";
import {
  presentError,
  type ErrorPresentationKind,
} from "./errorPresentation";
import { modalFocusableControls, modalFocusNeedsRepair, modalIsTopmost, modalOwnsPortalFocus } from "./modalFocus";

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
    <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 break-words text-[13px] font-medium leading-5 text-base-content/65">{eyebrow}</p>}
        <h1 className="break-words font-display text-2xl font-semibold leading-[30px] text-base-content">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] leading-5 text-base-content/65">{description}</p>}
      </div>
      {action && <div className="max-w-full shrink-0 [&_.btn]:h-auto [&_.btn]:min-h-11 [&_.btn]:max-w-full [&_.btn]:gap-2 [&_.btn]:whitespace-normal [&_.btn]:py-2 [&_.btn]:text-sm [&_.btn_svg]:shrink-0">{action}</div>}
    </header>
  );
}

export function Modal({ open, title, description, children, onClose, size = "md", closeDisabled = false }: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  size?: "md" | "lg";
  closeDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const lifetimeOpen = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = closeDisabled ? () => undefined : onClose;
  const titleId = useId();
  const descriptionId = useId();
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
  const [footerCount, setFooterCount] = useState(0);
  const registerFooter = useCallback(() => {
    setFooterCount((count) => count + 1);
    return () => setFooterCount((count) => Math.max(0, count - 1));
  }, []);
  const footerContext = useMemo(() => ({ footerHost, registerFooter }), [footerHost, registerFooter]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (open && lifetimeOpen.current && dialog && modalFocusNeedsRepair(dialog, document.activeElement)) {
      dialog.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    lifetimeOpen.current = true;
    const observer = new MutationObserver(() => {
      const dialog = dialogRef.current;
      if (dialog && modalFocusNeedsRepair(dialog, document.activeElement)) dialog.focus({ preventScroll: true });
    });
    if (dialogRef.current) observer.observe(dialogRef.current, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["disabled", "hidden", "inert", "aria-hidden", "class", "style", "tabindex"],
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const dialog = dialogRef.current;
      if (!dialog || !modalIsTopmost(dialog) || modalOwnsPortalFocus(dialog, document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = modalFocusableControls(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      lifetimeOpen.current = false;
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;
  const widthClass = size === "lg" ? "max-w-4xl" : "max-w-2xl";
  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} data-bunkfy-modal>
      <div ref={dialogRef} tabIndex={-1} data-bunkfy-modal-box className={`modal-box flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${widthClass} flex-col overflow-hidden border border-base-300 p-0 shadow-2xl outline-none sm:max-h-[90vh]`}>
        <div className="z-10 flex shrink-0 items-start justify-between gap-4 border-b border-base-300 bg-base-100 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-xl font-semibold">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 max-w-2xl text-sm leading-5 text-base-content/60">{description}</p>}
          </div>
          <button type="button" className="btn btn-circle btn-ghost btn-sm shrink-0" disabled={closeDisabled} onClick={() => closeRef.current()} aria-label="Close dialog"><X size={18} /></button>
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
      <div className="modal-backdrop" onClick={() => closeRef.current()} aria-hidden="true" />
    </div>
  );
}

export function LoadingState({ label = "Loading workspace" }: { label?: string }) {
  return <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-base-content/55"><LoaderCircle className="animate-spin text-primary" size={20} />{label}</div>;
}

export function ErrorState({ error, retry, title }: { error: unknown; retry?: () => void; title?: string }) {
  const presentation = presentError(error, title);
  const remainingMs = useRetryDelay(presentation.retryAfterMs, error);
  const retryBlocked = remainingMs > 0;
  const retrySeconds = Math.max(1, Math.ceil(remainingMs / 1_000));
  const Icon = errorIcon(presentation.kind);
  const tone = errorTone(presentation.kind);
  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${tone}`}
      role="alert"
      aria-live="polite"
    >
      <Icon className="mt-0.5 shrink-0" size={19} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{presentation.title}</p>
        <p className="mt-0.5 text-sm leading-5 opacity-80">{presentation.message}</p>
        {presentation.referenceId && (
          <p className="mt-2 break-all text-xs opacity-65">
            Reference <code>{presentation.referenceId}</code>
          </p>
        )}
      </div>
      {retry && (
        <button
          type="button"
          className="btn btn-ghost btn-sm col-start-2 mt-1 justify-self-end sm:col-start-3 sm:row-start-1 sm:mt-0"
          disabled={retryBlocked}
          onClick={retry}
        >
          {retryBlocked ? <Clock3 size={15} /> : <RotateCcw size={15} />}
          {retryBlocked ? `Try again in ${retrySeconds}s` : "Try again"}
        </button>
      )}
    </div>
  );
}

function useRetryDelay(retryAfterMs: number | undefined, marker: unknown): number {
  const [remainingMs, setRemainingMs] = useState(retryAfterMs ?? 0);

  useEffect(() => {
    if (!retryAfterMs) {
      setRemainingMs(0);
      return;
    }

    const deadline = Date.now() + retryAfterMs;
    const update = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [marker, retryAfterMs]);

  return remainingMs;
}

function errorIcon(kind: ErrorPresentationKind) {
  if (kind === "network") return WifiOff;
  if (kind === "access" || kind === "session") return ShieldX;
  if (kind === "missing") return SearchX;
  if (kind === "rate-limit") return Clock3;
  if (kind === "temporary") return ServerCrash;
  return AlertCircle;
}

function errorTone(kind: ErrorPresentationKind): string {
  if (kind === "network") return "border-info/25 bg-info/10 text-info-content";
  if (kind === "missing") return "border-base-300 bg-base-200/70 text-base-content";
  if (kind === "rate-limit" || kind === "temporary" || kind === "conflict") {
    return "border-warning/30 bg-warning/12 text-warning-content";
  }
  return "border-error/20 bg-error/8 text-error";
}

export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center p-7 text-center sm:p-8">
      <div className="mb-4 grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
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
  const tone = normalized === "unconfirmed"
    ? "border-base-300 bg-base-200 text-base-content/65"
    : normalized.includes("cancel") || normalized.includes("retired") || normalized.includes("rejected") || normalized.includes("archived") || normalized.includes("failed") || normalized === "error" || normalized === "no-show"
    ? "border-error/20 bg-error/10 text-error"
    : normalized.includes("pending") || normalized.includes("unconfigured") || normalized.includes("needs") || normalized === "suspended" || normalized === "warning" || normalized === "blocked" || normalized === "overdue"
      ? "border-warning/35 bg-warning/20 text-warning-content"
      : normalized === "in house" || normalized === "arriving" || normalized === "departing" || normalized === "checked out" || normalized === "released"
        ? "border-secondary/20 bg-secondary/10 text-secondary"
        : normalized.includes("confirmed") || normalized === "active" || normalized === "available" || normalized === "checked in" || normalized === "configured" || normalized === "verified" || normalized === "success" || normalized === "succeeded" || normalized === "unread"
          ? surface === "dark" ? "border-success bg-success text-white" : "border-success/20 bg-success/10 text-success"
          : "border-base-300 bg-base-200 text-base-content/65";
  return <span className={`badge badge-sm h-auto min-h-5 shrink-0 whitespace-nowrap border font-semibold capitalize ${tone}`}>{normalized}</span>;
}

export function FormActions({ submitting, submitLabel, onCancel, disabled = false, cancelDisabled = false }: {
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
  disabled?: boolean;
  cancelDisabled?: boolean;
}) {
  const { isOffline } = useNetworkStatus();
  return (
    <ModalActions>
      <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onCancel} disabled={cancelDisabled}>Cancel</button>
      <button
        type="submit"
        className="btn btn-primary btn-sm min-w-28 sm:btn-md sm:min-w-36"
        disabled={submitting || disabled || isOffline}
        title={isOffline ? "Reconnect before saving changes." : undefined}
      >
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
  const { isOffline } = useNetworkStatus();

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
    return button.props.type === "submit"
      ? cloneElement(button, {
          disabled: button.props.disabled || isOffline,
          form: associatedFormId,
          title: isOffline ? "Reconnect before saving changes." : button.props.title,
        })
      : child;
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
  const { isOffline } = useNetworkStatus();
  const guardedChildren = Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== "button") return child;
    const button = child as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
    return button.props.type === "submit"
      ? cloneElement(button, {
          disabled: button.props.disabled || isOffline,
          title: isOffline ? "Reconnect before saving changes." : button.props.title,
        })
      : child;
  });
  return (
    <div className={`mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-base-300 pt-4 ${className}`}>
      {guardedChildren}
    </div>
  );
}
