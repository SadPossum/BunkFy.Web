import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Archive,
  CalendarDays,
  ChevronRight,
  Edit3,
  Globe2,
  History,
  Languages,
  Mail,
  MessageSquareText,
  Phone,
  Plus,
  Search,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import type { GuestListItem, GuestListResponse, GuestMutationReceipt, GuestProfile, GuestStayHistoryItem, GuestStayHistoryListResponse } from "../../api/types";
import { guestStatusLabel, guestStatusValue, guestStayRoleLabel, guestStayStatusLabel } from "../../api/labels";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useTargetProperty } from "../../app/resourceFocus";
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
  guestUpdateRecoveryAllowed,
  guestSaveResultUncertain,
  type GuestManagementAttempt,
  type GuestUpdateAttempt,
} from "./guestManagementAttempt";
import {
  guestMutationAllowed,
  guestRecordMatches,
} from "./guestsMutationAuthority";
import {
  guestCountryLabel,
  guestIdentitySummary,
  guestLanguageLabels,
} from "./guestProfilePresentation";
import { NationalityPicker } from "./NationalityPicker";
import { LanguagePicker } from "./LanguagePicker";
import { guestLanguagePayload, guestLanguageSelection } from "./guestLanguageSelection";

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
  intent: { ownerKey: string };
  attempt?: GuestUpdateAttempt;
  recovery?: boolean;
};
type GuestUpdateRecovery = { attempt: GuestUpdateAttempt; uncertain: boolean };

type GuestArchiveSubmission = {
  propertyId: string;
  guest: GuestProfile;
};

export function GuestsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  useTargetProperty(searchParams.get("property"));
  const requestedGuestId = searchParams.get("guest");
  const selectedPropertyIdRef = useRef(selectedPropertyId);
  selectedPropertyIdRef.current = selectedPropertyId;
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(requestedGuestId);
  const [stayPage, setStayPage] = useState(1);
  const [formState, setFormState] = useState<GuestFormState>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<GuestProfile | null>(null);
  const [updateRecovery, setUpdateRecovery] = useState<GuestUpdateRecovery | null>(null);
  const [guestOutcome, setGuestOutcome] = useState<string | null>(null);
  const ownerKey = JSON.stringify([session?.tenantId, session?.subjectId ?? session?.username, session?.sessionId, session?.generation, selectedPropertyId]);
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const formIntent = useRef<{ ownerKey: string } | null>(null);
  const createAttempt = useRef<GuestCreateAttempt | null>(null);
  const updateAttempt = useRef<GuestUpdateAttempt | null>(null);
  const archiveAttempt = useRef<GuestManagementAttempt | null>(null);

  const accessScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.guestsRead, scope: accessScope },
    { permission: permissions.guestsCreate, scope: accessScope },
    { permission: permissions.guestsManage, scope: accessScope },
    { permission: permissions.guestsArchive, scope: accessScope },
    { permission: permissions.reservationsRead, scope: accessScope },
  ] : []);
  const mayRead = access.allows(permissions.guestsRead, accessScope);
  const mayCreate = access.allows(permissions.guestsCreate, accessScope);
  const mayManage = access.allows(permissions.guestsManage, accessScope);
  const mayArchive = access.allows(permissions.guestsArchive, accessScope);
  const mayReadReservations = access.allows(permissions.reservationsRead, accessScope);
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
  const recoveryAllowed = Boolean(updateRecovery?.uncertain && formIntent.current?.ownerKey === ownerKey &&
    guestUpdateRecoveryAllowed(updateRecovery.attempt, {
      propertyId: selectedPropertyId, guestId: selectedGuestId, permissionsCurrent, mayRead, mayManage,
      guestCurrent: detailCurrent, guest: detail.data,
    }));

  const guestMutation = useMutation<GuestMutationReceipt, Error, GuestFormSubmission>({
    mutationFn: ({ propertyId, guest, values, intent, attempt, recovery }) => {
      const exactOwner = formIntent.current === intent && intent.ownerKey === ownerKeyRef.current;
      const authorityCurrent = exactOwner && propertyId === selectedPropertyId && (
        guest
          ? recovery
            ? attempt === updateRecovery?.attempt && recoveryAllowed
            : !updateRecovery && guest.status === 1 && mayRead && mayManage && guestMutationAllowed("update", {
              permissionsCurrent,
              guestCurrent: detailCurrent && guestRecordMatches(detail.data, guest),
            })
          : mayRead && mayCreate && guestMutationAllowed("create", { permissionsCurrent })
      );
      if (!authorityCurrent) {
        throw new ApiError("Current Guest Record access and profile evidence could not be confirmed. Review the latest profile before making another change.", 409);
      }

      const body = guest
        ? (() => {
            if (!attempt || attempt !== updateAttempt.current || attempt.propertyId !== propertyId || attempt.guestId !== guest.guestId) {
              throw new ApiError("This save attempt is no longer owned by this form. Review the latest profile.", 409);
            }
            return attempt.requestBody;
          })()
        : (() => {
            createAttempt.current = resolveGuestCreateAttempt(
              createAttempt.current,
              propertyId,
              values,
            );
            return JSON.stringify({ ...values, operationId: createAttempt.current.operationId });
          })();
      return request<GuestMutationReceipt>(
        guest
          ? `/api/guests/properties/${propertyId}/${guest.guestId}`
          : `/api/guests/properties/${propertyId}`,
        { method: guest ? "PUT" : "POST", body },
      );
    },
    onSuccess: async (saved, submission) => {
      if (formIntent.current !== submission.intent || submission.intent.ownerKey !== ownerKeyRef.current) return;
      createAttempt.current = null;
      updateAttempt.current = null;
      setUpdateRecovery(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guest-list", submission.propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-detail", submission.propertyId, saved.guestId] }),
      ]);
      if (selectedPropertyIdRef.current !== submission.propertyId || !mayReadRef.current || formIntent.current !== submission.intent || submission.intent.ownerKey !== ownerKeyRef.current) return;
      formIntent.current = null;
      setGuestOutcome("Guest record saved.");
      setFormState(undefined);
      selectGuest(saved.guestId);
    },
    onError: async (error, submission) => {
      if (formIntent.current !== submission.intent || submission.intent.ownerKey !== ownerKeyRef.current) return;
      if (submission.guest && submission.attempt) {
        setUpdateRecovery({ attempt: submission.attempt, uncertain: guestSaveResultUncertain(error) });
      }
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
    formIntent.current = null;
    setUpdateRecovery(null);
    setGuestOutcome(null);
    createAttempt.current = null;
    updateAttempt.current = null;
    archiveAttempt.current = null;
    setPage(1);
    setStayPage(1);
    setSelectedGuestId(null);
    setFormState(undefined);
    setArchiveTarget(null);
  }, [selectedPropertyId, ownerKey]);

  useEffect(() => {
    if (!requestedGuestId || !selectedPropertyId) return;
    setStayPage(1);
    setSelectedGuestId(requestedGuestId);
  }, [requestedGuestId, selectedPropertyId]);

  useEffect(() => {
    if (!permissionsCurrent) return;

    if (!mayRead) {
      formIntent.current = null;
      setUpdateRecovery(null);
      createAttempt.current = null;
      updateAttempt.current = null;
      archiveAttempt.current = null;
      setSelectedGuestId(null);
      setFormState(undefined);
      setArchiveTarget(null);
      return;
    }

    if ((formState === null && !mayCreate) || (formState && !mayManage)) {
      formIntent.current = null;
      setUpdateRecovery(null);
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
    if (!formState) return;
    const identityChanged = selectedGuestId !== formState.guestId || requestedGuestId !== formState.guestId;
    const denied = detail.error instanceof ApiError && [401, 403, 404, 410].includes(detail.error.status);
    const inactive = detailCurrent && detail.data?.guestId === formState.guestId && detail.data.status !== 1;
    if (!identityChanged && !denied && !inactive) return;
    formIntent.current = null;
    updateAttempt.current = null;
    setUpdateRecovery(null);
    setFormState(undefined);
    if (denied || inactive) setGuestOutcome("This Guest record can no longer be edited. Review the latest profile and access status.");
  }, [formState, selectedGuestId, requestedGuestId, detail.error, detailCurrent, detail.data]);

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
    const next = new URLSearchParams(searchParams);
    if (guestId) {
      next.set("guest", guestId);
    } else {
      next.delete("guest");
      next.delete("focus");
      next.delete("property");
    }
    setSearchParams(next, { replace: true });
  }

  function openCreate() {
    if (!createAuthorityCurrent) return;
    guestMutation.reset();
    createAttempt.current = null;
    updateAttempt.current = null;
    setUpdateRecovery(null);
    setGuestOutcome(null);
    formIntent.current = { ownerKey };
    selectGuest(null);
    setFormState(null);
  }

  function openEdit(guest: GuestProfile) {
    if (!detailManageAuthorityCurrent || !guestRecordMatches(detail.data, guest)) return;
    guestMutation.reset();
    createAttempt.current = null;
    updateAttempt.current = null;
    setUpdateRecovery(null);
    setGuestOutcome(null);
    formIntent.current = { ownerKey };
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
        title="Guest records"
        description="Find durable contact details and review reservation-linked stay history."
        action={mayRead && mayCreate ? <button type="button" className="btn btn-primary" disabled={!createAuthorityCurrent} onClick={openCreate}><Plus size={17} />New guest record</button> : undefined}
      />
      {guestOutcome && <p role="status" className="mb-4 text-sm">{guestOutcome}</p>}

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
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <SegmentedTabs
                value={status}
                ariaLabel="Guest status"
                onValueChange={(nextStatus) => { setStatus(nextStatus); setPage(1); }}
                options={statusFilters.map((option) => ({
                  value: option,
                  label: option === "all" ? "All guests" : option === "active" ? "Active" : "Archived",
                }))}
              />
              {directoryUsable && <p className="text-xs font-medium text-base-content/50" aria-live="polite">Page {page} · {guestItems.length} {guestItems.length === 1 ? "record" : "records"}</p>}
            </div>
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
              {search && !guests.isFetching && <button type="button" className="btn btn-circle btn-ghost btn-xs -mr-1" aria-label="Clear guest search" onClick={() => { setSearch(""); setPage(1); }}><X size={14} /></button>}
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
        description="Durable identity, contact details and reservation-linked history"
        onClose={() => selectGuest(null)}
        size="lg"
      >
        {detailSource.state === "loading" ? <LoadingState label="Loading guest profile" /> : !detailUsable ? (
          <div>
            <CompositeSourceNotice sources={[permissionSource]} title="Guest access is delayed" />
            <CompositeSourceFallback error={detail.error} retry={() => void detail.refetch()} state={detailSource.state} label="guest profile" title="Guest profile could not be opened" />
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
              canOpenReservations={mayReadReservations && permissionsCurrent}
              manageEnabled={detailManageAuthorityCurrent}
              archiveEnabled={detailArchiveAuthorityCurrent}
              onEdit={() => openEdit(detail.data)}
              onArchive={() => openArchive(detail.data)}
            />
          </div>
        ) : null}
      </Modal>

      <GuestForm
        state={guestDataVisible && formIntent.current?.ownerKey === ownerKey ? formState : undefined}
        submitting={guestMutation.isPending}
        error={guestMutation.error}
        sources={formState ? [permissionSource, detailSource] : [permissionSource]}
        authorityCurrent={formAuthorityCurrent}
        authorityMessage={formAuthorityMessage}
        recovery={updateRecovery}
        recoveryAllowed={recoveryAllowed}
        onRetry={() => {
          if (!formState || !formIntent.current || !recoveryAllowed || !updateRecovery || guestMutation.isPending) return;
          guestMutation.mutate({ propertyId: selectedPropertyId, guest: formState, values: JSON.parse(updateRecovery.attempt.requestBody),
            intent: formIntent.current, attempt: updateRecovery.attempt, recovery: true });
        }}
        onSubmit={(values) => {
          if (!formAuthorityCurrent || !formIntent.current || updateRecovery || guestMutation.isPending) return;
          const attempt = formState ? resolveGuestUpdateAttempt(updateAttempt.current, selectedPropertyId, formState.guestId, formState.version, values) : undefined;
          if (attempt) updateAttempt.current = attempt;
          guestMutation.mutate({ propertyId: selectedPropertyId, guest: formState ?? null, values, intent: formIntent.current, attempt });
        }}
        onClose={() => { formIntent.current = null; guestMutation.reset(); createAttempt.current = null; updateAttempt.current = null; setUpdateRecovery(null); setFormState(undefined); }}
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
          <thead><tr className="border-base-300 text-[0.68rem] uppercase text-base-content/40"><th className="pl-6">Guest</th><th>Contact</th><th>Identity details</th><th>Status</th><th>Last updated</th><th className="pr-6" /></tr></thead>
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
                <td><IdentitySummary guest={guest} /></td>
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

function IdentitySummary({ guest }: { guest: GuestListItem }) {
  const details = guestIdentitySummary(guest);
  if (!details.length) return <span className="text-sm text-base-content/35">Display name only</span>;
  return <div className="max-w-52 space-y-1 text-sm text-base-content/55">{details.map((detail) => <p key={detail} className="truncate" title={detail}>{detail}</p>)}</div>;
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
  canOpenReservations,
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
  canOpenReservations: boolean;
  manageEnabled: boolean;
  archiveEnabled: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const active = guestStatusLabel(guest.status) === "active";
  const country = guestCountryLabel(guest.nationalityCountryCode);
  const language = guestLanguageLabels(guest).join(" · ");
  const hasRecordedProfileFacts = Boolean(
    guest.legalName || guest.email || guest.phone || guest.dateOfBirth || country || language,
  );
  const missingProfileFacts = [
    !guest.legalName && "legal name",
    !guest.email && "email",
    !guest.phone && "phone",
    !guest.dateOfBirth && "date of birth",
    !country && "nationality",
    !language && "languages",
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-lg bg-base-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><InitialAvatar name={guest.displayName} variant="solid" /><div><div className="flex flex-wrap items-center gap-2"><p className="font-display text-lg font-semibold">{guest.displayName}</p><StatusBadge status={guestStatusLabel(guest.status)} /></div><p className="mt-1 text-xs text-base-content/45">Guest since {formatDateTime(guest.createdAtUtc)}</p></div></div>
        {active && (canManage || canArchive) && <div className="flex gap-2">{canManage && <button type="button" className="btn btn-sm btn-outline" disabled={!manageEnabled} onClick={onEdit}><Edit3 size={15} />Edit</button>}{canArchive && <button type="button" className="btn btn-sm btn-ghost text-error" disabled={!archiveEnabled} onClick={onArchive}><Archive size={15} />Archive</button>}</div>}
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="min-w-0" aria-labelledby="guest-profile-details">
          <h3 id="guest-profile-details" className="mb-3 text-xs font-bold uppercase text-base-content/40">Identity and contact</h3>
          <div className="divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300 bg-base-100">
            {guest.legalName && <ProfileFact icon={<UserRound size={16} />} label="Legal name" value={guest.legalName} />}
            {guest.email && <ProfileFact icon={<Mail size={16} />} label="Email" value={guest.email} href={`mailto:${guest.email}`} />}
            {guest.phone && <ProfileFact icon={<Phone size={16} />} label="Phone" value={guest.phone} href={`tel:${guest.phone}`} />}
            {guest.dateOfBirth && <ProfileFact icon={<CalendarDays size={16} />} label="Date of birth" value={formatDate(guest.dateOfBirth)} />}
            {country && <ProfileFact icon={<Globe2 size={16} />} label="Nationality" value={country} />}
            {language && <ProfileFact icon={<Languages size={16} />} label="Languages" value={language} />}
            {!hasRecordedProfileFacts && <div className="p-4 text-sm text-base-content/50">Only the display name is recorded.</div>}
          </div>
          {missingProfileFacts.length > 0 && <p className="mt-3 text-xs leading-5 text-base-content/45">Not recorded: {missingProfileFacts.join(", ")}.</p>}
          {guest.notes && <div className="mt-5 border-l-2 border-primary/35 pl-4"><div className="flex items-center gap-2 text-xs font-semibold text-base-content/50"><MessageSquareText size={15} className="text-primary" />Staff notes</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{guest.notes}</p></div>}
        </section>

        <section className="min-w-0" aria-labelledby="guest-stay-history">
          <div className="mb-3 flex items-center justify-between gap-3"><h3 id="guest-stay-history" className="text-xs font-bold uppercase text-base-content/40">Stay history</h3>{stays.length > 0 && <span className="text-xs font-medium text-base-content/40">Page {stayPage}</span>}</div>
          <CompositeSourceNotice className="mb-3" sources={[staysSource]} title="Stay history is delayed" />
          {staysSource.state === "loading" ? <LoadingState label="Loading stay history" /> : !compositeSourceUsable(staysSource.state) ? (
            <CompositeSourceFallback state={staysSource.state} label="stay history" />
          ) : !stays.length ? (
            <div className="rounded-lg border border-dashed border-base-300 p-6 text-center"><History className="mx-auto text-base-content/25" size={26} /><p className="mt-3 text-sm font-semibold">No stays recorded yet</p><p className="mt-1 text-xs text-base-content/45">A linked reservation will appear here automatically.</p></div>
          ) : <><div className="space-y-3">{stays.map((stay) => <StayHistoryCard key={`${stay.reservationId}-${stay.reservationVersion}`} stay={stay} canOpenReservation={canOpenReservations} />)}</div><PaginationBar page={stayPage} pageSize={stayPageSize} itemCount={stays.length} itemLabel="stay" hasMore={staysHasMore} disabled={!compositeSourceCurrent(staysSource)} onPageChange={onStayPageChange} /></>}
        </section>
      </div>

      <p className="border-t border-base-300 pt-4 text-xs leading-5 text-base-content/40">Last updated {formatDateTime(guest.lastChangedAtUtc)} by {formatActor(guest.lastChangedBy)} · Profile version {guest.version}</p>
    </div>
  );
}

function ProfileFact({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  return <div className="flex min-w-0 gap-3 p-4"><span className="mt-0.5 shrink-0 text-primary">{icon}</span><div className="min-w-0"><p className="text-xs font-semibold text-base-content/45">{label}</p>{href ? <a className="mt-1 block break-words text-sm font-medium text-primary hover:underline" href={href}>{value}</a> : <p className="mt-1 break-words text-sm font-medium">{value}</p>}</div></div>;
}

function StayHistoryCard({ stay, canOpenReservation }: { stay: GuestStayHistoryItem; canOpenReservation: boolean }) {
  const lifecycleDate = stay.checkedOutBusinessDate
    ? `Checked out ${formatDate(stay.checkedOutBusinessDate)}`
    : stay.noShowBusinessDate
      ? `No-show ${formatDate(stay.noShowBusinessDate)}`
      : stay.checkedInBusinessDate
        ? `Checked in ${formatDate(stay.checkedInBusinessDate)}`
        : null;
  return (
    <article className="rounded-lg border border-base-300 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays size={17} /></span><div><p className="font-semibold">{formatDate(stay.arrival)} → {formatDate(stay.departure)}</p><p className="mt-1 text-xs text-base-content/45">{nightsBetween(stay.arrival, stay.departure)} nights · {guestStayRoleLabel(stay.role)}</p></div></div>
        <StatusBadge status={guestStayStatusLabel(stay.status)} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-3">
        <div className="text-xs text-base-content/45"><p>{lifecycleDate ?? "Stay not started"}</p><p className="mt-1">{stay.isCurrentParticipant ? "Current participant" : "Historical participant"} · Reservation {stay.reservationId.slice(0, 8).toUpperCase()}</p></div>
        {canOpenReservation && <Link className="btn btn-ghost btn-sm shrink-0 text-primary" to={`/reservations?${new URLSearchParams({ property: stay.propertyId, reservation: stay.reservationId, focus: stay.reservationId })}`}><span>Open reservation</span><ArrowUpRight size={15} /></Link>}
      </div>
    </article>
  );
}

type GuestFormProps = {
  state: GuestFormState;
  submitting: boolean;
  error: unknown;
  sources: CompositeSource[];
  authorityCurrent: boolean;
  authorityMessage: string;
  recovery: GuestUpdateRecovery | null;
  recoveryAllowed: boolean;
  onRetry: () => void;
  onSubmit: (values: GuestWriteValues) => void;
  onClose: () => void;
};

function GuestForm(props: GuestFormProps) {
  const guest = props.state ?? null;
  return <Modal open={props.state !== undefined} title={guest ? "Edit guest record" : "New guest record"} description="Durable identity and contact details for future reservations and stay history." onClose={props.onClose} size="lg">
    <GuestEditor key={guest?.guestId ?? "new"} {...props} />
  </Modal>;
}

function GuestEditor({ state, submitting, error, sources, authorityCurrent, authorityMessage, recovery, recoveryAllowed, onRetry, onSubmit, onClose }: GuestFormProps) {
  const guest = state ?? null;
  const [languageTags, setLanguageTags] = useState(() => guestLanguageSelection(guest ?? {}));
  const [languageError, setLanguageError] = useState<string | null>(null);
  const authorityFeedback = useRef<HTMLDivElement>(null);
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  const failureFocusOwner = useRef<Element | null>(null);
  const fieldsDisabled = !authorityCurrent || submitting || Boolean(recovery);
  useEffect(() => {
    if (!submitting || !failureFocusOwner.current) return;
    const cancel = () => { failureFocusOwner.current = null; };
    const focus = (event: FocusEvent) => {
      if (event.target !== failureFocusOwner.current && event.target !== detailsHeading.current && event.target !== authorityFeedback.current &&
        event.target !== document.body && event.target !== authorityFeedback.current?.closest("[data-bunkfy-modal-box]")) cancel();
    };
    const pointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !failureFocusOwner.current?.contains(event.target)) cancel();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Tab") cancel(); };
    document.addEventListener("focusin", focus);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("focusin", focus);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [submitting]);
  useEffect(() => {
    if (!error || submitting || !failureFocusOwner.current) return;
    const active = document.activeElement;
    if (active === failureFocusOwner.current || active === document.body || active === detailsHeading.current || active === authorityFeedback.current || active === authorityFeedback.current?.closest("[data-bunkfy-modal-box]")) {
      authorityFeedback.current?.focus();
    }
    failureFocusOwner.current = null;
  }, [error, submitting]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fieldsDisabled) return;
    const languages = guestLanguagePayload(languageTags, guest?.preferredLanguageTag);
    if (!languages.ok) { setLanguageError(languages.error); detailsHeading.current?.focus(); return; }
    const data = new FormData(event.currentTarget);
    failureFocusOwner.current = document.activeElement;
    onSubmit({
      displayName: String(data.get("displayName") ?? "").trim(),
      legalName: optionalFormValue(data, "legalName"),
      email: optionalFormValue(data, "email"),
      phone: optionalFormValue(data, "phone"),
      dateOfBirth: optionalFormValue(data, "dateOfBirth"),
      nationalityCountryCode: optionalFormValue(data, "nationalityCountryCode")?.toUpperCase() ?? null,
      preferredLanguageTag: languages.preferredLanguageTag,
      languageTags: languages.languageTags,
      notes: optionalFormValue(data, "notes"),
    });
  }
  return (
      <form onSubmit={submit} className="space-y-4">
        <div ref={authorityFeedback} tabIndex={-1} className="rounded outline-none focus:ring-2 focus:ring-primary">
          <CompositeSourceNotice className="mb-0" sources={sources} title="Guest command context is delayed" />
          {recovery ? <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm" role="alert">
            <p className="font-semibold">{recovery.uncertain ? "Save result not confirmed" : "This save could not be completed"}</p>
            <p className="mt-1">{recovery.uncertain ? "Retry the same save to confirm its result. Your submitted details are locked until it is resolved." : "No replacement save has been sent. Review the latest profile before making another change."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {recovery.uncertain && <button type="button" className="btn btn-primary min-h-11" disabled={!recoveryAllowed || submitting}
                onClick={event => { failureFocusOwner.current = event.currentTarget; onRetry(); }}>{submitting ? "Checking save…" : "Retry save"}</button>}
              <button type="button" className="btn btn-ghost min-h-11" disabled={submitting} onClick={onClose}>Review latest profile</button>
            </div>
          </div> : <>
            {!authorityCurrent && <MutationAuthorityNotice message={authorityMessage} />}
            {Boolean(error) && <ErrorState error={error} />}
            {!guest && Boolean(error) && guestSaveResultUncertain(error) && <button type="submit" className="btn btn-primary mt-3 min-h-11" disabled={!authorityCurrent || submitting}>Retry create</button>}
          </>}
        </div>
        <fieldset disabled={fieldsDisabled} className="divide-y divide-base-300">
          <FormSection icon={<UserRound size={17} />} title="Identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Display name" name="displayName" defaultValue={guest?.displayName} placeholder="Maya Chen" maxLength={256} autoComplete="name" />
              <FormField label="Legal name (optional)" name="legalName" defaultValue={guest?.legalName} placeholder="As shown on identification" maxLength={256} required={false} autoComplete="name" />
            </div>
          </FormSection>
          <FormSection icon={<Mail size={17} />} title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Email (optional)" name="email" type="email" defaultValue={guest?.email} placeholder="maya@example.com" maxLength={320} required={false} autoComplete="email" />
              <FormField label="Phone (optional)" name="phone" type="tel" defaultValue={guest?.phone} placeholder="+44 20 1234 5678" maxLength={64} required={false} autoComplete="tel" />
            </div>
          </FormSection>
          <FormSection icon={<Globe2 size={17} />} title="Additional details" headingRef={detailsHeading}>
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <FormDatePicker label="Date of birth (optional)" name="dateOfBirth" defaultValue={guest?.dateOfBirth} />
              <FormNationalityPicker defaultValue={guest?.nationalityCountryCode} disabled={fieldsDisabled} />
            </div>
            <LanguagePicker value={languageTags} onChange={value => { setLanguageTags(value); setLanguageError(null); }} disabled={fieldsDisabled}
              onDisabledClose={() => (!authorityCurrent ? authorityFeedback.current : detailsHeading.current)?.focus()} />
            {languageError && <p role="alert" className="mt-2 text-sm text-error">{languageError}</p>}
          </FormSection>
          <FormSection icon={<MessageSquareText size={17} />} title="Staff context">
            <label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">Staff notes (optional)</span><textarea className="textarea textarea-bordered min-h-24 w-full" name="notes" defaultValue={guest?.notes ?? ""} maxLength={4000} placeholder="Operational preferences or context" /><span className="mt-1.5 block text-xs leading-5 text-base-content/45">Visible to staff who can read Guest Records at this property.</span></label>
          </FormSection>
        </fieldset>
        <FormActions submitting={submitting} disabled={!authorityCurrent || Boolean(recovery)} submitLabel={guest ? "Save changes" : "Create guest record"} onCancel={onClose} />
      </form>
  );
}

function FormSection({ icon, title, children, headingRef }: { icon: React.ReactNode; title: string; children: React.ReactNode; headingRef?: React.Ref<HTMLHeadingElement> }) {
  return <section className="py-5 first:pt-0 last:pb-0"><div className="mb-4 flex items-center gap-2"><span className="text-primary">{icon}</span><h3 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="rounded font-display text-base font-semibold outline-none focus:ring-2 focus:ring-primary">{title}</h3></div>{children}</section>;
}

function MutationAuthorityNotice({ message }: { message: string }) {
  return (
    <div className="alert border border-warning/25 bg-warning/10 text-base-content" role="status">
      <AlertTriangle className="shrink-0 text-warning" size={18} />
      <p className="text-sm leading-5">{message}</p>
    </div>
  );
}

function FormField({ label, name, defaultValue, placeholder, type = "text", minLength, maxLength, pattern, required = true, autoComplete, autoCapitalize, spellCheck, hint }: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  type?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  required?: boolean;
  autoComplete?: string;
  autoCapitalize?: string;
  spellCheck?: boolean;
  hint?: string;
}) {
  const hintId = useId();
  return <label className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><input className="input input-bordered w-full" name={name} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} required={required} minLength={minLength} maxLength={maxLength} pattern={pattern} autoComplete={autoComplete} autoCapitalize={autoCapitalize} spellCheck={spellCheck} aria-describedby={hint ? hintId : undefined} />{hint && <span id={hintId} className="mt-1.5 block text-xs leading-5 text-base-content/45">{hint}</span>}</label>;
}

function FormDatePicker({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string | null }) {
  const [value, setValue] = useState(defaultValue ?? "");
  return <div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span><DatePicker className="w-full" name={name} value={value} onChange={setValue} ariaLabel={label} /></div>;
}

function FormNationalityPicker({ defaultValue, disabled }: { defaultValue?: string | null; disabled: boolean }) {
  const [value, setValue] = useState(defaultValue ?? "");
  return <div className="form-control min-w-0"><span className="label-text mb-1.5 block text-sm font-semibold">Nationality (optional)</span><NationalityPicker name="nationalityCountryCode" value={value} onChange={setValue} disabled={disabled} /></div>;
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
    <Modal open={Boolean(guest)} title="Archive guest record?" description="Remove this profile from future booking selection while preserving its history." onClose={onClose}>
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
              <p className="mt-1 text-xs leading-5 text-base-content/50">Existing reservation links and stay history remain visible. This is not deletion or a privacy-rights outcome.</p>
            </div>
          </div>
          {Boolean(error) && <ErrorState error={error} />}
          <ModalActions>
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Keep active</button>
            <button type="button" className="btn btn-error btn-sm sm:btn-md" disabled={submitting || !authorityCurrent} onClick={onConfirm}>
              {submitting && <span className="loading loading-spinner loading-sm" />}
              Archive record
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
