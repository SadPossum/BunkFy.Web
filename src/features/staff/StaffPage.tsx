import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, BriefcaseBusiness, Building2, ChevronLeft, ChevronRight, CircleUserRound, Edit3, KeyRound, Mail, Phone, Plus, Search, ShieldAlert, UserRoundCheck, UserRoundMinus, UserRoundX, UsersRound } from "lucide-react";
import { useDeferredValue, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { staffStatusLabel, staffStatusValue } from "../../api/labels";
import type { Property, StaffMember, StaffPropertyAssignment, StaffStatus } from "../../api/types";
import { permissions, propertyAccessScope, tenantAccessScope, usePermissions } from "../../app/permissions";
import { focusedResourceClass, useTargetProperty, useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, FormActions, InitialAvatar, InlineFormActions, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";
import { DatePicker } from "../../components/ui/DatePicker";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";

const PAGE_SIZE = 30;
const statusOptions = ["active", "suspended", "departed"] as const;
type StaffStatusFilter = "all" | (typeof statusOptions)[number];

export function StaffPage() {
  const { request, session } = useSession();
  const { properties, selectedProperty } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [status, setStatus] = useState<StaffStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const tenantScope = session ? tenantAccessScope(session.tenantId) : "";
  const propertyScope = session && selectedProperty ? propertyAccessScope(session.tenantId, selectedProperty.propertyId) : "";
  const access = usePermissions(tenantScope ? [
    { permission: permissions.staffRead, scope: tenantScope },
    { permission: permissions.staffCreate, scope: tenantScope },
    { permission: permissions.staffManage, scope: tenantScope },
    { permission: permissions.staffManageLifecycle, scope: tenantScope },
    ...(propertyScope ? [{ permission: permissions.staffAssignProperties, scope: propertyScope }] : []),
  ] : []);
  const canRead = access.allows(permissions.staffRead, tenantScope);
  const canCreate = access.allows(permissions.staffCreate, tenantScope);
  const canManage = access.allows(permissions.staffManage, tenantScope);
  const canManageLifecycle = access.allows(permissions.staffManageLifecycle, tenantScope);
  const canAssignCurrentProperty = Boolean(propertyScope && access.allows(permissions.staffAssignProperties, propertyScope));
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (deferredSearch) params.set("search", deferredSearch);
  if (status !== "all") params.set("status", String(staffStatusValue(status)));
  const members = useQuery({
    queryKey: ["staff-members", session?.tenantId, deferredSearch, status, page],
    queryFn: () => request<{ items: StaffMember[]; page: number; pageSize: number }>(`/api/staff/members?${params}`),
    enabled: canRead,
  });
  const focusedMemberId = useTransientResourceFocus(Boolean(members.data));

  useEffect(() => { setPage(1); }, [deferredSearch, status]);

  function selectMember(id: string | null) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("member", id); else next.delete("member");
    setSearchParams(next, { replace: true });
  }

  if (access.isLoading) return <LoadingState label="Checking staff access" />;
  if (access.error) return <ErrorState error={access.error} />;
  if (!canRead) return <EmptyState icon={<ShieldAlert />} title="Staff access is restricted" description="Your account does not have permission to view staff profiles for this workspace." />;

  const items = members.data?.items ?? [];
  return (
    <>
      <PageHeader eyebrow="Workspace team" title="Staff" description="Manage staff profiles, employment state, account links, and property assignments." action={canCreate ? <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={17} />Add staff member</button> : undefined} />

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-base-300 p-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <SegmentedTabs
            value={status}
            ariaLabel="Staff status"
            onValueChange={setStatus}
            options={(["all", ...statusOptions] as const).map((option) => ({
              value: option,
              label: option === "all" ? "All staff" : capitalize(option),
            }))}
          />
          <label className="input input-bordered input-sm flex w-full items-center gap-2 lg:w-72"><Search size={15} className="text-base-content/35" /><input className="grow" aria-label="Search staff" placeholder="Name, email or employee no." value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>

        {members.isLoading ? <LoadingState label="Loading staff" /> : members.error ? <div className="p-6"><ErrorState error={members.error} retry={() => void members.refetch()} /></div> : !items.length ? <div className="p-6"><EmptyState icon={<UsersRound />} title={search || status !== "all" ? "No staff members match" : "No staff profiles yet"} description={search || status !== "all" ? "Try another search or status." : "Create the first staff profile, then assign it to a property."} action={canCreate && !search && status === "all" ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>Add staff member</button> : undefined} /></div> : <>
          <div className="hidden overflow-x-auto md:block"><table className="table"><thead><tr className="border-base-300 text-[0.68rem] uppercase tracking-[0.12em] text-base-content/40"><th className="pl-6">Staff member</th><th>Role</th><th>Properties</th><th>Status</th><th className="pr-6" /></tr></thead><tbody>{items.map((member) => <tr key={member.staffMemberId} className={`cursor-pointer border-base-300 transition hover:bg-base-200/70 ${member.staffMemberId === focusedMemberId ? focusedResourceClass : ""}`} onClick={() => selectMember(member.staffMemberId)}><td className="pl-6"><StaffIdentity member={member} /></td><td><p className="text-sm font-medium">{member.jobTitle || "No job title"}</p><p className="mt-1 text-xs text-base-content/45">{member.department || "No department"}</p></td><td><span className="badge badge-ghost font-semibold">{member.assignments.filter((assignment) => assignment.isCurrent).length} current</span></td><td><StatusBadge status={staffStatusLabel(member.status)} /></td><td className="pr-6 text-right"><button type="button" className="btn btn-circle btn-ghost btn-xs" onClick={(event) => { event.stopPropagation(); selectMember(member.staffMemberId); }} aria-label={`Open ${member.displayName}`}><ChevronRight size={17} /></button></td></tr>)}</tbody></table></div>
          <div className="divide-y divide-base-300 md:hidden">{items.map((member) => <button key={member.staffMemberId} type="button" className={`block w-full p-5 text-left transition hover:bg-base-200 ${member.staffMemberId === focusedMemberId ? focusedResourceClass : ""}`} onClick={() => selectMember(member.staffMemberId)}><div className="flex items-start justify-between gap-3"><StaffIdentity member={member} /><StatusBadge status={staffStatusLabel(member.status)} /></div><div className="mt-4 flex items-center justify-between gap-3 text-xs text-base-content/50"><span>{member.jobTitle || member.department || "No role details"}</span><span>{member.assignments.filter((assignment) => assignment.isCurrent).length} properties <ChevronRight className="inline" size={15} /></span></div></button>)}</div>
          <div className="flex items-center justify-between border-t border-base-300 px-4 py-3 sm:px-6"><p className="text-xs text-base-content/45">Page {page}</p><div className="join"><button type="button" className="btn btn-sm join-item" disabled={page === 1} onClick={() => setPage((current) => current - 1)} aria-label="Previous staff page"><ChevronLeft size={16} /></button><button type="button" className="btn btn-sm join-item" disabled={items.length < PAGE_SIZE} onClick={() => setPage((current) => current + 1)} aria-label="Next staff page"><ChevronRight size={16} /></button></div></div>
        </>}
      </section>

      <CreateStaffModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={async (created) => { await queryClient.invalidateQueries({ queryKey: ["staff-members"] }); setCreateOpen(false); selectMember(created.staffMemberId); }} />
      <StaffDetail memberId={searchParams.get("member")} initialTab={staffDetailTab(searchParams.get("section"))} properties={properties} selectedProperty={selectedProperty} canManage={canManage} canManageLifecycle={canManageLifecycle} canAssignCurrentProperty={canAssignCurrentProperty} onClose={() => selectMember(null)} />
    </>
  );
}

function CreateStaffModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (member: StaffMember) => Promise<void> }) {
  const { request } = useSession();
  const mutation = useMutation({ mutationFn: (payload: Record<string, unknown>) => request<StaffMember>("/api/staff/members", { method: "POST", body: JSON.stringify(payload) }), onSuccess: onCreated });
  return <Modal open={open} title="New staff member" description="Create the workspace profile first. Property assignments can be added next." onClose={onClose}><StaffProfileForm includeAuthSubject submitting={mutation.isPending} error={mutation.error} submitLabel="Create staff member" onCancel={onClose} onSubmit={(payload) => mutation.mutate(payload)} /></Modal>;
}

function StaffDetail({ memberId, initialTab, properties, selectedProperty, canManage, canManageLifecycle, canAssignCurrentProperty, onClose }: { memberId: string | null; initialTab: "profile" | "assignments" | "account"; properties: Property[]; selectedProperty: Property | null; canManage: boolean; canManageLifecycle: boolean; canAssignCurrentProperty: boolean; onClose: () => void }) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"profile" | "assignments" | "account">(initialTab);
  const [editing, setEditing] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<"suspend" | "resume" | "depart" | null>(null);
  useEffect(() => { setTab(initialTab); setEditing(false); setLifecycleAction(null); }, [initialTab, memberId]);
  const member = useQuery({ queryKey: ["staff-member", memberId], queryFn: () => request<StaffMember>(`/api/staff/members/${memberId}`), enabled: Boolean(memberId) });
  async function refresh(updated?: StaffMember) { if (updated && memberId) queryClient.setQueryData(["staff-member", memberId], updated); await queryClient.invalidateQueries({ queryKey: ["staff-members"] }); }
  const profileMutation = useMutation({ mutationFn: ({ item, payload }: { item: StaffMember; payload: Record<string, unknown> }) => request<StaffMember>(`/api/staff/members/${item.staffMemberId}`, { method: "PUT", body: JSON.stringify({ ...payload, expectedVersion: item.version }) }), onSuccess: async (updated) => { setEditing(false); await refresh(updated); } });
  const lifecycleMutation = useMutation({ mutationFn: ({ item, action, reason, effectiveOn }: { item: StaffMember; action: "suspend" | "resume" | "depart"; reason: string; effectiveOn: string }) => request<StaffMember>(`/api/staff/members/${item.staffMemberId}/${action}`, { method: "POST", body: JSON.stringify(action === "depart" ? { effectiveOn, reason, expectedVersion: item.version } : { reason, expectedVersion: item.version }) }), onSuccess: async (updated) => { setLifecycleAction(null); await refresh(updated); } });
  const authMutation = useMutation({ mutationFn: ({ item, authSubjectId }: { item: StaffMember; authSubjectId: string | null }) => request<StaffMember>(`/api/staff/members/${item.staffMemberId}/auth-subject`, { method: "PUT", body: JSON.stringify({ authSubjectId, expectedVersion: item.version }) }), onSuccess: refresh });
  const item = member.data;
  return <Modal open={Boolean(memberId)} size="lg" title={item?.displayName || "Staff profile"} description={item ? `${item.jobTitle || "Staff member"}${item.department ? ` · ${item.department}` : ""}` : "Loading staff profile"} onClose={onClose}>{member.isLoading ? <LoadingState label="Loading staff profile" /> : member.error ? <ErrorState error={member.error} retry={() => void member.refetch()} /> : item ? <div className="space-y-5">
    <div className="flex flex-col gap-4 rounded-2xl bg-base-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><InitialAvatar name={item.displayName} variant="solid" /><div><p className="font-semibold">{item.displayName}</p><p className="text-xs text-base-content/50">{item.workEmail || item.employeeNumber || "Staff profile"}</p></div></div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={staffStatusLabel(item.status)} />{canManageLifecycle && staffStatusKey(item.status) === "active" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLifecycleAction("suspend")}><UserRoundMinus size={15} />Suspend</button>}{canManageLifecycle && staffStatusKey(item.status) === "suspended" && <button type="button" className="btn btn-primary btn-sm" onClick={() => setLifecycleAction("resume")}><UserRoundCheck size={15} />Resume</button>}{canManageLifecycle && staffStatusKey(item.status) !== "departed" && <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => setLifecycleAction("depart")}><UserRoundX size={15} />Depart</button>}</div></div>
    {lifecycleAction && <LifecyclePanel member={item} action={lifecycleAction} submitting={lifecycleMutation.isPending} error={lifecycleMutation.error} onCancel={() => { setLifecycleAction(null); lifecycleMutation.reset(); }} onConfirm={(reason, effectiveOn) => lifecycleMutation.mutate({ item, action: lifecycleAction, reason, effectiveOn })} />}
    <SegmentedTabs
      stretch
      value={tab}
      ariaLabel="Staff details"
      onValueChange={setTab}
      options={[
        { value: "profile", label: "Profile", icon: <CircleUserRound size={15} /> },
        { value: "assignments", label: "Assignments", icon: <Building2 size={15} /> },
        { value: "account", label: "Account", icon: <KeyRound size={15} /> },
      ]}
    />
    {tab === "profile" && <section className="rounded-2xl border border-base-300 p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-display text-lg font-semibold">Profile</h3><p className="mt-1 text-xs text-base-content/50">Workspace identity and contact information.</p></div>{canManage && !editing && staffStatusKey(item.status) !== "departed" && <button type="button" className="btn btn-ghost btn-sm text-primary" onClick={() => setEditing(true)}><Edit3 size={15} />Edit</button>}</div>{editing ? <StaffProfileForm member={item} submitting={profileMutation.isPending} error={profileMutation.error} submitLabel="Save profile" onCancel={() => { setEditing(false); profileMutation.reset(); }} onSubmit={(payload) => profileMutation.mutate({ item, payload })} /> : <ProfileDetails member={item} />}</section>}
    {tab === "assignments" && <AssignmentsPanel member={item} properties={properties} selectedProperty={selectedProperty} canAssign={canAssignCurrentProperty} onUpdated={refresh} />}
    {tab === "account" && <AccountLinkPanel member={item} canManage={canManage && staffStatusKey(item.status) !== "departed"} submitting={authMutation.isPending} error={authMutation.error} onSave={(authSubjectId) => authMutation.mutate({ item, authSubjectId })} />}
    <div className="flex justify-end border-t border-base-300 pt-5"><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div>
  </div> : null}</Modal>;
}

function ProfileDetails({ member }: { member: StaffMember }) { return <div className="grid gap-3 sm:grid-cols-2"><InfoRow icon={<CircleUserRound />} label="Legal name" value={member.legalName || "Not provided"} /><InfoRow icon={<BadgeCheck />} label="Employee number" value={member.employeeNumber || "Not provided"} /><InfoRow icon={<Mail />} label="Work email" value={member.workEmail || "Not provided"} href={member.workEmail ? `mailto:${member.workEmail}` : undefined} /><InfoRow icon={<Phone />} label="Work phone" value={member.workPhone || "Not provided"} href={member.workPhone ? `tel:${member.workPhone}` : undefined} /><InfoRow icon={<BriefcaseBusiness />} label="Job title" value={member.jobTitle || "Not provided"} /><InfoRow icon={<UsersRound />} label="Department" value={member.department || "Not provided"} /></div>; }

function StaffProfileForm({ member, includeAuthSubject = false, submitting, error, submitLabel, onCancel, onSubmit }: { member?: StaffMember; includeAuthSubject?: boolean; submitting: boolean; error: unknown; submitLabel: string; onCancel: () => void; onSubmit: (payload: Record<string, unknown>) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit({ displayName: String(data.get("displayName") ?? "").trim(), legalName: emptyToNull(data.get("legalName")), workEmail: emptyToNull(data.get("workEmail")), workPhone: emptyToNull(data.get("workPhone")), employeeNumber: emptyToNull(data.get("employeeNumber")), jobTitle: emptyToNull(data.get("jobTitle")), department: emptyToNull(data.get("department")), ...(includeAuthSubject ? { authSubjectId: emptyToNull(data.get("authSubjectId")) } : {}) }); }
  return <form className="space-y-4" onSubmit={submit}><TextField label="Display name" name="displayName" defaultValue={member?.displayName} maxLength={256} /><TextField label="Legal name (optional)" name="legalName" defaultValue={member?.legalName || ""} required={false} maxLength={256} /><div className="grid gap-4 sm:grid-cols-2"><TextField label="Work email" name="workEmail" type="email" defaultValue={member?.workEmail || ""} required={false} maxLength={320} /><TextField label="Work phone" name="workPhone" type="tel" defaultValue={member?.workPhone || ""} required={false} maxLength={64} /></div><div className="grid gap-4 sm:grid-cols-2"><TextField label="Employee number" name="employeeNumber" defaultValue={member?.employeeNumber || ""} required={false} maxLength={64} /><TextField label="Job title" name="jobTitle" defaultValue={member?.jobTitle || ""} required={false} maxLength={128} /></div><TextField label="Department" name="department" defaultValue={member?.department || ""} required={false} maxLength={128} />{includeAuthSubject && <details className="rounded-lg border border-base-300 p-4"><summary className="cursor-pointer text-sm font-semibold">Sign-in account link (advanced)</summary><div className="mt-4"><TextField label="Sign-in account ID" name="authSubjectId" required={false} maxLength={256} /><p className="mt-2 text-xs leading-5 text-base-content/50">Only set this when you know the exact account identifier.</p></div></details>}{Boolean(error) && <ErrorState error={error} />}{member ? <InlineFormActions><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={submitting}>Cancel</button><button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>{submitting && <span className="loading loading-spinner loading-xs" />}{submitLabel}</button></InlineFormActions> : <FormActions submitting={submitting} submitLabel={submitLabel} onCancel={onCancel} />}</form>;
}

function LifecyclePanel({ member, action, submitting, error, onCancel, onConfirm }: { member: StaffMember; action: "suspend" | "resume" | "depart"; submitting: boolean; error: unknown; onCancel: () => void; onConfirm: (reason: string, effectiveOn: string) => void }) {
  const [reason, setReason] = useState(""); const [effectiveOn, setEffectiveOn] = useState(localDateKey(new Date())); const copy = action === "suspend" ? { title: `Suspend ${member.displayName}?`, body: "They remain in staff records but should no longer be treated as active staff.", button: "Suspend staff member" } : action === "resume" ? { title: `Resume ${member.displayName}?`, body: "This returns the staff profile to active status.", button: "Resume staff member" } : { title: `Record ${member.displayName} as departed?`, body: "All current property assignments end on the effective date. This cannot be reversed from the UI.", button: "Record departure" };
  return <section className="rounded-lg border border-warning/30 bg-warning/8 p-4"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 shrink-0 text-warning" size={19} /><div><h3 className="font-semibold">{copy.title}</h3><p className="mt-1 text-sm leading-6 text-base-content/60">{copy.body}</p></div></div><div className={`mt-4 grid gap-4 ${action === "depart" ? "sm:grid-cols-[1fr_180px]" : ""}`}><label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Reason</span><textarea className="textarea textarea-bordered min-h-20 w-full" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Add a clear operational reason" required /></label>{action === "depart" && <div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Effective date</span><DatePicker className="w-full" value={effectiveOn} onChange={setEffectiveOn} ariaLabel="Effective date" required /></div>}</div>{Boolean(error) && <div className="mt-4"><ErrorState error={error} /></div>}<InlineFormActions><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={submitting}>Cancel</button><button type="button" className={`btn btn-sm ${action === "resume" ? "btn-primary" : "btn-error"}`} onClick={() => onConfirm(reason.trim(), effectiveOn)} disabled={submitting || !reason.trim()}>{submitting && <span className="loading loading-spinner loading-xs" />}{copy.button}</button></InlineFormActions></section>;
}

function AssignmentsPanel({ member, properties, selectedProperty, canAssign, onUpdated }: { member: StaffMember; properties: Property[]; selectedProperty: Property | null; canAssign: boolean; onUpdated: (member?: StaffMember) => Promise<void> }) {
  const { request } = useSession(); const [mode, setMode] = useState<"idle" | "assign" | "unassign">("idle"); const currentAtSelected = member.assignments.find((assignment) => assignment.propertyId === selectedProperty?.propertyId && assignment.isCurrent); const hasPrimary = member.assignments.some((assignment) => assignment.isCurrent && assignment.isPrimary); const mutation = useMutation({ mutationFn: ({ kind, payload }: { kind: "assignment" | "unassign"; payload: Record<string, unknown> }) => request<StaffMember>(`/api/staff/properties/${selectedProperty?.propertyId}/members/${member.staffMemberId}/${kind}`, { method: kind === "assignment" ? "PUT" : "POST", body: JSON.stringify(payload) }), onSuccess: async (updated) => { setMode("idle"); await onUpdated(updated); } });
  function assign(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ kind: "assignment", payload: { propertyJobTitle: emptyToNull(data.get("propertyJobTitle")), isPrimary: data.get("isPrimary") === "on", effectiveFrom: String(data.get("effectiveFrom")), expectedVersion: member.version } }); }
  function unassign(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ kind: "unassign", payload: { effectiveTo: String(data.get("effectiveTo")), reason: String(data.get("reason") ?? "").trim(), expectedVersion: member.version } }); }
  const ordered = [...member.assignments].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.effectiveFrom.localeCompare(a.effectiveFrom));
  return <section className="space-y-4"><div className="rounded-2xl border border-base-300 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-display text-lg font-semibold">Property assignments</h3><p className="mt-1 text-xs text-base-content/50">Switch the current property in the top bar to manage another assignment.</p></div>{canAssign && selectedProperty && staffStatusKey(member.status) === "active" && mode === "idle" && <button type="button" className={`btn btn-sm ${currentAtSelected ? "btn-ghost text-error" : "btn-primary"}`} onClick={() => setMode(currentAtSelected ? "unassign" : "assign")}>{currentAtSelected ? <UserRoundMinus size={15} /> : <Plus size={15} />}{currentAtSelected ? `Unassign from ${selectedProperty.name}` : `Assign to ${selectedProperty.name}`}</button>}</div>
    {mode === "assign" && selectedProperty && <form className="mt-4 rounded-lg bg-base-200 p-4" onSubmit={assign}><h4 className="font-semibold">Assign to {selectedProperty.name}</h4><div className="mt-4 grid gap-4 sm:grid-cols-2"><TextField label="Property job title" name="propertyJobTitle" defaultValue={member.jobTitle || ""} required={false} maxLength={128} /><div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Effective from</span><FormDatePicker name="effectiveFrom" defaultValue={localDateKey(new Date())} ariaLabel="Effective from" /></div></div><label className={`mt-4 flex items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 ${hasPrimary ? "opacity-60" : "cursor-pointer"}`}><input className="checkbox checkbox-primary checkbox-sm mt-0.5" type="checkbox" name="isPrimary" disabled={hasPrimary} /><span><span className="block text-sm font-semibold">Primary property</span><span className="block text-xs text-base-content/50">{hasPrimary ? "Another current assignment is already primary." : "Use this as the staff member’s main property."}</span></span></label>{mutation.error && <div className="mt-4"><ErrorState error={mutation.error} /></div>}<InlineFormActions><button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("idle")}>Cancel</button><button type="submit" className="btn btn-primary btn-sm" disabled={mutation.isPending}>{mutation.isPending && <span className="loading loading-spinner loading-xs" />}Add assignment</button></InlineFormActions></form>}
    {mode === "unassign" && selectedProperty && currentAtSelected && <form className="mt-4 rounded-lg border border-warning/25 bg-warning/8 p-4" onSubmit={unassign}><h4 className="font-semibold">End assignment at {selectedProperty.name}</h4><div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]"><div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Effective through</span><FormDatePicker name="effectiveTo" min={currentAtSelected.effectiveFrom} defaultValue={localDateKey(new Date())} ariaLabel="Effective through" /></div><label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Reason</span><input className="input input-bordered w-full" name="reason" maxLength={1000} placeholder="Why this assignment is ending" required /></label></div>{mutation.error && <div className="mt-4"><ErrorState error={mutation.error} /></div>}<InlineFormActions><button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("idle")}>Cancel</button><button type="submit" className="btn btn-error btn-sm" disabled={mutation.isPending}>{mutation.isPending && <span className="loading loading-spinner loading-xs" />}End assignment</button></InlineFormActions></form>}
  </div>{ordered.length ? <div className="space-y-3">{ordered.map((assignment) => <AssignmentCard key={assignment.assignmentId} assignment={assignment} property={properties.find((property) => property.propertyId === assignment.propertyId)} />)}</div> : <div className="rounded-2xl border border-dashed border-base-300 p-8 text-center"><Building2 className="mx-auto text-base-content/30" /><h3 className="mt-3 font-display text-lg font-semibold">No property assignments</h3><p className="mt-1 text-sm text-base-content/50">Assign this staff member from the currently selected property.</p></div>}</section>;
}

function AssignmentCard({ assignment, property }: { assignment: StaffPropertyAssignment; property?: Property }) { return <article className={`rounded-2xl border p-4 ${assignment.isCurrent ? "border-primary/20 bg-primary/5" : "border-base-300 bg-base-100"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{property?.name || "Unknown property"}</h4>{assignment.isPrimary && <span className="badge border-0 bg-primary text-primary-content">Primary</span>}{!assignment.isCurrent && <span className="badge badge-ghost">Ended</span>}</div><p className="mt-1 text-sm text-base-content/55">{assignment.propertyJobTitle || "No property-specific title"}</p></div><p className="text-xs text-base-content/45">{formatDate(assignment.effectiveFrom)} → {assignment.effectiveTo ? formatDate(assignment.effectiveTo) : "Current"}</p></div></article>; }

function AccountLinkPanel({ member, canManage, submitting, error, onSave }: { member: StaffMember; canManage: boolean; submitting: boolean; error: unknown; onSave: (value: string | null) => void }) { const [value, setValue] = useState(member.authSubjectId || ""); useEffect(() => setValue(member.authSubjectId || ""), [member.authSubjectId]); return <section className="rounded-2xl border border-base-300 p-4 sm:p-5"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><KeyRound size={19} /></div><div><h3 className="font-display text-lg font-semibold">Sign-in account link</h3><p className="mt-1 text-sm leading-6 text-base-content/55">This connects the staff profile to a BunkFy account. Permissions are managed separately.</p></div></div><label className="form-control mt-5 block"><span className="label-text mb-1.5 block text-sm font-semibold">Sign-in account ID</span><input className="input input-bordered w-full font-mono text-sm" value={value} maxLength={256} disabled={!canManage} placeholder="Not linked" onChange={(event) => setValue(event.target.value)} /></label>{Boolean(error) && <div className="mt-4"><ErrorState error={error} /></div>}{canManage && <InlineFormActions>{member.authSubjectId && <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => onSave(null)} disabled={submitting}>Clear link</button>}<button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(emptyStringToNull(value))} disabled={submitting || value.trim() === (member.authSubjectId || "")}>{submitting && <span className="loading loading-spinner loading-xs" />}Save account link</button></InlineFormActions>}</section>; }

function StaffIdentity({ member }: { member: StaffMember }) { return <div className="flex min-w-0 items-center gap-3"><InitialAvatar name={member.displayName} size="sm" /><div className="min-w-0"><p className="truncate font-semibold">{member.displayName}</p><p className="mt-1 truncate text-xs text-base-content/45">{member.workEmail || member.employeeNumber || "No contact details"}</p></div></div>; }
function InfoRow({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href?: string }) { return <div className="flex items-start gap-3 rounded-xl border border-base-300 p-4"><span className="mt-0.5 text-primary">{icon}</span><div className="min-w-0"><p className="text-xs text-base-content/40">{label}</p>{href ? <a className="mt-1 block truncate text-sm font-semibold text-primary hover:underline" href={href}>{value}</a> : <p className="mt-1 truncate text-sm font-semibold">{value}</p>}</div></div>; }
function TextField({ label, name, type = "text", defaultValue, required = true, maxLength }: { label: string; name: string; type?: string; defaultValue?: string; required?: boolean; maxLength?: number }) { return <label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} type={type} defaultValue={defaultValue} required={required} maxLength={maxLength} /></label>; }
function FormDatePicker({ name, defaultValue, min, ariaLabel }: { name: string; defaultValue: string; min?: string; ariaLabel: string }) { const [value, setValue] = useState(defaultValue); return <DatePicker className="w-full" name={name} value={value} min={min} onChange={setValue} ariaLabel={ariaLabel} required />; }
function staffStatusKey(status: StaffStatus) { if (typeof status === "string") return status.toLowerCase(); return ({ 1: "active", 2: "suspended", 3: "departed" } as Record<number, string>)[status] ?? "unknown"; }
function staffDetailTab(value: string | null): "profile" | "assignments" | "account" { return value === "assignments" || value === "account" ? value : "profile"; }
function emptyToNull(value: FormDataEntryValue | null) { return emptyStringToNull(String(value ?? "")); }
function emptyStringToNull(value: string) { const normalized = value.trim(); return normalized || null; }
function capitalize(value: string) { return value.slice(0, 1).toUpperCase() + value.slice(1); }
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
