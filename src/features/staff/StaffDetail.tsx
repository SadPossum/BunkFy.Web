import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CircleUserRound,
  Edit3,
  KeyRound,
  Link2,
  Mail,
  Phone,
  ShieldAlert,
  Unlink2,
  UserRoundCheck,
  UserRoundMinus,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  Property,
  StaffMember,
  StaffMemberMutationReceipt,
} from "../../api/types";
import { staffStatusLabel } from "../../api/labels";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import { DatePicker } from "../../components/ui/DatePicker";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import {
  ErrorState,
  InitialAvatar,
  InlineFormActions,
  LoadingState,
  Modal,
  StatusBadge,
} from "../../components/ui/primitives";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import {
  resolveStaffAuthSubjectChangeAttempt,
  type StaffAuthSubjectChangeAttempt,
} from "./staffAuthSubjectChangeAttempt";
import {
  resolveStaffAuthSubjectTransition,
} from "./staffAuthSubjectTransition";
import { StaffAuthorityNotice } from "./StaffAuthorityNotice";
import { StaffAssignmentsPanel } from "./StaffAssignmentsPanel";
import {
  resolveStaffLifecycleAttempt,
  type StaffLifecycleAttempt,
} from "./staffLifecycleAttempt";
import {
  staffLifecycleActionMatches,
  staffMutationAllowed,
  staffRecordMatches,
  staffSensitiveRecordMatches,
} from "./staffMutationAuthority";
import {
  isFullStaffMember,
  staffStatusKey,
  type StaffDetailMember,
} from "./staffPresentation";
import { StaffProfileForm } from "./StaffProfileForm";
import {
  resolveDurableStaffProfileUpdateAttempt,
  type StaffProfileUpdateAttempt,
} from "./staffProfileUpdateAttempt";
import type { StaffCreatePayload } from "./staffCreateAttempt";

type StaffDetailTab = "profile" | "assignments" | "account";
type LifecycleAction = "suspend" | "resume" | "depart";

type LifecycleTarget = {
  tenantId: string;
  member: StaffDetailMember;
  action: LifecycleAction;
};

type LifecycleSubmission = LifecycleTarget & {
  reason: string;
  effectiveOn: string;
};

type ProfileSubmission = {
  tenantId: string;
  member: StaffMember;
  payload: StaffCreatePayload;
};

type AuthSubjectSubmission = {
  tenantId: string;
  member: StaffMember;
  authSubjectId: string | null;
};

export function StaffDetail({
  tenantId,
  memberId,
  initialTab,
  properties,
  selectedProperty,
  propertySource,
  permissionSource,
  assignmentPermissionSource,
  canReadSensitive,
  canManage,
  canManageAccountLinks,
  canManageLifecycle,
  canAssignCurrentProperty,
  onClose,
}: {
  tenantId: string;
  memberId: string | null;
  initialTab: StaffDetailTab;
  properties: Property[];
  selectedProperty: Property | null;
  propertySource: CompositeSource;
  permissionSource: CompositeSource;
  assignmentPermissionSource: CompositeSource | null;
  canReadSensitive: boolean;
  canManage: boolean;
  canManageAccountLinks: boolean;
  canManageLifecycle: boolean;
  canAssignCurrentProperty: boolean;
  onClose: () => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<StaffDetailTab>(
    initialTab === "account" && !canReadSensitive ? "profile" : initialTab,
  );
  const [editingTarget, setEditingTarget] = useState<StaffMember | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const profileAttempt = useRef<StaffProfileUpdateAttempt | null>(null);
  const authSubjectAttempt = useRef<StaffAuthSubjectChangeAttempt | null>(null);
  const lifecycleAttempt = useRef<StaffLifecycleAttempt | null>(null);
  const scopeKey = `${tenantId}:${memberId ?? "none"}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  const directory = useQuery({
    queryKey: ["staff-member", memberId, tenantId, "directory"],
    queryFn: () => request<StaffDetailMember>(`/api/staff/members/${memberId}`),
    enabled: Boolean(memberId),
  });
  const profile = useQuery({
    queryKey: ["staff-member", memberId, tenantId, "profile"],
    queryFn: () => request<StaffMember>(`/api/staff/members/${memberId}/profile`),
    enabled: Boolean(memberId && canReadSensitive),
  });
  const directorySource = createCompositeSource({
    label: "Staff directory detail",
    hasData: directory.data !== undefined,
    isLoading: directory.isLoading,
    error: directory.error,
    isFetching: directory.isFetching,
    refetch: () => directory.refetch(),
  });
  const profileSource = createCompositeSource({
    label: "Sensitive Staff profile",
    hasData: canReadSensitive && profile.data !== undefined,
    isLoading: canReadSensitive && profile.isLoading,
    error: canReadSensitive ? profile.error : null,
    isFetching: canReadSensitive && profile.isFetching,
    refetch: () => profile.refetch(),
  });
  const permissionsCurrent = compositeSourceCurrent(permissionSource);
  const directoryCurrent = compositeSourceCurrent(directorySource);
  const profileCurrent = canReadSensitive && compositeSourceCurrent(profileSource);
  const directoryUsable = compositeSourceUsable(directorySource.state);
  const profileUsable = canReadSensitive && compositeSourceUsable(profileSource.state);
  const currentRecords = [
    ...(directoryCurrent && directory.data ? [{ item: directory.data, source: directorySource }] : []),
    ...(profileCurrent && profile.data ? [{ item: profile.data, source: profileSource }] : []),
  ].sort((left, right) => right.item.version - left.item.version);
  const currentMember = currentRecords[0]?.item ?? null;
  const item = currentMember ??
    (directoryUsable ? directory.data : undefined) ??
    (profileUsable ? profile.data : undefined);
  const itemSource = currentRecords[0]?.source ??
    (directoryUsable && directory.data ? directorySource : profileSource);
  const fullProfile = profileUsable ? profile.data ?? null : null;
  const detailSources = [
    permissionSource,
    directorySource,
    ...(canReadSensitive ? [profileSource] : []),
  ];
  const detailLoading = !item && (
    directorySource.state === "loading" ||
    (canReadSensitive && profileSource.state === "loading")
  );

  const editingAuthorityCurrent = Boolean(
    editingTarget &&
      canManage &&
      canReadSensitive &&
      staffStatusKey(editingTarget.status) !== "departed" &&
      staffMutationAllowed("update-profile", {
        permissionsCurrent,
        memberCurrent: profileCurrent &&
          staffSensitiveRecordMatches(profile.data, editingTarget),
      }),
  );
  const lifecycleAuthorityCurrent = Boolean(
    lifecycleTarget &&
      canManageLifecycle &&
      staffLifecycleActionMatches(lifecycleTarget.member, lifecycleTarget.action) &&
      staffMutationAllowed("lifecycle", {
        permissionsCurrent,
        memberCurrent: staffRecordMatches(currentMember, lifecycleTarget.member),
      }),
  );
  const profileActionCurrent = Boolean(
    fullProfile &&
      canManage &&
      staffStatusKey(fullProfile.status) !== "departed" &&
      staffMutationAllowed("update-profile", {
        permissionsCurrent,
        memberCurrent: profileCurrent &&
          staffSensitiveRecordMatches(profile.data, fullProfile),
      }),
  );
  const lifecycleActionCurrent = Boolean(
    item &&
      canManageLifecycle &&
      staffMutationAllowed("lifecycle", {
        permissionsCurrent,
        memberCurrent: staffRecordMatches(currentMember, item),
      }),
  );
  const accountAuthorityCurrent = Boolean(
    fullProfile &&
      canReadSensitive &&
      canManageAccountLinks &&
      staffMutationAllowed("account-link", {
        permissionsCurrent,
        memberCurrent: profileCurrent &&
          staffSensitiveRecordMatches(profile.data, fullProfile),
      }),
  );

  async function refresh(targetTenantId: string, targetMemberId: string) {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["staff-member", targetMemberId, targetTenantId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["staff-members", targetTenantId],
      }),
    ]);
  }

  const profileMutation = useMutation<StaffMemberMutationReceipt, Error, ProfileSubmission>({
    mutationFn: async ({ tenantId: targetTenantId, member, payload }) => {
      const authorityCurrent = scopeKeyRef.current === `${targetTenantId}:${member.staffMemberId}` &&
        canManage && canReadSensitive &&
        staffMutationAllowed("update-profile", {
          permissionsCurrent,
          memberCurrent: profileCurrent &&
            staffSensitiveRecordMatches(profile.data, member),
        });
      if (!authorityCurrent) {
        throw new Error("Current Staff profile and access evidence could not be confirmed. Refresh and try again.");
      }
      profileAttempt.current = await resolveDurableStaffProfileUpdateAttempt(
        profileAttempt.current,
        member.staffMemberId,
        member.version,
        payload,
      );
      return request<StaffMemberMutationReceipt>(
        `/api/staff/members/${member.staffMemberId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...payload,
            operationId: profileAttempt.current.operationId,
            expectedVersion: profileAttempt.current.expectedVersion,
          }),
        },
      );
    },
    onSuccess: async (_receipt, submission) => {
      profileAttempt.current = null;
      await refresh(submission.tenantId, submission.member.staffMemberId);
      if (scopeKeyRef.current === `${submission.tenantId}:${submission.member.staffMemberId}`) {
        setEditingTarget(null);
      }
    },
    onError: async (_error, submission) => {
      await refresh(submission.tenantId, submission.member.staffMemberId);
    },
  });

  const lifecycleMutation = useMutation<StaffMemberMutationReceipt, Error, LifecycleSubmission>({
    mutationFn: async ({ tenantId: targetTenantId, member, action, reason, effectiveOn }) => {
      const authorityCurrent = scopeKeyRef.current === `${targetTenantId}:${member.staffMemberId}` &&
        canManageLifecycle &&
        staffLifecycleActionMatches(member, action) &&
        staffMutationAllowed("lifecycle", {
          permissionsCurrent,
          memberCurrent: staffRecordMatches(currentMember, member),
        });
      if (!authorityCurrent) {
        throw new Error("Current Staff lifecycle and access evidence could not be confirmed. Refresh and try again.");
      }
      lifecycleAttempt.current = await resolveStaffLifecycleAttempt(
        lifecycleAttempt.current,
        member.staffMemberId,
        member.version,
        action,
        reason,
        effectiveOn,
      );
      const attempt = lifecycleAttempt.current;
      return request<StaffMemberMutationReceipt>(
        `/api/staff/members/${member.staffMemberId}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(action === "depart"
            ? {
                operationId: attempt.operationId,
                effectiveOn,
                reason,
                expectedVersion: attempt.expectedVersion,
              }
            : {
                operationId: attempt.operationId,
                reason,
                expectedVersion: attempt.expectedVersion,
              }),
        },
      );
    },
    onSuccess: async (_receipt, submission) => {
      lifecycleAttempt.current = null;
      await refresh(submission.tenantId, submission.member.staffMemberId);
      if (scopeKeyRef.current === `${submission.tenantId}:${submission.member.staffMemberId}`) {
        setLifecycleTarget(null);
      }
    },
    onError: async (_error, submission) => {
      await refresh(submission.tenantId, submission.member.staffMemberId);
    },
  });

  const authMutation = useMutation<StaffMemberMutationReceipt, Error, AuthSubjectSubmission>({
    mutationFn: async ({ tenantId: targetTenantId, member, authSubjectId }) => {
      const transition = resolveStaffAuthSubjectTransition(
        staffStatusKey(member.status),
        Boolean(member.authSubjectId),
        canManageAccountLinks,
        canManageLifecycle,
      );
      const intentAllowed = authSubjectId ? transition.canEdit : transition.canClear;
      const authorityCurrent = scopeKeyRef.current === `${targetTenantId}:${member.staffMemberId}` &&
        intentAllowed &&
        staffMutationAllowed("account-link", {
          permissionsCurrent,
          memberCurrent: profileCurrent &&
            staffSensitiveRecordMatches(profile.data, member),
        });
      if (!authorityCurrent) {
        throw new Error("Current Staff account-link and access evidence could not be confirmed. Refresh and try again.");
      }
      authSubjectAttempt.current = await resolveStaffAuthSubjectChangeAttempt(
        authSubjectAttempt.current,
        member.staffMemberId,
        member.version,
        authSubjectId,
      );
      return request<StaffMemberMutationReceipt>(
        `/api/staff/members/${member.staffMemberId}/auth-subject`,
        {
          method: "PUT",
          body: JSON.stringify({
            authSubjectId,
            operationId: authSubjectAttempt.current.operationId,
            expectedVersion: authSubjectAttempt.current.expectedVersion,
          }),
        },
      );
    },
    onSuccess: async (_receipt, submission) => {
      authSubjectAttempt.current = null;
      await refresh(submission.tenantId, submission.member.staffMemberId);
    },
    onError: async (error, submission) => {
      if (isInsufficientAuthenticationError(error)) return;
      await refresh(submission.tenantId, submission.member.staffMemberId);
    },
  });

  useEffect(() => {
    setTab(initialTab === "account" && !canReadSensitive ? "profile" : initialTab);
    setEditingTarget(null);
    setLifecycleTarget(null);
    profileAttempt.current = null;
    authSubjectAttempt.current = null;
    lifecycleAttempt.current = null;
  }, [canReadSensitive, initialTab, scopeKey]);

  useEffect(() => {
    if (!permissionsCurrent) return;
    if (!canReadSensitive) {
      setTab((current) => current === "account" ? "profile" : current);
      setEditingTarget(null);
      authSubjectAttempt.current = null;
    }
    if (!canManage) {
      profileAttempt.current = null;
      setEditingTarget(null);
    }
    if (!canManageLifecycle) {
      lifecycleAttempt.current = null;
      setLifecycleTarget(null);
    }
  }, [canManage, canManageLifecycle, canReadSensitive, permissionsCurrent]);

  function openLifecycle(action: LifecycleAction) {
    if (!item || !lifecycleActionCurrent || !staffLifecycleActionMatches(item, action)) return;
    lifecycleAttempt.current = null;
    lifecycleMutation.reset();
    setLifecycleTarget({ tenantId, member: item, action });
  }

  function retryAuthAfterAuthentication() {
    const submission = authMutation.variables;
    if (!submission) return;
    authMutation.reset();
    authMutation.mutate(submission);
  }

  const authNeedsAuthentication = isInsufficientAuthenticationError(authMutation.error);

  return (
    <Modal
      open={Boolean(memberId)}
      size="lg"
      title={item?.displayName || "Staff profile"}
      description={item
        ? `${item.jobTitle || "Staff member"}${item.department ? ` / ${item.department}` : ""}`
        : "Loading staff profile"}
      onClose={onClose}
    >
      <CompositeSourceNotice
        sources={detailSources}
        title="Staff profile context is delayed"
      />
      {detailLoading ? (
        <LoadingState label="Loading staff profile" />
      ) : !item ? (
        <CompositeSourceFallback state="unavailable" label="staff profile" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 rounded-2xl bg-base-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <InitialAvatar name={item.displayName} variant="solid" />
              <div>
                <p className="font-semibold">{item.displayName}</p>
                <p className="text-xs text-base-content/50">{item.jobTitle || item.department || "Staff directory"}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={staffStatusLabel(item.status)} />
              {canManageLifecycle && staffStatusKey(item.status) === "active" && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={!lifecycleActionCurrent} onClick={() => openLifecycle("suspend")}>
                  <UserRoundMinus size={15} />Suspend
                </button>
              )}
              {canManageLifecycle && staffStatusKey(item.status) === "suspended" && (
                <button type="button" className="btn btn-primary btn-sm" disabled={!lifecycleActionCurrent} onClick={() => openLifecycle("resume")}>
                  <UserRoundCheck size={15} />Resume
                </button>
              )}
              {canManageLifecycle && staffStatusKey(item.status) !== "departed" && (
                <button type="button" className="btn btn-ghost btn-sm text-error" disabled={!lifecycleActionCurrent} onClick={() => openLifecycle("depart")}>
                  <UserRoundX size={15} />Depart
                </button>
              )}
            </div>
          </div>

          {lifecycleTarget && (
            <LifecyclePanel
              target={lifecycleTarget}
              sources={[permissionSource, itemSource]}
              authorityCurrent={lifecycleAuthorityCurrent}
              submitting={lifecycleMutation.isPending}
              error={lifecycleMutation.error}
              onCancel={() => {
                lifecycleAttempt.current = null;
                setLifecycleTarget(null);
                lifecycleMutation.reset();
              }}
              onConfirm={(reason, effectiveOn) => {
                if (!lifecycleAuthorityCurrent) return;
                lifecycleMutation.mutate({
                  ...lifecycleTarget,
                  reason,
                  effectiveOn,
                });
              }}
            />
          )}

          <SegmentedTabs
            stretch
            value={tab}
            ariaLabel="Staff details"
            onValueChange={setTab}
            options={[
              { value: "profile", label: "Profile", icon: <CircleUserRound size={15} /> },
              { value: "assignments", label: "Assignments", icon: <Building2 size={15} /> },
              ...(canReadSensitive
                ? [{ value: "account" as const, label: "Account", icon: <KeyRound size={15} /> }]
                : []),
            ]}
          />

          {tab === "profile" && (
            <section className="rounded-2xl border border-base-300 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg font-semibold">Profile</h3>
                  <p className="mt-1 text-xs text-base-content/50">Workspace identity and role information.</p>
                </div>
                {fullProfile && canManage && !editingTarget && staffStatusKey(fullProfile.status) !== "departed" && (
                  <button type="button" className="btn btn-ghost btn-sm text-primary" disabled={!profileActionCurrent} onClick={() => {
                    if (!profileActionCurrent) return;
                    profileAttempt.current = null;
                    profileMutation.reset();
                    setEditingTarget(fullProfile);
                  }}>
                    <Edit3 size={15} />Edit
                  </button>
                )}
              </div>
              {editingTarget ? (
                <StaffProfileForm
                  member={editingTarget}
                  submitting={profileMutation.isPending}
                  error={profileMutation.error}
                  submitLabel="Save profile"
                  sources={[permissionSource, profileSource]}
                  authorityCurrent={editingAuthorityCurrent}
                  authorityMessage="Current Staff profile or access evidence is refreshing or no longer matches this form. If it remains disabled, cancel and reopen the latest profile."
                  onCancel={() => {
                    profileAttempt.current = null;
                    setEditingTarget(null);
                    profileMutation.reset();
                  }}
                  onSubmit={(payload) => {
                    if (!editingAuthorityCurrent) return;
                    profileMutation.mutate({ tenantId, member: editingTarget, payload });
                  }}
                />
              ) : (
                <ProfileDetails member={fullProfile ?? item} />
              )}
            </section>
          )}

          {tab === "assignments" && (
            <StaffAssignmentsPanel
              tenantId={tenantId}
              member={item}
              currentMember={currentMember}
              memberSource={itemSource}
              properties={properties}
              selectedProperty={selectedProperty}
              propertySource={propertySource}
              assignmentPermissionSource={assignmentPermissionSource}
              canAssign={canAssignCurrentProperty}
              onUpdated={refresh}
            />
          )}

          {tab === "account" && canReadSensitive && (
            fullProfile ? (
              <>
                <AccountLinkPanel
                  member={fullProfile}
                  canManageAccountLinks={canManageAccountLinks}
                  canManageLifecycle={canManageLifecycle}
                  authorityCurrent={accountAuthorityCurrent}
                  suspensionEnabled={lifecycleActionCurrent}
                  submitting={authMutation.isPending || authNeedsAuthentication}
                  error={authNeedsAuthentication ? null : authMutation.error}
                  onRequestSuspension={() => openLifecycle("suspend")}
                  onSave={(authSubjectId) => {
                    if (!accountAuthorityCurrent) return;
                    authMutation.mutate({ tenantId, member: fullProfile, authSubjectId });
                  }}
                />
                {authNeedsAuthentication && (
                  <RecentAuthenticationPrompt
                    error={authMutation.error}
                    title="Confirm your password to change the account link"
                    description="Staff account linking is a sensitive identity action and requires a recent sign-in."
                    onAuthenticated={retryAuthAfterAuthentication}
                  />
                )}
              </>
            ) : (
              <CompositeSourceFallback state={profileSource.state} label="sensitive Staff profile" />
            )
          )}

          <div className="flex justify-end border-t border-base-300 pt-5">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProfileDetails({ member }: { member: StaffDetailMember }) {
  if (!isFullStaffMember(member)) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoRow icon={<BriefcaseBusiness />} label="Job title" value={member.jobTitle || "Not provided"} />
        <InfoRow icon={<UsersRound />} label="Department" value={member.department || "Not provided"} />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <InfoRow icon={<CircleUserRound />} label="Legal name" value={member.legalName || "Not provided"} />
      <InfoRow icon={<BadgeCheck />} label="Employee number" value={member.employeeNumber || "Not provided"} />
      <InfoRow icon={<Mail />} label="Work email" value={member.workEmail || "Not provided"} href={member.workEmail ? `mailto:${member.workEmail}` : undefined} />
      <InfoRow icon={<Phone />} label="Work phone" value={member.workPhone || "Not provided"} href={member.workPhone ? `tel:${member.workPhone}` : undefined} />
      <InfoRow icon={<BriefcaseBusiness />} label="Job title" value={member.jobTitle || "Not provided"} />
      <InfoRow icon={<UsersRound />} label="Department" value={member.department || "Not provided"} />
    </div>
  );
}

function LifecyclePanel({
  target,
  sources,
  authorityCurrent,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  target: LifecycleTarget;
  sources: CompositeSource[];
  authorityCurrent: boolean;
  submitting: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (reason: string, effectiveOn: string) => void;
}) {
  const today = utcDateKey(new Date());
  const [reason, setReason] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(today);
  const copy = target.action === "suspend"
    ? {
        title: `Suspend ${target.member.displayName}?`,
        body: "They remain in staff records but should no longer be treated as active staff.",
        button: "Suspend staff member",
      }
    : target.action === "resume"
      ? {
          title: `Resume ${target.member.displayName}?`,
          body: "This returns the staff profile to active status.",
          button: "Resume staff member",
        }
      : {
          title: `Record ${target.member.displayName} as departed?`,
          body: "All current property assignments end on the effective date. This cannot be reversed from the UI.",
          button: "Record departure",
        };

  return (
    <section className="rounded-lg border border-warning/30 bg-warning/8 p-4">
      <CompositeSourceNotice className="mb-4" sources={sources} title="Staff lifecycle context is delayed" />
      {!authorityCurrent && (
        <div className="mb-4">
          <StaffAuthorityNotice message="Current Staff lifecycle or access evidence is refreshing or no longer matches this confirmation. If it remains disabled, cancel and reopen it." />
        </div>
      )}
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 shrink-0 text-warning" size={19} />
        <div>
          <h3 className="font-semibold">{copy.title}</h3>
          <p className="mt-1 text-sm leading-6 text-base-content/60">{copy.body}</p>
        </div>
      </div>
      <fieldset disabled={!authorityCurrent || submitting} className={`mt-4 grid gap-4 ${target.action === "depart" ? "sm:grid-cols-[1fr_180px]" : ""}`}>
        <label className="form-control block">
          <span className="label-text mb-1.5 block text-sm font-semibold">Reason</span>
          <textarea
            className="textarea textarea-bordered min-h-20 w-full"
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Add a clear operational reason"
            required
          />
        </label>
        {target.action === "depart" && (
          <div className="form-control block">
            <span className="label-text mb-1.5 block text-sm font-semibold">Effective date</span>
            <DatePicker
              className="w-full"
              value={effectiveOn}
              max={today}
              onChange={setEffectiveOn}
              ariaLabel="Effective date"
              required
            />
          </div>
        )}
      </fieldset>
      {Boolean(error) && <div className="mt-4"><ErrorState error={error} /></div>}
      <InlineFormActions>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          type="button"
          className={`btn btn-sm ${target.action === "resume" ? "btn-primary" : "btn-error"}`}
          onClick={() => onConfirm(reason.trim(), effectiveOn)}
          disabled={submitting || !reason.trim() || !authorityCurrent}
        >
          {submitting && <span className="loading loading-spinner loading-xs" />}
          {copy.button}
        </button>
      </InlineFormActions>
    </section>
  );
}

function AccountLinkPanel({
  member,
  canManageAccountLinks,
  canManageLifecycle,
  authorityCurrent,
  suspensionEnabled,
  submitting,
  error,
  onRequestSuspension,
  onSave,
}: {
  member: StaffMember;
  canManageAccountLinks: boolean;
  canManageLifecycle: boolean;
  authorityCurrent: boolean;
  suspensionEnabled: boolean;
  submitting: boolean;
  error: unknown;
  onRequestSuspension: () => void;
  onSave: (value: string | null) => void;
}) {
  const [value, setValue] = useState(member.authSubjectId || "");
  useEffect(() => setValue(member.authSubjectId || ""), [member.authSubjectId]);
  const transition = resolveStaffAuthSubjectTransition(
    staffStatusKey(member.status),
    Boolean(member.authSubjectId),
    canManageAccountLinks,
    canManageLifecycle,
  );
  const normalizedValue = value.trim();

  return (
    <section className="rounded-2xl border border-base-300 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <KeyRound size={19} />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold">Sign-in account link</h3>
          <p className="mt-1 text-sm leading-6 text-base-content/55">Connect the employment profile to one BunkFy account.</p>
        </div>
      </div>
      {!authorityCurrent && canManageAccountLinks && (
        <div className="mt-4">
          <StaffAuthorityNotice message="Current sensitive Staff profile or account-link access is refreshing. Account changes remain disabled until it recovers." />
        </div>
      )}
      <label className="form-control mt-5 block">
        <span className="label-text mb-1.5 block text-sm font-semibold">Sign-in account ID</span>
        <input
          className="input input-bordered w-full font-mono text-sm"
          value={value}
          maxLength={256}
          disabled={!transition.canEdit || !authorityCurrent}
          placeholder="Not linked"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <div className={`mt-4 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${transition.attention ? "border-warning/30 bg-warning/8" : "border-base-300 bg-base-200"}`}>
        <p className="text-sm leading-6 text-base-content/65">{transition.guidance}</p>
        {transition.canRequestSuspension && (
          <button type="button" className="btn btn-ghost btn-sm shrink-0" disabled={!suspensionEnabled} onClick={onRequestSuspension}>
            <UserRoundMinus size={15} />Suspend first
          </button>
        )}
      </div>
      {Boolean(error) && <div className="mt-4"><ErrorState error={error} /></div>}
      {(transition.canClear || transition.canEdit) && (
        <InlineFormActions>
          {transition.canClear && (
            <button type="button" className="btn btn-error btn-sm" onClick={() => onSave(null)} disabled={submitting || !authorityCurrent}>
              <Unlink2 size={15} />Clear account link
            </button>
          )}
          {transition.canEdit && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(normalizedValue)} disabled={submitting || !normalizedValue || !authorityCurrent}>
              {submitting && <span className="loading loading-spinner loading-xs" />}
              <Link2 size={15} />Link account
            </button>
          )}
        </InlineFormActions>
      )}
    </section>
  );
}

function InfoRow({
  icon,
  label,
  value,
  href,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-base-300 p-4">
      <span className="mt-0.5 text-primary">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-base-content/40">{label}</p>
        {href ? (
          <a className="mt-1 block truncate text-sm font-semibold text-primary hover:underline" href={href}>{value}</a>
        ) : (
          <p className="mt-1 truncate text-sm font-semibold">{value}</p>
        )}
      </div>
    </div>
  );
}

function utcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
