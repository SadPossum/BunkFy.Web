import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SelectPickerOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  searchTerms?: string[];
  searchCodes?: string[];
};

type SelectPickerProps = {
  value?: string;
  onValueChange: (value: string) => void;
  options: SelectPickerOption[];
  placeholder?: string;
  ariaLabel: string;
  name?: string;
  disabled?: boolean;
  searchable?: boolean;
  size?: "sm" | "md";
  variant?: "bordered" | "plain";
  className?: string;
};

export function SelectPicker(props: SelectPickerProps) {
  const searchable = props.searchable ?? props.options.length > 12;
  return searchable
    ? <SearchableSelectPicker {...props} />
    : <BasicSelectPicker {...props} />;
}

function BasicSelectPicker({
  value,
  onValueChange,
  options,
  placeholder = "Choose an option",
  ariaLabel,
  name,
  disabled,
  size = "md",
  variant = "bordered",
  className = "",
}: SelectPickerProps) {
  return (
    <Select.Root
      value={normalizeSelectValue(value)}
      onValueChange={onValueChange}
      name={name}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={triggerClasses(size, variant, className)}
      >
        <span className="min-w-0 truncate">
          <Select.Value placeholder={placeholder} />
        </span>
        <Select.Icon className="shrink-0 text-base-content/45">
          <ChevronDown size={15} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="z-[1100] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[min(var(--radix-select-trigger-width),var(--radix-select-content-available-width))] max-w-[var(--radix-select-content-available-width)] overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-xl"
          onEscapeKeyDown={containPickerEscape}
        >
          <Select.ScrollUpButton className="grid h-7 place-items-center bg-base-100 text-base-content/45">
            <ChevronUp size={15} />
          </Select.ScrollUpButton>
          <Select.Viewport className="p-1">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex min-h-10 cursor-default select-none items-center rounded-md py-2 pl-9 pr-3 text-sm outline-none data-[disabled]:opacity-35 data-[highlighted]:bg-primary data-[highlighted]:text-primary-content"
              >
                <Select.ItemIndicator className="absolute left-3">
                  <Check size={15} />
                </Select.ItemIndicator>
                <span className="min-w-0 flex-1">
                  <Select.ItemText className="whitespace-normal break-words">{option.label}</Select.ItemText>
                  {option.description && (
                    <span className="mt-0.5 block whitespace-normal break-words text-xs opacity-60">
                      {option.description}
                    </span>
                  )}
                </span>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="grid h-7 place-items-center bg-base-100 text-base-content/45">
            <ChevronDown size={15} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function SearchableSelectPicker({
  value,
  onValueChange,
  options,
  placeholder = "Choose an option",
  ariaLabel,
  name,
  disabled,
  size = "md",
  variant = "bordered",
  className = "",
}: SelectPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const contentId = useId();
  const listboxId = useId();
  const listbox = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const visibleOptions = useMemo(
    () => filterSelectOptions(options, search),
    [options, search],
  );
  const activeOption = visibleOptions[activeIndex];
  useEffect(() => {
    if (!open) return;
    listbox.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, visibleOptions]);
  useEffect(() => {
    if (disabled) changeOpen(false);
  }, [disabled]);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen && !disabled);
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextEligibleOptionIndex(options, -1, 1));
    if (!nextOpen) {
      setSearch("");
    }
  }

  function chooseOption(optionValue: string) {
    if (disabled || !options.some((option) => option.value === optionValue && !option.disabled)) return;
    onValueChange(optionValue);
    changeOpen(false);
  }

  return (
    <div className={className}>
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={contentId}
            disabled={disabled}
            className={triggerClasses(size, variant, "w-full")}
          >
            <span className={`min-w-0 truncate ${selected ? "" : "text-base-content/45"}`}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronDown size={15} className="shrink-0 text-base-content/45" />
          </button>
        </Popover.Trigger>
        {name && <input type="hidden" name={name} value={value ?? ""} />}
        <Popover.Portal>
          <Popover.Content
            id={contentId}
            aria-label={`${ariaLabel} picker`}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="z-[1100] max-h-[min(22rem,var(--radix-popover-content-available-height))] max-w-[var(--radix-popover-content-available-width)] overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-xl outline-none"
            style={{ width: "min(var(--radix-popover-trigger-width), var(--radix-popover-content-available-width))" }}
            onEscapeKeyDown={containPickerEscape}
          >
          <div className="border-b border-base-300 p-2">
            <label className="flex h-9 items-center gap-2 rounded-md bg-base-200 px-3 text-base-content/65 focus-within:ring-2 focus-within:ring-primary">
              <Search size={15} className="shrink-0" />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm text-base-content outline-none"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveIndex(nextEligibleOptionIndex(filterSelectOptions(options, event.target.value), -1, 1));
                }}
                onKeyDown={(event) => handleSelectPickerKey(event, visibleOptions, activeIndex, {
                  select: chooseOption, close: () => changeOpen(false), setActive: setActiveIndex,
                })}
                placeholder="Search options"
                aria-label={`Search ${ariaLabel.toLowerCase()}`}
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={activeOption && !activeOption.disabled ? `${listboxId}-${activeIndex}` : undefined}
                autoFocus
              />
            </label>
          </div>
          <div ref={listbox} id={listboxId} role="listbox" aria-label={`${ariaLabel} options`} className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-4rem))] overflow-y-auto p-1">
            {visibleOptions.map((option, index) => (
              <button
                id={`${listboxId}-${index}`}
                key={option.value}
                type="button"
                role="option"
                tabIndex={-1}
                data-option-index={index}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                className={`relative flex min-h-10 w-full items-center rounded-md py-2 pl-9 pr-3 text-left text-sm outline-none enabled:hover:bg-primary enabled:hover:text-primary-content focus-visible:bg-primary focus-visible:text-primary-content disabled:opacity-50 ${index === activeIndex && !option.disabled ? "bg-primary text-primary-content" : ""}`}
                onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseOption(option.value)}
              >
                {option.value === value && (
                  <Check size={15} className="absolute left-3" />
                )}
                <OptionText option={option} />
              </button>
            ))}
            {!visibleOptions.length && (
              <p role="status" className="px-3 py-5 text-center text-sm text-base-content/65">
                No matching options
              </p>
            )}
          </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function OptionText({ option }: { option: SelectPickerOption }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block whitespace-normal break-words">{option.label}</span>
      {option.description && (
        <span className="mt-0.5 block whitespace-normal break-words text-xs opacity-80">
          {option.description}
        </span>
      )}
    </span>
  );
}

function triggerClasses(
  size: "sm" | "md",
  variant: "bordered" | "plain",
  className: string,
): string {
  const height = size === "sm" ? "h-9 text-sm" : "h-12 text-base";
  const surface = variant === "plain"
    ? "border-transparent bg-transparent px-0 font-semibold hover:text-primary"
    : "border-base-300 bg-base-100 px-3 shadow-xs hover:border-primary/45";
  return `flex min-w-0 items-center justify-between gap-2 rounded-lg border text-left outline-none transition focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50 ${height} ${surface} ${className}`;
}

export function filterSelectOptions(
  options: SelectPickerOption[],
  search: string,
): SelectPickerOption[] {
  const normalized = normalizeSelectSearch(search);
  if (!normalized) return options;
  const tokens = normalized.split(" ");
  const exactCodes = new Set(options.flatMap((option) => option.searchCodes ?? []).map(normalizeSelectSearch));
  return options.map((option, index) => {
    const fields = [option.value, option.label, option.description ?? "", ...(option.searchTerms ?? [])].map(normalizeSelectSearch);
    const text = fields.join(" ");
    const matches = tokens.every((token) => exactCodes.has(token)
      ? fields.some((field) => field.split(" ").includes(token))
      : text.includes(token));
    const rank = fields[0] === normalized ? 0 : fields.some((field) => field === normalized) ? 1
      : fields[1].startsWith(normalized) ? 2 : 3;
    return { option, index, matches, rank };
  }).filter((entry) => entry.matches).sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.option);
}

export function normalizeSelectSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[/_]+/g, " ").trim().replace(/\s+/g, " ");
}

export function nextEligibleOptionIndex(options: SelectPickerOption[], current: number, direction: 1 | -1): number {
  if (current >= options.length) current = -1;
  const start = current < 0 ? (direction === 1 ? 0 : options.length - 1) : current + direction;
  for (let index = start; index >= 0 && index < options.length; index += direction) {
    if (!options[index].disabled) return index;
  }
  return options[current] && !options[current].disabled ? current : -1;
}

export function handleSelectPickerKey(
  event: { key: string; preventDefault: () => void; stopPropagation: () => void; nativeEvent: { isComposing: boolean; keyCode?: number } },
  options: SelectPickerOption[],
  activeIndex: number,
  actions: { select: (value: string) => void; close: () => void; setActive: (index: number) => void },
): void {
  if (event.key === "Enter") {
    // Enter must never submit the containing form, even for no results or IME input.
    event.preventDefault();
    event.stopPropagation();
    const option = options[activeIndex];
    if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && option && !option.disabled) actions.select(option.value);
  } else if (event.nativeEvent.isComposing) {
    return;
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.close();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    actions.setActive(nextEligibleOptionIndex(options, activeIndex, event.key === "ArrowDown" ? 1 : -1));
  }
  // Home/End and text-editing shortcuts retain their native input/caret behavior.
}

export function normalizeSelectValue(value?: string): string {
  return value ?? "";
}

export function containPickerEscape(event: Pick<Event, "stopPropagation">): void {
  event.stopPropagation();
}
