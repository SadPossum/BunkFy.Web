import { KeyRound } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { useSession } from "../../app/session";
import { FormSection } from "../../components/ui/FormLayout";
import { useSharedAccounts } from "./SharedAccountsProvider";

export function RememberAccountPanel() {
  const shared = useSharedAccounts();
  const { session } = useSession();
  const [editing, setEditing] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [validation, setValidation] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  if (!shared?.enabled || !session) return null;
  const own = shared.current?.accounts?.find(account => account.proofId === shared.current?.active?.proofId);
  const digits = shared.current?.pinDigits ?? 6;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shared || shared.busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const pin = String(data.get("pin") ?? "");
    if (!new RegExp(`^[0-9]{${digits}}$`).test(pin) || pin !== data.get("confirmPin")) {
      setValidation(`Enter the same ${digits}-digit PIN in both fields.`);
      form.querySelector<HTMLInputElement>('[name="confirmPin"]')?.focus(); return;
    }
    if (data.get("consent") !== "on") { setValidation("Confirm that your account may appear on this browser’s lock screen."); return; }
    const label = String(data.get("label") ?? "");
    form.reset(); setValidation("");
    if (await shared.rememberAccount(pin, label, true)) setEditing(false);
  }

  return <FormSection className="hidden lg:block" title="Fast account switching" icon={<KeyRound size={18} />}
    description="Return to your own account with a PIN on this browser. Your normal workspace access and permissions stay the same.">
    <div className="max-w-xl space-y-4">
      <p className="text-sm leading-6">{own ? "Your account is remembered on this browser." : "Sign in once, then use a PIN for everyday handovers."}</p>
      {(validation || shared.message) && <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm leading-5">{validation || shared.message}</p>}
      {!editing && !confirmForget && <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-outline btn-sm" disabled={shared.busy} onClick={() => {
          setEditing(true); setValidation(""); requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[name="pin"]')?.focus());
        }}>{own ? "Change this browser’s PIN" : "Remember this account"}</button>
        {own && <>
          <button type="button" className="btn btn-outline btn-sm" disabled={shared.busy} onClick={() => void shared.switchAccount()}>Switch account</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={shared.busy} onClick={() => setConfirmForget(true)}>Forget my account here</button>
        </>}
      </div>}
      {editing && <form ref={formRef} onSubmit={event => void submit(event)} className="space-y-4">
        <p className="text-sm leading-6 text-base-content/70">A recent password sign-in and any required verification are needed to save or change your PIN. A PIN does not replace verification for sensitive actions.</p>
        {own && <button type="button" className="btn btn-outline btn-sm" disabled={shared.busy} onClick={() => void shared.signInAgain()}>Sign in again to change PIN</button>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor={`${id}-pin`} className="mb-1.5 block text-sm font-semibold">PIN</label>
            <input id={`${id}-pin`} name="pin" type="password" inputMode="numeric" autoComplete="new-password" required
              minLength={digits} maxLength={digits} pattern={`[0-9]{${digits}}`} className="input w-full tracking-[0.3em]" disabled={shared.busy} /></div>
          <div><label htmlFor={`${id}-confirm`} className="mb-1.5 block text-sm font-semibold">Confirm PIN</label>
            <input id={`${id}-confirm`} name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" required
              minLength={digits} maxLength={digits} pattern={`[0-9]{${digits}}`} className="input w-full tracking-[0.3em]" disabled={shared.busy} /></div>
        </div>
        <p className="text-xs leading-5 text-base-content/65">Choose {digits} digits. Use a private PIN, not one shared by the team.</p>
        <div><label htmlFor={`${id}-label`} className="mb-1.5 block text-sm font-semibold">Your display name <span className="font-normal text-base-content/65">(optional)</span></label>
          <input id={`${id}-label`} name="label" defaultValue={own?.label ?? ""} maxLength={256} className="input w-full" disabled={shared.busy} />
          <p className="mt-1.5 text-xs leading-5 text-base-content/65">Your sign-in email will also appear so colleagues can identify the right account.</p></div>
        <label className="flex items-start gap-3 rounded-lg border border-base-300 p-3 text-sm leading-6">
          <input type="checkbox" name="consent" className="checkbox mt-0.5 shrink-0" required disabled={shared.busy} />
          <span>I agree to show my name and sign-in email on this browser’s account chooser. Other users of this device can see them.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" disabled={shared.busy}>{shared.busy ? "Saving…" : "Save PIN on this browser"}</button>
          <button type="button" className="btn btn-ghost" disabled={shared.busy} onClick={() => { formRef.current?.reset(); setEditing(false); setValidation(""); }}>Cancel</button>
        </div>
      </form>}
      {confirmForget && <div className="space-y-3 rounded-lg border border-base-300 p-4">
        <h3 className="text-sm font-semibold">Forget your account on this browser?</h3>
        <p className="text-sm leading-6">Your PIN will stop working here and this browser will lock. Other remembered accounts and your sessions on other devices are not removed.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-outline" disabled={shared.busy} onClick={() => void shared.forgetOwnAccount()}>Forget my account</button>
          <button type="button" className="btn btn-ghost" disabled={shared.busy} onClick={() => setConfirmForget(false)}>Cancel</button></div>
      </div>}
    </div>
  </FormSection>;
}
