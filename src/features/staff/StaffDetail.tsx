import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  CircleUserRound,
  Edit3,
  KeyRound,
  Link2,
  Mail,
  MoreHorizontal,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Unlink2,
  UserRoundCheck,
  UserRoundMinus,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type {
  Property,
  StaffMember,
  StaffMemberMutationReceipt,
} from "../../api/types";
import { staffStatusLabel } from "../../api/labels";
import { ApiError } from "../../api/client";
import { browserIsOnline } from "../../api/requestConnectivity";
import { useNetworkStatus } from "../../app/networkStatus";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import {
  compositeSourceCurrent,
  compositeSourceNeedsRetry,
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
  InlineFormActions,
  LoadingState,
  Modal,
  StatusBadge,
} from "../../components/ui/primitives";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { focusModalRecoveryFeedback, modalControlVisible, modalIsTopmost } from "../../components/ui/modalFocus";
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
  assignmentIsCurrent,
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
  canReadSensitive,
  canManage,
  canManageAccountLinks,
  canManageLifecycle,
  onSectionChange,
  onClose,
}: {
  tenantId: string;
  memberId: string | null;
  initialTab: StaffDetailTab;
  properties: Property[];
  selectedProperty: Property | null;
  propertySource: CompositeSource;
  permissionSource: CompositeSource;
  canReadSensitive: boolean;
  canManage: boolean;
  canManageAccountLinks: boolean;
  canManageLifecycle: boolean;
  onSectionChange: (section: StaffDetailTab) => void;
  onClose: () => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<StaffDetailTab>(
    initialTab === "account" && !canReadSensitive ? "profile" : initialTab,
  );
  const [editingTarget, setEditingTarget] = useState<StaffMember | null>(null);
  const [clearedProfile, setClearedProfile] = useState<{ scope: string; submitted: boolean } | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const profileAttempt = useRef<StaffProfileUpdateAttempt | null>(null);
  const authSubjectAttempt = useRef<StaffAuthSubjectChangeAttempt | null>(null);
  const lifecycleAttempt = useRef<StaffLifecycleAttempt | null>(null);
  const employmentMenuRef = useRef<HTMLDetailsElement | null>(null);
  const profileArea = useRef<HTMLElement>(null);
  const accessFeedback = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const profileFocus = useRef<StaffProfileFocusIntent | null>(null);
  const recoveryArea = useRef<HTMLDivElement>(null);
  const recoveryFeedback = useRef<HTMLDivElement>(null);
  const recoveryFocus = useRef<StaffRetryFocusIntent | null>(null);
  const recoveryFlight = useRef<{ identity: string; promise: Promise<unknown> } | null>(null);
  const [recoveryPending, setRecoveryPending] = useState<string | null>(null);
  const { isOffline } = useNetworkStatus();
  const offlineRecoveryId = useId();
  const scopeKey = `${tenantId}:${memberId ?? "none"}`;
  const recoveryIdentity = `${scopeKey}:${tab}:${initialTab}:${canReadSensitive}`;
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
  const directoryDenied = useStaffReadDenial(directory, tenantId, memberId, "directory");
  const profileDenied = useStaffReadDenial(profile, tenantId, memberId, "profile");
  const directorySource = createCompositeSource({
    label: "Staff directory detail",
    hasData: !directoryDenied && directory.data !== undefined,
    isLoading: directory.isLoading,
    error: directory.error,
    isFetching: directory.isFetching,
    refetch: () => directory.refetch(),
  });
  const profileSource = createCompositeSource({
    label: "Sensitive Staff profile",
    hasData: canReadSensitive && !profileDenied && profile.data !== undefined,
    isLoading: canReadSensitive && profile.isLoading,
    error: canReadSensitive ? profile.error : null,
    isFetching: canReadSensitive && profile.isFetching,
    refetch: () => profile.refetch(),
  });
  const permissionsCurrent = compositeSourceCurrent(permissionSource);
  const directoryCurrent = !directoryDenied && compositeSourceCurrent(directorySource);
  const profileCurrent = canReadSensitive && !profileDenied && compositeSourceCurrent(profileSource);
  const directoryUsable = !directoryDenied && compositeSourceUsable(directorySource.state);
  const profileUsable = canReadSensitive && !profileDenied && compositeSourceUsable(profileSource.state);
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
  const retryPending = recoveryPending === recoveryIdentity;

  function retryDetails() {
    // CompositeSourceNotice invokes each affected callback. Share one flight so
    // a native activation captures focus once and refreshes each source once.
    if (recoveryFlight.current?.identity === recoveryIdentity) return recoveryFlight.current.promise;
    const sources = item ? detailSources.filter(source => compositeSourceNeedsRetry(source.state))
      : [directorySource, ...(canReadSensitive ? [profileSource] : [])];
    if (!browserIsOnline() || sources.some(source => source.isFetching)
      || ["directory", ...(canReadSensitive ? ["profile"] : [])].some(kind => {
        const state = queryClient.getQueryState(["staff-member", memberId, tenantId, kind]);
        return sources.includes(kind === "directory" ? directorySource : profileSource) && state && state.fetchStatus !== "idle";
      })) return Promise.resolve();
    recoveryFocus.current?.cancel();
    recoveryFocus.current = captureStaffRetryFocus(recoveryArea.current, recoveryIdentity);
    setRecoveryPending(recoveryIdentity);
    const flight = { identity: recoveryIdentity, promise: Promise.allSettled(sources.map(source => source.refetch())) };
    recoveryFlight.current = flight;
    void flight.promise.then(() => {
      if (recoveryFlight.current !== flight) return;
      recoveryFlight.current = null;
      setRecoveryPending(null);
    });
    return flight.promise;
  }

  useLayoutEffect(() => {
    const intent = recoveryFocus.current;
    if (!intent) return;
    if (intent.identity !== recoveryIdentity || !modalIsTopmost(intent.modal)) {
      intent.cancel(); recoveryFocus.current = null; return;
    }
    const target = retryPending ? recoveryFeedback.current
      : recoveryArea.current?.querySelector<HTMLElement>('button:not(:disabled)')
        ?? (tab === "profile" ? profileArea.current?.querySelector<HTMLElement>("h3") : intent.modal.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))
        ?? accessFeedback.current;
    moveStaffRetryFocus(intent, target ?? null);
    if (!retryPending) { intent.cancel(); recoveryFocus.current = null; }
  });

  useEffect(() => () => { recoveryFocus.current?.cancel(); }, [recoveryIdentity]);

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
      profileFocus.current?.cancel();
      profileFocus.current = null;
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
    employmentMenuRef.current?.removeAttribute("open");
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
  const currentAssignmentCount = item?.assignments.filter(assignmentIsCurrent).length ?? 0;
  const sensitiveHidden = !canReadSensitive || profileDenied;
  const visibleEditingTarget = !sensitiveHidden && canManage ? editingTarget : null;
  const submittedHere = Boolean(profileMutation.variables && profileMutation.variables.tenantId === tenantId
    && profileMutation.variables.member.staffMemberId === memberId);
  const clearedHere = clearedProfile?.scope === scopeKey ? clearedProfile : null;
  const clearingDraft = Boolean(editingTarget && sensitiveHidden);
  const showSubmittedNotice = (clearingDraft && submittedHere) || clearedHere?.submitted;

  useLayoutEffect(() => {
    if (directoryDenied || (canReadSensitive && profileDenied) || clearingDraft) {
      focusModalRecoveryFeedback(accessFeedback.current);
    }
  }, [directoryDenied, profileDenied, canReadSensitive, clearingDraft]);

  useEffect(() => {
    if (!sensitiveHidden) return;
    profileFocus.current?.cancel(); profileFocus.current = null;
    if (editingTarget) {
      setClearedProfile({ scope: scopeKey, submitted: submittedHere });
      setEditingTarget(null);
      // A server write is not cancelled by hiding its editor. Keep an already
      // submitted attempt and mutation receipt lifecycle intact until settlement.
      if (!submittedHere) profileAttempt.current = null;
    }
  }, [sensitiveHidden, editingTarget, scopeKey, submittedHere]);

  useLayoutEffect(() => {
    const intent = profileFocus.current;
    if (!intent) return;
    if (intent.identity !== scopeKey || tab !== "profile" || initialTab !== "profile" || !canManage || sensitiveHidden || !permissionsCurrent) {
      intent.cancel(); profileFocus.current = null; return;
    }
    if (intent.direction === "return" && (editingTarget || profileMutation.isPending)) return;
    const target = intent.direction === "enter"
      ? profileArea.current?.querySelector<HTMLElement>('input[name="displayName"]') ?? null
      : editButton.current;
    finishStaffProfileFocus(intent, target, intent.direction === "enter" ? editingAuthorityCurrent : profileActionCurrent);
    profileFocus.current = null;
  }, [scopeKey, tab, initialTab, canManage, sensitiveHidden, permissionsCurrent, editingTarget, editingAuthorityCurrent, profileActionCurrent, profileMutation.isPending]);

  useEffect(() => () => { profileFocus.current?.cancel(); }, []);

  function rememberProfileFocus(direction: StaffProfileFocusIntent["direction"]) {
    profileFocus.current?.cancel();
    profileFocus.current = captureStaffProfileFocus(profileArea.current, scopeKey, direction);
  }

  return (
    <div className="[&_h2]:line-clamp-2 [&_h2]:[overflow-wrap:anywhere]">
    <Modal
      open={Boolean(memberId)}
      size="lg"
      title={item?.displayName || "Staff profile"}
      description={item
        ? "Employment profile"
        : detailLoading ? "Loading staff profile"
          : directoryDenied || profileDenied ? "Access to staff details could not be confirmed" : "Staff profile is unavailable"}
      onClose={onClose}
    >
      {(directoryDenied || (canReadSensitive && profileDenied) || clearingDraft || clearedHere) && <div
        ref={accessFeedback} role="status" aria-label="Staff access update" tabIndex={-1}
        className="mb-4 scroll-my-2 space-y-3 rounded outline-none focus:ring-2 focus:ring-primary"
      >
      {(directoryDenied || (canReadSensitive && profileDenied)) && <p className="border-l-2 border-warning pl-3 text-sm leading-6">
        {directoryDenied && profileDenied
          ? "Staff details are hidden because access could not be confirmed. Try again to load fresh information."
          : profileDenied
            ? "Sensitive staff details are hidden because access could not be confirmed. Available directory information is shown separately."
            : "Staff directory details could not be confirmed. Separately available profile information is shown."}
      </p>}
      {(clearingDraft || clearedHere) && <p className="border-l-2 border-warning pl-3 text-sm leading-6">
        {showSubmittedNotice
          ? profileMutation.isPending
            ? "A profile save is still in progress. It has not been cancelled. Its result cannot be shown until access is restored."
            : profileMutation.isSuccess
              ? "The submitted profile save completed. Refresh access to view the current profile."
              : "A profile save was submitted, but its result could not be confirmed. Check the current profile before submitting again."
          : "Unsaved profile changes were cleared because access could not be confirmed. Reopen Edit after access is restored to start again."}
      </p>}
      </div>}
      <div ref={recoveryArea} className="contents">
      {retryPending ? <div ref={recoveryFeedback} role="status" aria-label="Refreshing staff details" tabIndex={-1}
        className="mb-4 rounded border border-base-300 p-4 text-sm outline-none focus:ring-2 focus:ring-primary">
        {isOffline ? "Waiting for a connection to refresh staff details." : "Refreshing staff details…"}
      </div> : item && <CompositeSourceNotice
        sources={detailSources.map(source => ({ ...source, refetch: retryDetails }))}
        title="Staff profile context is delayed"
      />}
      {!retryPending && (detailLoading ? (
        <LoadingState label="Loading staff profile" />
      ) : !item ? (
        <div role="group" aria-label="Staff profile recovery" aria-disabled={isOffline || undefined}
          aria-describedby={isOffline ? offlineRecoveryId : undefined}
          className={isOffline ? "[&_button]:cursor-not-allowed [&_button]:text-base-content/60" : undefined}>
        <CompositeSourceFallback
          error={directory.error ?? profile.error}
          retry={() => { void retryDetails(); }}
          state="unavailable"
          label="staff profile"
          title="Staff profile could not be opened"
        />
        {isOffline && <p id={offlineRecoveryId} role="status" className="px-4 pb-4 text-sm leading-6 sm:px-5">
          Reconnect to retry. Staff details cannot be loaded while you are offline.
        </p>}
        </div>
      ) : null)}
      </div>
      {item && (
        <div className="space-y-5">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-base-300 pb-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <StatusBadge status={staffStatusLabel(item.status)} />
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-base-content/55">
                <Building2 size={14} className="shrink-0 text-primary" />
                {currentAssignmentCount} current {currentAssignmentCount === 1 ? "property" : "properties"}
              </span>
            </div>
              {canManageLifecycle && staffStatusKey(item.status) !== "departed" && (
                <details ref={employmentMenuRef} className="dropdown dropdown-end">
                  <summary className="btn btn-outline btn-sm list-none [&::-webkit-details-marker]:hidden">
                    <MoreHorizontal size={15} />Employment actions<ChevronDown size={14} />
                  </summary>
                  <ul className="menu dropdown-content z-30 mt-2 w-56 rounded-lg border border-base-300 bg-base-100 p-2 shadow-lg">
                    {staffStatusKey(item.status) === "active" && (
                      <li><button type="button" disabled={!lifecycleActionCurrent} onClick={() => openLifecycle("suspend")}><UserRoundMinus size={15} />Suspend employment</button></li>
                    )}
                    {staffStatusKey(item.status) === "suspended" && (
                      <li><button type="button" disabled={!lifecycleActionCurrent} onClick={() => openLifecycle("resume")}><UserRoundCheck size={15} />Resume employment</button></li>
                    )}
                    <li><button type="button" className="text-error" disabled={!lifecycleActionCurrent} onClick={() => openLifecycle("depart")}><UserRoundX size={15} />Record departure</button></li>
                  </ul>
                </details>
              )}
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
            onValueChange={(nextTab) => {
              setTab(nextTab);
              onSectionChange(nextTab);
            }}
            options={[
              { value: "profile", label: "Profile", compactLabel: "Profile", icon: <CircleUserRound size={15} /> },
              { value: "assignments", label: "Work locations", compactLabel: "Locations", icon: <Building2 size={15} /> },
              ...(canReadSensitive
                ? [{ value: "account" as const, label: "Account link", compactLabel: "Account", icon: <KeyRound size={15} /> }]
                : []),
            ]}
          />

          {tab === "profile" && (
            <section ref={profileArea} className="min-w-0">
              <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-48">
                  <h3 tabIndex={-1} className="rounded font-display text-lg font-semibold outline-none focus:ring-2 focus:ring-primary">{visibleEditingTarget ? "Edit employment profile" : "Employment profile"}</h3>
                  <p className="mt-1 text-xs text-base-content/50">Employment, work contact, and internal identity details.</p>
                </div>
                {fullProfile && canManage && !editingTarget && staffStatusKey(fullProfile.status) !== "departed" && (
                  <button ref={editButton} type="button" className="btn btn-ghost btn-sm shrink-0 text-primary" disabled={!profileActionCurrent} onClick={() => {
                    if (!profileActionCurrent) return;
                    rememberProfileFocus("enter");
                    setClearedProfile(null);
                    profileAttempt.current = null;
                    profileMutation.reset();
                    setEditingTarget(fullProfile);
                  }}>
                    <Edit3 size={15} />Edit
                  </button>
                )}
              </div>
              {visibleEditingTarget ? (
                <StaffProfileForm
                  member={visibleEditingTarget}
                  submitting={profileMutation.isPending}
                  error={profileMutation.error}
                  submitLabel="Save profile"
                  sources={[permissionSource, profileSource]}
                  authorityCurrent={editingAuthorityCurrent}
                  authorityMessage="Current Staff profile or access evidence is refreshing or no longer matches this form. If it remains disabled, cancel and reopen the latest profile."
                  onCancel={() => {
                    rememberProfileFocus("return");
                    profileAttempt.current = null;
                    setEditingTarget(null);
                    profileMutation.reset();
                  }}
                  onSubmit={(payload) => {
                    if (!editingAuthorityCurrent) return;
                    rememberProfileFocus("return");
                    profileMutation.mutate({ tenantId, member: visibleEditingTarget, payload });
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
              assignmentHistory={fullProfile?.staffMemberId === item.staffMemberId && fullProfile.version === item.version
                ? fullProfile.assignments : null}
              historyRestricted={!canReadSensitive}
              historyStale={!profileCurrent}
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

        </div>
      )}
    </Modal>
    </div>
  );
}

// A denied read is not an ordinary stale-data outage. Conceal immediately, then
// evict only the settled denied cache entry owned by this tenant/member/source.
// The observer can retain its old result after removal, so keep a local latch
// until that observer receives a successful fresh result. Cache eviction also
// prevents a later route/modal mount from reviving the rejected snapshot on503.
function useStaffReadDenial(query: UseQueryResult<unknown, Error>, tenantId: string, memberId: string | null, kind: "directory" | "profile") {
  const client = useQueryClient();
  const identity = JSON.stringify([tenantId, memberId, kind]);
  const [deniedIdentity, setDeniedIdentity] = useState<string | null>(null);
  const observedDenial = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 401);
  const successfulRead = query.isSuccess && !query.isFetching && query.data !== undefined;
  const denied = observedDenial || (deniedIdentity === identity && !successfulRead);

  useEffect(() => {
    if (!memberId) return;
    if (observedDenial) {
      setDeniedIdentity(identity);
      if (query.isFetching || query.data === undefined) return;
      const key = ["staff-member", memberId, tenantId, kind];
      const cached = client.getQueryState(key);
      if (cached?.status === "error" && cached.fetchStatus === "idle"
        && cached.error === query.error && cached.data === query.data
        && cached.errorUpdatedAt === query.errorUpdatedAt && cached.dataUpdatedAt === query.dataUpdatedAt) {
        client.removeQueries({ queryKey: key, exact: true });
      }
    } else if (successfulRead && deniedIdentity === identity) {
      setDeniedIdentity(null);
    }
  }, [client, tenantId, memberId, kind, identity, observedDenial, successfulRead, deniedIdentity, query.isFetching, query.data, query.error, query.errorUpdatedAt, query.dataUpdatedAt]);
  return denied;
}

type StaffProfileFocusIntent = {
  identity: string;
  direction: "enter" | "return";
  source: HTMLElement;
  modal: HTMLElement;
  cancelled: boolean;
  cancel: () => void;
};

// Only a deliberate transition within this profile can request focus. A save
// may finish later; independent navigation must permanently cancel its intent.
function captureStaffProfileFocus(area: HTMLElement | null, identity: string, direction: StaffProfileFocusIntent["direction"]): StaffProfileFocusIntent | null {
  const activeElement = document.activeElement;
  const modal = area?.closest<HTMLElement>("[data-bunkfy-modal-box]");
  if (!(activeElement instanceof HTMLElement) || !area?.contains(activeElement) || !modal || !modalIsTopmost(modal)) return null;
  const source = activeElement;
  const intent: StaffProfileFocusIntent = { identity, direction, source, modal, cancelled: false,
    cancel: () => { intent.cancelled = true; document.removeEventListener("focusin", moved); } };
  function moved() {
    const active = document.activeElement;
    const handoff = !source.isConnected || source.matches(":disabled");
    if (active !== source && !(handoff && (active === modal || active === document.body))) intent.cancel();
  }
  document.addEventListener("focusin", moved);
  return intent;
}

function finishStaffProfileFocus(intent: StaffProfileFocusIntent, target: HTMLElement | null, authorityCurrent: boolean) {
  const active = document.activeElement;
  const allowed = !intent.cancelled && authorityCurrent && target && intent.modal.isConnected
    && target.closest("[data-bunkfy-modal-box]") === intent.modal && modalIsTopmost(intent.modal) && modalControlVisible(target)
    && (active === intent.source || ((!intent.source.isConnected || intent.source.matches(":disabled")) && (active === document.body || active === intent.modal)));
  intent.cancel();
  if (!allowed || !target) return;
  target.focus({ preventScroll: true });
  for (let port = target.parentElement; port && port !== intent.modal; port = port.parentElement) {
    if (!/^(auto|scroll)$/.test(getComputedStyle(port).overflowY)) continue;
    const rect = target.getBoundingClientRect(), bounds = port.getBoundingClientRect();
    port.scrollTop += rect.top < bounds.top + 8 ? rect.top - bounds.top - 8 : rect.bottom > bounds.bottom - 8 ? rect.bottom - bounds.bottom + 8 : 0;
    break;
  }
}

type StaffRetryFocusIntent = {
  identity: string;
  modal: HTMLElement;
  owned: HTMLElement;
  cancelled: boolean;
  cancel: () => void;
};

// Local read recovery, not an Edit transition: failure must remain reachable
// even when current authority cannot be confirmed. Explicit navigation wins.
function captureStaffRetryFocus(area: HTMLElement | null, identity: string): StaffRetryFocusIntent | null {
  const source = document.activeElement;
  const modal = area?.closest<HTMLElement>("[data-bunkfy-modal-box]");
  if (!(source instanceof HTMLElement) || !area?.contains(source) || !modal || !modalIsTopmost(modal)) return null;
  const intent: StaffRetryFocusIntent = { identity, modal, owned: source, cancelled: false, cancel: () => {
    intent.cancelled = true;
    document.removeEventListener("focusin", moved);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("pointerdown", pointer, true);
  } };
  function moved() {
    const active = document.activeElement;
    const handoff = !intent.owned.isConnected || intent.owned.matches(":disabled");
    if (active !== intent.owned && !(handoff && (active === modal || active === document.body))) intent.cancel();
  }
  function key(event: KeyboardEvent) { if (event.key === "Tab" || event.key === "Escape") intent.cancel(); }
  function pointer() { intent.cancel(); }
  document.addEventListener("focusin", moved);
  document.addEventListener("keydown", key, true);
  document.addEventListener("pointerdown", pointer, true);
  return intent;
}

function moveStaffRetryFocus(intent: StaffRetryFocusIntent, target: HTMLElement | null) {
  const active = document.activeElement;
  const handoff = !intent.owned.isConnected || intent.owned.matches(":disabled");
  if (intent.cancelled || !target || !modalIsTopmost(intent.modal) || !modalControlVisible(target)
    || target.closest("[data-bunkfy-modal-box]") !== intent.modal
    || (active !== intent.owned && !(handoff && (active === document.body || active === intent.modal)))) return;
  if (active === target) return;
  intent.owned = target;
  target.focus({ preventScroll: true });
  for (let port = target.parentElement; port && port !== intent.modal; port = port.parentElement) {
    if (!/^(auto|scroll)$/.test(getComputedStyle(port).overflowY)) continue;
    const rect = target.getBoundingClientRect(), bounds = port.getBoundingClientRect();
    port.scrollTop += rect.top < bounds.top + 8 ? rect.top - bounds.top - 8 : rect.bottom > bounds.bottom - 8 ? rect.bottom - bounds.bottom + 8 : 0;
    break;
  }
}

function ProfileDetails({ member }: { member: StaffDetailMember }) {
  if (!isFullStaffMember(member)) {
    return (
      <div>
        <ProfileGroup title="Employment" icon={<BriefcaseBusiness size={17} />}>
          <ProfileFact icon={<CircleUserRound size={16} />} label="Display name" value={member.displayName} />
          {member.jobTitle && <ProfileFact icon={<BriefcaseBusiness size={16} />} label="Job title" value={member.jobTitle} />}
          {member.department && <ProfileFact icon={<UsersRound size={16} />} label="Department" value={member.department} />}
          {!member.jobTitle && !member.department && <p className="p-4 text-sm text-base-content/50">No employment details are recorded.</p>}
        </ProfileGroup>
        <p className="mt-3 text-xs leading-5 text-base-content/45">Sensitive identity and work-contact details are not available in this view.</p>
      </div>
    );
  }

  const missingEmployment = [
    !member.jobTitle && "job title",
    !member.department && "department",
    !member.employeeNumber && "employee number",
  ].filter((value): value is string => Boolean(value));
  const missingIdentity = [
    !member.legalName && "legal name",
    !member.workEmail && "work email",
    !member.workPhone && "work phone",
  ].filter((value): value is string => Boolean(value));

  return (
    <div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <ProfileGroup title="Employment" icon={<BriefcaseBusiness size={17} />}>
            {member.jobTitle && <ProfileFact icon={<BriefcaseBusiness size={16} />} label="Job title" value={member.jobTitle} />}
            {member.department && <ProfileFact icon={<UsersRound size={16} />} label="Department" value={member.department} />}
            {member.employeeNumber && <ProfileFact icon={<BadgeCheck size={16} />} label="Employee number" value={member.employeeNumber} />}
            {!member.jobTitle && !member.department && !member.employeeNumber && <p className="p-4 text-sm text-base-content/50">No employment details are recorded.</p>}
          </ProfileGroup>
          {missingEmployment.length > 0 && <p className="mt-2 text-xs leading-5 text-base-content/45">Not recorded: {missingEmployment.join(", ")}.</p>}
        </div>
        <div className="min-w-0">
          <ProfileGroup title="Identity and contact" icon={<CircleUserRound size={17} />}>
            <ProfileFact icon={<CircleUserRound size={16} />} label="Display name" value={member.displayName} />
            {member.legalName && <ProfileFact icon={<CircleUserRound size={16} />} label="Legal name" value={member.legalName} />}
            {member.workEmail && <ProfileFact icon={<Mail size={16} />} label="Work email" value={member.workEmail} href={`mailto:${member.workEmail}`} />}
            {member.workPhone && <ProfileFact icon={<Phone size={16} />} label="Work phone" value={member.workPhone} href={`tel:${member.workPhone}`} />}
            {!member.legalName && !member.workEmail && !member.workPhone && <p className="p-4 text-sm text-base-content/50">No additional identity or contact details are recorded.</p>}
          </ProfileGroup>
          {missingIdentity.length > 0 && <p className="mt-2 text-xs leading-5 text-base-content/45">Not recorded: {missingIdentity.join(", ")}.</p>}
        </div>
      </div>
      <p className="mt-5 border-t border-base-300 pt-4 text-xs leading-5 text-base-content/45">
        Last updated {formatStaffDateTime(member.lastChangedAtUtc)} · Profile version {member.version}
      </p>
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
        body: "Workspace membership and assigned access profiles are denied before the Staff profile is suspended. The global account and other workspaces are unchanged.",
        button: "Suspend staff member",
      }
    : target.action === "resume"
      ? {
          title: `Resume ${target.member.displayName}?`,
          body: "This returns the Staff profile to active and restores the exact access profile set captured at suspension. If a profile is no longer available, workspace access stays denied for review.",
          button: "Resume staff member",
        }
      : {
          title: `Record ${target.member.displayName} as departed?`,
          body: "All current work assignments end and this workspace membership is removed. The Staff profile and assignment history remain, and departure cannot be reversed from the UI.",
          button: "Record departure",
        };

  return (
    <section className="rounded-lg border border-warning/35 bg-warning/10 p-4">
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
    <section className="min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <KeyRound size={19} />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold">Sign-in account link</h3>
          <p className="mt-1 text-sm leading-6 text-base-content/55">Trusted correlation between this employment profile and one BunkFy account.</p>
        </div>
        </div>
        <StatusBadge status={member.authSubjectId ? "Linked" : "Not linked"} />
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-lg border border-secondary/20 bg-secondary/8 p-4">
        <ShieldCheck className="mt-0.5 shrink-0 text-secondary" size={18} />
        <div>
          <p className="text-sm font-semibold">Account access stays separate</p>
          <p className="mt-1 text-sm leading-6 text-base-content/60">Linking identifies the account for Staff workflows. It does not create workspace membership, assign roles, grant permissions, change credentials, or affect other workspaces.</p>
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
        <span className="mt-1.5 block text-xs leading-5 text-base-content/45">Use the exact Auth subject ID supplied by a trusted account-recovery or enrollment workflow.</span>
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

function ProfileGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-base-content/45">
        <span className="text-primary">{icon}</span>{title}
      </h4>
      <div className="divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300 bg-base-100">
        {children}
      </div>
    </section>
  );
}

function ProfileFact({
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
    <div className="flex min-w-0 items-start gap-3 p-4">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-base-content/45">{label}</p>
        {href ? (
          <a className="mt-1 block break-words text-sm font-medium text-primary hover:underline" href={href}>{value}</a>
        ) : (
          <p className="mt-1 break-words text-sm font-medium">{value}</p>
        )}
      </div>
    </div>
  );
}

function formatStaffDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function utcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
