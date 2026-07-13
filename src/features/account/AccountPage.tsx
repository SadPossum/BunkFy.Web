import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { useSession } from "../../app/session";
import { ErrorState, InitialAvatar, PageHeader } from "../../components/ui/primitives";

export function AccountPage() {
  const { session, request, logout, logoutAll } = useSession();
  const tenant = useQuery({ queryKey: ["tenant-current", session?.tenantId], queryFn: () => request<{ tenantId: string; isEnabled: boolean }>("/api/tenants/current") });
  const [confirmAll, setConfirmAll] = useState(false);
  const [submitting, setSubmitting] = useState<"current" | "all" | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function signOut(mode: "current" | "all") {
    setSubmitting(mode); setError(null);
    try { if (mode === "all") await logoutAll(); else await logout(); } catch (caught) { setError(caught); setSubmitting(null); }
  }
  return <>
    <PageHeader eyebrow="Personal settings" title="Account" description="Review the active workspace identity and control your signed-in sessions." />
    <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
      <section className="card border border-base-300 bg-base-100 shadow-sm"><div className="card-body p-6"><div className="flex items-center gap-4"><InitialAvatar name={session?.username} variant="solid" /><div className="min-w-0"><h2 className="truncate font-display text-xl font-semibold">{session?.username}</h2><p className="mt-1 text-sm text-base-content/50">Current sign-in identity</p></div></div><div className="my-3 h-px bg-base-300" /><div className="space-y-3"><AccountRow icon={<UserRound />} label="Username" value={session?.username || "Unknown"} /><AccountRow icon={<ShieldCheck />} label="Tenant" value={tenant.data?.tenantId || session?.tenantId || "Unknown"} /><AccountRow icon={<ShieldCheck />} label="Tenant scoping" value={tenant.isLoading ? "Checking…" : tenant.data?.isEnabled ? "Enabled" : "Unavailable"} /><AccountRow icon={<KeyRound />} label="Session storage" value="Secure browser cookie + in-memory access" /></div></div></section>
      <section className="card border border-base-300 bg-base-100 shadow-sm"><div className="card-body p-6"><div className="flex items-start gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><MonitorSmartphone size={21} /></div><div><h2 className="font-display text-xl font-semibold">Signed-in sessions</h2><p className="mt-1 text-sm leading-6 text-base-content/55">Sign out this browser, or revoke every active refresh session for your account.</p></div></div>{Boolean(error) && <ErrorState error={error} />} {!confirmAll ? <div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => void signOut("current")} disabled={submitting != null}><LogOut size={16} />{submitting === "current" ? "Signing out…" : "Sign out this browser"}</button><button type="button" className="btn btn-outline btn-error" onClick={() => setConfirmAll(true)} disabled={submitting != null}>Sign out everywhere</button></div> : <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/8 p-4"><h3 className="font-semibold">Sign out on every device?</h3><p className="mt-1 text-sm leading-6 text-base-content/60">All refresh sessions will be revoked, including this browser. You’ll need to sign in again everywhere.</p><div className="mt-4 flex justify-end gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmAll(false)} disabled={submitting != null}>Cancel</button><button type="button" className="btn btn-error btn-sm" onClick={() => void signOut("all")} disabled={submitting != null}>{submitting === "all" && <span className="loading loading-spinner loading-xs" />}Sign out everywhere</button></div></div>}</div></section>
    </div>
  </>;
}

function AccountRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex items-start gap-3 rounded-xl border border-base-300 p-4"><span className="mt-0.5 text-primary">{icon}</span><div className="min-w-0"><p className="text-xs text-base-content/40">{label}</p><p className="mt-1 break-all text-sm font-semibold">{value}</p></div></div>; }
import { useQuery } from "@tanstack/react-query";
