import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Modal } from "../../components/ui/primitives";

export function PropertyEditorFrame({ open, inline, title, description, onClose, children, opener, feedback }: {
  open: boolean;
  inline?: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  opener?: RefObject<HTMLElement | null>;
  feedback?: unknown;
}) {
  const headingId = useId();
  const element = useRef<HTMLElement>(null);
  const modalReturn = useRef<{
    trigger: HTMLElement | null;
    openerValue: HTMLElement | null | undefined;
    heading: HTMLElement | null;
    headingText: string | null;
    ownerRoute: string;
  } | null>(null);
  useLayoutEffect(() => {
    if (!open || inline) return;
    // Legacy callers do not supply a trigger. Capture it before Modal's
    // passive effect moves focus into the dialog; do not change Modal itself.
    const heading = document.querySelector<HTMLElement>("[data-property-retirement-heading]");
    modalReturn.current = {
      trigger: opener?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
      openerValue: opener?.current,
      heading,
      headingText: heading?.textContent ?? null,
      ownerRoute: propertyOwnerRoute(),
    };
  }, [open, inline, opener]);
  useEffect(() => {
    if (!open || inline) return;
    const captured = modalReturn.current;
    return () => { requestAnimationFrame(() => {
      if (!captured || modalReturn.current !== captured || opener?.current !== captured.openerValue) return;
      if (document.activeElement === document.body && !visible(captured.trigger)
        && propertyOwnerRoute() === captured.ownerRoute
        && captured.heading === document.querySelector("[data-property-retirement-heading]")
        && captured.heading?.textContent === captured.headingText && visible(captured.heading)) {
        captured.heading?.focus();
        captured.heading?.scrollIntoView({ block: "nearest" });
      }
      if (opener && opener.current === captured.openerValue) opener.current = null;
      modalReturn.current = null;
    }); };
  }, [open, inline, opener]);
  useEffect(() => {
    if (!open || !inline) return;
    const trigger = opener?.current;
    const control = element.current?.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled), button[aria-haspopup]:not(:disabled), select:not(:disabled), textarea:not(:disabled)");
    (control ?? element.current)?.focus();
    return () => {
      // Mutation settlement can enable the trigger after the form disappears.
      requestAnimationFrame(() => {
        if (opener && opener.current !== trigger) return;
        if (document.activeElement === document.body || document.activeElement === trigger) {
          const visible = (node: HTMLElement | null | undefined) => Boolean(node?.isConnected && node.getClientRects().length && !node.matches(":disabled") && !node.closest("[inert]"));
          const fallback = document.querySelector<HTMLElement>("[data-property-retirement-heading]");
          const destination = visible(trigger) ? trigger : visible(fallback) ? fallback : null;
          destination?.focus();
        }
        if (opener && opener.current === trigger) opener.current = null;
      });
    };
  }, [open, inline, opener]);
  useEffect(() => {
    if (!open || !inline || !feedback || document.activeElement !== document.body) return;
    const message = element.current?.querySelector<HTMLElement>('[role="alert"]');
    const target = message ?? element.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? element.current;
    if (message && !message.hasAttribute("tabindex")) message.tabIndex = -1;
    target?.focus();
  }, [open, inline, feedback]);
  if (!inline) return <Modal open={open} title={title} description={description} onClose={onClose}>{children}</Modal>;
  if (!open) return null;
  return <section ref={element} tabIndex={-1} aria-labelledby={headingId} className="border-t border-base-300 bg-base-200/25 p-4 outline-offset-[-3px] sm:p-5"
    onFocusCapture={(event) => {
      const node = event.target;
      const region = element.current;
      requestAnimationFrame(() => {
        if (!node.isConnected || document.activeElement !== node || node === region || region !== element.current || !region?.contains(node)) return;
        const footer = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
        if (!footer?.getClientRects().length) return;
        const bounds = node.getBoundingClientRect();
        const top = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0;
        if (bounds.bottom <= footer.getBoundingClientRect().top - 12 && bounds.top >= top + 12) return;
        // Match established inline-editor clearance without changing global CSS.
        const previousMargin = node.style.scrollMarginBlock;
        node.style.scrollMarginBlock = "5rem calc(5rem + env(safe-area-inset-bottom))";
        node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        node.style.scrollMarginBlock = previousMargin;
      });
    }}>
    <h3 id={headingId} className="mb-1 text-base font-semibold">{title}</h3>
    {description && <p className="mb-4 text-sm text-base-content/65">{description}</p>}
    {children}
  </section>;
}

function visible(node: HTMLElement | null): boolean {
  return Boolean(node?.isConnected && node.getClientRects().length && !node.matches(":disabled") && !node.closest("[inert]"));
}

function propertyOwnerRoute(): string {
  return `${window.location.pathname}:${new URLSearchParams(window.location.search).get("property") ?? ""}`;
}
