import { useMutation } from "@tanstack/react-query";
import { Building2, KeyRound, Mail, Phone, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StaffMember, StaffMemberMutationReceipt } from "../../api/types";
import { focusedResourceClass } from "../../app/resourceFocus";
import { ErrorState, StatusBadge } from "../../components/ui/primitives";
import {
  resolveStaffProfileUpdateAttempt,
  type StaffProfileUpdateAttempt,
} from "../staff/staffProfileUpdateAttempt";
import { StaffProfileFields } from "../workspaces/StaffProfileFields";
import type { StaffProfileDraft } from "../workspaces/staffOnboarding";

type AccountStaffProfilePanelProps = {
  member: StaffMember;
  focused: boolean;
  canMutate: boolean;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  onUpdated: (member: StaffMember) => void;
};

export function AccountStaffProfilePanel({
  member,
  focused,
  canMutate,
  request,
  onUpdated,
}: AccountStaffProfilePanelProps) {
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<StaffProfileDraft>(() => staffDraft(member));
  const updateAttempt = useRef<StaffProfileUpdateAttempt | null>(null);

  useEffect(() => setProfile(staffDraft(member)), [member]);
  useEffect(() => {
    updateAttempt.current = null;
  }, [member.staffMemberId]);
  useEffect(() => {
    if (canMutate) return;
    updateAttempt.current = null;
    setEditing(false);
  }, [canMutate]);

  const update = useMutation({
    mutationFn: async () => {
      const payload = {
        ...profile,
        legalName: profile.legalName.trim() || null,
        workEmail: profile.workEmail.trim() || null,
        workPhone: profile.workPhone.trim() || null,
        jobTitle: profile.jobTitle.trim() || null,
        department: profile.department.trim() || null,
      };
      updateAttempt.current = await resolveStaffProfileUpdateAttempt(
        updateAttempt.current,
        member.staffMemberId,
        member.version,
        payload,
      );
      await request<StaffMemberMutationReceipt>("/api/staff/me", {
        method: "PUT",
        body: JSON.stringify({
          ...payload,
          operationId: updateAttempt.current.operationId,
          expectedVersion: updateAttempt.current.expectedVersion,
        }),
      });
      return request<StaffMember>("/api/staff/me");
    },
    onSuccess: (updated) => {
      updateAttempt.current = null;
      onUpdated(updated);
      setEditing(false);
    },
  });

  function cancelEditing() {
    updateAttempt.current = null;
    setProfile(staffDraft(member));
    setEditing(false);
    update.reset();
  }

  return (
    <section className={`max-w-5xl ${focused ? focusedResourceClass : ""}`}>
      <div className="flex flex-col gap-4 border-b border-base-300 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Building2 size={20} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold">Workspace profile</h2>
              <StatusBadge status="Workspace owned" />
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-base-content/55">
              Contact and work details visible to your team. This profile does not control workspace membership, roles, or sign-in methods.
            </p>
          </div>
        </div>
        {!editing && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)} disabled={!canMutate}>
            Edit profile
          </button>
        )}
      </div>

      {!canMutate && (
        <div className="mt-5 rounded-lg bg-warning/10 px-4 py-3 text-sm text-warning-content">
          This profile is a saved view. Refresh account data before editing it.
        </div>
      )}

      <div className="pt-5">
        {editing ? (
          <form onSubmit={(event) => { event.preventDefault(); if (canMutate) update.mutate(); }}>
            <StaffProfileFields value={profile} onChange={setProfile} />
            {update.error && <div className="mt-4"><ErrorState error={update.error} /></div>}
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-5">
              <button type="button" className="btn btn-ghost" onClick={cancelEditing} disabled={update.isPending}>Cancel</button>
              <button className="btn btn-primary text-white" disabled={update.isPending || !canMutate || !profile.displayName.trim()}>
                {update.isPending && <span className="loading loading-spinner loading-sm" />}
                Save profile
              </button>
            </div>
          </form>
        ) : (
          <div className="grid overflow-hidden rounded-lg border border-base-300 sm:grid-cols-2 lg:grid-cols-3">
            <ProfileFact icon={<UserRound />} label="Display name" value={member.displayName} />
            <ProfileFact icon={<UserRound />} label="Legal name" value={member.legalName || "Not provided"} />
            <ProfileFact icon={<Mail />} label="Work email" value={member.workEmail || "Not provided"} />
            <ProfileFact icon={<Phone />} label="Work phone" value={member.workPhone || "Not provided"} />
            <ProfileFact icon={<KeyRound />} label="Job title" value={member.jobTitle || "Not provided"} />
            <ProfileFact icon={<Building2 />} label="Department" value={member.department || "Not provided"} />
          </div>
        )}
      </div>
    </section>
  );
}

function ProfileFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 border-b border-base-300 bg-base-100 p-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-r lg:[&:nth-child(3n)]:border-r-0 lg:[&:nth-last-child(-n+3)]:border-b-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-base-200 text-primary [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-base-content/45">{label}</p>
        <p className="mt-1 break-words text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function staffDraft(member: StaffMember): StaffProfileDraft {
  return {
    displayName: member.displayName,
    legalName: member.legalName ?? "",
    workEmail: member.workEmail ?? "",
    workPhone: member.workPhone ?? "",
    jobTitle: member.jobTitle ?? "",
    department: member.department ?? "",
  };
}
