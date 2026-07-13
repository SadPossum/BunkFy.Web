import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarCheck2,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { apiRequest, resolveApiBaseUrl } from "../../api/client";
import type { ExternalAuthenticationProviderList } from "../../api/types";
import { useSession } from "../../app/session";
import { BrandMark } from "../../components/ui/BrandMark";

export function AuthPage() {
  const { beginExternalSignIn, login, register } = useSession();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [tenantId, setTenantId] = useState("default");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [externalSubmitting, setExternalSubmitting] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");
  const providers = useQuery({
    queryKey: ["auth", "external-providers"],
    queryFn: () =>
      apiRequest<ExternalAuthenticationProviderList>(
        "/api/auth/external/providers",
      ),
    staleTime: 5 * 60_000,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (
      mode === "register" &&
      password !== String(data.get("confirmPassword") ?? "")
    ) {
      setError("Passwords do not match.");
      setSubmitting(false);
      return;
    }

    try {
      const credentials = {
        tenantId: tenantId.trim(),
        username: String(data.get("username") ?? "").trim(),
        password,
      };
      await (mode === "login" ? login(credentials) : register(credentials));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Authentication failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function continueWithProvider(provider: string) {
    setExternalSubmitting(provider);
    setError("");
    try {
      await beginExternalSignIn(provider, tenantId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "External authentication could not start.",
      );
      setExternalSubmitting(null);
    }
  }

  const providerCodes = providers.data?.providers ?? [];
  return (
    <main className="auth-grid min-h-screen bg-base-200 p-3 sm:p-5">
      <section className="relative hidden overflow-hidden bg-primary p-10 text-primary-content lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10 flex items-center gap-3">
          <BrandMark variant="simple-white-bold" height={52} />
          <span className="font-display text-2xl font-semibold">BunkFy</span>
        </div>
        <div className="relative z-10 max-w-xl">
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.2em] text-accent">
            Your hostel, in focus
          </p>
          <h1 className="font-display text-5xl font-semibold leading-[1.08] xl:text-6xl">
            A calmer way to run every stay.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-primary-content/70">
            Reservations, rooms, beds and availability stay connected, so your
            team can move quickly without losing the details.
          </p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-3">
          {[
            { icon: CalendarCheck2, label: "Reservations" },
            { icon: Building2, label: "Properties" },
            { icon: ShieldCheck, label: "Staff access" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="border border-primary-content/10 bg-primary-content/8 p-4"
            >
              <Icon size={20} className="mb-3 text-accent" />
              <p className="text-sm font-semibold">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-4 py-10 sm:min-h-[calc(100vh-2.5rem)] sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <BrandMark variant="simple-white-bold" height={48} framed />
            <span className="font-display text-2xl font-semibold">BunkFy</span>
          </div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Staff workspace
          </p>
          <h2 className="font-display text-4xl font-semibold">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-base-content/55">
            {mode === "login"
              ? "Sign in to continue managing your property."
              : "Register a staff account for your tenant workspace."}
          </p>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="form-control block">
              <span className="label-text mb-2 block text-sm font-semibold">
                Workspace ID
              </span>
              <input
                name="tenantId"
                className="input input-bordered h-12 w-full bg-base-100"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                autoComplete="organization"
                required
              />
              <span className="mt-2 text-xs text-base-content/45">
                Usually "default" for a local BunkFy installation.
              </span>
            </label>
            <label className="form-control block">
              <span className="label-text mb-2 block text-sm font-semibold">
                Email
              </span>
              <input
                name="username"
                type="email"
                className="input input-bordered h-12 w-full bg-base-100"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
            <PasswordField
              name="password"
              label="Password"
              show={showPassword}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              onToggle={() => setShowPassword((value) => !value)}
            />
            {mode === "register" && (
              <PasswordField
                name="confirmPassword"
                label="Confirm password"
                show={showPassword}
                autoComplete="new-password"
              />
            )}
            {error && (
              <div className="alert alert-error py-3 text-sm">
                <span>{error}</span>
              </div>
            )}
            <button
              className="btn btn-primary h-12 w-full text-base"
              disabled={submitting || externalSubmitting !== null}
            >
              {submitting && (
                <span className="loading loading-spinner loading-sm" />
              )}
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          {providerCodes.length > 0 && (
            <div className="mt-6">
              <div className="divider text-xs uppercase text-base-content/35">
                or
              </div>
              <div className="grid gap-2">
                {providerCodes.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className="btn btn-outline h-12"
                    disabled={externalSubmitting !== null || submitting}
                    onClick={() => void continueWithProvider(provider)}
                  >
                    {externalSubmitting === provider ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <KeyRound size={17} />
                    )}
                    Continue with {providerLabel(provider)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-6 text-center text-sm text-base-content/55">
            {mode === "login"
              ? "New to this workspace?"
              : "Already have an account?"}{" "}
            <button
              className="link link-primary font-semibold no-underline hover:underline"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {mode === "login" ? "Register" : "Sign in"}
            </button>
          </p>
          <p className="mt-10 text-center text-xs text-base-content/35">
            Connected to {resolveApiBaseUrl()}
          </p>
        </div>
      </section>
    </main>
  );
}

function PasswordField({
  name,
  label,
  show,
  autoComplete,
  onToggle,
}: {
  name: string;
  label: string;
  show: boolean;
  autoComplete: string;
  onToggle?: () => void;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-2 block text-sm font-semibold">
        {label}
      </span>
      <div className="relative">
        <input
          name={name}
          type={show ? "text" : "password"}
          className="input input-bordered h-12 w-full bg-base-100 pr-12"
          placeholder="Password"
          autoComplete={autoComplete}
          required
          minLength={8}
        />
        {onToggle && (
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm absolute right-2 top-2"
            onClick={onToggle}
            aria-label={show ? "Hide passwords" : "Show passwords"}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
    </label>
  );
}

function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
