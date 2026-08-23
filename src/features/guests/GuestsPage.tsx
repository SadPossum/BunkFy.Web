import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  ChevronRight,
  Edit3,
  Globe2,
  History,
  Languages,
  Mail,
  Phone,
  Plus,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { GuestListItem, GuestListResponse, GuestMutationReceipt, GuestProfile, GuestStayHistoryItem, GuestStayHistoryListResponse } from "../../api/types";
import { guestStatusLabel, guestStatusValue, guestStayRoleLabel, guestStayStatusLabel } from "../../api/labels";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { DatePicker } from "../../components/ui/DatePicker";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import {
  EmptyState,
  ErrorState,
  FormActions,
  InitialAvatar,
  LoadingState,
  Modal,
  ModalActions,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";
import {
  resolveGuestCreateAttempt,
  type GuestCreateAttempt,
  type GuestCreatePayload,
} from "./guestCreateAttempt";
import {
  resolveGuestArchiveAttempt,
  resolveGuestUpdateAttempt,
  type GuestManagementAttempt,
} from "./guestManagementAttempt";
import {
  guestMutationAllowed,
  guestRecordMatches,
} from "./guestsMutationAuthority";

const PAGE_SIZE = 30;
const STAY_PAGE_SIZE = 8;
const statusFilters = ["active", "all", "archived"] as const;
type StatusFilter = (typeof statusFilters)[number];
type GuestFormState = GuestProfile | null | undefined;

type GuestWriteValues = GuestCreatePayload;

type GuestFormSubmission = {
  propertyId: string;
  guest: GuestProfile | null;
  values: GuestWriteValues;
};

type GuestArchiveSubmission = {
  propertyId: string;
  guest: GuestProfile;
};

export function GuestsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const selectedPropertyIdRef = useRef(selectedPropertyId);
  selectedPropertyIdRef.current = selectedPropertyId;
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [stayPage, setStayPage] = useState(1);
  const [formState, setFormState] = useState<GuestFormState>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<GuestProfile | null>(null);
  const createAttempt = useRef<GuestCreateAttempt | null>(null);
  const updateAttempt = useRef<GuestManagementAttempt | null>(null);
  const archiveAttempt = useRef<GuestManagementAttempt | null>(null);

  const accessScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.guestsRead, scope: accessScope },
    { permission: permissions.guestsCreate, scope: accessScope },
    { permission: permissions.guestsManage, scope: accessScope },
    { permission: permissions.guestsArchive, scope: accessScope },
  ] : []);
  const mayRead = access.allows(permissions.guestsRead, accessScope);
  const mayCreate = access.allows(permissions.guestsCreate, accessScope);
  const mayManage = access.allows(permissions.guestsManage, accessScope);
  const mayArchive = access.allows(permissions.guestsArchive, accessScope);
  const mayReadRef = useRef(mayRead);
  mayReadRef.current = mayRead;
  const permissionSource = createCompositeSource({
    label: "Guest permissions",
    hasData: access.hasData,
    isLoading: access.isLoading,
    error: access.error,
    isFetching: access.isFetching,
    refetch: access.refetch,
  });
  const permissionsCurrent = compositeSourceCurrent(permissionSource);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (status !== "all") params.set("status", String(guestStatusValue(status)));
    return params.toString();
  }, [debouncedSearch, page, status]);

  const guests = useQuery({
    queryKey: ["guest-list", selectedPropertyId, status, debouncedSearch, page],
    queryFn: () => request<GuestListResponse>(`/api/guests/properties/${selectedPropertyId}?${queryString}`),
    enabled: Boolean(selectedPropertyId && mayRead),
  });

  const detail = useQuery({
    queryKey: ["guest-detail", selectedPropertyId, selectedGuestId],
    queryFn: () => request<GuestProfile>(`/api/guests/properties/${selectedPropertyId}/${selectedGuestId}`),
    enabled: Boolean(selectedPropertyId && selectedGuestId && mayRead),
  });
  const stays = useQuery({
    queryKey: ["guest-stays", selectedPropertyId, selectedGuestId, stayPage],
    queryFn: () => request<GuestStayHistoryListResponse>(`/api/guests/properties/${selectedPropertyId}/${selectedGuestId}/stays?page=${stayPage}&pageSize=${STAY_PAGE_SIZE}`),
    enabled: Boolean(selectedPropertyId && selectedGuestId && mayRead),
  });

  const directorySource = createCompositeSource({
    label: "Guest directory",
    hasData: guests.data !== undefined,
    isLoading: guests.isLoading,
    error: guests.error,
    isFetching: guests.isFetching,
    refetch: () => guests.refetch(),
  });
  const detailSource = createCompositeSource({
    label: "Guest profile",
    hasData: detail.data !== undefined,
    isLoading: detail.isLoading,
    error: detail.error,
    isFetching: detail.isFetching,
    refetch: () => detail.refetch(),
  });
  const staysSource = createCompositeSource({
    label: "Stay history",
    hasData: stays.data !== undefined,
    isLoading: stays.isLoading,
    error: stays.error,
    isFetching: stays.isFetching,
    refetch: () => stays.refetch(),
  });
  const directoryCurrent = compositeSourceCurrent(directorySource);
  const directoryUsable = compositeSourceUsable(directorySource.state);
  const detailCurrent = compositeSourceCurrent(detailSource);
  const detailUsable = compositeSourceUsable(detailSource.state);
  const staysCurrent = compositeSourceCurrent(staysSource);
  const permissionUsable = compositeSourceUsable(permissionSource.state);
  const createAuthorityCurrent = mayRead && mayCreate && guestMutationAllowed("create", {
    permissionsCurrent,
  });
  const updateAuthorityCurrent = Boolean(
    formState && mayRead && mayManage && guestMutationAllowed("update", {
      permissionsCurrent,
      guestCurrent: detailCurrent && guestRecordMatches(detail.data, formState),
    }),
  );
  const archiveAuthorityCurrent = Boolean(
    archiveTarget && mayRead && mayArchive && guestMutationAllowed("archive", {
      permissionsCurrent,
      guestCurrent: detailCurrent && guestRecordMatches(detail.data, archiveTarget),
    }),
  );
  const detailManageAuthorityCurrent = mayRead && mayManage && permissionsCurrent && detailCurrent;
  const detailArchiveAuthorityCurrent = mayRead && mayArchive && permissionsCurrent && detailCurrent;
  const formAuthorityCurrent = formState === null
    ? createAuthorityCurrent
    : formState
      ? updateAuthorityCurrent
      : false;
  const formAuthorityMessage = formState === null
    ? "Current create permission could not be confirmed. Retry the access source before submitting."
    : "Current Guest Record and access evidence is refreshing or no longer matches this form. If it remains disabled, close and reopen the latest profile."
  const archiveAuthorityMessage = "Current Guest Record and access evidence is refreshing or no longer matches this confirmation. If it remains disabled, close it and review the latest profile.";

  const guestMutation = useMutation<GuestMutationReceipt, Error, GuestFormSubmission>({
    mutationFn: ({ propertyId, guest, values }) => {
      const authorityCurrent = propertyId === selectedPropertyId && (
        guest
          ? mayRead && mayManage && guestMutationAllowed("update", {
              permissionsCurrent,
              guestCurrent: detailCurrent && guestRecordMatches(detail.data, guest),
            })
          : mayRead && mayCreate && guestMutationAllowed("create", { permissionsCurrent })
      );
      if (!authorityCurrent) {
        throw new Error("Current Guest Record access and profile evidence could not be confirmed. Refresh and try again.");
      }

      const body = guest
        ? (() => {
            updateAttempt.current = resolveGuestUpdateAttempt(
              updateAttempt.current,
              propertyId,
              guest.guestId,
              guest.version,
              values,
            );
            return {
              ...values,
              operationId: updateAttempt.current.operationId,
              expectedVersion: guest.version,
            };
          })()
        : (() => {
            createAttempt.current = resolveGuestCreateAttempt(
              createAttempt.current,
              propertyId,
              values,
            );
            return { ...values, operationId: createAttempt.current.operationId };
          })();
      return request<GuestMutationReceipt>(
        guest
          ? `/api/guests/properties/${propertyId}/${guest.guestId}`
          : `/api/guests/properties/${propertyId}`,
        { method: guest ? "PUT" : "POST", body: JSON.stringify(body) },
      );
    },
    onSuccess: async (saved, submission) => {
      createAttempt.current = null;
      updateAttempt.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guest-list", submission.propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-detail", submission.propertyId, saved.guestId] }),
      ]);
      if (selectedPropertyIdRef.current !== submission.propertyId || !mayReadRef.current) return;
      setFormState(undefined);
      selectGuest(saved.guestId);
    },
    onError: async (_error, submission) => {
      if (!submission.guest) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guest-list", submission.propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-detail", submission.propertyId, submission.guest.guestId] }),
      ]);
    },
  });

  const archiveMutation = useMutation<GuestMutationReceipt, Error, GuestArchiveSubmission>({
    mutationFn: ({ propertyId, guest }) => {
      const authorityCurrent = propertyId === selectedPropertyId && mayRead && mayArchive &&
        guestMutationAllowed("archive", {
          permissionsCurrent,
          guestCurrent: detailCurrent && guestRecordMatches(detail.data, guest),
        });
      if (!authorityCurrent) {
        throw new Error("Current Guest Record access and profile evidence could not be confirmed. Refresh and try again.");
      }

      archiveAttempt.current = resolveGuestArchiveAttempt(
        archiveAttempt.current,
        propertyId,
        guest.guestId,
        guest.version,
      );
      return request<GuestMutationReceipt>(
        `/api/guests/properties/${propertyId}/${guest.guestId}/archive`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: archiveAttempt.current.operationId,
            expectedVersion: guest.version,
            confirmed: true,
          }),
        },
      );
    },
    onSuccess: async (archived, submission) => {
      archiveAttempt.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guest-list", submission.propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-detail", submission.propertyId, archived.guestId] }),
      ]);
      if (selectedPropertyIdRef.current !== submission.propertyId) return;
      setArchiveTarget(null);
      selectGuest(null);
    },
    onError: async (_error, submission) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guest-list", submission.propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-detail", submission.propertyId, submission.guest.guestId] }),
      ]);
    },
  });

  useEffect(() => {
    createAttempt.current = null;
    updateAttempt.current = null;
    archiveAttempt.current = null;
    setPage(1);
    setStayPage(1);
    setSelectedGuestId(null);
    setFormState(undefined);
    setArchiveTarget(null);
  }, [selectedPropertyId]);

  useEffect(() => {
    if (!permissionsCurrent) return;

    if (!mayRead) {
      createAttempt.current = null;
      updateAttempt.current = null;
      archiveAttempt.current = null;
      setSelectedGuestId(null);
      setFormState(undefined);
      setArchiveTarget(null);
      return;
    }

    if ((formState === null && !mayCreate) || (formState && !mayManage)) {
      createAttempt.current = null;
      updateAttempt.current = null;
      setFormState(undefined);
    }
    if (archiveTarget && !mayArchive) {
      archiveAttempt.current = null;
      setArchiveTarget(null);
    }
  }, [archiveTarget, formState, mayArchive, mayCreate, mayManage, mayRead, permissionsCurrent]);

  useEffect(() => {
    if (directoryCurrent && guests.data && page > 1 && guests.data.guests.length === 0) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [directoryCurrent, guests.data, page]);

  useEffect(() => {
    if (staysCurrent && stays.data && stayPage > 1 && stays.data.stays.length === 0) {
      setStayPage((current) => Math.max(1, current - 1));
    }
  }, [stayPage, stays.data, staysCurrent]);

  const guestItems = directoryUsable ? guests.data?.guests ?? [] : [];
  const selectedSummary = guestItems.find((guest) => guest.guestId === selectedGuestId);
  const guestDataVisible = permissionUsable && mayRead;
  const detailOpen = Boolean(guestDataVisible && selectedGuestId && formState === undefined && !archiveTarget);

  function selectGuest(guestId: string | null) {
    setStayPage(1);
    setSelectedGuestId(guestId);
  }

  function openCreate() {
    if (!createAuthorityCurrent) return;
    guestMutation.reset();
    createAttempt.current = null;
    updateAttempt.current = null;
    selectGuest(null);
    setFormState(null);
  }

  function openEdit(guest: GuestProfile) {
    if (!detailManageAuthorityCurrent || !guestRecordMatches(detail.data, guest)) return;
    guestMutation.reset();
    createAttempt.current = null;
    updateAttempt.current = null;
    setSelectedGuestId(guest.guestId);
    setFormState(guest);
  }

  function openArchive(guest: GuestProfile) {
    if (!detailArchiveAuthorityCurrent || !guestRecordMatches(detail.data, guest)) return;
    archiveMutation.reset();
    archiveAttempt.current = null;
    setSelectedGuestId(guest.guestId);
    setArchiveTarget(guest);
  }

  if (!selectedProperty) {
    return <EmptyState icon={<UsersRound />} title="Choose a property first" description="Guest records are visible through the property where staff work with them." />;
  }

  return (
    <>
      <PageHeader
        eyebrow={selectedProperty.name}
        title="Guests"
        description="Keep guest details and stay history together, without turning guest records into login accounts."
        action={mayRead && mayCreate ? <button type="button" className="btn btn-primary" disabled={!createAuthorityCurrent} onClick={openCreate}><Plus size={17} />New guest</button> : undefined}
      />

      {!permissionUsable || !mayRead ? permissionsCurrent && !mayRead ? (
        <EmptyState icon={<UsersRound />} title="Guest access is not enabled" description="Ask an administrator for guest record access at this property." />
      ) : (
        <>
          <CompositeSourceNotice sources={[permissionSource]} title="Guest access is delayed" />
          <section className="card overflow-hidden border border-base-300 bg-base-100 shadow-sm">
            <CompositeSourceFallback state={permissionSource.state} label="guest access" />
          </section>
        </>
      ) : (
        <>
          <CompositeSourceNotice
            sources={[permissionSource, directorySource]}
            title="Guest data is delayed"
          />
          <section className="card overflow-hidden border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-base-300 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <SegmentedTabs
              value={status}
              ariaLabel="Guest status"
              onValueChange={(nextStatus) => { setStatus(nextStatus); setPage(1); }}
              options={statusFilters.map((option) => ({
                value: option,
                label: option === "all" ? "All guests" : option === "active" ? "Active" : "Archived",
              }))}
            />
            <label className="input input-bordered input-sm flex w-full items-center gap-2 sm:w-72">
              <Search size={15} className="text-base-content/35" />
              <input
                className="grow"
                aria-label="Search guests"
                placeholder="Name, email or phone"
                value={search}
                maxLength={256}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              />
              {guests.isFetching && <span className="loading loading-spinner loading-xs text-primary" aria-label="Updating guest results" />}
            </label>
          </div>

          {directorySource.state === "loading" ? <LoadingState label="Loading guests" /> : !directoryUsable ? (
            <CompositeSourceFallback state={directorySource.state} label="guest directory" />
          ) : !guestItems.length ? (
            <div className="p-6">
              <EmptyState
                icon={<UserRound />}
                title={search || status !== "active" ? "No guests match" : "No guest records yet"}
                description={search || status !== "active" ? "Try another search or status filter." : "Create a guest profile to keep contact details and stay history in one place."}
                action={mayCreate && !search && status === "active" ? <button type="button" className="btn btn-sm btn-primary" disabled={!createAuthorityCurrent} onClick={openCreate}>Create first guest</button> : undefined}
              />
            </div>
          ) : (
            <GuestList guests={guestItems} onSelect={selectGuest} />
          )}

          {directoryUsable && <PaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              itemCount={guestItems.length}
              itemLabel="guest"
              hasMore={guests.data?.hasMore}
              disabled={!directoryCurrent}
              onPageChange={setPage}
            />}
          </section>
        </>
      )}

      <Modal
        open={detailOpen}
        title={detail.data?.displayName ?? selectedSummary?.displayName ?? "Guest profile"}
        description="Profile details and recorded stay history"
        onClose={() => selectGuest(null)}
      >
        {detailSource.state === "loading" ? <LoadingState label="Loading guest profile" /> : !detailUsable ? (
          <div>
            <CompositeSourceNotice sources={[permissionSource, detailSource]} title="Guest profile is delayed" />
            <CompositeSourceFallback state={detailSource.state} label="guest profile" />
          </div>
        ) : detail.data ? (
          <div>
            <CompositeSourceNotice sources={[permissionSource, detailSource]} title="Guest profile is delayed" />
            <GuestDetail
              guest={detail.data}
              stays={stays.data?.stays ?? []}
              staysSource={staysSource}
              stayPage={stayPage}
              stayPageSize={STAY_PAGE_SIZE}
              staysHasMore={stays.data?.hasMore ?? false}
              onStayPageChange={setStayPage}
              canManage={mayManage}
              canArchive={mayArchive}
              manageEnabled={detailManageAuthorityCurrent}
              archiveEnabled={detailArchiveAuthorityCurrent}
              onEdit={() => openEdit(detail.data)}
              onArchive={() => openArchive(detail.data)}
            />
          </div>
        ) : null}
      </Modal>

      <GuestForm
        state={guestDataVisible ? formState : undefined}
        submitting={guestMutation.isPending}
        error={guestMutation.error}
        sources={formState ? [permissionSource, detailSource] : [permissionSource]}
        authorityCurrent={formAuthorityCurrent}
        authorityMessage={formAuthorityMessage}
        onSubmit={(values) => {
          if (!formAuthorityCurrent) return;
          guestMutation.mutate({ propertyId: selectedPropertyId, guest: formState ?? null, values });
        }}
        onClose={() => { guestMutation.reset(); createAttempt.current = null; updateAttempt.current = null; setFormState(undefined); }}
      />

      <ArchiveGuestModal
        guest={guestDataVisible ? archiveTarget : null}
        submitting={archiveMutation.isPending}
        error={archiveMutation.error}
        sources={[permissionSource, detailSource]}
        authorityCurrent={archiveAuthorityCurrent}
        authorityMessage={archiveAuthorityMessage}
        onConfirm={() => {
          if (!archiveTarget || !archiveAuthorityCurrent) return;
          archiveMutation.mutate({ propertyId: selectedPropertyId, guest: archiveTarget });
        }}
        onClose={() => { archiveMutation.reset(); archiveAttempt.current = null; setArchiveTarget(null); }}
      />
    </>
  );
}

function GuestList({ guests, onSelect }: { guests: GuestListItem[]; onSelect: (guestId: string) => void }) {
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="table">
          <thead><tr className="border-base-300 text-[0.68rem] uppercase tracking-[0.12em] text-base-content/40"><th className="pl-6">Guest</th><th>Contact</th><th>Profile</th><th>Status</th><th>Last updated</th><th className="pr-6" /></tr></thead>
          <tbody>
            {guests.map((guest) => (
              <tr key={guest.guestId} className="border-base-300 transition hover:bg-base-200/70">
                <td className="pl-6">
                  <button type="button" className="flex items-center gap-3 text-left" onClick={() => onSelect(guest.guestId)}>
                    <InitialAvatar name={guest.displayName} size="sm" />
                    <span><span className="block font-semibold">{guest.displayName}</span>{guest.legalName && guest.legalName !== guest.displayName && <span className="mt-1 block text-xs text-base-content/40">{guest.legalName}</span>}</span>
                  </button>
                </td>
                <td><ContactSummary guest={guest} /></td>
                <td className="text-sm text-base-content/55">{[guest.nationalityCountryCode?.toUpperCase(), guest.preferredLanguageTag].filter(Boolean).join(" · ") || "Basic profile"}</td>
                <td><StatusBadge status={guestStatusLabel(guest.status)} /></td>
                <td><p className="text-sm font-medium">{formatDateTime(guest.lastChangedAtUtc)}</p><p className="mt-1 text-xs text-base-content/40">by {formatActor(guest.lastChangedBy)}</p></td>
                <td className="pr-6 text-right"><button type="button" className="btn btn-circle btn-ghost btn-xs" aria-label={`View ${guest.displayName}`} onClick={() => onSelect(guest.guestId)}><ChevronRight size={17} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-base-300 lg:hidden">
        {guests.map((guest) => (
          <button key={guest.guestId} type="button" className="block w-full p-5 text-left transition hover:bg-base-200/70 focus-visible:bg-base-200/70" onClick={() => onSelect(guest.guestId)}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3"><InitialAvatar name={guest.displayName} /><div className="min-w-0"><p className="truncate font-semibold">{guest.displayName}</p><p className="mt-1 truncate text-xs text-base-content/45">{guest.email || guest.phone || "No contact details"}</p></div></div>
              <StatusBadge status={guestStatusLabel(guest.status)} />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-base-content/45"><span>Updated {formatDateTime(guest.lastChangedAtUtc)}</span><span className="inline-flex items-center gap-1 font-semibold text-primary">View profile<ChevronRight size={14} /></span></div>
          </button>
        ))}
      </div>
    </>
  );
}

function ContactSummary({ guest }: { guest: GuestListItem }) {
  if (!guest.email && !guest.phone) return <span className="text-sm text-base-content/35">No contact details</span>;
  return <div className="space-y-1 text-sm">{guest.email && <p className="flex items-center gap-2"><Mail size={14} className="text-base-content/35" /><span className="max-w-56 truncate">{guest.email}</span></p>}{guest.phone && <p className="flex items-center gap-2"><Phone size={14} className="text-base-content/35" />{guest.phone}</p>}</div>;
}

function GuestDetail({
  guest,
  stays,
  staysSource,
  stayPage,
  stayPageSize,
  staysHasMore,
  onStayPageChange,
  canManage,
  canArchive,
  manageEnabled,
  archiveEnabled,
  onEdit,
  onArchive,
}: {
  guest: GuestProfile;
  stays: GuestStayHistoryItem[];
  staysSource: CompositeSource;
  stayPage: number;
  stayPageSize: number;
  staysHasMore: boolean;
  onStayPageChange: (page: number) => void;
  canManage: boolean;
  canArchive: boolean;
  manageEnabled: boolean;
  archiveEnabled: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const active = guestStatusLabel(guest.status) === "active";
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-base-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><InitialAvatar name={guest.displayName} variant="solid" /><div><div className="flex flex-wrap items-center gap-2"><p className="font-display text-lg font-semibold">{guest.displayName}</p><StatusBadge status={guestStatusLabel(guest.status)} /></div><p className="mt-1 text-xs text-base-content/45">Guest since {formatDateTime(guest.createdAtUtc)}</p></div></div>
        {active && (canManage || canArchive) && <div className="flex gap-2">{canManage && <button type="button" className="btn btn-sm btn-outline" disabled={!manageEnabled} onClick={onEdit}><Edit3 size={15} />Edit</button>}{canArchive && <button type="button" className="btn btn-sm btn-ghost text-error" disabled={!archiveEnabled} onClick={onArchive}><Archive size={15} />Archive</button>}</div>}
      </div>

      <section aria-labelledby="guest-profile-details">
        <h3 id="guest-profile-details" className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Profile</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailField icon={<UserRound size={16} />} label="Legal name" value={guest.legalName || "Not provided"} />
          <DetailField icon={<CalendarDays size={16} />} label="Date of birth" value={guest.dateOfBirth ? formatDate(guest.dateOfBirth) : "Not provided"} />
          <DetailField icon={<Mail size={16} />} label="Email" value={guest.email || "Not provided"} href={guest.email ? `mailto:${guest.email}` : undefined} />
          <DetailField icon={<Phone size={16} />} label="Phone" value={guest.phone || "Not provided"} href={guest.phone ? `tel:${guest.phone}` : undefined} />
          <DetailField icon={<Globe2 size={16} />} label="Nationality" value={guest.nationalityCountryCode?.toUpperCase() || "Not provided"} />
          <DetailField icon={<Languages size={16} />} label="Preferred language" value={guest.preferredLanguageTag || "Not provided"} />
        </div>
        {guest.notes && <div className="mt-3 rounded-xl border border-base-300 p-4"><p className="text-xs font-semibold text-base-content/45">Staff notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{guest.notes}</p></div>}
      </section>

      <section aria-labelledby="guest-stay-history">
        <div className="mb-3 flex items-center justify-between"><h3 id="guest-stay-history" className="text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Stay history</h3>{stays.length > 0 && <span className="text-xs font-medium text-base-content/40">Page {stayPage}</span>}</div>
        <CompositeSourceNotice className="mb-3" sources={[staysSource]} title="Stay history is delayed" />
        {staysSource.state === "loading" ? <LoadingState label="Loading stay history" /> : !compositeSourceUsable(staysSource.state) ? (
          <CompositeSourceFallback state={staysSource.state} label="stay history" />
        ) : !stays.length ? (
          <div className="rounded-2xl border border-dashed border-base-300 p-6 text-center"><History className="mx-auto text-base-content/25" size={26} /><p className="mt-3 text-sm font-semibold">No stays recorded yet</p><p className="mt-1 text-xs text-base-content/45">Reservation participation will appear here automatically.</p></div>
        ) : <><div className="space-y-3">{stays.map((stay) => <StayHistoryCard key={`${stay.reservationId}-${stay.reservationVersion}`} stay={stay} />)}</div><PaginationBar page={stayPage} pageSize={stayPageSize} itemCount={stays.length} itemLabel="stay" hasMore={staysHasMore} disabled={!compositeSourceCurrent(staysSource)} onPageChange={onStayPageChange} /></>}
      </section>

      <p className="border-t border-base-300 pt-4 text-xs leading-5 text-base-content/40">Last updated {formatDateTime(guest.lastChangedAtUtc)} by {formatActor(guest.lastChangedBy)} · Profile version {guest.version}</p>
    </div>
  );
}

function DetailField({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  return <div className="flex gap-3 rounded-xl border border-base-300 p-4"><span className="mt-0.5 text-primary">{icon}</span><div className="min-w-0"><p className="text-xs font-semibold text-base-content/45">{label}</p>{href ? <a className="mt-1 block truncate text-sm font-medium text-primary hover:underline" href={href}>{value}</a> : <p className="mt-1 truncate text-sm font-medium">{value}</p>}</div></div>;
}

function StayHistoryCard({ stay }: { stay: GuestStayHistoryItem }) {
  const lifecycleDate = stay.checkedOutBusinessDate
    ? `Checked out ${formatDate(stay.checkedOutBusinessDate)}`
    : stay.noShowBusinessDate
      ? `No-show ${formatDate(stay.noShowBusinessDate)}`
      : stay.checkedInBusinessDate
        ? `Checked in ${formatDate(stay.checkedInBusinessDate)}`
        : null;
  return (
    <article className="rounded-xl border border-base-300 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays size={17} /></span><div><p className="font-semibold">{formatDate(stay.arrival)} → {formatDate(stay.departure)}</p><p className="mt-1 text-xs text-base-content/45">{nightsBetween(stay.arrival, stay.departure)} nights · {guestStayRoleLabel(stay.role)}</p></div></div>
        <StatusBadge status={guestStayStatusLabel(stay.status)} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-base-300 pt-3 text-xs text-base-content/45"><span>{lifecycleDate ?? "Stay not started"}</span><span>{stay.isCurrentParticipant ? "Current reservation link" : "Previous reservation link"}</span></div>
    </article>
  );
}

function GuestForm({ state, submitting, error, sources, authorityCurrent, authorityMessage, onSubmit, onClose }: {
  state: GuestFormState;
  submitting: boolean;
  error: unknown;
  sources: CompositeSource[];
  authorityCurrent: boolean;
  authorityMessage: string;
  onSubmit: (values: GuestWriteValues) => void;
  onClose: () => void;
}) {
  const guest = state ?? null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorityCurrent) return;
    const data = new FormData(event.currentTarget);
    onSubmit({
      displayName: String(data.get("displayName") ?? "").trim(),
      legalName: optionalFormValue(data, "legalName"),
      email: optionalFormValue(data, "email"),
      phone: optionalFormValue(data, "phone"),
      dateOfBirth: optionalFormValue(data, "dateOfBirth"),
      nationalityCountryCode: optionalFormValue(data, "nationalityCountryCode")?.toUpperCase() ?? null,
      preferredLanguageTag: optionalFormValue(data, "preferredLanguageTag"),
      notes: optionalFormValue(data, "notes"),
    });
  }
  return (
    <Modal open={state !== undefined} title={guest ? "Edit guest" : "New guest"} description="Start with the details staff need most. Optional fields can be completed later." onClose={onClose}>
      <form key={guest?.guestId ?? "new"} onSubmit={submit} className="space-y-4">
        <CompositeSourceNotice className="mb-0" sources={sources} title="Guest command context is delayed" />
        {!authorityCurrent && <MutationAuthorityNotice message={authorityMessage} />}
        <fieldset disabled={!authorityCurrent || submitting} className="space-y-4">
          <FormField label="Display name" name="displayName" defaultValue={guest?.displayName} placeholder="Maya Chen" maxLength={256} autoComplete="name" />
          <FormField label="Legal name (optional)" name="legalName" defaultValue={guest?.legalName} placeholder="As shown on identification" maxLength={256} required={false} autoComplete="name" />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Email (optional)" name="email" type="email" defaultValue={guest?.email} placeholder="maya@example.com" maxLength={320} required={false} autoComplete="email" />
            <FormField label="Phone (optional)" name="phone" type="tel" defaultValue={guest?.phone} placeholder="+44 20 1234 5678" maxLength={64} required={false} autoComplete="tel" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormDatePicker label="Date of birth" name="dateOfBirth" defaultValue={guest?.dateOfBirth} />
            <FormField label="Nationality" name="nationalityCountryCode" defaultValue={guest?.nationalityCountryCode} placeholder="GB" maxLength={2} required={false} autoComplete="country" />
            <FormField label="Language" name="preferredLanguageTag" defaultValue={guest?.preferredLanguageTag} placeholder="en-GB" maxLength={35} required={false} autoComplete="language" />
          </div>
          <label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Staff notes (optional)</span><textarea className="textarea textarea-bordered min-h-20 w-full" name="notes" defaultValue={guest?.notes ?? ""} maxLength={4000} placeholder="Preferences or operational notes visible to staff" /></label>
        </fieldset>
        {Boolean(error) && <ErrorState error={error} />}
        <FormActions submitting={submitting} disabled={!authorityCurrent} submitLabel={guest ? "Save changes" : "Create guest"} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function MutationAuthorityNotice({ message }: { message: string }) {
  return (
    <div className="alert border border-warning/25 bg-warning/10 text-base-content" role="status">
      <AlertTriangle className="shrink-0 text-warning" size={18} />
      <p className="text-sm leading-5">{message}</p>
    </div>
  );
}

function FormField({ label, name, defaultValue, placeholder, type = "text", maxLength, required = true, autoComplete }: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  required?: boolean;
  autoComplete?: string;
}) {
  return <label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} required={required} maxLength={maxLength} autoComplete={autoComplete} /></label>;
}

function FormDatePicker({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string | null }) {
  const [value, setValue] = useState(defaultValue ?? "");
  return <div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><DatePicker className="w-full" name={name} value={value} onChange={setValue} ariaLabel={label} /></div>;
}

function ArchiveGuestModal({ guest, submitting, error, sources, authorityCurrent, authorityMessage, onConfirm, onClose }: {
  guest: GuestProfile | null;
  submitting: boolean;
  error: unknown;
  sources: CompositeSource[];
  authorityCurrent: boolean;
  authorityMessage: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={Boolean(guest)} title="Archive guest profile?" description="Archived profiles remain available for historical records." onClose={onClose}>
      {guest && (
        <div className="space-y-4">
          <CompositeSourceNotice
            className="mb-0"
            sources={sources}
            title="Guest command context is delayed"
          />
          {!authorityCurrent && <MutationAuthorityNotice message={authorityMessage} />}
          <div className="flex items-center gap-3 rounded-lg bg-base-200 p-4">
            <InitialAvatar name={guest.displayName} />
            <div>
              <p className="font-semibold">{guest.displayName}</p>
              <p className="mt-1 text-xs text-base-content/45">Stay history and reservation links are preserved.</p>
            </div>
          </div>
          {Boolean(error) && <ErrorState error={error} />}
          <ModalActions>
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Keep active</button>
            <button type="button" className="btn btn-error btn-sm sm:btn-md" disabled={submitting || !authorityCurrent} onClick={onConfirm}>
              {submitting && <span className="loading loading-spinner loading-sm" />}
              Archive guest
            </button>
          </ModalActions>
        </div>
      )}
    </Modal>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function optionalFormValue(data: FormData, name: string): string | null {
  const value = String(data.get(name) ?? "").trim();
  return value || null;
}

function formatActor(value: string): string {
  const separator = value.indexOf(":");
  if (separator < 0) return looksLikeUuid(value) ? "staff user" : value;

  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "user") return looksLikeUuid(id) ? "staff user" : id;
  if (kind === "admin-actor") return looksLikeUuid(id) ? "administrator" : id;
  return looksLikeUuid(id) ? kind.replaceAll("-", " ") : id;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function nightsBetween(arrival: string, departure: string): number {
  return Math.max(0, Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86_400_000));
}
