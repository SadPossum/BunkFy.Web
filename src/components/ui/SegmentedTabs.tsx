import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

export type SegmentedTabOption<TValue extends string> = {
  value: TValue;
  label: string;
  compactLabel?: string;
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
  narrowGrid = false,
}: {
  value: TValue;
  options: readonly SegmentedTabOption<TValue>[];
  ariaLabel: string;
  onValueChange: (value: TValue) => void;
  className?: string;
  stretch?: boolean;
  narrowGrid?: boolean;
}) {
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const activeIndex = options.findIndex((option) => option.value === value);
    revealTabHorizontally(tabListRef.current, buttonRefs.current[activeIndex]);
  }, [options, value]);

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
    revealTabHorizontally(tabListRef.current, buttonRefs.current[nextIndex]);
  }

  return (
    <div
      ref={tabListRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={`inline-flex max-w-full snap-x snap-mandatory gap-0 overflow-x-auto overscroll-x-contain rounded-lg border border-base-300 bg-base-200/75 p-1 [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden ${stretch ? "w-full" : "w-fit"} ${narrowGrid ? "max-[420px]:grid max-[420px]:w-full max-[420px]:grid-cols-2 max-[420px]:gap-1 max-[420px]:overflow-visible max-[420px]:snap-none" : ""} ${className}`}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { buttonRefs.current[index] = node; }}
            type="button"
            role="tab"
            aria-label={option.compactLabel ? option.label : undefined}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            className={`btn btn-sm h-8 min-h-8 snap-start whitespace-nowrap border-0 px-1.5 text-[0.7rem] font-semibold sm:px-3 sm:text-sm ${stretch ? "min-w-0 flex-1 shrink basis-0" : "shrink-0"} ${narrowGrid ? "max-[420px]:w-full max-[420px]:min-w-0" : ""} ${active ? "bg-base-100 text-base-content shadow-sm hover:bg-base-100 focus-visible:bg-base-100" : "btn-ghost text-base-content/55 hover:bg-base-100/65 hover:text-base-content"}`}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.icon && (
              <span className={`inline-flex shrink-0 ${stretch ? "max-[420px]:hidden" : ""}`} aria-hidden="true">
                {option.icon}
              </span>
            )}
            {option.compactLabel && !narrowGrid ? (
              <>
                <span className="max-[420px]:hidden" aria-hidden="true">{option.label}</span>
                <span className="min-[421px]:hidden" aria-hidden="true">{option.compactLabel}</span>
              </>
            ) : option.label}
          </button>
        );
      })}
    </div>
  );
}

function revealTabHorizontally(
  tabList: HTMLDivElement | null,
  tab: HTMLButtonElement | null | undefined,
) {
  if (!tabList || !tab) return;

  const listBounds = tabList.getBoundingClientRect();
  const tabBounds = tab.getBoundingClientRect();
  if (tabBounds.left < listBounds.left) {
    tabList.scrollLeft -= listBounds.left - tabBounds.left;
  } else if (tabBounds.right > listBounds.right) {
    tabList.scrollLeft += tabBounds.right - listBounds.right;
  }
}
