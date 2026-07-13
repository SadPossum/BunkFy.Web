import { Building2, CalendarCheck2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { resolveApiBaseUrl } from "../../api/client";
import { useSession } from "../../app/session";
import { BrandMark } from "../../components/ui/BrandMark";

export function AuthPage() {
  const { login, register } = useSession();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const credentials = {
        tenantId: String(data.get("tenantId") ?? "").trim(),
        username: String(data.get("username") ?? "").trim(),
        password: String(data.get("password") ?? ""),
      };
      await (mode === "login" ? login(credentials) : register(credentials));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-grid min-h-screen bg-base-200 p-3 sm:p-5">
      <section className="relative hidden overflow-hidden rounded-[2rem] bg-primary p-10 text-primary-content lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -bottom-28 left-1/4 size-80 rounded-full bg-secondary/20 blur-3xl" />
        <div className="relative z-10 flex items-center gap-3">
          <BrandMark variant="simple-white-bold" height={52} />
          <span className="font-display text-2xl font-semibold">BunkFy</span>
        </div>
        <div className="relative z-10 max-w-xl">
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.2em] text-accent">Your hostel, in focus</p>
          <h1 className="font-display text-5xl font-semibold leading-[1.08] tracking-tight xl:text-6xl">A calmer way to run every stay.</h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-primary-content/70">Reservations, rooms, beds and availability stay connected—so your team can move quickly without losing the details.</p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-3">
          {[{ icon: CalendarCheck2, label: "Reservations" }, { icon: Building2, label: "Properties" }, { icon: ShieldCheck, label: "Staff access" }].map(({ icon: Icon, label }) => (
            <div key={label} className="rounded-2xl border border-primary-content/10 bg-primary-content/8 p-4 backdrop-blur"><Icon size={20} className="mb-3 text-accent" /><p className="text-sm font-semibold">{label}</p></div>
          ))}
        </div>
      </section>

      <section className="flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-4 py-10 sm:min-h-[calc(100vh-2.5rem)] sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <BrandMark variant="simple-white-bold" height={48} framed />
            <span className="font-display text-2xl font-semibold">BunkFy</span>
          </div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Staff workspace</p>
          <h2 className="font-display text-4xl font-semibold tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="mt-3 text-sm leading-6 text-base-content/55">{mode === "login" ? "Sign in to continue managing your property." : "Register a staff account for your tenant workspace."}</p>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="form-control block">
              <span className="label-text mb-2 block text-sm font-semibold">Workspace ID</span>
              <input name="tenantId" className="input input-bordered h-12 w-full bg-base-100" defaultValue="default" autoComplete="organization" required />
              <span className="mt-2 text-xs text-base-content/45">Usually “default” for a local BunkFy installation.</span>
            </label>
            <label className="form-control block">
              <span className="label-text mb-2 block text-sm font-semibold">Email</span>
              <input name="username" type="email" className="input input-bordered h-12 w-full bg-base-100" placeholder="you@example.com" autoComplete="email" required />
            </label>
            <label className="form-control block">
              <span className="label-text mb-2 block text-sm font-semibold">Password</span>
              <div className="relative">
                <input name="password" type={showPassword ? "text" : "password"} className="input input-bordered h-12 w-full bg-base-100 pr-12" placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
                <button type="button" className="btn btn-circle btn-ghost btn-sm absolute right-2 top-2" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
            </label>
            {error && <div className="alert alert-error py-3 text-sm"><span>{error}</span></div>}
            <button className="btn btn-primary h-12 w-full text-base" disabled={submitting}>{submitting && <span className="loading loading-spinner loading-sm" />}{mode === "login" ? "Sign in" : "Create account"}</button>
          </form>

          <p className="mt-6 text-center text-sm text-base-content/55">
            {mode === "login" ? "New to this workspace?" : "Already have an account?"}{" "}
            <button className="link link-primary font-semibold no-underline hover:underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Register" : "Sign in"}</button>
          </p>
          <p className="mt-10 text-center text-xs text-base-content/35">Connected to {resolveApiBaseUrl()}</p>
        </div>
      </section>
    </main>
  );
}
