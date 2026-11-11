import { Check, Copy } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type CopyState = "idle" | "copying" | "copied" | "failed";

export function CopyTextActions({
  value, label, manualLabel, buttonClassName = "btn btn-ghost btn-sm", children,
}: {
  value: string;
  label: string;
  manualLabel: string;
  buttonClassName?: string;
  children?: ReactNode;
}) {
  const [feedback, setFeedback] = useState<{ state: CopyState }>({ state: "idle" });
  const state = feedback.state;
  const owner = useRef({ attempt: 0 });
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  useLayoutEffect(() => {
    const current = { attempt: 0 };
    owner.current = current;
    setFeedback({ state: "idle" });
    return () => { current.attempt++; };
  }, [value]);

  useEffect(() => {
    if (feedback.state !== "failed") return;
    field.current?.focus();
    field.current?.select();
  }, [feedback]);

  async function copy() {
    const current = owner.current;
    const attempt = ++current.attempt;
    const isCurrent = () => owner.current === current && current.attempt === attempt;
    setFeedback({ state: "copying" });
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrent()) setFeedback({ state: "copied" });
    } catch {
      // Clipboard support and permission vary by browser. Keep the displayed
      // one-time value available without issuing or requesting another one.
      if (isCurrent()) setFeedback({ state: "failed" });
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClassName} disabled={state === "copying"} onClick={() => void copy()}>
          {state === "copied" ? <Check size={15} /> : <Copy size={15} />}
          {state === "copied" ? "Copied" : label}
        </button>
        {children}
      </div>
      {state === "failed" && (
        <div className="min-w-0 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <p role="status" className="text-sm">Copy failed. Select the text below and copy it manually.</p>
          <label htmlFor={fieldId} className="mt-3 block text-sm font-semibold">{manualLabel}</label>
          <textarea id={fieldId} ref={field} className="textarea textarea-bordered mt-1 w-full min-w-0 break-all font-mono text-xs"
            readOnly rows={3} value={value} onFocus={event => event.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}
