import { useMemo } from "react";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { nationalityOptions, normalizeNationalityValue } from "./nationalityOptions";

export function NationalityPicker({ value, onChange, name, disabled = false }: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  name?: string;
  disabled?: boolean;
}) {
  const selected = normalizeNationalityValue(value);
  const locale = typeof navigator === "undefined" ? "en" : navigator.language || "en";
  const options = useMemo(() => nationalityOptions(selected, [locale]), [selected, locale]);
  return <div className="flex min-w-0 items-start gap-1">
    <SelectPicker
      className="min-w-0 flex-1 [&_button[aria-haspopup]]:min-h-[44px]"
      name={name}
      value={selected}
      onValueChange={next => { if (!disabled) onChange(next); }}
      options={options}
      placeholder="Not specified"
      ariaLabel="Nationality (optional)"
      searchable
      disabled={disabled}
    />
    {/* Keep this control mounted after clearing, so native focus is not discarded. */}
    <button type="button" className="btn btn-ghost min-h-[44px] shrink-0 px-2"
      aria-label="Clear nationality" aria-disabled={!selected || disabled || undefined} disabled={disabled}
      onClick={() => { if (!disabled && selected) onChange(""); }}>Clear</button>
  </div>;
}
