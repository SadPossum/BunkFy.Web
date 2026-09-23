import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "@daypicker/react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function DatePicker({
  value,
  onChange,
  ariaLabel,
  name,
  min,
  max,
  required,
  disabled,
  size = "md",
  compactOnSmallScreens = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  name?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  compactOnSmallScreens?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const selected = parseDateKey(value);
  const fromDate = parseDateKey(min);
  const toDate = parseDateKey(max);
  const firstMonth = fromDate ?? parseDateKey("0001-01-01")!;
  const lastMonth = toDate ?? parseDateKey("9999-12-31")!;
  const initialMonth = () => datePickerMonth(selected ?? new Date(), firstMonth, lastMonth);
  const [month, setMonth] = useState(initialMonth);
  const [yearText, setYearText] = useState(() => String(initialMonth().getFullYear()));
  const [yearError, setYearError] = useState(false);
  const [yearView, setYearView] = useState(false);
  const [monthView, setMonthView] = useState(false);
  const [yearPage, setYearPage] = useState(() => datePickerYearPage(initialMonth().getFullYear()));
  const yearTrigger = useRef<HTMLButtonElement>(null);
  const monthTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (yearView) content.current?.querySelector<HTMLButtonElement>(`[data-year="${month.getFullYear()}"]`)?.focus();
  }, [yearView]);
  useEffect(() => {
    if (monthView) content.current?.querySelector<HTMLButtonElement>(`[data-month="${month.getMonth()}"]`)?.focus();
  }, [monthView]);
  useEffect(() => {
    if (yearError && content.current) content.current.scrollTop = content.current.scrollHeight;
  }, [yearError]);
  function navigateMonth(next: Date) {
    const bounded = datePickerMonth(next, firstMonth, lastMonth);
    setMonth(bounded); setYearText(String(bounded.getFullYear())); setYearError(false);
  }
  function changeOpen(next: boolean) {
    if (next && disabled) return;
    if (next) navigateMonth(initialMonth());
    setYearView(false);
    setMonthView(false);
    setOpen(next);
  }
  useEffect(() => {
    const bounded = initialMonth();
    navigateMonth(bounded);
    setYearPage(datePickerYearPage(bounded.getFullYear()));
    if (disabled) setOpen(false);
  }, [value, min, max, disabled]);
  function commitYear() {
    const next = datePickerYearMonth(yearText, month, firstMonth, lastMonth);
    if (next) { navigateMonth(next); setYearPage(datePickerYearPage(next.getFullYear())); return true; }
    setYearError(true); return false;
  }
  function closeYears() {
    if (content.current) content.current.scrollTop = 0;
    yearTrigger.current?.focus({ preventScroll: true }); setYearView(false); setYearError(false);
  }
  function toggleYears() {
    if (yearView) closeYears();
    else { setMonthView(false); setYearText(String(month.getFullYear())); setYearPage(datePickerYearPage(month.getFullYear())); setYearError(false); setYearView(true); }
  }
  function closeMonths() {
    if (content.current) content.current.scrollTop = 0;
    monthTrigger.current?.focus({ preventScroll: true }); setMonthView(false);
  }
  function toggleMonths() {
    if (monthView) closeMonths();
    else { setYearView(false); setYearError(false); setMonthView(true); }
  }
  const previous = new Date(month);
  const next = new Date(month);
  if (monthView) { previous.setFullYear(previous.getFullYear() - 1); next.setFullYear(next.getFullYear() + 1); }
  else { previous.setMonth(previous.getMonth() - 1); next.setMonth(next.getMonth() + 1); }
  const previousDisabled = yearView ? yearPage <= firstMonth.getFullYear() : monthView ? month.getFullYear() <= firstMonth.getFullYear() : datePickerMonth(previous, firstMonth, lastMonth).getTime() === month.getTime();
  const nextDisabled = yearView ? yearPage + 12 > lastMonth.getFullYear() : monthView ? month.getFullYear() >= lastMonth.getFullYear() : datePickerMonth(next, firstMonth, lastMonth).getTime() === month.getTime();
  const headingControl = "relative flex h-11 min-w-0 items-center gap-1 rounded-md px-1 text-base font-semibold hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40";
  function commitValue(next: string) {
    const button = trigger.current;
    // Hand focus back before the parent value render removes the focused day.
    // Outside dismissal and deliberate focus elsewhere remain untouched.
    if (open && !disabled && button?.isConnected && content.current?.contains(document.activeElement)
      && !button.matches(":disabled") && !button.closest("[hidden], [inert], [aria-hidden='true']")
      && button.getClientRects().length > 0) {
      const visibility = getComputedStyle(button).visibility;
      if (visibility !== "hidden" && visibility !== "collapse") button.focus({ preventScroll: true });
    }
    onChange(next);
    setOpen(false);
  }

  return (
    <div className={className}>
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={selected ? `${ariaLabel}: ${formatDate(selected, "long")}` : ariaLabel}
            aria-expanded={open}
            aria-haspopup="dialog"
            disabled={disabled}
            className={`flex w-full items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-3 text-left shadow-xs outline-none transition hover:border-primary/45 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "h-9 text-sm" : "h-12 text-base"}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <CalendarDays size={16} className="shrink-0 text-primary" />
              <span className={selected ? "whitespace-nowrap font-medium tabular-nums" : "min-w-0 truncate text-base-content/45"}>
                {selected && compactOnSmallScreens ? (
                  <>
                    <span className="whitespace-nowrap sm:hidden">{formatCompactDate(selected)}</span>
                    <span className="hidden sm:inline">{formatDate(selected, "medium")}</span>
                  </>
                ) : selected ? formatDate(selected, "medium") : "Choose a date"}
              </span>
            </span>
            <ChevronDown size={15} className={`shrink-0 text-base-content/40 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </Popover.Trigger>
        {name && <input type="hidden" name={name} value={value} required={required} />}
        <Popover.Portal>
          <Popover.Content
            ref={content}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label={`${ariaLabel} calendar`}
            className="z-[1200] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain scroll-p-2 rounded-lg border border-base-300 bg-base-100 p-2 shadow-2xl outline-none"
            style={{ maxHeight: "min(var(--radix-popover-content-available-height), calc(100dvh - 1.5rem))" }}
            onEscapeKeyDown={(event) => { event.stopPropagation(); if (yearView) { event.preventDefault(); closeYears(); } else if (monthView) { event.preventDefault(); closeMonths(); } }}
          >
            <div className="flex items-center justify-between gap-0.5 pb-1">
              <div className="flex min-w-0 items-center gap-0.5">
              <button ref={monthTrigger} type="button" aria-label={`${ariaLabel} month`} aria-expanded={monthView} disabled={disabled} className={headingControl} onClick={toggleMonths}>
                <span className="truncate">{new Intl.DateTimeFormat(undefined, { month: "long" }).format(month)}</span>
                <ChevronDown aria-hidden="true" size={12} className={`shrink-0 ${monthView ? "rotate-180" : ""}`} />
              </button>
              <button ref={yearTrigger} type="button" aria-label={`${ariaLabel} choose year`} aria-expanded={yearView} disabled={disabled} className={`${headingControl} shrink-0 tabular-nums`} onClick={toggleYears}>
                {month.getFullYear()}<ChevronDown aria-hidden="true" size={12} className={yearView ? "rotate-180" : ""} />
              </button>
              </div>
              <div className="flex shrink-0">
                <button type="button" aria-label={yearView ? "Previous 12 years" : monthView ? "Previous year" : "Previous month"} disabled={disabled || previousDisabled} className={`${headingControl} w-11 justify-center text-primary`} onClick={() => yearView ? setYearPage(yearPage - 12) : navigateMonth(previous)}><ChevronLeft aria-hidden="true" size={20} /></button>
                <button type="button" aria-label={yearView ? "Next 12 years" : monthView ? "Next year" : "Next month"} disabled={disabled || nextDisabled} className={`${headingControl} w-11 justify-center text-primary`} onClick={() => yearView ? setYearPage(yearPage + 12) : navigateMonth(next)}><ChevronRight aria-hidden="true" size={20} /></button>
              </div>
            </div>
            {monthView && <div role="group" aria-label={`${ariaLabel} month choices`} className="grid grid-cols-3 gap-1 py-2">
              {Array.from({ length: 12 }, (_, index) => {
                const candidate = new Date(month); candidate.setMonth(index);
                return <button key={index} data-month={index} type="button" aria-pressed={index === month.getMonth()} disabled={disabled || datePickerMonth(candidate, firstMonth, lastMonth).getMonth() !== index} className={`min-h-11 min-w-0 rounded-md px-1 py-2 text-sm leading-5 [overflow-wrap:anywhere] hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30 ${index === month.getMonth() ? "bg-primary/10 font-semibold text-primary" : ""}`} onClick={() => { navigateMonth(candidate); closeMonths(); }}>
                  {new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2000, index, 1))}
                </button>;
              })}
            </div>}
            {yearView && <div role="group" aria-label={`${ariaLabel} year choices`} className="space-y-3 py-2">
              <p aria-live="polite" className="text-center text-sm text-base-content/65">{yearPage}–{Math.min(yearPage + 11, 9999)}</p>
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: Math.min(12, 10000 - yearPage) }, (_, i) => yearPage + i).map(year => <button key={year} data-year={year} type="button" aria-pressed={year === month.getFullYear()} disabled={disabled || year < firstMonth.getFullYear() || year > lastMonth.getFullYear()} className={`h-11 rounded-md text-base tabular-nums hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30 ${year === month.getFullYear() ? "bg-primary/10 font-semibold text-primary" : ""}`} onClick={() => {
                  const next = datePickerYearMonth(String(year), month, firstMonth, lastMonth);
                  if (next) { navigateMonth(next); closeYears(); }
                }}>{year}</button>)}
              </div>
              <div className="flex items-end gap-2 border-t border-base-300 pt-3">
                <label className="min-w-0 flex-1 text-sm">Go to year
                  <input aria-label={`${ariaLabel} year`} aria-invalid={yearError || undefined} className="mt-1 h-11 w-full rounded-md border border-base-300 bg-base-100 px-3 text-base tabular-nums focus-visible:outline-2 focus-visible:outline-primary" type="text" inputMode="numeric" maxLength={4} value={yearText} disabled={disabled} onChange={(event) => { setYearText(event.target.value); setYearError(false); }} onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (commitYear()) closeYears(); }
                  }} />
                </label>
                <button type="button" className="h-11 rounded-md border border-base-300 px-4 text-sm font-medium hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary" disabled={disabled} onClick={() => { if (commitYear()) closeYears(); }}>Go</button>
              </div>
              {yearError && <p role="status" className="text-sm text-error">Enter a year from {firstMonth.getFullYear()} to {lastMonth.getFullYear()}.</p>}
            </div>}
            <div hidden={yearView || monthView}>
            <DayPicker
              className="bunkfy-day-picker w-full"
              classNames={{ month_caption: "sr-only", months: "w-full", month: "w-full", month_grid: "w-full table-fixed border-collapse" }}
              hideNavigation
              mode="single"
              selected={selected}
              month={month}
              onMonthChange={navigateMonth}
              startMonth={firstMonth}
              endMonth={lastMonth}
              disabled={[
                ...(fromDate ? [{ before: fromDate }] : []),
                ...(toDate ? [{ after: toDate }] : []),
              ]}
              onSelect={(date) => {
                if (!date) return;
                commitValue(toDateKey(date));
              }}
            />
            </div>
            {!yearView && !monthView && !required && value && (
              <div className="border-t border-base-300 px-2 pt-2 text-right">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => commitValue("")}
                >
                  Clear date
                </button>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function formatDate(date: Date, dateStyle: "medium" | "long"): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle }).format(date);
}

export function formatCompactDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function parseDateKey(value?: string): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (year < 1 || year > 9999) return undefined;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}

export function toDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function datePickerMonth(date: Date, min: Date, max: Date): Date {
  const month = new Date(date); month.setDate(1); month.setHours(0, 0, 0, 0);
  const first = new Date(min); first.setDate(1); first.setHours(0, 0, 0, 0);
  const last = new Date(max); last.setDate(1); last.setHours(0, 0, 0, 0);
  return month < first ? first : month > last ? last : month;
}

export function datePickerYearMonth(value: string, current: Date, min: Date, max: Date): Date | null {
  if (!/^\d{1,4}$/.test(value)) return null;
  const year = Number(value);
  if (year < 1 || year > 9999 || year < min.getFullYear() || year > max.getFullYear()) return null;
  const next = new Date(current); next.setDate(1); next.setFullYear(year);
  return datePickerMonth(next, min, max);
}

export function datePickerYearPage(year: number): number {
  return Math.floor((year - 1) / 12) * 12 + 1;
}
