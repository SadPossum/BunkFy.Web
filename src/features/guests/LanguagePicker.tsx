import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { containPickerEscape } from "../../components/ui/SelectPicker";
import { addGuestLanguage, guestLanguageIdentity, guestLanguageLimit, removeGuestLanguage } from "./guestLanguageSelection";
import { guestLanguageName, indexGuestLanguages, loadGuestLanguageCatalog, searchGuestLanguages,
  type GuestLanguageCatalog, type GuestLanguageOption } from "./guestLanguageOptions";

export function LanguagePicker({ value, onChange, disabled = false, locale = "en", onDisabledClose }: {
  value: readonly string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  locale?: string;
  /** The form owner supplies its visible recovery heading/control when authority changes. */
  onDisabledClose?: () => void;
}) {
  const id = useId(), listId = `${id}-options`, hintId = `${id}-status`;
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<GuestLanguageCatalog | null>(null);
  const [loadError, setLoadError] = useState(false), [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [exact, setExact] = useState(false), [tag, setTag] = useState("");
  const trigger = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const tokens = useRef(new Map<string, HTMLButtonElement>());
  const index = useMemo(() => indexGuestLanguages(catalog ?? [], locale), [catalog, locale]);
  const results = useMemo(() => searchGuestLanguages(index, query, value, locale), [index, query, value, locale]);
  const activeIndex = Math.max(0, results.options.findIndex(option => option.value === active));
  const activeOption = results.options[activeIndex];

  useEffect(() => {
    if (!open || disabled || catalog) return;
    let current = true;
    loadGuestLanguageCatalog().then(data => { if (current) { setCatalog(data); setLoadError(false); } },
      () => { if (current) setLoadError(true); });
    return () => { current = false; };
  }, [open, disabled, catalog, retry]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);
  useEffect(() => {
    if (disabled || typeof window === "undefined") return;
    let frame = 0;
    const owns = (element: HTMLElement) => root.current?.contains(element) || popup.current?.contains(element);
    const visible = (element: HTMLElement) => {
      const viewport = window.visualViewport;
      let top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
      let bottom = top + (viewport?.height ?? window.innerHeight), right = left + (viewport?.width ?? window.innerWidth);
      // The modal body clips below its header. Intersect every clipping ancestor,
      // including the portal's own scroller, rather than just the screen edges.
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top + parent.clientTop); bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left + parent.clientLeft); right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth); }
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= top && rect.bottom <= bottom && rect.left >= left && rect.right <= right;
    };
    const reveal = () => {
      frame = 0;
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !focused.isConnected || !owns(focused)) return;
      if (!open || !popup.current?.contains(focused)) {
        if (!visible(focused)) focused.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        return;
      }
      // Keep the same portal input/list focus while its anchor is revealed.
      if (trigger.current && !visible(trigger.current)) trigger.current.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (document.activeElement !== focused || !popup.current?.contains(focused)) return;
        const box = popup.current.getBoundingClientRect();
        const activeId = focused.getAttribute("aria-activedescendant");
        const activeOption = activeId ? document.getElementById(activeId) : null;
        const target = activeOption instanceof HTMLElement && focused.contains(activeOption) ? activeOption : focused;
        if (visible(target) && box.height >= 132 && box.width >= 120) return;
        const owner = trigger.current;
        if (!owner?.isConnected || owner.disabled || owner.closest("[inert]")) return;
        setOpen(false);
        owner.focus({ preventScroll: true });
        if (!visible(owner)) owner.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      });
    };
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal); };
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [open, disabled]);

  function changeOpen(next: boolean) {
    setOpen(next && !disabled);
    if (next) { setQuery(""); setActive(null); setMessage(""); setExact(false); setTag(""); }
  }
  function toggle(option: GuestLanguageOption) {
    if (disabled) return;
    setActive(option.value);
    const selected = value.some(saved => guestLanguageIdentity(saved) === guestLanguageIdentity(option.value));
    if (selected) {
      onChange(removeGuestLanguage(value, option.value));
      setMessage(`${option.label} removed.`);
    } else {
      const result = addGuestLanguage(value, option.value);
      if (!result.ok) { setMessage(result.error); return; }
      onChange(result.languageTags);
      setMessage(`${option.label} added.`);
    }
  }
  function removeToken(saved: string, position: number) {
    if (disabled) return;
    const next = removeGuestLanguage(value, saved);
    onChange(next);
    setMessage(`${guestLanguageName(saved, locale)} removed.`);
    const destination = next[Math.min(position, next.length - 1)];
    // Existing adjacent node survives this update; never focus the removed button.
    (destination ? tokens.current.get(guestLanguageIdentity(destination)) : trigger.current)?.focus();
  }
  function addExact() {
    if (disabled) return;
    const result = addGuestLanguage(value, tag);
    if (!result.ok) { setMessage(result.error); return; }
    onChange(result.languageTags); setMessage(`Language tag ${guestLanguageIdentity(tag)} added.`);
    setExact(false); setTag(""); searchInput.current?.focus();
  }
  function searchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault(); event.stopPropagation();
      if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && activeOption) toggle(activeOption);
    } else if (event.key === "ArrowDown" && !event.nativeEvent.isComposing) {
      event.preventDefault(); setActive(results.options[0]?.value ?? null); list.current?.focus();
    }
    // Space, Home/End, selection and IME retain native text-editing behavior here.
  }
  function listKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    const last = results.options.length - 1;
    const position = event.key === "ArrowDown" ? Math.min(last, activeIndex + 1)
      : event.key === "ArrowUp" ? Math.max(0, activeIndex - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (position != null) { event.preventDefault(); setActive(results.options[Math.max(0, position)]?.value ?? null); }
    else if (event.key === " " || event.key === "Enter") {
      event.preventDefault(); event.stopPropagation(); if (activeOption) toggle(activeOption);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); setQuery(event.key); setActive(null); searchInput.current?.focus();
    }
  }

  return <div ref={root} tabIndex={-1} role="group" className="min-w-0 rounded-md outline-none focus:ring-2 focus:ring-primary" aria-labelledby={`${id}-label`}>
    <span id={`${id}-label`} className="mb-1.5 block text-sm font-semibold">Languages (optional)</span>
    {value.length > 0 && <ul aria-label="Selected languages" className="mb-2 flex flex-wrap gap-2">
      {value.map((saved, position) => <li key={guestLanguageIdentity(saved)} className="flex min-w-0 max-w-full items-center rounded-md border border-base-300 bg-base-200/60 pl-2 text-sm">
        <span className="min-w-0 break-words py-1">{guestLanguageName(saved, locale)} {guestLanguageName(saved, locale) !== saved && <span className="text-base-content/65">({saved})</span>}</span>
        <button ref={node => { if (node) tokens.current.set(guestLanguageIdentity(saved), node); else tokens.current.delete(guestLanguageIdentity(saved)); }}
          type="button" disabled={disabled} aria-label={`Remove ${guestLanguageName(saved, locale)}${guestLanguageName(saved, locale) === saved ? "" : ` (${saved})`}`}
          className="btn btn-ghost min-h-[44px] min-w-[44px] shrink-0 px-2" onClick={() => removeToken(saved, position)}><X size={14} aria-hidden="true" /></button>
      </li>)}
    </ul>}
    <Popover.Root open={open && !disabled} onOpenChange={changeOpen}>
      <Popover.Trigger asChild><button ref={trigger} type="button" disabled={disabled}
        aria-label="Choose languages" aria-describedby={hintId}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-left text-sm shadow-xs outline-none hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
        <span>{value.length ? "Add or remove languages" : "Choose languages"}</span><ChevronDown size={15} aria-hidden="true" />
      </button></Popover.Trigger>
      <Popover.Portal><Popover.Content ref={popup} align="start" sideOffset={6} collisionPadding={12}
        aria-label="Choose languages" onEscapeKeyDown={containPickerEscape}
        onCloseAutoFocus={event => {
          if (!disabled) return; // Radix restores Escape/Done focus but respects deliberate outside focus.
          event.preventDefault();
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused !== document.body && !popup.current?.contains(focused) && !focused.matches(":disabled")) return;
          if (onDisabledClose) onDisabledClose(); else root.current?.focus();
        }}
        onOpenAutoFocus={event => { event.preventDefault(); searchInput.current?.focus(); }}
        className="z-[1100] flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[min(24rem,var(--radix-popover-content-available-width))] max-w-[var(--radix-popover-content-available-width)] flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-xl outline-none">
        <div className="shrink-0 border-b border-base-300 p-2">
          <label className="flex min-h-[44px] items-center gap-2 rounded-md bg-base-200 px-3 focus-within:ring-2 focus-within:ring-primary">
            <Search size={15} aria-hidden="true" /><input ref={searchInput} value={query} disabled={disabled} type="search"
              aria-label="Search languages" aria-controls={listId} placeholder="Search by name or code"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
              onChange={event => { setQuery(event.target.value); setActive(null); setMessage(""); }} onKeyDown={searchKey} />
          </label>
        </div>
        <div className="min-h-0 overflow-y-auto">
          {!catalog && <div role="status" className="p-3 text-sm">{loadError ? <>Language suggestions could not load. <button type="button" disabled={disabled} className="btn btn-ghost" onClick={() => { setLoadError(false); setRetry(value => value + 1); }}>Retry</button></> : "Loading languages…"}</div>}
          <div ref={list} id={listId} role="listbox" aria-label="Language options" aria-multiselectable="true"
            aria-busy={!catalog && !loadError} aria-activedescendant={activeOption ? `${listId}-${activeIndex}` : undefined}
            tabIndex={disabled ? -1 : 0} onKeyDown={listKey} className="p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
            {results.options.map((option, position) => {
              const selected = value.some(saved => guestLanguageIdentity(saved) === guestLanguageIdentity(option.value));
              return <div key={guestLanguageIdentity(option.value)} id={`${listId}-${position}`} role="option" aria-selected={selected}
                data-option-index={position} aria-disabled={disabled || undefined} aria-setsize={results.total} aria-posinset={position + 1}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${position === activeIndex ? "bg-primary/10 text-primary" : "hover:bg-base-200"}`}
                onMouseDown={event => event.preventDefault()} onClick={() => { list.current?.focus(); toggle(option); }}>
                <span className="w-4 shrink-0">{selected && <Check size={16} aria-hidden="true" />}</span>
                <span className="min-w-0 flex-1 break-words">{option.label}</span><span className="shrink-0 text-xs text-base-content/65">{option.value}</span>
              </div>;
            })}
          </div>
          {catalog && !results.total && <p className="px-3 py-4 text-sm">No matching languages. Try another name or code.</p>}
          {results.total > results.options.length && <p className="px-3 py-2 text-xs text-base-content/65">Showing {results.options.length} of {results.total}. Type to narrow the list.</p>}
        </div>
        <div className="shrink-0 border-t border-base-300 p-2">
          {exact ? <div className="mb-2 space-y-2">
            <label className="block text-sm">Exact language tag<input autoFocus disabled={disabled} value={tag} maxLength={35}
              className="input input-bordered mt-1 w-full" placeholder="For example, sr-Latn"
              onChange={event => setTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) addExact(); } }} /></label>
            <p className="text-xs text-base-content/65">Choose a regional or script variant; it stays separate from the base language.</p>
            <button type="button" disabled={disabled} className="btn btn-outline min-h-[44px]" onClick={addExact}>Add tag</button>
          </div> : <button type="button" disabled={disabled} className="btn btn-ghost min-h-[44px] text-sm" onClick={() => { setExact(true); setMessage(""); }}>Enter an exact tag</button>}
          <div role="status" aria-live="polite" className="px-1 text-sm">{message || `${value.length} selected${value.length >= guestLanguageLimit ? ` · Limit ${guestLanguageLimit}` : ""}`}</div>
          <div className="mt-2 flex justify-end"><Popover.Close asChild><button type="button" className="btn btn-primary min-h-[44px]">Done</button></Popover.Close></div>
        </div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <span id={hintId} role="status" className="sr-only">{open ? "" : message || `${value.length} languages selected`}</span>
  </div>;
}
