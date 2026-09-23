import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { Modal } from "../../components/ui/primitives";
import type { BlockEditorNotice } from "./useManualBlockEditor";

export function BlockEditorFrame({ inline = false, title, description, onClose, opener, feedback, children }: {
  inline?: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  opener: RefObject<HTMLElement | null>;
  feedback?: unknown;
  children: ReactNode;
}) {
  const headingId = useId();
  const element = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Modal's focus effect must not restart on a background source render.
  const close = useCallback(() => closeRef.current(), []);
  useEffect(() => {
    const trigger = opener.current;
    const returnHeading = element.current?.closest("[data-blocks-region]")?.querySelector<HTMLElement>("h2");
    if (inline) {
      const control = element.current?.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled), textarea:not(:disabled), [data-autofocus]");
      (control ?? element.current)?.focus();
    }
    return () => {
      requestAnimationFrame(() => {
        if (opener.current !== trigger) return;
        if (document.activeElement !== document.body) return;
        const available = (candidate: HTMLElement | null | undefined) => Boolean(candidate?.isConnected
          && !candidate.matches(":disabled") && !candidate.closest("[inert]") && candidate.getClientRects().length);
        const target = available(trigger) ? trigger : available(returnHeading) ? returnHeading : null;
        if (target) { if (target === returnHeading) target.tabIndex = -1; target.focus(); }
        opener.current = null;
      });
    };
  }, [inline, opener]);
  useEffect(() => {
    if (!feedback || document.activeElement !== document.body) return;
    const message = Array.from(element.current?.querySelectorAll<HTMLElement>('[role="alert"], [data-feedback-focus]') ?? [])
      .find((candidate) => candidate.getClientRects().length > 0);
    const control = element.current?.querySelector<HTMLElement>('input[type="password"]:not(:disabled)');
    if (message) { message.tabIndex = -1; message.classList.add("focus:outline-2", "focus:outline-primary", "outline-offset-2"); message.focus(); }
    else if (control?.getClientRects().length) control.focus();
  }, [feedback]);
  useEffect(() => {
    if (!inline) return;
    let width = window.innerWidth, height = window.innerHeight;
    let pending: number | null = null;
    const resize = () => {
      if (width === window.innerWidth && height === window.innerHeight) return;
      width = window.innerWidth; height = window.innerHeight;
      if (pending !== null) cancelAnimationFrame(pending);
      const root = element.current, target = document.activeElement;
      if (!(target instanceof HTMLElement) || target === root || !root?.contains(target)) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        if (element.current !== root || !target.isConnected || document.activeElement !== target
          || !root.contains(target) || !target.getClientRects().length
          || target.matches(":disabled") || target.closest('[hidden], [inert], [aria-hidden="true"]')
          || getComputedStyle(target).visibility !== "visible") return;
        const navigation = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
        let top = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0;
        let bottom = navigation?.getClientRects().length ? navigation.getBoundingClientRect().top : window.innerHeight;
        for (let parent = target.parentElement; parent; parent = parent.parentElement) {
          if (!/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) continue;
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top + parent.clientTop);
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
        const bounds = target.getBoundingClientRect();
        if (bounds.top < top + 12 || bounds.bottom > bottom - 12) {
          // Reflow can move an active field behind chrome or a wide inspector's
          // edge. Reveal it through its native scroll owners without refocusing.
          target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        }
      });
    };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); if (pending !== null) cancelAnimationFrame(pending); };
  }, [inline]);
  const content = <section ref={element} tabIndex={-1} data-inline-block-editor={inline || undefined} aria-labelledby={inline ? headingId : undefined}
    onFocusCapture={inline ? (event) => {
      const target = event.target;
      requestAnimationFrame(() => {
        if (!target.isConnected || target !== document.activeElement || target === element.current || !element.current?.contains(target)) return;
        const navigation = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
        if (!navigation?.getClientRects().length) return;
        const bounds = target.getBoundingClientRect();
        const headerBottom = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0;
        if (bounds.bottom > navigation.getBoundingClientRect().top - 12 || bounds.top < headerBottom + 12) {
          // Native Tab scrolling can ignore scroll-margin. Explicit nearest
          // scrolling respects it, without moving focus or changing tab order.
          target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        }
      });
    } : undefined}
    className={inline ? "border-t border-base-300 bg-base-200/25 p-4 outline-offset-[-3px] sm:p-5" : "outline-offset-2"}>
    {inline && <><h3 id={headingId} className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-base-content/65">{description}</p>}</>}
    <div className={inline ? "mt-4" : ""}>{children}</div>
  </section>;
  return inline ? content : <Modal open title={title} description={description} onClose={close}>{content}</Modal>;
}

export function BlockMutationNotice({ notice }: { notice: BlockEditorNotice | null }) {
  const element = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) element.current?.focus(); }, [notice]);
  if (!notice) return null;
  return <p ref={element} role="status" tabIndex={-1} className="border-b border-base-300 px-4 py-3 text-sm outline-offset-[-3px] focus:outline-2 focus:outline-primary sm:px-5">
    {notice.action === "created" ? "Block added" : "Block released; showing All history"} · {notice.receipt.affectedBlockCount} {notice.receipt.affectedBlockCount === 1 ? "unit" : "units"}.
  </p>;
}
