import { DayPicker } from "@daypicker/react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";

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
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateKey(value);
  const fromDate = parseDateKey(min);
  const toDate = parseDateKey(max);

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border border-base-300 bg-base-100 px-3 text-left text-sm shadow-xs outline-none transition hover:border-primary/45 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/10 disabled:opacity-50 ${size === "sm" ? "h-9" : "h-12"}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays size={16} className="shrink-0 text-primary" />
          <span className={selected ? "truncate" : "truncate text-base-content/45"}>
            {selected ? selected.toLocaleDateString() : "Choose a date"}
          </span>
        </span>
        <ChevronDown size={15} className="shrink-0 text-base-content/40" />
      </button>
      {name && <input type="hidden" name={name} value={value} required={required} />}
      {open && (
        <div role="dialog" aria-label={`${ariaLabel} calendar`} className="absolute left-0 top-full z-[110] mt-1.5 rounded-lg border border-base-300 bg-base-100 p-2 shadow-xl outline-none">
          <DayPicker
            className="bunkfy-day-picker"
            mode="single"
            selected={selected}
            defaultMonth={selected ?? fromDate ?? new Date()}
            startMonth={fromDate}
            endMonth={toDate}
            disabled={[
              ...(fromDate ? [{ before: fromDate }] : []),
              ...(toDate ? [{ after: toDate }] : []),
            ]}
            onSelect={(date) => {
              if (!date) return;
              onChange(toDateKey(date));
              setOpen(false);
            }}
          />
          {!required && value && (
            <div className="border-t border-base-300 px-2 pt-2 text-right">
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Clear date
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function parseDateKey(value?: string): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
