import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type SegmentedTabOption<TValue extends string> = {
  value: TValue;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export function SegmentedTabs<TValue extends string>({
  value,
  options,
  ariaLabel,
  onValueChange,
  className = "",
  stretch = false,
}: {
  value: TValue;
  options: readonly SegmentedTabOption<TValue>[];
  ariaLabel: string;
  onValueChange: (value: TValue) => void;
  className?: string;
  stretch?: boolean;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    const enabledIndexes = options
      .map((option, index) => option.disabled ? -1 : index)
      .filter((index) => index >= 0);
    if (!enabledIndexes.length) return;

    const currentEnabledIndex = enabledIndexes.indexOf(currentIndex);
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = enabledIndexes[(currentEnabledIndex + 1) % enabledIndexes.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = enabledIndexes[(currentEnabledIndex - 1 + enabledIndexes.length) % enabledIndexes.length];
    } else if (event.key === "Home") {
      nextIndex = enabledIndexes[0];
    } else if (event.key === "End") {
      nextIndex = enabledIndexes[enabledIndexes.length - 1];
    }

    if (nextIndex == null) return;
    event.preventDefault();
    onValueChange(options[nextIndex].value);
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full gap-0 overflow-x-auto rounded-lg bg-base-200 p-1 [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden ${stretch ? "w-full" : "w-fit"} ${className}`}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { buttonRefs.current[index] = node; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            className={`btn btn-sm h-9 min-h-9 shrink-0 whitespace-nowrap border-0 px-2 text-xs font-semibold sm:px-3 sm:text-sm ${stretch ? "flex-1" : ""} ${active ? "bg-primary text-white shadow-sm hover:bg-primary hover:text-white focus-visible:bg-primary" : "btn-ghost text-base-content/60 hover:bg-base-100 hover:text-base-content"}`}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.icon && <span className="hidden sm:inline-flex">{option.icon}</span>}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
