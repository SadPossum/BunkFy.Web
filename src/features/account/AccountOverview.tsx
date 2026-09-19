import {
  ArrowRight,
  Building2,
  Clock3,
  KeyRound,
  Link2,
  MailCheck,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import type {
  AuthenticationMethods,
  AuthenticationSessions,
  MultiFactorStatus,
  StaffMember,
} from "../../api/types";
import type { CompositeSourceState } from "../../app/compositeSourceState";
import { InitialAvatar, StatusBadge } from "../../components/ui/primitives";
import type { AccountSection } from "./accountSections";

type AccountOverviewProps = {
  username: string;
  workspaceName: string | null;
  staffProfile: StaffMember | undefined;
  staffProfileState: CompositeSourceState;
  methods: AuthenticationMethods | undefined;
  methodsState: CompositeSourceState;
  mfaStatus: MultiFactorStatus | undefined;
  mfaState: CompositeSourceState;
  sessions: AuthenticationSessions | undefined;
  sessionsState: CompositeSourceState;
  onOpenSection: (section: AccountSection) => void;
};

export function AccountOverview({
  username,
  workspaceName,
  staffProfile,
  staffProfileState,
  methods,
  methodsState,
  mfaStatus,
  mfaState,
  sessions,
  sessionsState,
  onOpenSection,
}: AccountOverviewProps) {
  const activeEmail = methods?.emails.find((email) => email.isActive);
  const activeSessions = sessions?.sessions.length ?? 0;
  const securityRows = [
    {
      icon: KeyRound,
      label: "Password",
      detail: methods?.hasPassword ? "Available for sign-in" : "External sign-in only",
      status: sourceStatus(methodsState, methods?.hasPassword ? "Configured" : "Not configured"),
      section: "security" as const,
    },
    {
      icon: MailCheck,
      label: "Account email",
      detail: activeEmail?.email ?? username,
      status: sourceStatus(methodsState, activeEmail?.isVerified ? "Verified" : "Unverified"),
      section: "security" as const,
    },
    {
      icon: Smartphone,
      label: "Multi-factor authentication",
      detail: mfaStatus?.providerAvailable === false
        ? "Authenticator unavailable in this environment"
        : "Authenticator and recovery codes",
      status: sourceStatus(mfaState, mfaStatus?.isActive ? "Active" : "Not configured"),
      section: "security" as const,
    },
    {
      icon: Link2,
      label: "External accounts",
      detail: `${methods?.externalIdentities.length ?? 0} linked provider${methods?.externalIdentities.length === 1 ? "" : "s"}`,
      status: sourceStatus(methodsState, methods?.externalIdentities.length ? "Linked" : "None linked"),
      section: "security" as const,
    },
    {
      icon: MonitorSmartphone,
      label: "Active sessions",
      detail: "Review browsers and revoke access",
      status: sourceStatus(sessionsState, `${activeSessions} active`),
      section: "sessions" as const,
    },
  ];

  return (
    <div className="max-w-5xl">
      <section className="flex flex-col gap-5 border-b border-base-300 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <InitialAvatar name={username} variant="solid" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-primary">Signed-in account</p>
            <h2 className="mt-1 break-all font-display text-xl font-semibold">{username}</h2>
            <p className="mt-1 text-sm text-base-content/55">Personal security and session owner</p>
          </div>
        </div>
        <StatusBadge status="Active" />
      </section>

      <section className="border-b border-base-300 py-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Building2 size={18} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">Workspace identity</h2>
            <p className="mt-1 text-sm leading-6 text-base-content/55">
              Staff profile details are workspace-owned and do not grant account access or permissions.
            </p>
          </div>
        </div>
        <dl className="mt-5 grid overflow-hidden rounded-lg border border-base-300 bg-base-200/45 sm:grid-cols-3 sm:divide-x sm:divide-base-300">
          <OverviewFact label="Current workspace" value={workspaceName ?? "No workspace selected"} icon={<Building2 />} />
          <OverviewFact
            label="Staff profile"
            value={sourceValue(staffProfileState, staffProfile?.displayName ?? "Not ready")}
            icon={<UserRound />}
          />
          <OverviewFact
            label="Staff profile created"
            value={sourceValue(
              staffProfileState,
              staffProfile ? new Date(staffProfile.createdAtUtc).toLocaleDateString() : "Not available",
            )}
            icon={<Clock3 />}
          />
        </dl>
        {workspaceName && (
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn btn-ghost btn-sm text-primary" onClick={() => onOpenSection("profile")}>
              Open workspace profile
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </section>

      <section className="pt-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck size={18} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">Security at a glance</h2>
            <p className="mt-1 text-sm leading-6 text-base-content/55">
              Scan the current account safeguards, then open the owning section to make a change.
            </p>
          </div>
        </div>
        <div className="mt-5 divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300">
          {securityRows.map((row) => {
            const Icon = row.icon;
            return (
              <button
                key={row.label}
                type="button"
                className="flex w-full items-center gap-3 bg-base-100 px-4 py-3.5 text-left transition hover:bg-base-200/60 focus-visible:bg-base-200/60"
                onClick={() => onOpenSection(row.section)}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-base-200 text-primary">
                  <Icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{row.label}</span>
                  <span className="mt-0.5 block break-words text-xs text-base-content/50">{row.detail}</span>
                </span>
                <StatusBadge status={row.status} />
                <ArrowRight size={16} className="hidden shrink-0 text-base-content/35 sm:block" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function OverviewFact({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3 px-4 py-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-base-100 text-primary shadow-xs [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-base-content/45">{label}</dt>
        <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
      </div>
    </div>
  );
}

function sourceValue(state: CompositeSourceState, value: string): string {
  if (state === "loading") return "Loading...";
  if (state === "unavailable") return "Unavailable";
  return state === "stale" ? `${value} (saved view)` : value;
}

function sourceStatus(state: CompositeSourceState, value: string): string {
  if (state === "loading") return "Loading";
  if (state === "unavailable") return "Unavailable";
  return state === "stale" ? "Saved view" : value;
}
