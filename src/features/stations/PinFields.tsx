import { useId, type Ref } from "react";
import { FormGrid } from "../../components/ui/FormLayout";

export function PinFields({ confirm = false, disabled = false, inputRef }: { confirm?: boolean; disabled?: boolean; inputRef?: Ref<HTMLInputElement> }) {
  const hint = useId();
  return <div>
    <FormGrid>
      <label className="min-w-0"><span className="mb-2 block text-sm font-medium">{confirm ? "New PIN" : "PIN"}</span>
        <input ref={inputRef} name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6}
          autoComplete="off" required disabled={disabled} aria-describedby={hint}
          className="input input-bordered w-full min-w-0 font-mono tracking-[0.3em]" />
      </label>
      {confirm && <label className="min-w-0"><span className="mb-2 block text-sm font-medium">Confirm PIN</span>
        <input name="confirmPin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6}
          autoComplete="off" required disabled={disabled} aria-describedby={hint}
          className="input input-bordered w-full min-w-0 font-mono tracking-[0.3em]" />
      </label>}
    </FormGrid>
    <p id={hint} className="mt-2 text-sm text-base-content/65">6 digits. Keep your PIN private, including from colleagues.</p>
  </div>;
}
