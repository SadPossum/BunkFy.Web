import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, LockKeyhole, LogIn, Plus, RefreshCw, Search } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { BrandMark } from "../../components/ui/BrandMark";
import { Modal, ModalActions } from "../../components/ui/primitives";
import type { RememberedAccount } from "./accountSwitchTypes";

type Props = {
  accounts: readonly RememberedAccount[];
  selected: RememberedAccount | null;
  pinDigits: number;
  busy: boolean;
  securing: boolean;
  message: string;
  recovery: boolean;
  onChoose: (account: RememberedAccount) => void;
  onBack: () => void;
  onUnlock: (pin: string) => Promise<void>;
  onSignIn: () => void;
  onRetry: () => void;
  onForgetBrowser?: () => Promise<void>;
  checkingChange?: boolean;
  onCancelUnconfirmed?: () => Promise<void>;
};

const accountName = (account: RememberedAccount) => account.displayName || account.label || account.username;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part.slice(0, 1)).join("").toUpperCase();

export function AccountSwitchScreen({ accounts, selected, pinDigits, busy, securing, message, recovery,
  onChoose, onBack, onUnlock, onSignIn, onRetry, onForgetBrowser, onCancelUnconfirmed, checkingChange = false }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  const submitted = useRef(false);
  const pinId = useId();
  const descriptionId = useId();
  const [search, setSearch] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);
  const needle = search.trim().toLocaleLowerCase();
  const filtered = accounts.filter(account => [accountName(account), account.username, account.jobTitle].some(value => value?.toLocaleLowerCase().includes(needle)));
  const mode = securing ? "securing" : selected?.proofId ?? "chooser";
  useLayoutEffect(() => {
    if (selected && !securing) input.current?.focus();
    else heading.current?.focus();
  }, [mode]);
  useLayoutEffect(() => {
    if (busy || !submitted.current) return;
    submitted.current = false;
    const field = input.current;
    const active = document.activeElement;
    if (field && document.visibilityState === "visible" &&
      (!active || active === document.body || field.form?.contains(active))) field.focus();
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || securing || !selected) return;
    const form = event.currentTarget;
    const pin = String(new FormData(form).get("devicePin") ?? "");
    if (!new RegExp(`^[0-9]{${pinDigits}}$`).test(pin)) { input.current?.reportValidity(); return; }
    form.reset();
    submitted.current = true;
    await onUnlock(pin);
  }

  return <main className="account-switch-layout min-h-dvh bg-base-200 p-3 text-base-content sm:p-5">
    <aside className="relative hidden flex-col justify-between overflow-hidden rounded-xl bg-primary px-8 py-10 text-primary-content lg:flex xl:px-10">
      <div className="flex items-center gap-3"><BrandMark variant="simple-white-bold" height={48} /><span className="font-display text-2xl font-semibold">BunkFy</span></div>
      <div className="relative z-10 py-16">
        <p className="mb-5 text-xs font-bold uppercase text-accent">Ready for your shift</p>
        <h2 className="font-display text-4xl font-semibold leading-tight xl:text-5xl">Your team.<br />Your workspace.</h2>
        <p className="mt-6 max-w-xs text-base leading-7 text-primary-content/70">Pick your account and get back to what matters. Everything stays right where your team left it.</p>
        <div className="mt-9 flex items-center gap-2 text-sm text-primary-content/75"><LockKeyhole size={16} aria-hidden="true" />Your own access. Your own PIN.</div>
      </div>
      <p className="text-xs text-primary-content/50">A calmer way to run every stay.</p>
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-28 size-80 rounded-full border-[3rem] border-primary-content/5" />
    </aside>

    <section className="flex min-w-0 flex-col justify-center px-4 py-8 sm:px-8 lg:px-10 xl:px-14" aria-labelledby="account-switch-title" aria-busy={busy}>
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-10 flex items-center gap-3 lg:hidden"><BrandMark variant="simple-white-bold" framed height={40} /><span className="font-display text-2xl font-semibold">BunkFy</span></div>
        <p className="text-xs font-bold uppercase text-primary">Fast switching</p>
        <h1 id="account-switch-title" ref={heading} tabIndex={-1} className="mt-3 rounded font-display text-3xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary xl:text-4xl">
          {securing ? checkingChange ? "Checking account change" : "Securing this browser" : "Choose your account"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-base-content/55">{securing
          ? "The previous account stays hidden until BunkFy confirms the result."
          : "Find your name, enter your PIN, and you’re ready to go."}</p>

        {message && <p className="mt-5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6" role="alert">{message}</p>}

        {securing ? <div className="mt-8 max-w-md">
          {busy ? <p className="flex items-center gap-3 text-sm" role="status"><span className="loading loading-spinner loading-sm text-primary" />{checkingChange ? "Confirming the account change…" : "Confirming the server lock…"}</p>
            : <button type="button" className="btn btn-primary w-full gap-2" onClick={onRetry}><RefreshCw size={17} aria-hidden="true" />{checkingChange ? "Check result" : "Retry lock"}</button>}
          <p className="mt-4 text-xs leading-5 text-base-content/55">Already submitted work may still finish under the previous account. Switching does not cancel it.</p>
          {onCancelUnconfirmed && <div className="mt-5 border-t border-base-300 pt-5">
            <p className="mb-3 text-sm leading-6">You can stop unconfirmed setup and ask BunkFy to lock this browser. It stays hidden until the lock is confirmed.</p>
            <button type="button" className="btn btn-outline h-auto min-h-11 w-full whitespace-normal" disabled={busy} onClick={() => void onCancelUnconfirmed()}>Cancel unconfirmed setup and lock browser</button>
          </div>}
        </div> : <>
          <div className="mt-8 flex items-center gap-3">
            <label className="input h-12 min-w-0 flex-1 gap-3 bg-base-100">
              <Search size={18} className="shrink-0 text-base-content/40" aria-hidden="true" />
              <input type="search" aria-label="Search accounts" placeholder="Search by name or job title" value={search} disabled={busy || recovery} onChange={event => { setSearch(event.target.value); strip.current?.scrollTo({ left: 0 }); }} />
            </label>
            <div className="flex shrink-0 gap-1">
              <button type="button" className="btn btn-circle btn-ghost btn-sm" aria-label="Previous accounts" disabled={busy || recovery} onClick={() => strip.current?.scrollBy({ left: -strip.current.clientWidth * 0.8, behavior: "smooth" })}><ChevronLeft size={20} /></button>
              <button type="button" className="btn btn-circle btn-ghost btn-sm" aria-label="Next accounts" disabled={busy || recovery} onClick={() => strip.current?.scrollBy({ left: strip.current.clientWidth * 0.8, behavior: "smooth" })}><ChevronRight size={20} /></button>
            </div>
          </div>
          <ul ref={strip} aria-label="Remembered accounts" className="account-switch-strip mt-5 grid grid-flow-col gap-3 overflow-x-auto overscroll-x-contain pb-3" style={{ gridAutoColumns: "minmax(8rem, calc((100% - 3.75rem) / 6))" }}>
            <li className="min-w-0">
              <button type="button" aria-label="Sign in with another account" disabled={busy || recovery} onClick={onSignIn} className="flex min-h-44 w-full flex-col items-center rounded-xl border border-dashed border-base-content/20 px-3 py-5 text-center transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
                <span className="mb-4 grid size-14 place-items-center rounded-full bg-base-300/60 text-base-content/50"><Plus size={25} aria-hidden="true" /></span>
                <span className="text-sm font-semibold">Sign in with another account</span><span className="mt-1 text-xs text-base-content/45">Add account normally</span>
              </button>
            </li>
            {filtered.map(account => <li key={account.proofId} className="min-w-0">
              <button type="button" aria-pressed={selected?.proofId === account.proofId} disabled={busy || recovery} onClick={() => onChoose(account)} className={`relative flex min-h-44 w-full flex-col items-center rounded-xl border px-3 py-5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${selected?.proofId === account.proofId ? "border-primary bg-primary/6" : "border-base-300 bg-base-100 hover:border-primary/40 hover:bg-primary/3"}`}>
                {selected?.proofId === account.proofId && <Check size={15} className="absolute right-2 top-2 text-primary" aria-hidden="true" />}
                <span className="mb-4 grid size-14 place-items-center rounded-full bg-secondary/12 text-lg font-semibold text-secondary" aria-hidden="true">{initials(accountName(account))}</span>
                <span className="text-sm font-semibold leading-5 [overflow-wrap:anywhere]">{accountName(account)}</span>
                {account.jobTitle && <span className="mt-1 text-xs leading-5 text-base-content/45 [overflow-wrap:anywhere]">{account.jobTitle}</span>}
                {account.requiresSignIn && <span className="mt-2 text-xs leading-4 text-base-content/55">Sign in to renew access</span>}
              </button>
            </li>)}
          </ul>
          {filtered.length === 0 && <p className="mt-2 text-sm text-base-content/55" role="status">{needle ? "No accounts match your search." : "No accounts remembered yet. Add yours to get started."}</p>}

          <div className="mx-auto mt-8 w-full max-w-sm">
            {selected ? <form key={selected.proofId} onSubmit={event => void submit(event)}>
              <h2 className="text-xl font-semibold">Welcome back, {accountName(selected).split(/\s+/)[0]}</h2>
              <p className="mt-1 text-xs text-base-content/50 [overflow-wrap:anywhere]">{selected.username}</p>
              <label htmlFor={pinId} className="mb-2 mt-6 block text-sm font-semibold">Your PIN</label>
              <input ref={input} id={pinId} name="devicePin" type="password" inputMode="numeric" autoComplete="off" required minLength={pinDigits} maxLength={pinDigits} pattern={`[0-9]{${pinDigits}}`} className="input h-12 w-full bg-base-100 text-center text-xl tracking-[0.3em]" disabled={busy} aria-describedby={descriptionId} />
              <p id={descriptionId} className="mt-2 text-xs text-base-content/45">{pinDigits} digits · Your PIN for this browser</p>
              <button type="submit" className="btn btn-primary mt-5 h-12 w-full gap-2" disabled={busy}><LogIn size={18} aria-hidden="true" />{busy ? "Signing in…" : recovery ? "Retry this sign-in" : "Unlock account"}</button>
              {!recovery && <button type="button" className="mt-3 w-full text-center text-xs text-base-content/55 hover:underline" disabled={busy} onClick={onSignIn}>Forgot PIN? Sign in with password</button>}
              <button type="button" className="btn btn-ghost mt-2 w-full gap-2 text-xs" disabled={busy || recovery} onClick={onBack}><ArrowLeft size={14} />Choose another account</button>
            </form> : <div className="rounded-xl border border-base-300/70 bg-base-100/50 px-6 py-7 text-center"><LockKeyhole size={24} className="mx-auto mb-3 text-primary/60" aria-hidden="true" /><p className="text-sm text-base-content/55">Select your account above to enter your PIN.</p></div>}
          </div>
          <div className="mt-8 border-t border-base-300 pt-6 text-center">
            <p className="text-sm leading-6 text-base-content/55">New to BunkFy or can’t find your account? <button type="button" disabled={busy || recovery} onClick={onSignIn} className="inline-flex items-center gap-1 font-semibold text-blue-600 underline-offset-4 hover:underline disabled:opacity-50">Log in<ArrowRight size={14} aria-hidden="true" /></button></p>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <button type="button" className="flex items-center gap-1.5 text-xs text-base-content/45 hover:text-base-content" disabled={busy || recovery} onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />Refresh accounts</button>
            {onForgetBrowser && accounts.length > 0 && <button type="button" className="text-xs text-base-content/40 hover:text-base-content" disabled={busy || recovery} onClick={() => setConfirmForget(true)}>Forget all accounts on this browser</button>}
          </div>
        </>}
      </div>
      <Modal open={confirmForget} title="Forget all accounts on this browser?" closeDisabled={busy} onClose={() => setConfirmForget(false)}>
        <p className="text-sm leading-6">Every remembered account’s PIN will stop working on this browser. Everyone will need to sign in normally before setting up fast switching again. Real accounts, workspaces and sessions on other devices are not deleted.</p>
        <ModalActions><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirmForget(false)}>Cancel</button><button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setConfirmForget(false); void onForgetBrowser?.(); }}>Forget this browser</button></ModalActions>
      </Modal>
    </section>
  </main>;
}
