export function modalOwnsPortalFocus(dialog: HTMLElement, active: Element | null): boolean {
  if (!active || dialog.contains(active)) return false;
  return Array.from(dialog.querySelectorAll<HTMLElement>("[aria-controls]")).some((trigger) =>
    (trigger.getAttribute("aria-controls") ?? "").split(/\s+/).some((id) => {
      const content = id ? document.getElementById(id) : null;
      return Boolean(content && content.contains(active));
    }));
}

export function modalControlVisible(control: HTMLElement): boolean {
  const visibility = getComputedStyle(control).visibility;
  return control.isConnected && control.getClientRects().length > 0 && !control.matches(":disabled")
    && visibility !== "hidden" && visibility !== "collapse"
    && !control.closest("[hidden], [inert], [aria-hidden='true']");
}

export function modalFocusableControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    "a[href], button, input, select, textarea, [tabindex]",
  )).filter((control) => control.tabIndex >= 0 && modalControlVisible(control));
}

export function modalIsTopmost(dialog: HTMLElement): boolean {
  const modals = Array.from(document.querySelectorAll<HTMLElement>("[data-bunkfy-modal]"))
    .filter((item) => item.getClientRects().length > 0);
  return modals.length === 0 || modals.at(-1)?.contains(dialog) === true;
}

export function modalFocusNeedsRepair(dialog: HTMLElement, active: Element | null): boolean {
  if (!modalIsTopmost(dialog) || modalOwnsPortalFocus(dialog, active)) return false;
  return active !== dialog && (!(active instanceof HTMLElement) || !dialog.contains(active) || !modalControlVisible(active));
}

export function focusModalRecoveryFeedback(target: HTMLElement | null): void {
  const dialog = target?.closest<HTMLElement>("[data-bunkfy-modal-box]");
  if (!target || !dialog || !modalIsTopmost(dialog)) return;
  if (document.activeElement === dialog || modalFocusNeedsRepair(dialog, document.activeElement)) {
    target.scrollIntoView({ block: "nearest" });
    target.focus({ preventScroll: true });
  }
}
