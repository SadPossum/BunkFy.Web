import { LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import type { SessionIdentity } from "../../app/singleFlightRefresh";
import { BrandMark } from "../../components/ui/BrandMark";
import { ErrorState } from "../../components/ui/primitives";

export function SessionRecoveryPage({
  error,
  identity,
  isRestoring,
  onRetry,
  onUseAnotherAccount,
}: {
  error: unknown;
  identity: SessionIdentity;
  isRestoring: boolean;
  onRetry: () => void;
  onUseAnotherAccount: () => void;
}) {
  return (
    <main className="auth-grid min-h-screen bg-base-200 p-3 sm:p-5">
      <section className="relative hidden overflow-hidden bg-primary p-10 text-primary-content lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10 flex items-center gap-3">
          <BrandMark variant="simple-white-bold" height={52} />
          <span className="font-display text-2xl font-semibold">BunkFy</span>
        </div>
        <div className="relative z-10 max-w-xl">
          <ShieldCheck className="mb-5 text-accent" size={34} strokeWidth={1.7} />
          <h1 className="font-display text-4xl font-semibold leading-tight">
            Your workspace stays protected while we reconnect.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-primary-content/70">
            BunkFy keeps the saved account choice on this device, but does not open workspace data until the browser session is confirmed.
          </p>
        </div>
        <p className="relative z-10 text-sm text-primary-content/60">
          No operational changes are sent during recovery.
        </p>
      </section>

      <section className="flex min-h-[calc(100vh-1.5rem)] min-w-0 items-center bg-base-100 px-6 py-12 sm:min-h-[calc(100vh-2.5rem)] sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-md" aria-live="polite" aria-busy={isRestoring}>
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <BrandMark variant="simple-white-bold" height={44} framed />
            <span className="font-display text-xl font-semibold">BunkFy</span>
          </div>
          <p className="text-xs font-semibold uppercase text-primary">Saved browser session</p>
          <h2 className="mt-2 font-display text-3xl font-semibold leading-tight">
            {isRestoring ? "Reconnecting to BunkFy" : "We couldn't reconnect yet"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-base-content/60">
            Checking the saved session for <strong className="break-all font-semibold text-base-content">{identity.username}</strong>. Workspace data remains locked until this check succeeds.
          </p>

          {isRestoring ? (
            <div className="mt-8 flex items-center gap-3 border-y border-base-300 py-5 text-sm font-medium text-base-content/65">
              <LoaderCircle className="animate-spin text-primary" size={20} />
              Confirming your secure browser session...
            </div>
          ) : (
            <div className="mt-7">
              <ErrorState error={error} retry={onRetry} />
            </div>
          )}

          <button
            type="button"
            className="btn btn-ghost mt-5 px-0 text-base-content/65 hover:bg-transparent hover:text-base-content"
            onClick={onUseAnotherAccount}
          >
            <LogOut size={17} />
            Use another account
          </button>
        </div>
      </section>
    </main>
  );
}
