import { useQuery } from "@tanstack/react-query";
import { staffStatusLabel } from "../../api/labels";
import type { Property, StaffDirectoryMember } from "../../api/types";
import { createCompositeSource, compositeSourceUsable, type CompositeSource } from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import { sessionIdentityKey } from "../../app/singleFlightRefresh";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { Modal, StatusBadge } from "../../components/ui/primitives";
import { useStaffReadDenial } from "./useStaffReadDenial";
import { formatStaffDate } from "./staffPresentation";

// The property endpoint returns directory data only. Workspace profiles, account
// links and assignment history have separate authority and are never read here.
export function PropertyStaffDetail({ tenantId, property, memberId, permissionSource, onClose }: {
  tenantId: string;
  property: Property;
  memberId: string | null;
  permissionSource: CompositeSource;
  onClose: () => void;
}) {
  const { request, session } = useSession();
  const queryKey = ["staff-member", memberId, tenantId, "property-directory", property.propertyId, sessionIdentityKey(session)];
  const detail = useQuery({
    queryKey,
    queryFn: () => request<StaffDirectoryMember>(`/api/staff/properties/${property.propertyId}/members/${memberId}`),
    enabled: Boolean(memberId && session?.tenantId === tenantId),
  });
  const denied = useStaffReadDenial(detail, queryKey, [401, 403, 404]);
  const matches = detail.data?.staffMemberId === memberId
    && detail.data.assignments.some(item => item.propertyId === property.propertyId);
  const source = createCompositeSource({
    label: "Property Staff detail",
    hasData: Boolean(matches && !denied),
    isLoading: detail.isLoading,
    error: detail.error || (detail.data && !matches ? new Error("This staff record could not be confirmed for the selected property.") : null),
    isFetching: detail.isFetching,
    refetch: () => detail.refetch(),
  });
  const member = !denied && matches && compositeSourceUsable(source.state) ? detail.data : null;
  const assignment = member?.assignments.find(item => item.propertyId === property.propertyId);

  return (
    <Modal open={Boolean(memberId)} title={member?.displayName || "Property Staff profile"}
      description={`Staff directory details for ${property.name}.`} onClose={onClose}>
      <CompositeSourceNotice sources={[permissionSource, source]} title="Staff details are delayed" />
      {member && assignment ? (
        <div className="mt-5 space-y-5">
          <StatusBadge status={staffStatusLabel(member.status)} />
          <dl className="grid gap-5 sm:grid-cols-2">
            {[
              ["Job title", member.jobTitle || "Not recorded"],
              ["Department", member.department || "Not recorded"],
              ["Property", property.name],
              ["Property job title", assignment.propertyJobTitle || "Not recorded"],
              ["Assigned from", formatStaffDate(assignment.effectiveFrom)],
              ["Primary location", assignment.isPrimary ? "Yes" : "No"],
            ].map(([label, value]) => <div key={label}>
              <dt className="text-xs font-semibold text-base-content/50">{label}</dt>
              <dd className="mt-1 break-words text-sm">{value}</dd>
            </div>)}
          </dl>
        </div>
      ) : <CompositeSourceFallback state={source.state} label="property Staff profile" />}
    </Modal>
  );
}
