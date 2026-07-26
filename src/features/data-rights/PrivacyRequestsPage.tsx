import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileLock2, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  DataRightsCase,
  DataRightsCaseListResponse,
  DataRightsRequesterRelationship,
} from "../../api/types";
import {
  permissions,
  propertyAccessScope,
  tenantAccessScope,
  usePermissions,
} from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  EmptyState,
  ErrorState,
  FormActions,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";
import {
  dataRightsCaseNeedsLiveRefresh,
  dataRightsCaseStatusKey,
  dataRightsCaseStatusLabel,
  shortDataRightsCaseId,
  type DataRightsCapabilities,
} from "./dataRightsWorkflow";
import { PrivacyRequestDetail } from "./PrivacyRequestDetail";

const PAGE_SIZE = 20;
const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "1", label: "Draft" },
  { value: "2", label: "Discovery" },
  { value: "3", label: "Review required" },
  { value: "4", label: "Decision pending" },
  { value: "5", label: "Approved" },
  { value: "7", label: "Executing" },
  { value: "8", label: "Blocked" },
  { value: "9", label: "Completed" },
  { value: "6", label: "Denied" },
  { value: "11", label: "Canceled" },
] as const;

export function PrivacyRequestsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const propertyScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const tenantScope = session ? tenantAccessScope(session.tenantId) : "";
  const access = usePermissions(propertyScope && tenantScope ? [
    { permission: permissions.dataRightsRead, scope: propertyScope },
    { permission: permissions.dataRightsCreate, scope: propertyScope },
    { permission: permissions.dataRightsDiscover, scope: propertyScope },
    { permission: permissions.dataRightsReview, scope: propertyScope },
    { permission: permissions.dataRightsDecide, scope: propertyScope },
    { permission: permissions.dataRightsManage, scope: propertyScope },
    { permission: permissions.dataRightsErase, scope: tenantScope },
  ] : []);
  const capabilities: DataRightsCapabilities = {
    read: access.allows(permissions.dataRightsRead, propertyScope),
    create: access.allows(permissions.dataRightsCreate, propertyScope),
    discover: access.allows(permissions.dataRightsDiscover, propertyScope),
    review: access.allows(permissions.dataRightsReview, propertyScope),
    decide: access.allows(permissions.dataRightsDecide, propertyScope),
    manage: access.allows(permissions.dataRightsManage, propertyScope),
    erase: access.allows(permissions.dataRightsErase, tenantScope),
  };
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (status !== "all") params.set("status", status);
  const cases = useQuery({
    queryKey: ["data-rights-cases", selectedPropertyId, status, page],
    queryFn: () => request<DataRightsCaseListResponse>(
      `/api/data-rights/properties/${selectedPropertyId}/cases?${params}`,
    ),
    enabled: Boolean(selectedPropertyId && capabilities.read),
    refetchInterval: (query) => query.state.data?.items.some((item) =>
      dataRightsCaseNeedsLiveRefresh(item.status))
      ? 5_000
      : false,
    refetchIntervalInBackground: false,
  });
  const items = useMemo(() => cases.data?.items ?? [], [cases.data]);

  useEffect(() => {
    setPage(1);
    setSelectedCaseId(null);
    setCreateOpen(false);
  }, [selectedPropertyId]);

  useEffect(() => {
    if (items.length === 0 && page > 1 && !cases.isFetching) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [cases.isFetching, items.length, page]);

  if (!selectedProperty) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Choose a property first"
        description="Privacy requests are handled within the property that owns the selected records."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={selectedProperty.name}
        title="Privacy requests"
        description="Review and separately approve removal of personal data from property records."
        action={capabilities.create
          ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={17} />
              New request
            </button>
          )
          : undefined}
      />

      <section className="card overflow-hidden border border-base-300 bg-base-100 shadow-sm">
        <div className="flex flex-col items-stretch gap-4 border-b border-base-300 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="font-display text-lg font-semibold">Request queue</h2>
            <p className="mt-1 text-xs text-base-content/50">
              Sensitive record matching happens only inside an open request.
            </p>
          </div>
          <SelectPicker
            className="w-full sm:w-48"
            size="sm"
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            ariaLabel="Privacy request status"
            options={[...statusOptions]}
          />
        </div>

        {!capabilities.read && !access.isLoading
          ? (
            <div className="p-6">
              <EmptyState
                icon={<FileLock2 />}
                title="Privacy requests are restricted"
                description="Ask a workspace administrator for permission to read privacy cases for this property."
              />
            </div>
          )
          : cases.isLoading || access.isLoading
            ? <LoadingState label="Loading privacy requests" />
            : cases.error
              ? <div className="p-6"><ErrorState error={cases.error} retry={() => void cases.refetch()} /></div>
              : items.length === 0
                ? (
                  <div className="p-6">
                    <EmptyState
                      icon={<ShieldCheck />}
                      title={status === "all" ? "No privacy requests yet" : "No requests have this status"}
                      description={status === "all"
                        ? "Create a request when a guest asks for personal data to be removed."
                        : "Choose another status to review the rest of the queue."}
                      action={capabilities.create && status === "all"
                        ? (
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
                            Create request
                          </button>
                        )
                        : undefined}
                    />
                  </div>
                )
                : (
                  <>
                    <div className="divide-y divide-base-300">
                      {items.map((item) => (
                        <PrivacyRequestRow
                          key={item.id}
                          item={item}
                          onOpen={() => setSelectedCaseId(item.id)}
                        />
                      ))}
                    </div>
                    <PaginationBar
                      page={page}
                      pageSize={PAGE_SIZE}
                      itemCount={items.length}
                      itemLabel="request"
                      hasMore={items.length === PAGE_SIZE}
                      disabled={cases.isFetching}
                      onPageChange={setPage}
                    />
                  </>
                )}
      </section>

      <CreatePrivacyRequestModal
        open={createOpen}
        propertyId={selectedPropertyId}
        onClose={() => setCreateOpen(false)}
        onCreated={async (created) => {
          queryClient.setQueryData(["data-rights-case", selectedPropertyId, created.id], created);
          await queryClient.invalidateQueries({ queryKey: ["data-rights-cases", selectedPropertyId] });
          setCreateOpen(false);
          setSelectedCaseId(created.id);
        }}
      />

      <PrivacyRequestDetail
        propertyId={selectedPropertyId}
        caseId={selectedCaseId}
        capabilities={capabilities}
        onClose={() => setSelectedCaseId(null)}
      />
    </>
  );
}

function PrivacyRequestRow({ item, onOpen }: { item: DataRightsCase; onOpen: () => void }) {
  const status = dataRightsCaseStatusKey(item.status);
  return (
    <button
      type="button"
      className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-base-200/65 focus-visible:bg-base-200/65 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-6"
      onClick={onOpen}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileLock2 size={18} />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">Selected data removal</span>
          <span className="mt-1 block text-xs text-base-content/45">
            Request {shortDataRightsCaseId(item.id)} - opened {formatDateTime(item.createdAtUtc)}
          </span>
        </span>
      </div>
      <span className="text-xs text-base-content/50 sm:text-right">
        <span className="block font-semibold text-base-content/70">{stageDescription(status)}</span>
        <span className="mt-1 block">
          {item.selectedSubjectCount} {item.selectedSubjectCount === 1 ? "record" : "records"} selected
        </span>
      </span>
      <span className="flex items-center justify-between gap-3 sm:justify-end">
        <StatusBadge status={dataRightsCaseStatusLabel(item.status)} />
        <ChevronRight size={17} className="text-base-content/35" />
      </span>
    </button>
  );
}

function CreatePrivacyRequestModal({
  open,
  propertyId,
  onClose,
  onCreated,
}: {
  open: boolean;
  propertyId: string;
  onClose: () => void;
  onCreated: (created: DataRightsCase) => Promise<void>;
}) {
  const { request } = useSession();
  const [relationship, setRelationship] = useState("1");
  const mutation = useMutation({
    mutationFn: () => request<DataRightsCase>(
      `/api/data-rights/properties/${propertyId}/cases`,
      {
        method: "POST",
        body: JSON.stringify({
          requestedOperations: 16,
          restrictionDirective: 0,
          requesterRelationship: Number(relationship) as DataRightsRequesterRelationship,
        }),
      },
    ),
    onSuccess: onCreated,
  });

  useEffect(() => {
    if (open) setRelationship("1");
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <Modal
      open={open}
      title="New privacy request"
      description="Start a controlled workflow. Record selection, approval, and removal remain separate actions."
      onClose={onClose}
    >
      <form className="space-y-5" onSubmit={submit}>
        <label className="form-control block">
          <span className="label-text mb-1.5 block text-sm font-semibold">Who requested the change?</span>
          <SelectPicker
            className="w-full"
            value={relationship}
            onValueChange={setRelationship}
            ariaLabel="Privacy request source"
            options={[
              {
                value: "1",
                label: "The guest",
                description: "Identity verification and controller routing are required.",
              },
              {
                value: "2",
                label: "An authorized representative",
                description: "Authority, identity and controller routing are required.",
              },
              {
                value: "3",
                label: "Workspace initiated",
                description: "Use for an internally initiated removal review.",
              },
            ]}
          />
        </label>
        <div className="rounded-lg border border-warning/25 bg-warning/8 p-4">
          <p className="text-sm font-semibold">This workflow can permanently remove personal data.</p>
          <p className="mt-1 text-xs leading-5 text-base-content/55">
            BunkFy will verify policy eligibility before approval and will require another authorized
            staff member to execute an approved request.
          </p>
        </div>
        {mutation.error && <ErrorState error={mutation.error} />}
        <FormActions
          submitting={mutation.isPending}
          submitLabel="Create request"
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

function stageDescription(status: string): string {
  if (status === "draft") return "Intake";
  if (status === "discovery") return "Match records";
  if (status === "reviewRequired" || status === "decisionPending") return "Review";
  if (status === "approved") return "Ready for another operator";
  if (status === "executing") return "Removal in progress";
  if (status === "completed") return "Removal completed";
  if (status === "blocked") return "Needs attention";
  return "Closed";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
