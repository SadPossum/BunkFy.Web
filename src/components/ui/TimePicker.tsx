import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Clock3, Minus, Plus, X } from "lucide-react";
import { useState } from "react";

type TimePeriod = "AM" | "PM";

export type TimePickerParts = {
  hour: string;
  minute: string;
  period: TimePeriod;
};

export function TimePicker({
  value,
  onChange,
  ariaLabel,
  name,
  required,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hour12] = useState(usesTwelveHourClock);
  const [draft, setDraft] = useState<TimePickerParts>(() => parseTimeValue(value, hour12));
  const draftValue = timePartsToValue(draft, hour12);

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setDraft(parseTimeValue(value, hour12));
    setOpen(nextOpen);
  }

  function apply() {
    if (!draftValue) return;
    onChange(draftValue);
    setOpen(false);
  }

  function clear() {
    onChange("");
    setOpen(false);
  }

  return (
    <div className={className}>
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <div className={`flex h-12 items-center rounded-lg border border-base-300 bg-base-100 shadow-xs outline-none transition hover:border-primary/45 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/10 ${disabled ? "opacity-50" : ""}`}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={ariaLabel}
              aria-expanded={open}
              aria-haspopup="dialog"
              disabled={disabled}
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-left text-sm outline-none disabled:cursor-not-allowed"
            >
              <Clock3 size={16} className="shrink-0 text-primary" />
              <span className={`min-w-0 flex-1 truncate ${value ? "font-medium" : "text-base-content/45"}`}>
                {value ? formatTimeValue(value, hour12) : "Choose a time"}
              </span>
              <ChevronDown
                size={15}
                className={`shrink-0 text-base-content/40 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          </Popover.Trigger>
          {!required && value && !disabled && (
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-xs mr-2 shrink-0"
              aria-label={`Clear ${ariaLabel.toLowerCase()}`}
              title="Clear time"
              onClick={clear}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {name && <input type="hidden" name={name} value={value} />}
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label={`${ariaLabel} picker`}
            className="z-[1200] w-[min(19rem,calc(100vw-1.5rem))] rounded-lg border border-base-300 bg-base-100 shadow-2xl outline-none"
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Choose time</p>
                <p className={`mt-0.5 text-xs ${draftValue ? "text-base-content/50" : "text-error"}`}>
                  {draftValue ? formatTimeValue(draftValue, hour12) : "Enter a valid time"}
                </p>
              </div>
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Clock3 size={17} />
              </span>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <TimePartControl
                  label="Hour"
                  value={draft.hour}
                  ariaLabel={`${ariaLabel} hour`}
                  onChange={(hour) => setDraft((current) => ({ ...current, hour }))}
                  onDecrease={() => setDraft((current) => shiftTimeParts(current, -60, hour12))}
                  onIncrease={() => setDraft((current) => shiftTimeParts(current, 60, hour12))}
                  onSubmit={apply}
                />
                <TimePartControl
                  label="Minute"
                  value={draft.minute}
                  ariaLabel={`${ariaLabel} minute`}
                  onChange={(minute) => setDraft((current) => ({ ...current, minute }))}
                  onDecrease={() => setDraft((current) => shiftTimeParts(current, -5, hour12))}
                  onIncrease={() => setDraft((current) => shiftTimeParts(current, 5, hour12))}
                  onSubmit={apply}
                />
              </div>

              {hour12 && (
                <div role="group" aria-label={`${ariaLabel} period`} className="grid grid-cols-2 rounded-lg bg-base-200 p-1">
                  {(["AM", "PM"] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      aria-pressed={draft.period === period}
                      className={`h-9 rounded-md text-sm font-semibold transition ${draft.period === period ? "bg-primary text-white shadow-sm" : "text-base-content/55 hover:text-base-content"}`}
                      onClick={() => setDraft((current) => ({ ...current, period }))}
                    >
                      {period}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-base-300 px-4 py-3">
              {!required ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={!value}>
                  Clear
                </button>
              ) : <span />}
              <button type="button" className="btn btn-primary btn-sm" onClick={apply} disabled={!draftValue}>
                Apply
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function TimePartControl({
  label,
  value,
  ariaLabel,
  onChange,
  onDecrease,
  onIncrease,
  onSubmit,
}: {
  label: string;
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onDecrease: () => void;
  onIncrease: () => void;
  onSubmit: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-base-content/55">{label}</span>
      <span className="flex h-11 items-center rounded-lg border border-base-300 bg-base-100 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/10">
        <button
          type="button"
          className="grid h-full w-10 shrink-0 place-items-center rounded-l-lg text-base-content/45 transition hover:bg-base-200 hover:text-primary"
          aria-label={`Decrease ${label.toLowerCase()}`}
          title={`Decrease ${label.toLowerCase()}`}
          onClick={onDecrease}
        >
          <Minus size={15} />
        </button>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          value={value}
          className="min-w-0 flex-1 bg-transparent text-center font-mono text-lg font-semibold outline-none"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onChange(event.currentTarget.value.replace(/\D/g, "").slice(0, 2))}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onIncrease();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              onDecrease();
            } else if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="button"
          className="grid h-full w-10 shrink-0 place-items-center rounded-r-lg text-base-content/45 transition hover:bg-base-200 hover:text-primary"
          aria-label={`Increase ${label.toLowerCase()}`}
          title={`Increase ${label.toLowerCase()}`}
          onClick={onIncrease}
        >
          <Plus size={15} />
        </button>
      </span>
    </label>
  );
}

export function parseTimeValue(value: string, hour12: boolean): TimePickerParts {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  const hour24 = match ? Number(match[1]) : 12;
  const minute = match ? Number(match[2]) : 0;
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) {
    return parseTimeValue("12:00", hour12);
  }

  if (!hour12) {
    return { hour: padTimePart(hour24), minute: padTimePart(minute), period: "PM" };
  }

  return {
    hour: padTimePart(hour24 % 12 || 12),
    minute: padTimePart(minute),
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

export function timePartsToValue(parts: TimePickerParts, hour12: boolean): string | null {
  if (!/^\d{1,2}$/.test(parts.hour) || !/^\d{1,2}$/.test(parts.minute)) return null;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (minute < 0 || minute > 59) return null;

  if (!hour12) {
    if (hour < 0 || hour > 23) return null;
    return `${padTimePart(hour)}:${padTimePart(minute)}`;
  }

  if (hour < 1 || hour > 12) return null;
  const hour24 = (hour % 12) + (parts.period === "PM" ? 12 : 0);
  return `${padTimePart(hour24)}:${padTimePart(minute)}`;
}

export function shiftTimeParts(parts: TimePickerParts, deltaMinutes: number, hour12: boolean): TimePickerParts {
  const value = timePartsToValue(parts, hour12) ?? "12:00";
  const [hour, minute] = value.split(":").map(Number);
  const totalMinutes = (hour * 60 + minute + deltaMinutes + 1_440) % 1_440;
  return parseTimeValue(
    `${padTimePart(Math.floor(totalMinutes / 60))}:${padTimePart(totalMinutes % 60)}`,
    hour12,
  );
}

export function formatTimeValue(value: string, hour12: boolean): string {
  const parts = parseTimeValue(value, hour12);
  return hour12 ? `${parts.hour}:${parts.minute} ${parts.period}` : `${parts.hour}:${parts.minute}`;
}

function usesTwelveHourClock(): boolean {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? true;
}

function padTimePart(value: number): string {
  return String(value).padStart(2, "0");
}
