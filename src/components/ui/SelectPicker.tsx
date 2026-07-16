import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";

export type SelectPickerOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
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
      value={value || undefined}
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
          className="z-[1100] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-xl"
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
                <span className="min-w-0">
                  <Select.ItemText>{option.label}</Select.ItemText>
                  {option.description && (
                    <span className="mt-0.5 block truncate text-xs opacity-60">
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
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const visibleOptions = useMemo(
    () => filterSelectOptions(options, search),
    [options, search],
  );

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    setActiveIndex(0);
    if (!nextOpen) {
      setSearch("");
    }
  }

  function chooseOption(optionValue: string) {
    onValueChange(optionValue);
    changeOpen(false);
  }

  return (
    <div className={className}>
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listboxId}
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
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="z-[1100] max-h-[min(22rem,var(--radix-popover-content-available-height))] overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-xl outline-none"
            style={{ width: "var(--radix-popover-trigger-width)" }}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
          <div className="border-b border-base-300 p-2">
            <label className="flex h-9 items-center gap-2 rounded-md bg-base-200 px-3 text-base-content/50 focus-within:ring-2 focus-within:ring-primary/15">
              <Search size={15} className="shrink-0" />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm text-base-content outline-none"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    changeOpen(false);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((current) => Math.min(current + 1, visibleOptions.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((current) => Math.max(current - 1, 0));
                  } else if (event.key === "Enter" && visibleOptions[activeIndex]) {
                    event.preventDefault();
                    chooseOption(visibleOptions[activeIndex].value);
                  }
                }}
                placeholder="Search options"
                aria-label={`Search ${ariaLabel.toLowerCase()}`}
                aria-activedescendant={visibleOptions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
                autoFocus
              />
            </label>
          </div>
          <div id={listboxId} role="listbox" aria-label={`${ariaLabel} options`} className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-4rem))] overflow-y-auto p-1">
            {visibleOptions.map((option, index) => (
              <button
                id={`${listboxId}-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={`relative flex min-h-10 w-full items-center rounded-md py-2 pl-9 pr-3 text-left text-sm outline-none hover:bg-primary hover:text-primary-content focus-visible:bg-primary focus-visible:text-primary-content disabled:opacity-35 ${index === activeIndex ? "bg-base-200" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseOption(option.value)}
              >
                {option.value === value && (
                  <Check size={15} className="absolute left-3" />
                )}
                <OptionText option={option} />
              </button>
            ))}
            {!visibleOptions.length && (
              <p className="px-3 py-5 text-center text-sm text-base-content/45">
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
    <span className="min-w-0">
      <span className="block truncate">{option.label}</span>
      {option.description && (
        <span className="mt-0.5 block truncate text-xs opacity-60">
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
  const height = size === "sm" ? "h-9" : "h-12";
  const surface = variant === "plain"
    ? "border-transparent bg-transparent px-0 font-semibold hover:text-primary"
    : "border-base-300 bg-base-100 px-3 shadow-xs hover:border-primary/45";
  return `flex min-w-0 items-center justify-between gap-2 rounded-lg border text-left text-sm outline-none transition focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50 ${height} ${surface} ${className}`;
}

export function filterSelectOptions(
  options: SelectPickerOption[],
  search: string,
): SelectPickerOption[] {
  const normalized = search.trim().toLocaleLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    `${option.label} ${option.description ?? ""}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
}
