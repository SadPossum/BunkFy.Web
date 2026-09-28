import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, Plus, Star } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Property, StaffMemberMutationReceipt } from "../../api/types";
import { compositeSourceCurrent, createCompositeSource, type CompositeSource } from "../../app/compositeSourceState";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { DatePicker } from "../../components/ui/DatePicker";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { FormGrid, FormSection, FormSpan } from "../../components/ui/FormLayout";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { ErrorState, InlineFormActions, StatusBadge } from "../../components/ui/primitives";
import { modalControlVisible, modalIsTopmost } from "../../components/ui/modalFocus";
import { staffMutationAllowed, staffPropertyTargetMatches, staffRecordMatches } from "./staffMutationAuthority";
import { assignmentIsCurrent, formatStaffDate, isFullStaffAssignment, staffStatusKey, type StaffAssignment, type StaffDetailMember } from "./staffPresentation";
import { resolveStaffPropertyAssignmentAttempt, type StaffPropertyAssignmentAttempt, type StaffPropertyAssignmentAttemptInput } from "./staffPropertyAssignmentAttempt";
import { StaffAuthorityNotice } from "./StaffAuthorityNotice";

type AssignmentTarget = {
  id: number;
  owner: string;
  tenantId: string;
  member: StaffDetailMember;
  property: Property | null;
  action: StaffPropertyAssignmentAttemptInput["action"];
};
type AssignmentSubmission = AssignmentTarget & { property: Property; input: StaffPropertyAssignmentAttemptInput };

export function StaffAssignmentsPanel({
  tenantId, member, currentMember, memberSource, properties, selectedProperty,
  propertySource, assignmentHistory, historyRestricted, historyStale, onUpdated,
}: {
  tenantId: string;
  member: StaffDetailMember;
  currentMember: StaffDetailMember | null;
  memberSource: CompositeSource;
  properties: Property[];
  selectedProperty: Property | null;
  propertySource: CompositeSource;
  assignmentHistory: StaffAssignment[] | null;
  historyRestricted: boolean;
  historyStale: boolean;
  onUpdated: (tenantId: string, staffMemberId: string) => Promise<void>;
}) {
  const today = utcDateKey(new Date());
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AssignmentTarget | null>(null);
  const attempt = useRef<StaffPropertyAssignmentAttempt | null>(null);
  const serial = useRef(0);
  const area = useRef<HTMLElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const restore = useRef<{ owner: string; button: HTMLButtonElement | null; previous: Element | null } | null>(null);
  const headingId = useId();
  const owner = `${tenantId}:${member.staffMemberId}:${session?.subjectId ?? session?.username ?? ""}:${session?.sessionId ?? session?.generation ?? ""}`;
  const currentAssignments = [...member.assignments].filter(assignmentIsCurrent)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.effectiveFrom.localeCompare(b.effectiveFrom));
  const choices = properties.filter(property => property.status === "active" &&
    !currentAssignments.some(assignment => assignment.propertyId === property.propertyId));
  const relevantProperties = [...new Set([
    ...currentAssignments.map(assignment => assignment.propertyId),
    ...(target?.property ? [target.property.propertyId] : []),
  ])];
  const access = usePermissions(relevantProperties.map(propertyId => ({
    permission: permissions.staffAssignProperties, scope: propertyAccessScope(tenantId, propertyId),
  })));
  const permissionSource = createCompositeSource({
    label: "Work-location permissions", hasData: access.hasData, isLoading: access.isLoading,
    error: access.error, isFetching: access.isFetching, refetch: access.refetch,
  });
  const permissionCurrent = compositeSourceCurrent(permissionSource);
  const canAssign = (propertyId: string) => access.allows(permissions.staffAssignProperties, propertyAccessScope(tenantId, propertyId));
  const memberCurrent = compositeSourceCurrent(memberSource) && staffRecordMatches(currentMember, member);
  const active = staffStatusKey(member.status) === "active";
  const catalogueCurrent = compositeSourceCurrent(propertySource);
  const baseCurrent = memberCurrent && catalogueCurrent && active;
  const targetAuthorityCurrent = Boolean(target?.property && target.owner === owner &&
    canAssign(target.property.propertyId) && active && staffMutationAllowed("property-assignment", {
      permissionsCurrent: permissionCurrent,
      memberCurrent: compositeSourceCurrent(memberSource) && staffRecordMatches(currentMember, target.member),
      propertyCurrent: catalogueCurrent && staffPropertyTargetMatches(properties, target.property) &&
        (target.action === "unassign" || target.property.status === "active"),
    }));
  const latest = useRef({ owner, target, targetAuthorityCurrent });
  latest.current = { owner, target, targetAuthorityCurrent };
  const owns = (submission: AssignmentTarget) => latest.current.owner === submission.owner &&
    latest.current.target?.id === submission.id && latest.current.target.property?.propertyId === submission.property?.propertyId;
  const mutation = useMutation<StaffMemberMutationReceipt, Error, AssignmentSubmission>({
    mutationFn: async submission => {
      const authorized = () => owns(submission) && latest.current.targetAuthorityCurrent;
      if (!authorized()) throw new Error("Refresh the staff member, property and assignment access before saving.");
      const nextAttempt = await resolveStaffPropertyAssignmentAttempt(attempt.current,
        submission.member.staffMemberId, submission.property.propertyId, submission.member.version, submission.input);
      // Hash preparation is asynchronous: an identity/target/access change must
      // not dispatch the old closure's command after it finishes.
      if (!authorized()) throw new Error("The assignment context changed before saving. Review it and try again.");
      attempt.current = nextAttempt;
      const { action, ...payload } = submission.input;
      return request<StaffMemberMutationReceipt>(
        `/api/staff/properties/${submission.property.propertyId}/members/${submission.member.staffMemberId}/${action}`,
        { method: action === "assignment" ? "PUT" : "POST", body: JSON.stringify({
          ...payload, operationId: nextAttempt.operationId, expectedVersion: nextAttempt.expectedVersion,
        }) },
      );
    },
    onSuccess: async (_receipt, submission) => {
      await onUpdated(submission.tenantId, submission.member.staffMemberId);
      if (!owns(submission)) return;
      attempt.current = null;
      restore.current = { owner: submission.owner, button: opener.current, previous: document.activeElement };
      setTarget(null);
    },
    onError: async (_error, submission) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff-member", submission.member.staffMemberId, submission.tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["staff-members", submission.tenantId] }),
      ]);
    },
  });
  useEffect(() => {
    attempt.current = null;
    restore.current = null;
    setTarget(null);
  }, [owner]);
  useEffect(() => {
    if (active || !target || target.owner !== owner) return;
    const focused = document.activeElement;
    const modal = area.current?.closest<HTMLElement>("[data-bunkfy-modal-box]");
    if (focused === document.body || focused === modal || (focused && area.current?.contains(focused))) {
      restore.current = { owner, button: null, previous: focused };
    }
    attempt.current = null;
    setTarget(null);
  }, [active, owner, target]);
  useLayoutEffect(() => {
    const modal = area.current?.closest<HTMLElement>("[data-bunkfy-modal-box]");
    if (!modal || !modalIsTopmost(modal)) return;
    if (target?.owner === owner) {
      const first = form.current?.querySelector<HTMLElement>(target.action === "assignment" ? '[aria-label="Work location"]' : '[name="reason"]');
      if (first && modalControlVisible(first)) first.focus();
      return;
    }
    const intent = restore.current;
    restore.current = null;
    if (!intent || intent.owner !== owner) return;
    const focused = document.activeElement;
    if (focused !== intent.previous && focused !== modal && focused !== document.body && focused?.isConnected) return;
    const destination = intent.button && modalControlVisible(intent.button) ? intent.button : area.current?.querySelector<HTMLElement>("h3");
    if (destination) { destination.scrollIntoView({ block: "nearest" }); destination.focus({ preventScroll: true }); }
    // Local entry/return only; selecting another property and background reads
    // must not take focus away from the picker, fields or an independent task.
  }, [target?.id, owner]);
  useEffect(() => {
    const editor = form.current, modal = editor?.closest<HTMLElement>("[data-bunkfy-modal-box]");
    if (!targetAuthorityCurrent || mutation.isPending || !editor || !modal) return;
    let port = editor.parentElement;
    while (port && port !== modal && !/^(auto|scroll)$/.test(getComputedStyle(port).overflowY)) port = port.parentElement;
    if (!port || port === modal) return;
    const scrollport = port;
    let width = window.innerWidth, height = window.innerHeight, frame = 0, pointerDown = false;
    let visibleField: HTMLElement | null = null;
    const activeField = () => {
      const active = document.activeElement;
      return active instanceof HTMLElement && editor.contains(active) && active.matches("input:not([type=hidden]), textarea, select") &&
        !active.matches(":disabled, [readonly]") ? active : null;
    };
    const remember = () => {
      const active = activeField();
      if (!active) { visibleField = null; return; }
      const rect = active.getBoundingClientRect(), bounds = scrollport.getBoundingClientRect();
      visibleField = rect.top >= bounds.top && rect.bottom <= bounds.bottom ? active : null;
    };
    const reveal = (field: HTMLElement) => {
      if (pointerDown || !editor.isConnected || activeField() !== field || !modalIsTopmost(modal)) return;
      const rect = field.getBoundingClientRect(), label = field.closest("label")?.getBoundingClientRect();
      const bounds = scrollport.getBoundingClientRect();
      const top = Math.min(rect.top - 8, label?.top ?? rect.top - 8), bottom = rect.bottom + 8;
      scrollport.scrollTop += top < bounds.top ? top - bounds.top : bottom > bounds.bottom ? bottom - bounds.bottom : 0;
    };
    const clear = () => { visibleField = null; cancelAnimationFrame(frame); };
    const entered = () => {
      clear();
      const field = activeField();
      if (!field) return;
      // Native Tab may expose only the border. Adjust this scrollport after
      // that native scroll; keep the caret, focus and independent task intact.
      frame = requestAnimationFrame(() => { reveal(field); remember(); });
    };
    const shrink = () => {
      const smaller = window.innerWidth < width || window.innerHeight < height;
      width = window.innerWidth; height = window.innerHeight;
      if (smaller && visibleField) reveal(visibleField);
      remember();
    };
    const startPointer = () => { pointerDown = true; clear(); };
    const endPointer = () => { pointerDown = false; remember(); };
    remember();
    editor.addEventListener("focusin", entered); editor.addEventListener("focusout", clear);
    scrollport.addEventListener("scroll", remember, { passive: true });
    scrollport.addEventListener("wheel", clear, { passive: true }); scrollport.addEventListener("pointerdown", startPointer);
    document.addEventListener("pointerup", endPointer); document.addEventListener("pointercancel", endPointer);
    window.addEventListener("resize", shrink);
    return () => {
      clear(); editor.removeEventListener("focusin", entered); editor.removeEventListener("focusout", clear);
      scrollport.removeEventListener("scroll", remember); scrollport.removeEventListener("wheel", clear); scrollport.removeEventListener("pointerdown", startPointer);
      document.removeEventListener("pointerup", endPointer); document.removeEventListener("pointercancel", endPointer);
      window.removeEventListener("resize", shrink);
    };
  }, [target?.id, owner, targetAuthorityCurrent, mutation.isPending]);
  useEffect(() => () => { latest.current = { owner: "", target: null, targetAuthorityCurrent: false }; }, []);

  function open(action: AssignmentTarget["action"], button: HTMLButtonElement, property: Property | null) {
    if (mutation.isPending || target || !baseCurrent) return;
    if (action === "unassign" && (!property || !permissionCurrent || !canAssign(property.propertyId))) return;
    opener.current = button;
    attempt.current = null;
    mutation.reset();
    setTarget({ id: ++serial.current, owner, tenantId, member, property, action });
  }
  function cancel() {
    if (mutation.isPending) return;
    restore.current = { owner, button: opener.current, previous: document.activeElement };
    attempt.current = null;
    mutation.reset();
    setTarget(null);
  }
  function chooseProperty(id: string) {
    if (!target || mutation.isPending || target.action !== "assignment") return;
    const property = choices.find(item => item.propertyId === id);
    if (!property) return;
    attempt.current = null;
    mutation.reset();
    setTarget({ ...target, member, property });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target?.property || !targetAuthorityCurrent || mutation.isPending) return;
    const data = new FormData(event.currentTarget);
    const input: StaffPropertyAssignmentAttemptInput = target.action === "assignment" ? {
      action: "assignment", propertyJobTitle: emptyToNull(data.get("propertyJobTitle")),
      isPrimary: data.get("isPrimary") === "on", effectiveFrom: String(data.get("effectiveFrom")),
    } : { action: "unassign", effectiveTo: String(data.get("effectiveTo")), reason: String(data.get("reason") ?? "").trim() };
    mutation.mutate({ ...target, property: target.property, input });
  }
  const hasPrimary = (target?.member ?? member).assignments.some(assignment => assignmentIsCurrent(assignment) && assignment.isPrimary);
  const targetAssignment = target?.member.assignments.find(assignment => assignment.propertyId === target.property?.propertyId && assignmentIsCurrent(assignment));
  const history = assignmentHistory?.filter(assignment => !assignmentIsCurrent(assignment))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const denied = target?.property && permissionCurrent && !canAssign(target.property.propertyId);
  const changed = target && currentMember && !staffRecordMatches(currentMember, target.member);

  function editor() {
    if (!target || target.owner !== owner) return null;
    return <form ref={form} onSubmit={submit} className="min-w-0 border-t border-base-300 pt-5">
      <FormSection title={target.action === "assignment" ? "Add work location" : "End assignment"} headingLevel={4}
        description={target.action === "unassign" ? target.property?.name : undefined}>
        {target.action === "assignment" && <div className="mb-4 min-w-0">
          <label className="mb-1.5 block text-sm font-semibold">Work location</label>
          <SelectPicker ariaLabel="Work location" searchable value={target.property?.propertyId} disabled={mutation.isPending || !catalogueCurrent}
            placeholder="Choose a property" className="w-full" onValueChange={chooseProperty}
            options={choices.map(property => ({ value: property.propertyId, label: property.name, description: property.code, searchTerms: [property.code] }))} />
          {target.property && <p className="mt-2 text-sm font-medium [overflow-wrap:anywhere]">{target.property.name}</p>}
        </div>}
        {target.property && !targetAuthorityCurrent && <div className="mb-4"><StaffAuthorityNotice message={denied
          ? "You do not have access to manage assignments at this property. Choose another property or ask a workspace administrator."
          : changed ? "This staff record has changed. Cancel and reopen the form to review the latest version before saving."
          : "Confirming current staff, property and assignment access. Your draft is kept; saving is unavailable until these checks finish."} /></div>}
        {target.property && <fieldset key={target.property.propertyId} disabled={!targetAuthorityCurrent || mutation.isPending} className="min-w-0">
          {target.action === "assignment" ? <FormGrid>
            <TextField label="Property job title (optional)" name="propertyJobTitle" defaultValue={target.member.jobTitle || ""} maxLength={128} />
            <div className="min-w-0">
              <span className="mb-1.5 block text-sm font-semibold">Effective from</span>
              <FormDatePicker name="effectiveFrom" defaultValue={today} max={today} ariaLabel="Effective from" />
              <p className="mt-1.5 text-xs leading-5 text-base-content/65">Starts immediately. This date records when the person began working here.</p>
            </div>
            <FormSpan><label className="flex items-start gap-3 text-sm">
              <input className="checkbox checkbox-primary checkbox-sm mt-0.5 shrink-0" type="checkbox" name="isPrimary" disabled={hasPrimary || !targetAuthorityCurrent || mutation.isPending} />
              <span><span className="block font-semibold">Primary work location</span><span className="mt-1 block text-base-content/65">{hasPrimary ? "Another current work location is already primary." : "Use this as their main work location."}</span></span>
            </label></FormSpan>
          </FormGrid> : <FormGrid>
            <div className="min-w-0">
              <span className="mb-1.5 block text-sm font-semibold">Effective through</span>
              <FormDatePicker name="effectiveTo" min={targetAssignment?.effectiveFrom} max={today} defaultValue={today} ariaLabel="Effective through" />
              <p className="mt-1.5 text-xs leading-5 text-base-content/65">Ends this work location now. Employment and sign-in access do not change.</p>
            </div>
            <label className="block min-w-0"><span className="mb-1.5 block text-sm font-semibold">Reason</span>
              <textarea className="textarea textarea-bordered min-h-24 w-full" name="reason" maxLength={1000} rows={3} required />
            </label>
          </FormGrid>}
        </fieldset>}
        {mutation.error && <div className="mt-4"><ErrorState error={mutation.error} /></div>}
        <InlineFormActions>
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} disabled={mutation.isPending}>Cancel</button>
          <button type="submit" className={`btn btn-sm ${target.action === "unassign" ? "btn-error" : "btn-primary"}`} disabled={mutation.isPending || !targetAuthorityCurrent}>
            {mutation.isPending && <span className="loading loading-spinner loading-xs" />}
            {target.action === "unassign" ? "End assignment" : "Add assignment"}
          </button>
        </InlineFormActions>
      </FormSection>
    </form>;
  }

  return <section ref={area} aria-labelledby={headingId} className="min-w-0 space-y-5">
    <CompositeSourceNotice className="mb-0" sources={[propertySource, permissionSource]} title="Work-location context is delayed" />
    <div className="min-w-0">
      <h3 id={headingId} tabIndex={-1} className="rounded text-base font-semibold outline-none focus:ring-2 focus:ring-primary">Current work locations <span className="ml-1 font-normal text-base-content/55">({currentAssignments.length})</span></h3>
      <p className="mt-1 text-sm leading-5 text-base-content/65">Where this person works. Assignments do not grant workspace or property access.</p>
    </div>
    {currentAssignments.length ? <div className="divide-y divide-base-300 border-y border-base-300">
      {currentAssignments.map(assignment => {
        const property = properties.find(item => item.propertyId === assignment.propertyId);
        return <div key={assignment.assignmentId} className="min-w-0 py-4">
          <AssignmentRow assignment={assignment} property={property}>
            {active && canAssign(assignment.propertyId) && <button type="button" className="btn btn-outline btn-sm h-auto min-h-9 whitespace-normal"
              aria-label={`End assignment at ${property?.name ?? "unavailable property"}`}
              disabled={Boolean(target) || mutation.isPending || !baseCurrent || !permissionCurrent || !property}
              onClick={event => open("unassign", event.currentTarget, property ?? null)}>End assignment</button>}
          </AssignmentRow>
          {target?.action === "unassign" && target.property?.propertyId === assignment.propertyId && <div className="mt-4">{editor()}</div>}
        </div>;
      })}
    </div> : <p className="border-y border-base-300 py-5 text-sm text-base-content/65">No current work locations. Add the property where this person works.</p>}
    {target?.action === "unassign" && !currentAssignments.some(assignment => assignment.propertyId === target.property?.propertyId) && editor()}
    {active && <div className="min-w-0 space-y-4">
      <button type="button" className="btn btn-primary btn-sm h-auto min-h-9 max-w-full whitespace-normal" disabled={Boolean(target) || mutation.isPending || !baseCurrent || !choices.length}
        onClick={event => open("assignment", event.currentTarget, choices.find(property => property.propertyId === selectedProperty?.propertyId) ?? null)}><Plus size={15} />Add work location</button>
      {!choices.length && catalogueCurrent && <p className="text-sm text-base-content/65">No other active properties are available in this workspace.</p>}
      {target?.action === "assignment" && editor()}
    </div>}
    <div className="min-w-0 border-t border-base-300 pt-4">
      {history ? history.length ? <details className="group min-w-0">
        <summary tabIndex={0} className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>Assignment history <span className="font-normal text-base-content/55">({history.length})</span></span><ChevronDown size={17} className="shrink-0 group-open:rotate-180" />
        </summary>
        {historyStale && <p className="mb-2 text-xs text-base-content/65">Last confirmed history. Profile information is refreshing or unavailable.</p>}
        <div className="divide-y divide-base-300">{history.map(assignment => <div key={assignment.assignmentId} className="py-4"><AssignmentRow assignment={assignment} property={properties.find(property => property.propertyId === assignment.propertyId)} /></div>)}</div>
      </details> : <p className="text-sm text-base-content/65">{historyStale ? "No ended assignments in the last confirmed history." : "No ended assignments."}</p>
      : <p className="text-sm text-base-content/65">{historyRestricted ? "Assignment history is not available with your current access." : "Assignment history could not be confirmed. Refresh the staff profile to try again."}</p>}
    </div>
  </section>;
}

function AssignmentRow({ assignment, property, children }: { assignment: StaffAssignment; property?: Property; children?: ReactNode }) {
  const current = assignmentIsCurrent(assignment);
  const effectiveTo = isFullStaffAssignment(assignment) ? assignment.effectiveTo : null;
  return <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="flex min-w-0 items-start gap-3">
      <Building2 size={18} className="mt-1 shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 font-semibold [overflow-wrap:anywhere]">{property?.name ?? "Property unavailable"}</h4>
          {assignment.isPrimary && <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Star size={13} />Primary</span>}
          {!current && <StatusBadge status="Ended" />}
          {property?.status === "retired" && <StatusBadge status="Retired property" />}
        </div>
        <p className="mt-1 text-sm text-base-content/65 [overflow-wrap:anywhere]">{assignment.propertyJobTitle || "Uses the workspace job title"}</p>
        <p className="mt-1 text-xs leading-5 text-base-content/65">{formatStaffDate(assignment.effectiveFrom)} to {effectiveTo ? formatStaffDate(effectiveTo) : "present"}</p>
      </div>
    </div>
    {children && <div className="shrink-0 self-start sm:max-w-[12rem]">{children}</div>}
  </div>;
}
function TextField({ label, name, defaultValue, maxLength }: { label: string; name: string; defaultValue?: string; maxLength: number }) {
  return <label className="block min-w-0"><span className="mb-1.5 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} defaultValue={defaultValue} maxLength={maxLength} /></label>;
}
function FormDatePicker({ name, defaultValue, min, max, ariaLabel }: { name: string; defaultValue: string; min?: string; max?: string; ariaLabel: string }) {
  const [value, setValue] = useState(defaultValue);
  return <DatePicker className="w-full" name={name} value={value} min={min} max={max} onChange={setValue} ariaLabel={ariaLabel} required />;
}
function emptyToNull(value: FormDataEntryValue | null): string | null { return String(value ?? "").trim() || null; }
function utcDateKey(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
