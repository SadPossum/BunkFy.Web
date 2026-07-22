import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCw, UserCheck, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  WorkspaceStaffOnboarding,
  WorkspaceStaffOnboardingListResponse,
} from "../../api/types";
import { useSession } from "../../app/session";
import { PaginationBar } from "../../components/ui/PaginationBar";

const PAGE_SIZE = 25;

export function WorkspaceJoinRequestSettings({
  workspaceId,
  onMembershipChanged,
}: {
  workspaceId: string;
  onMembershipChanged: () => Promise<void>;
}) {
  const { request } = useSession();
  const [page, setPage] = useState(1);
  const joinRequests = useQuery({
    queryKey: ["workspace-staff-onboarding", workspaceId, "actionable", page],
    queryFn: () => request<WorkspaceStaffOnboardingListResponse>(
      `/api/workspace-staff-enrollment/applications?page=${page}&pageSize=${PAGE_SIZE}`,
    ),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const resolution = useMutation({
    mutationFn: ({ application, action }: {
      application: WorkspaceStaffOnboarding;
      action: "approve" | "reject" | "retry";
    }) => {
      if (action === "retry") {
        return request(`/api/workspace-staff-enrollment/applications/${application.applicationId}/retry`, { method: "POST" });
      }
      if (!application.claimId || !application.claimVersion) {
        throw new Error("This join request is still being prepared.");
      }
      return request(`/api/organizations/${workspaceId}/join-requests/${application.claimId}/${action}`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: application.claimVersion }),
      });
    },
    onSuccess: async () => {
      await Promise.all([joinRequests.refetch(), onMembershipChanged()]);
    },
  });

  useEffect(() => {
    if (!joinRequests.isFetching && page > 1 && joinRequests.data?.items.length === 0) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [joinRequests.data?.items.length, joinRequests.isFetching, page]);

  return (
    <section className="border-t border-base-300 pt-8">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <UserCheck size={20} />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">Join requests</h2>
          <p className="mt-1 text-sm leading-6 text-base-content/55">
            Review applicants before provisioning Staff and operational access.
          </p>
        </div>
      </div>
      {joinRequests.isLoading && <div className="loading loading-spinner loading-md mt-6 text-primary" />}
      {joinRequests.error && <SettingsError error={joinRequests.error} />}
      {!joinRequests.isLoading && !joinRequests.error && (
        <>
          <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
            {!joinRequests.data?.items.length && (
              <p className="py-8 text-center text-sm text-base-content/50">No join requests need attention.</p>
            )}
            {(joinRequests.data?.items ?? []).map((application) => (
              <article
                key={application.applicationId}
                className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {application.displayName ?? application.verifiedAccountEmail ?? "Staff applicant"}
                  </p>
                  <p className="mt-1 truncate text-xs text-base-content/50">
                    {application.workEmail ?? application.verifiedAccountEmail}
                    {application.jobTitle ? ` / ${application.jobTitle}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-base-content/45">
                    {application.status === 6 ? "Provisioning needs attention" : "Requested"}{" "}
                    {new Date(application.createdAtUtc).toLocaleString()}
                  </p>
                  {application.failureCode && (
                    <p className="mt-1 text-xs font-medium text-warning">{application.failureCode}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {application.status === 6 ? (
                    <button
                      className="btn btn-primary btn-sm text-white"
                      onClick={() => resolution.mutate({ application, action: "retry" })}
                      disabled={resolution.isPending}
                    >
                      <RotateCw size={15} />Retry setup
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-ghost btn-sm text-error"
                        onClick={() => resolution.mutate({ application, action: "reject" })}
                        disabled={resolution.isPending || !application.claimId}
                      >
                        <UserX size={15} />Reject
                      </button>
                      <button
                        className="btn btn-primary btn-sm text-white"
                        onClick={() => resolution.mutate({ application, action: "approve" })}
                        disabled={resolution.isPending || !application.claimId}
                      >
                        <UserCheck size={15} />Approve
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            itemCount={joinRequests.data?.items.length ?? 0}
            itemLabel="request"
            disabled={joinRequests.isFetching || resolution.isPending}
            onPageChange={setPage}
          />
          {resolution.error && <SettingsError error={resolution.error} />}
        </>
      )}
    </section>
  );
}

function SettingsError({ error }: { error: unknown }) {
  return <div className="alert alert-error mt-5 text-sm">{error instanceof Error ? error.message : "Request failed."}</div>;
}
