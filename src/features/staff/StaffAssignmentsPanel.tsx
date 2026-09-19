import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, ChevronDown, Plus, Star, UserRoundMinus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Property, StaffMemberMutationReceipt } from "../../api/types";
import {
  compositeSourceCurrent,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import { DatePicker } from "../../components/ui/DatePicker";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { ErrorState, InlineFormActions, StatusBadge } from "../../components/ui/primitives";
import {
  staffMutationAllowed,
  staffPropertyTargetMatches,
  staffRecordMatches,
} from "./staffMutationAuthority";
import {
  assignmentIsCurrent,
  formatStaffDate,
  isFullStaffAssignment,
  staffStatusKey,
  type StaffAssignment,
  type StaffDetailMember,
} from "./staffPresentation";
import {
  resolveStaffPropertyAssignmentAttempt,
  type StaffPropertyAssignmentAttempt,
  type StaffPropertyAssignmentAttemptInput,
} from "./staffPropertyAssignmentAttempt";
import { StaffAuthorityNotice } from "./StaffAuthorityNotice";

type AssignmentTarget = {
  tenantId: string;
  member: StaffDetailMember;
  property: Property;
  action: StaffPropertyAssignmentAttemptInput["action"];
};

type AssignmentSubmission = AssignmentTarget & {
  input: StaffPropertyAssignmentAttemptInput;
};

export function StaffAssignmentsPanel({
  tenantId,
  member,
  currentMember,
  memberSource,
  properties,
  selectedProperty,
  propertySource,
  assignmentPermissionSource,
  canAssign,
  onUpdated,
}: {
  tenantId: string;
  member: StaffDetailMember;
  currentMember: StaffDetailMember | null;
  memberSource: CompositeSource;
  properties: Property[];
  selectedProperty: Property | null;
  propertySource: CompositeSource;
  assignmentPermissionSource: CompositeSource | null;
  canAssign: boolean;
  onUpdated: (tenantId: string, staffMemberId: string) => Promise<void>;
}) {
  const today = utcDateKey(new Date());
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AssignmentTarget | null>(null);
  const assignmentAttempt = useRef<StaffPropertyAssignmentAttempt | null>(null);
  const scopeKey = `${tenantId}:${member.staffMemberId}:${selectedProperty?.propertyId ?? "none"}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  const permissionCurrent = Boolean(
    assignmentPermissionSource &&
      compositeSourceCurrent(assignmentPermissionSource),
  );
  const propertyCurrent = compositeSourceCurrent(propertySource) &&
    staffPropertyTargetMatches(properties, selectedProperty);
  const memberCurrent = staffRecordMatches(currentMember, member);
  const baseAuthorityCurrent = canAssign && staffMutationAllowed(
    "property-assignment",
    {
      permissionsCurrent: permissionCurrent,
      memberCurrent,
      propertyCurrent,
    },
  );
  const targetAuthorityCurrent = Boolean(
    target &&
      target.tenantId === tenantId &&
      selectedProperty?.propertyId === target.property.propertyId &&
      canAssign &&
      staffMutationAllowed("property-assignment", {
        permissionsCurrent: permissionCurrent,
        memberCurrent: staffRecordMatches(currentMember, target.member),
        propertyCurrent: compositeSourceCurrent(propertySource) &&
          staffPropertyTargetMatches(properties, target.property),
      }),
  );

  const mutation = useMutation<StaffMemberMutationReceipt, Error, AssignmentSubmission>({
    mutationFn: async ({ tenantId: targetTenantId, member: targetMember, property, input }) => {
      const scopeMatches = targetTenantId === tenantId &&
        scopeKeyRef.current === `${targetTenantId}:${targetMember.staffMemberId}:${property.propertyId}`;
      const authorityCurrent = scopeMatches && canAssign &&
        staffMutationAllowed("property-assignment", {
          permissionsCurrent: permissionCurrent,
          memberCurrent: staffRecordMatches(currentMember, targetMember),
          propertyCurrent: compositeSourceCurrent(propertySource) &&
            staffPropertyTargetMatches(properties, property),
        });
      if (!authorityCurrent) {
        throw new Error("Current Staff, property, and assignment access evidence could not be confirmed. Refresh and try again.");
      }

      assignmentAttempt.current = await resolveStaffPropertyAssignmentAttempt(
        assignmentAttempt.current,
        targetMember.staffMemberId,
        property.propertyId,
        targetMember.version,
        input,
      );
      const { action, ...payload } = input;
      return request<StaffMemberMutationReceipt>(
        `/api/staff/properties/${property.propertyId}/members/${targetMember.staffMemberId}/${action}`,
        {
          method: action === "assignment" ? "PUT" : "POST",
          body: JSON.stringify({
            ...payload,
            operationId: assignmentAttempt.current.operationId,
            expectedVersion: assignmentAttempt.current.expectedVersion,
          }),
        },
      );
    },
    onSuccess: async (_receipt, submission) => {
      assignmentAttempt.current = null;
      await onUpdated(submission.tenantId, submission.member.staffMemberId);
      if (scopeKeyRef.current === `${submission.tenantId}:${submission.member.staffMemberId}:${submission.property.propertyId}`) {
        setTarget(null);
      }
    },
    onError: async (_error, submission) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff-member", submission.member.staffMemberId] }),
        queryClient.invalidateQueries({ queryKey: ["staff-members", submission.tenantId] }),
      ]);
    },
  });

  useEffect(() => {
    assignmentAttempt.current = null;
    setTarget(null);
  }, [scopeKey]);

  useEffect(() => {
    if (!assignmentPermissionSource || !compositeSourceCurrent(assignmentPermissionSource)) return;
    if (!canAssign) {
      assignmentAttempt.current = null;
      setTarget(null);
    }
  }, [assignmentPermissionSource, canAssign]);

  function openTarget(action: AssignmentTarget["action"]) {
    if (!selectedProperty || !baseAuthorityCurrent) return;
    assignmentAttempt.current = null;
    mutation.reset();
    setTarget({ tenantId, member, property: selectedProperty, action });
  }

  function cancel() {
    assignmentAttempt.current = null;
    mutation.reset();
    setTarget(null);
  }

  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || target.action !== "assignment" || !targetAuthorityCurrent) return;
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      ...target,
      input: {
        action: "assignment",
        propertyJobTitle: emptyToNull(data.get("propertyJobTitle")),
        isPrimary: data.get("isPrimary") === "on",
        effectiveFrom: String(data.get("effectiveFrom")),
      },
    });
  }

  function unassign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || target.action !== "unassign" || !targetAuthorityCurrent) return;
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      ...target,
      input: {
        action: "unassign",
        effectiveTo: String(data.get("effectiveTo")),
        reason: String(data.get("reason") ?? "").trim(),
      },
    });
  }

  const currentAtSelected = member.assignments.find((assignment) =>
    assignment.propertyId === selectedProperty?.propertyId && assignmentIsCurrent(assignment));
  const hasPrimary = (target?.member ?? member).assignments.some((assignment) =>
    assignmentIsCurrent(assignment) && assignment.isPrimary);
  const ordered = [...member.assignments].sort((a, b) =>
    Number(assignmentIsCurrent(b)) - Number(assignmentIsCurrent(a)) ||
    b.effectiveFrom.localeCompare(a.effectiveFrom));
  const currentAssignments = ordered.filter(assignmentIsCurrent);
  const assignmentHistory = ordered.filter((assignment) => !assignmentIsCurrent(assignment));
  const targetCurrentAssignment = target?.member.assignments.find((assignment) =>
    assignment.propertyId === target.property.propertyId && assignmentIsCurrent(assignment));
  const sources = [
    memberSource,
    propertySource,
    ...(assignmentPermissionSource ? [assignmentPermissionSource] : []),
  ];

  return (
    <section className="space-y-4">
      <CompositeSourceNotice
        className="mb-0"
        sources={sources}
        title="Staff assignment context is delayed"
      />
      <div className="rounded-lg border border-base-300 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold">Property assignments</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-base-content/50">Current and past work locations. Assignments do not create workspace membership or grant property access.</p>
          </div>
          {canAssign && selectedProperty && staffStatusKey(member.status) === "active" && !target && (
            <button
              type="button"
              className={`btn btn-sm ${currentAtSelected ? "btn-ghost text-error" : "btn-primary"}`}
              disabled={!baseAuthorityCurrent}
              onClick={() => openTarget(currentAtSelected ? "unassign" : "assignment")}
            >
              {currentAtSelected ? <UserRoundMinus size={15} /> : <Plus size={15} />}
              {currentAtSelected
                ? `Unassign from ${selectedProperty.name}`
                : `Assign to ${selectedProperty.name}`}
            </button>
          )}
        </div>

        {target && !targetAuthorityCurrent && (
          <div className="mt-4">
            <StaffAuthorityNotice message="Current Staff, property, or assignment permission evidence is refreshing or no longer matches this form. If it remains disabled, cancel and reopen it." />
          </div>
        )}

        {target?.action === "assignment" && (
          <form className="mt-4 rounded-lg bg-base-200 p-4" onSubmit={assign}>
            <h4 className="font-semibold">Assign to {target.property.name}</h4>
            <fieldset disabled={!targetAuthorityCurrent || mutation.isPending}>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Property job title"
                  name="propertyJobTitle"
                  defaultValue={target.member.jobTitle || ""}
                  required={false}
                  maxLength={128}
                />
                <div className="form-control block">
                  <span className="label-text mb-1.5 block text-sm font-semibold">Effective from</span>
                  <FormDatePicker
                    name="effectiveFrom"
                    defaultValue={today}
                    max={today}
                    ariaLabel="Effective from"
                  />
                  <span className="mt-1.5 block text-xs leading-5 text-base-content/45">The assignment starts immediately; this date records the employment fact.</span>
                </div>
              </div>
              <label className={`mt-4 flex items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 ${hasPrimary ? "opacity-60" : "cursor-pointer"}`}>
                <input
                  className="checkbox checkbox-primary checkbox-sm mt-0.5"
                  type="checkbox"
                  name="isPrimary"
                  disabled={hasPrimary || !targetAuthorityCurrent || mutation.isPending}
                />
                <span>
                  <span className="block text-sm font-semibold">Primary property</span>
                  <span className="block text-xs text-base-content/50">
                    {hasPrimary
                      ? "Another current assignment is already primary."
                      : "Use this as the staff member's main property."}
                  </span>
                </span>
              </label>
            </fieldset>
            {mutation.error && <div className="mt-4"><ErrorState error={mutation.error} /></div>}
            <InlineFormActions>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={mutation.isPending || !targetAuthorityCurrent}>
                {mutation.isPending && <span className="loading loading-spinner loading-xs" />}
                Add assignment
              </button>
            </InlineFormActions>
          </form>
        )}

        {target?.action === "unassign" && targetCurrentAssignment && (
          <form className="mt-4 rounded-lg border border-warning/25 bg-warning/8 p-4" onSubmit={unassign}>
            <h4 className="font-semibold">End assignment at {target.property.name}</h4>
            <fieldset disabled={!targetAuthorityCurrent || mutation.isPending}>
              <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
                <div className="form-control block">
                  <span className="label-text mb-1.5 block text-sm font-semibold">Effective through</span>
                  <FormDatePicker
                    name="effectiveTo"
                    min={targetCurrentAssignment.effectiveFrom}
                    max={today}
                    defaultValue={today}
                    ariaLabel="Effective through"
                  />
                </div>
                <label className="form-control block">
                  <span className="label-text mb-1.5 block text-sm font-semibold">Reason</span>
                  <input
                    className="input input-bordered w-full"
                    name="reason"
                    maxLength={1000}
                    placeholder="Why this assignment is ending"
                    required
                  />
                </label>
              </div>
            </fieldset>
            {mutation.error && <div className="mt-4"><ErrorState error={mutation.error} /></div>}
            <InlineFormActions>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>Cancel</button>
              <button type="submit" className="btn btn-error btn-sm" disabled={mutation.isPending || !targetAuthorityCurrent}>
                {mutation.isPending && <span className="loading loading-spinner loading-xs" />}
                End assignment
              </button>
            </InlineFormActions>
          </form>
        )}
      </div>

      {ordered.length ? (
        <div className="space-y-5">
          <section aria-labelledby="current-staff-assignments">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 id="current-staff-assignments" className="text-xs font-bold uppercase text-base-content/45">Current work locations</h4>
              <span className="text-xs font-medium text-base-content/45">{currentAssignments.length}</span>
            </div>
            {currentAssignments.length ? (
              <div className="divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300 bg-base-100">
                {currentAssignments.map((assignment) => (
                  <AssignmentRow
                    key={assignment.assignmentId}
                    assignment={assignment}
                    property={properties.find((property) => property.propertyId === assignment.propertyId)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-base-300 p-6 text-center">
                <Building2 className="mx-auto text-base-content/30" />
                <p className="mt-3 text-sm font-semibold">No current work locations</p>
                <p className="mt-1 text-xs leading-5 text-base-content/50">Choose the relevant property in the workspace shell before adding an assignment.</p>
              </div>
            )}
          </section>

          {assignmentHistory.length > 0 && (
            <details className="group overflow-hidden rounded-lg border border-base-300 bg-base-100">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="block text-sm font-semibold">Assignment history</span>
                  <span className="mt-1 block text-xs text-base-content/45">{assignmentHistory.length} ended {assignmentHistory.length === 1 ? "assignment" : "assignments"}</span>
                </span>
                <ChevronDown className="shrink-0 transition-transform group-open:rotate-180" size={17} />
              </summary>
              <div className="divide-y divide-base-300 border-t border-base-300">
                {assignmentHistory.map((assignment) => (
                  <AssignmentRow
                    key={assignment.assignmentId}
                    assignment={assignment}
                    property={properties.find((property) => property.propertyId === assignment.propertyId)}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-base-300 p-8 text-center">
          <Building2 className="mx-auto text-base-content/30" />
          <h3 className="mt-3 font-display text-lg font-semibold">No property assignments</h3>
          <p className="mt-1 text-sm text-base-content/50">Choose the property where this person works, then add their first assignment.</p>
        </div>
      )}
    </section>
  );
}

function AssignmentRow({
  assignment,
  property,
}: {
  assignment: StaffAssignment;
  property?: Property;
}) {
  const current = assignmentIsCurrent(assignment);
  const effectiveTo = isFullStaffAssignment(assignment) ? assignment.effectiveTo : null;
  return (
    <article className={`p-4 ${current ? "bg-primary/5" : "bg-base-100"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${current ? "bg-primary/10 text-primary" : "bg-base-200 text-base-content/55"}`}>
            <Building2 size={17} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">{property?.name || "Property unavailable"}</h4>
              {assignment.isPrimary && <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary"><Star size={13} />Primary</span>}
              <StatusBadge status={current ? "Current" : "Ended"} />
            </div>
            <p className="mt-1 text-sm text-base-content/55">{assignment.propertyJobTitle || "Uses the workspace job title"}</p>
          </div>
        </div>
        <p className="inline-flex shrink-0 items-center gap-1.5 text-xs text-base-content/45">
          <CalendarDays size={14} />
          {formatStaffDate(assignment.effectiveFrom)} to {effectiveTo ? formatStaffDate(effectiveTo) : "present"}
        </p>
      </div>
    </article>
  );
}

function TextField({
  label,
  name,
  defaultValue,
  required = true,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      <input
        className="input input-bordered w-full"
        name={name}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}

function FormDatePicker({
  name,
  defaultValue,
  min,
  max,
  ariaLabel,
}: {
  name: string;
  defaultValue: string;
  min?: string;
  max?: string;
  ariaLabel: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <DatePicker
      className="w-full"
      name={name}
      value={value}
      min={min}
      max={max}
      onChange={setValue}
      ariaLabel={ariaLabel}
      required
    />
  );
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function utcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
