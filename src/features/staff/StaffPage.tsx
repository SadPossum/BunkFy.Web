import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronRight,
  Plus,
  Search,
  ShieldAlert,
  UsersRound,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { staffStatusLabel, staffStatusValue } from "../../api/labels";
import type {
  StaffDirectoryListResponse,
  StaffDirectoryListItem,
  StaffDirectoryMember,
  StaffPropertyDirectoryListItem,
  StaffPropertyDirectoryListResponse,
} from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import {
  permissions,
  propertyAccessScope,
  tenantAccessScope,
  usePermissions,
} from "../../app/permissions";
import {
  focusedResourceClass,
  useTargetProperty,
  useTransientResourceFocus,
} from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { PaginationBar } from "../../components/ui/PaginationBar";
import {
  EmptyState,
  InitialAvatar,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import {
  resolveStaffCreateAttempt,
  type StaffCreateAttempt,
  type StaffCreatePayload,
} from "./staffCreateAttempt";
import { StaffDetail } from "./StaffDetail";
import { staffMutationAllowed } from "./staffMutationAuthority";
import {
  staffDetailTab,
  staffDirectoryScope,
  type StaffDirectoryScope,
} from "./staffPresentation";
import { StaffProfileForm } from "./StaffProfileForm";

const PAGE_SIZE = 30;
const statusOptions = ["active", "suspended", "departed"] as const;
type StaffStatusFilter = "all" | (typeof statusOptions)[number];
type StaffDirectoryItem = StaffDirectoryListItem | StaffPropertyDirectoryListItem;

type CreateStaffSubmission = {
  tenantId: string;
  payload: StaffCreatePayload;
};

export function StaffPage() {
  const { request, session } = useSession();
  const workspace = useWorkspace();
  const {
    properties,
    propertiesLoaded,
    propertiesLoading,
    propertiesFetching,
    propertiesError,
    refetchProperties,
    selectedProperty,
  } = workspace;
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [status, setStatus] = useState<StaffStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const tenantId = session?.tenantId ?? "";
  const tenantIdRef = useRef(tenantId);
  tenantIdRef.current = tenantId;
  const previousTenantIdRef = useRef(tenantId);
  const tenantScope = session ? tenantAccessScope(session.tenantId) : "";
  const propertyScope = session && selectedProperty
    ? propertyAccessScope(session.tenantId, selectedProperty.propertyId)
    : "";

  const tenantAccess = usePermissions(tenantScope ? [
    { permission: permissions.staffRead, scope: tenantScope },
    { permission: permissions.staffSensitiveProfileRead, scope: tenantScope },
    { permission: permissions.staffCreate, scope: tenantScope },
    { permission: permissions.staffManage, scope: tenantScope },
    { permission: permissions.staffAccountLinksManage, scope: tenantScope },
    { permission: permissions.staffManageLifecycle, scope: tenantScope },
  ] : []);
  const propertyStaffAccess = usePermissions(propertyScope ? [
    { permission: permissions.staffRead, scope: propertyScope },
    { permission: permissions.staffAssignProperties, scope: propertyScope },
  ] : []);
  const mayRead = tenantAccess.allows(permissions.staffRead, tenantScope);
  const mayReadSensitive = tenantAccess.allows(
    permissions.staffSensitiveProfileRead,
    tenantScope,
  );
  const mayCreate = tenantAccess.allows(permissions.staffCreate, tenantScope);
  const mayManage = tenantAccess.allows(permissions.staffManage, tenantScope);
  const mayManageAccountLinks = tenantAccess.allows(
    permissions.staffAccountLinksManage,
    tenantScope,
  );
  const mayManageLifecycle = tenantAccess.allows(
    permissions.staffManageLifecycle,
    tenantScope,
  );
  const mayReadCurrentProperty = Boolean(
    propertyScope && propertyStaffAccess.allows(permissions.staffRead, propertyScope),
  );
  const mayAssignCurrentProperty = Boolean(
    propertyScope &&
      propertyStaffAccess.allows(permissions.staffAssignProperties, propertyScope),
  );
  const permissionSource = createCompositeSource({
    label: "Staff permissions",
    hasData: tenantAccess.hasData,
    isLoading: tenantAccess.isLoading,
    error: tenantAccess.error,
    isFetching: tenantAccess.isFetching,
    refetch: tenantAccess.refetch,
  });
  const propertyStaffPermissionSource = selectedProperty
    ? createCompositeSource({
        label: `${selectedProperty.name} Staff permissions`,
        hasData: propertyStaffAccess.hasData,
        isLoading: propertyStaffAccess.isLoading,
        error: propertyStaffAccess.error,
        isFetching: propertyStaffAccess.isFetching,
        refetch: propertyStaffAccess.refetch,
      })
    : null;
  const propertySource = createCompositeSource({
    label: "Property catalogue",
    hasData: propertiesLoaded,
    isLoading: propertiesLoading,
    error: propertiesError,
    isFetching: propertiesFetching,
    refetch: refetchProperties,
  });
  const permissionsCurrent = compositeSourceCurrent(permissionSource);
  const permissionUsable = compositeSourceUsable(permissionSource.state);
  const createAuthorityCurrent = mayRead && mayCreate && staffMutationAllowed(
    "create",
    { permissionsCurrent },
  );
  const directoryScope = staffDirectoryScope(
    searchParams.get("scope"),
    Boolean(selectedProperty),
  );
  const propertyPermissionUsable = Boolean(
    propertyStaffPermissionSource &&
      compositeSourceUsable(propertyStaffPermissionSource.state),
  );
  const propertyPermissionCurrent = Boolean(
    propertyStaffPermissionSource &&
      compositeSourceCurrent(propertyStaffPermissionSource),
  );

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (deferredSearch) params.set("search", deferredSearch);
  if (status !== "all") params.set("status", String(staffStatusValue(status)));
  const members = useQuery<StaffDirectoryListResponse | StaffPropertyDirectoryListResponse>({
    queryKey: [
      "staff-members",
      tenantId,
      directoryScope,
      directoryScope === "property" ? selectedProperty?.propertyId ?? "none" : "workspace",
      deferredSearch,
      status,
      page,
    ],
    queryFn: () => directoryScope === "property" && selectedProperty
      ? request<StaffPropertyDirectoryListResponse>(
          `/api/staff/properties/${selectedProperty.propertyId}/members?${params}`,
        )
      : request<StaffDirectoryListResponse>(`/api/staff/members?${params}`),
    enabled: Boolean(
      tenantId && mayRead && (
        directoryScope === "workspace" ||
        (selectedProperty && mayReadCurrentProperty)
      ),
    ),
  });
  const directorySource = createCompositeSource({
    label: directoryScope === "property"
      ? `${selectedProperty?.name ?? "Current property"} Staff directory`
      : "Workspace Staff directory",
    hasData: members.data !== undefined,
    isLoading: members.isLoading,
    error: members.error,
    isFetching: members.isFetching,
    refetch: () => members.refetch(),
  });
  const directoryCurrent = compositeSourceCurrent(directorySource);
  const directoryUsable = compositeSourceUsable(directorySource.state);
  const items: StaffDirectoryItem[] = directoryUsable
    ? members.data?.items ?? []
    : [];
  const focusedMemberId = useTransientResourceFocus(directoryUsable);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, directoryScope, selectedProperty?.propertyId, status]);

  useEffect(() => {
    if (directoryCurrent && members.data && page > 1 && members.data.items.length === 0) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [directoryCurrent, members.data, page]);

  useEffect(() => {
    const previousTenantId = previousTenantIdRef.current;
    if (tenantId) previousTenantIdRef.current = tenantId;
    if (!previousTenantId || !tenantId || previousTenantId === tenantId) return;

    setSearch("");
    setStatus("all");
    setPage(1);
    setCreateOpen(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("member");
      next.delete("section");
      next.delete("focus");
      next.delete("scope");
      return next;
    }, { replace: true });
  }, [setSearchParams, tenantId]);

  useEffect(() => {
    if (!permissionsCurrent) return;
    if (!mayRead || !mayCreate) setCreateOpen(false);
    if (!mayRead) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("member");
        next.delete("section");
        return next;
      }, { replace: true });
    }
  }, [mayCreate, mayRead, permissionsCurrent, setSearchParams]);

  function selectMember(id: string | null) {
    const next = new URLSearchParams(searchParams);
    if (id) {
      next.set("member", id);
      next.delete("section");
    } else {
      next.delete("member");
      next.delete("section");
      next.delete("focus");
    }
    setSearchParams(next, { replace: true });
  }

  function setDirectoryScope(scope: StaffDirectoryScope) {
    const next = new URLSearchParams(searchParams);
    if (scope === "property") next.set("scope", "property");
    else next.delete("scope");
    next.delete("member");
    next.delete("section");
    next.delete("focus");
    setPage(1);
    setSearchParams(next, { replace: true });
  }

  function setDetailSection(section: "profile" | "assignments" | "account") {
    const next = new URLSearchParams(searchParams);
    if (section === "profile") next.delete("section");
    else next.set("section", section);
    setSearchParams(next, { replace: true });
  }

  async function handleCreated(
    targetTenantId: string,
    created: StaffDirectoryMember,
  ) {
    await queryClient.invalidateQueries({
      queryKey: ["staff-members", targetTenantId],
    });
    if (tenantIdRef.current !== targetTenantId) return;
    setCreateOpen(false);
    selectMember(created.staffMemberId);
  }

  return (
    <>
      <PageHeader
        eyebrow="Workspace people"
        title="Staff"
        description="Keep employment profiles, work locations, and lifecycle history accurate. Workspace roles and permissions stay in Workspace settings."
        action={mayRead && mayCreate ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!createAuthorityCurrent}
            onClick={() => {
              if (createAuthorityCurrent) setCreateOpen(true);
            }}
          >
            <Plus size={17} />Add staff member
          </button>
        ) : undefined}
      />

      {!permissionUsable || !mayRead ? permissionsCurrent && !mayRead ? (
        <EmptyState
          icon={<ShieldAlert />}
          title="Staff access is restricted"
          description="Your account does not have permission to view staff profiles for this workspace."
        />
      ) : (
        <>
          <CompositeSourceNotice sources={[permissionSource]} title="Staff access is delayed" />
          <section className="card overflow-hidden border border-base-300 bg-base-100 shadow-sm">
            <CompositeSourceFallback state={permissionSource.state} label="Staff access" />
          </section>
        </>
      ) : (
        <>
          <CompositeSourceNotice
            sources={[
              permissionSource,
              ...(directoryScope === "property" && propertyStaffPermissionSource
                ? [propertyStaffPermissionSource]
                : []),
              ...(
                directoryScope === "workspace" ||
                (propertyPermissionUsable && mayReadCurrentProperty)
                  ? [directorySource]
                  : []
              ),
            ]}
            title="Staff data is delayed"
          />
          <section className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="flex flex-col gap-4 border-b border-base-300 p-4 sm:px-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end">
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-base-content/45">Directory</p>
                  <SegmentedTabs
                    value={directoryScope}
                    ariaLabel="Staff directory scope"
                    onValueChange={setDirectoryScope}
                    options={[
                      { value: "workspace", label: "Workspace", icon: <UsersRound size={15} /> },
                      {
                        value: "property",
                        label: selectedProperty?.name ?? "Current property",
                        icon: <Building2 size={15} />,
                        disabled: !selectedProperty,
                      },
                    ]}
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-base-content/45">Employment status</p>
                  <SegmentedTabs
                    value={status}
                    ariaLabel="Staff status"
                    onValueChange={setStatus}
                    options={(["all", ...statusOptions] as const).map((option) => ({
                      value: option,
                      label: option === "all" ? "All" : capitalize(option),
                    }))}
                  />
                </div>
              </div>
              <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between xl:w-auto xl:justify-end">
                {directoryUsable && (
                  <p className="shrink-0 text-xs font-medium text-base-content/50" aria-live="polite">
                    Page {page} · {items.length} {items.length === 1 ? "person" : "people"}
                  </p>
                )}
                <label className="input input-bordered input-sm flex w-full items-center gap-2 sm:w-72">
                  <Search size={15} className="text-base-content/35" />
                  <input
                    className="grow"
                    aria-label="Search staff"
                    placeholder="Display name"
                    value={search}
                    maxLength={256}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {members.isFetching && (
                    <span className="loading loading-spinner loading-xs text-primary" aria-label="Updating Staff results" />
                  )}
                  {search && !members.isFetching && (
                    <button type="button" className="btn btn-circle btn-ghost btn-xs -mr-1" aria-label="Clear Staff search" onClick={() => setSearch("")}>
                      <X size={14} />
                    </button>
                  )}
                </label>
              </div>
            </div>

            {directoryScope === "property" && !propertyPermissionUsable ? (
              <CompositeSourceFallback
                state={propertyStaffPermissionSource?.state ?? "unavailable"}
                label={`${selectedProperty?.name ?? "current property"} Staff access`}
              />
            ) : directoryScope === "property" && propertyPermissionCurrent && !mayReadCurrentProperty ? (
              <EmptyState
                icon={<ShieldAlert />}
                title="Property Staff access is restricted"
                description={`Your account cannot view Staff assignments at ${selectedProperty?.name ?? "the selected property"}.`}
              />
            ) : directorySource.state === "loading" ? (
              <LoadingState label="Loading staff" />
            ) : !directoryUsable ? (
              <CompositeSourceFallback state={directorySource.state} label="Staff directory" />
            ) : !items.length ? (
              <div className="p-6">
                <EmptyState
                  icon={<UsersRound />}
                  title={search || status !== "all"
                    ? "No staff members match"
                    : directoryScope === "property"
                      ? `No staff assigned to ${selectedProperty?.name ?? "this property"}`
                      : "No staff profiles yet"}
                  description={search || status !== "all"
                    ? "Try another search or status."
                    : directoryScope === "property"
                      ? "View the workspace directory to choose a person, then add this property as a work location."
                      : "Create the first staff profile, then assign it to a property."}
                  action={!search && status === "all" && directoryScope === "property" ? (
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setDirectoryScope("workspace")}>
                      <UsersRound size={15} />View workspace staff
                    </button>
                  ) : mayCreate && !search && status === "all" ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!createAuthorityCurrent}
                      onClick={() => {
                        if (createAuthorityCurrent) setCreateOpen(true);
                      }}
                    >
                      Add staff member
                    </button>
                  ) : undefined}
                />
              </div>
            ) : (
              <StaffDirectory
                items={items}
                scope={directoryScope}
                propertyName={selectedProperty?.name ?? null}
                focusedMemberId={focusedMemberId}
                onSelect={selectMember}
              />
            )}

            {directoryUsable && (
              <PaginationBar
                page={page}
                pageSize={PAGE_SIZE}
                itemCount={items.length}
                itemLabel="staff member"
                hasMore={members.data?.hasMore}
                disabled={!directoryCurrent}
                onPageChange={setPage}
              />
            )}
          </section>
        </>
      )}

      <CreateStaffModal
        key={tenantId}
        tenantId={tenantId}
        open={permissionUsable && mayRead && createOpen}
        permissionSource={permissionSource}
        authorityCurrent={createAuthorityCurrent}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
      {permissionUsable && mayRead && (
        <StaffDetail
          key={`${tenantId}:${searchParams.get("member") ?? "none"}`}
          tenantId={tenantId}
          memberId={searchParams.get("member")}
          initialTab={staffDetailTab(searchParams.get("section"))}
          properties={properties}
          selectedProperty={selectedProperty}
          propertySource={propertySource}
          permissionSource={permissionSource}
          assignmentPermissionSource={propertyStaffPermissionSource}
          canReadSensitive={mayReadSensitive}
          canManage={mayManage}
          canManageAccountLinks={mayManageAccountLinks}
          canManageLifecycle={mayManageLifecycle}
          canAssignCurrentProperty={mayAssignCurrentProperty}
          onSectionChange={setDetailSection}
          onClose={() => selectMember(null)}
        />
      )}
    </>
  );
}

function CreateStaffModal({
  tenantId,
  open,
  permissionSource,
  authorityCurrent,
  onClose,
  onCreated,
}: {
  tenantId: string;
  open: boolean;
  permissionSource: CompositeSource;
  authorityCurrent: boolean;
  onClose: () => void;
  onCreated: (tenantId: string, member: StaffDirectoryMember) => Promise<void>;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const attempt = useRef<StaffCreateAttempt | null>(null);
  const mutation = useMutation<StaffDirectoryMember, Error, CreateStaffSubmission>({
    mutationFn: ({ tenantId: targetTenantId, payload }) => {
      if (targetTenantId !== tenantId || !authorityCurrent) {
        throw new Error("Current Staff create access could not be confirmed. Refresh and try again.");
      }
      attempt.current = resolveStaffCreateAttempt(attempt.current, payload);
      return request<StaffDirectoryMember>("/api/staff/members", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          operationId: attempt.current.operationId,
        }),
      });
    },
    onSuccess: async (created, submission) => {
      attempt.current = null;
      await onCreated(submission.tenantId, created);
    },
    onError: async (_error, submission) => {
      await queryClient.invalidateQueries({
        queryKey: ["staff-members", submission.tenantId],
      });
    },
  });

  function close() {
    attempt.current = null;
    mutation.reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      size="lg"
      title="New staff member"
      description="Create the workspace profile first. Account links and property assignments can be added next."
      onClose={close}
    >
      <StaffProfileForm
        submitting={mutation.isPending}
        error={mutation.error}
        submitLabel="Create staff member"
        sources={[permissionSource]}
        authorityCurrent={authorityCurrent}
        authorityMessage="Current Staff create permission is refreshing or unavailable. The form remains read-only until it recovers."
        onCancel={close}
        onSubmit={(payload) => {
          if (authorityCurrent) mutation.mutate({ tenantId, payload });
        }}
      />
    </Modal>
  );
}

function StaffDirectory({
  items,
  scope,
  propertyName,
  focusedMemberId,
  onSelect,
}: {
  items: StaffDirectoryItem[];
  scope: StaffDirectoryScope;
  propertyName: string | null;
  focusedMemberId: string | null;
  onSelect: (staffMemberId: string) => void;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="table">
          <thead>
            <tr className="border-base-300 text-[0.68rem] uppercase text-base-content/40">
              <th className="pl-6">Staff member</th>
              <th>Employment</th>
              <th>{scope === "property" ? "Current property assignment" : "Work locations"}</th>
              <th>Status</th>
              <th className="pr-6" />
            </tr>
          </thead>
          <tbody>
            {items.map((member) => (
              <tr
                key={member.staffMemberId}
                className={`cursor-pointer border-base-300 transition hover:bg-base-200/70 ${member.staffMemberId === focusedMemberId ? focusedResourceClass : ""}`}
                onClick={() => onSelect(member.staffMemberId)}
              >
                <td className="pl-6"><StaffIdentity member={member} /></td>
                <td><EmploymentSummary member={member} /></td>
                <td><AssignmentSummary member={member} scope={scope} propertyName={propertyName} /></td>
                <td><StatusBadge status={staffStatusLabel(member.status)} /></td>
                <td className="pr-6 text-right">
                  <button
                    type="button"
                    className="btn btn-circle btn-ghost btn-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(member.staffMemberId);
                    }}
                    aria-label={`Open ${member.displayName}`}
                  >
                    <ChevronRight size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-base-300 md:hidden">
        {items.map((member) => (
          <button
            key={member.staffMemberId}
            type="button"
            className={`block w-full p-5 text-left transition hover:bg-base-200 ${member.staffMemberId === focusedMemberId ? focusedResourceClass : ""}`}
            onClick={() => onSelect(member.staffMemberId)}
          >
            <div className="flex items-start justify-between gap-3">
              <StaffIdentity member={member} showEmployment />
              <StatusBadge status={staffStatusLabel(member.status)} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-base-content/50">
              <AssignmentSummary member={member} scope={scope} propertyName={propertyName} compact />
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary">View profile <ChevronRight size={14} /></span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function StaffIdentity({
  member,
  showEmployment = false,
}: {
  member: Pick<StaffDirectoryListItem, "displayName" | "jobTitle" | "department">;
  showEmployment?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <InitialAvatar name={member.displayName} size="sm" />
      <div className="min-w-0">
        <p className="truncate font-semibold">{member.displayName}</p>
        {showEmployment && (
          <p className="mt-1 truncate text-xs text-base-content/45">{member.jobTitle || member.department || "Employment details not recorded"}</p>
        )}
      </div>
    </div>
  );
}

function EmploymentSummary({
  member,
}: {
  member: Pick<StaffDirectoryItem, "jobTitle" | "department">;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{member.jobTitle || "Job title not recorded"}</p>
      <p className="mt-1 truncate text-xs text-base-content/45">{member.department || "Department not recorded"}</p>
    </div>
  );
}

function AssignmentSummary({
  member,
  scope,
  propertyName,
  compact = false,
}: {
  member: StaffDirectoryItem;
  scope: StaffDirectoryScope;
  propertyName: string | null;
  compact?: boolean;
}) {
  if (scope === "property" && isPropertyDirectoryItem(member)) {
    const propertySpecificTitle = member.assignment.propertyJobTitle &&
      member.assignment.propertyJobTitle !== member.jobTitle
      ? member.assignment.propertyJobTitle
      : null;
    return (
      <span className={`inline-flex min-w-0 items-center gap-2 ${compact ? "max-w-[13rem]" : ""}`}>
        <Building2 className="shrink-0 text-primary" size={14} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{propertyName || "Current property"}</span>
          {!compact && (
            <span className="mt-1 block truncate text-xs text-base-content/45">
              {[propertySpecificTitle, member.assignment.isPrimary ? "Primary" : null].filter(Boolean).join(" · ") || "Current assignment"}
            </span>
          )}
        </span>
      </span>
    );
  }

  const count = isPropertyDirectoryItem(member) ? 1 : member.currentPropertyCount;
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <Building2 className="shrink-0 text-primary" size={14} />
      <span>{count} current {count === 1 ? "property" : "properties"}</span>
    </span>
  );
}

function isPropertyDirectoryItem(
  member: StaffDirectoryItem,
): member is StaffPropertyDirectoryListItem {
  return "assignment" in member;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
