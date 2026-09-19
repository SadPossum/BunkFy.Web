import { LogOut, MonitorSmartphone } from "lucide-react";
import type { AuthenticationSession } from "../../api/types";
import type { CompositeSourceState } from "../../app/compositeSourceState";
import { CompositeSourceFallback } from "../../components/ui/CompositeSourceNotice";
import { ErrorState, StatusBadge } from "../../components/ui/primitives";

type AccountSessionsPanelProps = {
  sessions: AuthenticationSession[];
  sourceState: CompositeSourceState;
  canRevoke: boolean;
  revokePending: boolean;
  revokeError: unknown;
  signOutError: unknown;
  submitting: "current" | "all" | null;
  confirmAll: boolean;
  onConfirmAll: (confirming: boolean) => void;
  onRevoke: (sessionId: string) => void;
  onSignOut: (mode: "current" | "all") => void;
};

export function AccountSessionsPanel({
  sessions,
  sourceState,
  canRevoke,
  revokePending,
  revokeError,
  signOutError,
  submitting,
  confirmAll,
  onConfirmAll,
  onRevoke,
  onSignOut,
}: AccountSessionsPanelProps) {
  const usable = sourceState === "ready" || sourceState === "stale";
  return (
    <section className="max-w-4xl">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <MonitorSmartphone size={20} />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">Active sessions</h2>
          <p className="mt-1 text-sm leading-6 text-base-content/55">
            Review every browser session and revoke access you no longer recognize or use.
          </p>
        </div>
      </div>

      {Boolean(signOutError) && <div className="mt-5"><ErrorState error={signOutError} /></div>}
      {!usable ? (
        <div className="mt-5"><CompositeSourceFallback state={sourceState} label="active sessions" /></div>
      ) : sessions.length ? (
        <div className="mt-5 max-h-[32rem] divide-y divide-base-300 overflow-y-auto overscroll-contain rounded-lg border border-base-300" aria-label="Active sessions list">
          {sessions.map((item) => (
            <div key={item.sessionId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{authenticationMethodLabel(item.authenticationMethod)}</p>
                  {item.isCurrent && <StatusBadge status="This browser" />}
                </div>
                <p className="mt-1 break-words text-xs leading-5 text-base-content/50">
                  Signed in {formatDateTime(item.loginDateTimeUtc)} · active until {new Date(item.refreshTokenExpiresAtUtc).toLocaleDateString()}
                </p>
              </div>
              {!item.isCurrent && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error"
                  disabled={revokePending || !canRevoke}
                  onClick={() => onRevoke(item.sessionId)}
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-base-300 px-5 py-8 text-center">
          <p className="text-sm font-semibold">No active sessions were returned</p>
          <p className="mt-1 text-xs text-base-content/50">Refresh this section before making a session decision.</p>
        </div>
      )}

      {sourceState === "stale" && (
        <p className="mt-4 rounded-lg bg-warning/10 px-4 py-3 text-sm text-warning-content">
          This is a saved session view. Refresh it before revoking another browser.
        </p>
      )}
      {Boolean(revokeError) && <div className="mt-4"><ErrorState error={revokeError} /></div>}

      {!confirmAll ? (
        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-5">
          <button type="button" className="btn btn-ghost" onClick={() => onSignOut("current")} disabled={submitting != null}>
            <LogOut size={16} />
            {submitting === "current" ? "Signing out..." : "Sign out this browser"}
          </button>
          <button type="button" className="btn btn-outline btn-error" onClick={() => onConfirmAll(true)} disabled={submitting != null}>
            Sign out everywhere
          </button>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <h3 className="font-semibold">Sign out on every device?</h3>
          <p className="mt-1 text-sm leading-6 text-base-content/60">
            All refresh sessions will be revoked, including this browser. You will need to sign in again everywhere.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onConfirmAll(false)} disabled={submitting != null}>Cancel</button>
            <button type="button" className="btn btn-error btn-sm text-white" onClick={() => onSignOut("all")} disabled={submitting != null}>
              {submitting === "all" && <span className="loading loading-spinner loading-xs" />}
              Sign out everywhere
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function authenticationMethodLabel(value: string): string {
  return value.toLowerCase() === "password" ? "Password sign-in" : `${providerLabel(value)} sign-in`;
}

function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
