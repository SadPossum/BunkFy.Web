import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarDays,
  ChevronLeft,
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
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { GuestListResponse, GuestProfile, GuestStayHistoryItem } from "../../api/types";
import { guestStatusLabel, guestStatusValue, guestStayRoleLabel, guestStayStatusLabel } from "../../api/labels";
import { permissions, propertyAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { DatePicker } from "../../components/ui/DatePicker";
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

const PAGE_SIZE = 30;
const statusFilters = ["active", "all", "archived"] as const;
type StatusFilter = (typeof statusFilters)[number];
type GuestFormState = GuestProfile | null | undefined;

type GuestWriteValues = {
  displayName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  nationalityCountryCode: string | null;
  preferredLanguageTag: string | null;
  notes: string | null;
};

type GuestFormSubmission = {
  guest: GuestProfile | null;
  values: GuestWriteValues;
};

export function GuestsPage() {
  const { request, session } = useSession();
  const { selectedProperty, selectedPropertyId } = useWorkspace();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [formState, setFormState] = useState<GuestFormState>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<GuestProfile | null>(null);

  const accessScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const access = usePermissions(accessScope ? [
    { permission: permissions.guestsRead, scope: accessScope },
    { permission: permissions.guestsCreate, scope: accessScope },
    { permission: permissions.guestsManage, scope: accessScope },
    { permission: permissions.guestsArchive, scope: accessScope },
  ] : []);
  const canRead = access.allows(permissions.guestsRead, accessScope);
  const canCreate = access.allows(permissions.guestsCreate, accessScope);
  const canManage = access.allows(permissions.guestsManage, accessScope);
  const canArchive = access.allows(permissions.guestsArchive, accessScope);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (status !== "all") params.set("status", String(guestStatusValue(status)));
    return params.toString();
  }, [debouncedSearch, page, status]);

  const guests = useQuery({
    queryKey: ["guest-list", selectedPropertyId, status, debouncedSearch, page],
    queryFn: () => request<GuestListResponse>(`/api/guests/properties/${selectedPropertyId}?${queryString}`),
    enabled: Boolean(selectedPropertyId && !access.isLoading && canRead),
    placeholderData: (previous) => previous,
  });

  const detail = useQuery({
    queryKey: ["guest-detail", selectedPropertyId, selectedGuestId],
    queryFn: () => request<GuestProfile>(`/api/guests/properties/${selectedPropertyId}/${selectedGuestId}`),
    enabled: Boolean(selectedPropertyId && selectedGuestId && canRead),
  });
  const stays = useQuery({
    queryKey: ["guest-stays", selectedPropertyId, selectedGuestId],
    queryFn: () => request<GuestStayHistoryItem[]>(`/api/guests/properties/${selectedPropertyId}/${selectedGuestId}/stays`),
    enabled: Boolean(selectedPropertyId && selectedGuestId && canRead),
  });

  const guestMutation = useMutation<GuestProfile, Error, GuestFormSubmission>({
    mutationFn: ({ guest, values }) => request<GuestProfile>(
      guest
        ? `/api/guests/properties/${selectedPropertyId}/${guest.guestId}`
        : `/api/guests/properties/${selectedPropertyId}`,
      {
        method: guest ? "PUT" : "POST",
        body: JSON.stringify(guest ? { ...values, expectedVersion: guest.version } : values),
      },
    ),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guest-list", selectedPropertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-detail", selectedPropertyId, saved.guestId] }),
      ]);
      setFormState(undefined);
      setSelectedGuestId(saved.guestId);
    },
  });

  const archiveMutation = useMutation<GuestProfile, Error, GuestProfile>({
    mutationFn: (guest) => request<GuestProfile>(
      `/api/guests/properties/${selectedPropertyId}/${guest.guestId}/archive`,
      { method: "POST", body: JSON.stringify({ expectedVersion: guest.version, confirmed: true }) },
    ),
    onSuccess: async (archived) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guest-list", selectedPropertyId] }),
        queryClient.invalidateQueries({ queryKey: ["guest-detail", selectedPropertyId, archived.guestId] }),
      ]);
      setArchiveTarget(null);
      setSelectedGuestId(null);
    },
  });

  useEffect(() => {
    setPage(1);
    setSelectedGuestId(null);
  }, [selectedPropertyId]);

  const guestItems = guests.data?.guests ?? [];
  const selectedSummary = guestItems.find((guest) => guest.guestId === selectedGuestId);
  const detailOpen = Boolean(selectedGuestId && formState === undefined && !archiveTarget);

  function openCreate() {
    guestMutation.reset();
    setSelectedGuestId(null);
    setFormState(null);
  }

  function openEdit(guest: GuestProfile) {
    guestMutation.reset();
    setSelectedGuestId(guest.guestId);
    setFormState(guest);
  }

  function openArchive(guest: GuestProfile) {
    archiveMutation.reset();
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
        action={canCreate ? <button type="button" className="btn btn-primary" onClick={openCreate}><Plus size={17} />New guest</button> : undefined}
      />

      {access.isLoading ? <LoadingState label="Checking guest access" /> : access.error ? <ErrorState error={access.error} /> : !canRead ? (
        <EmptyState icon={<UsersRound />} title="Guest access is not enabled" description="Ask an administrator for guest record access at this property." />
      ) : (
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

          {guests.isLoading ? <LoadingState label="Loading guests" /> : guests.error ? (
            <div className="p-6"><ErrorState error={guests.error} retry={() => void guests.refetch()} /></div>
          ) : !guestItems.length ? (
            <div className="p-6">
              <EmptyState
                icon={<UserRound />}
                title={search || status !== "active" ? "No guests match" : "No guest records yet"}
                description={search || status !== "active" ? "Try another search or status filter." : "Create a guest profile to keep contact details and stay history in one place."}
                action={canCreate && !search && status === "active" ? <button type="button" className="btn btn-sm btn-primary" onClick={openCreate}>Create first guest</button> : undefined}
              />
            </div>
          ) : (
            <GuestList guests={guestItems} onSelect={setSelectedGuestId} />
          )}

          {(page > 1 || guestItems.length === PAGE_SIZE) && (
            <div className="flex items-center justify-between border-t border-base-300 px-4 py-4 sm:px-6">
              <p className="text-xs font-medium text-base-content/45">Page {page} · {guestItems.length} guest{guestItems.length === 1 ? "" : "s"}</p>
              <div className="join">
                <button type="button" className="btn join-item btn-sm" disabled={page === 1 || guests.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} />Previous</button>
                <button type="button" className="btn join-item btn-sm" disabled={guestItems.length < PAGE_SIZE || guests.isFetching} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </section>
      )}

      <Modal
        open={detailOpen}
        title={detail.data?.displayName ?? selectedSummary?.displayName ?? "Guest profile"}
        description="Profile details and recorded stay history"
        onClose={() => setSelectedGuestId(null)}
      >
        {detail.isLoading ? <LoadingState label="Loading guest profile" /> : detail.error ? <ErrorState error={detail.error} retry={() => void detail.refetch()} /> : detail.data ? (
          <GuestDetail
            guest={detail.data}
            stays={stays.data ?? []}
            staysLoading={stays.isLoading}
            staysError={stays.error}
            canManage={canManage}
            canArchive={canArchive}
            onEdit={() => openEdit(detail.data)}
            onArchive={() => openArchive(detail.data)}
          />
        ) : null}
      </Modal>

      <GuestForm
        state={formState}
        submitting={guestMutation.isPending}
        error={guestMutation.error}
        onSubmit={(values) => guestMutation.mutate({ guest: formState ?? null, values })}
        onClose={() => { guestMutation.reset(); setFormState(undefined); }}
      />

      <ArchiveGuestModal
        guest={archiveTarget}
        submitting={archiveMutation.isPending}
        error={archiveMutation.error}
        onConfirm={() => { if (archiveTarget) archiveMutation.mutate(archiveTarget); }}
        onClose={() => { archiveMutation.reset(); setArchiveTarget(null); }}
      />
    </>
  );
}

function GuestList({ guests, onSelect }: { guests: GuestProfile[]; onSelect: (guestId: string) => void }) {
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

function ContactSummary({ guest }: { guest: GuestProfile }) {
  if (!guest.email && !guest.phone) return <span className="text-sm text-base-content/35">No contact details</span>;
  return <div className="space-y-1 text-sm">{guest.email && <p className="flex items-center gap-2"><Mail size={14} className="text-base-content/35" /><span className="max-w-56 truncate">{guest.email}</span></p>}{guest.phone && <p className="flex items-center gap-2"><Phone size={14} className="text-base-content/35" />{guest.phone}</p>}</div>;
}

function GuestDetail({ guest, stays, staysLoading, staysError, canManage, canArchive, onEdit, onArchive }: {
  guest: GuestProfile;
  stays: GuestStayHistoryItem[];
  staysLoading: boolean;
  staysError: unknown;
  canManage: boolean;
  canArchive: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const active = guestStatusLabel(guest.status) === "active";
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-base-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><InitialAvatar name={guest.displayName} variant="solid" /><div><div className="flex flex-wrap items-center gap-2"><p className="font-display text-lg font-semibold">{guest.displayName}</p><StatusBadge status={guestStatusLabel(guest.status)} /></div><p className="mt-1 text-xs text-base-content/45">Guest since {formatDateTime(guest.createdAtUtc)}</p></div></div>
        {active && (canManage || canArchive) && <div className="flex gap-2">{canManage && <button type="button" className="btn btn-sm btn-outline" onClick={onEdit}><Edit3 size={15} />Edit</button>}{canArchive && <button type="button" className="btn btn-sm btn-ghost text-error" onClick={onArchive}><Archive size={15} />Archive</button>}</div>}
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
        <div className="mb-3 flex items-center justify-between"><h3 id="guest-stay-history" className="text-xs font-bold uppercase tracking-[0.15em] text-base-content/40">Stay history</h3>{stays.length > 0 && <span className="text-xs font-medium text-base-content/40">{stays.length} recorded</span>}</div>
        {staysLoading ? <LoadingState label="Loading stay history" /> : staysError ? <ErrorState error={staysError} /> : !stays.length ? (
          <div className="rounded-2xl border border-dashed border-base-300 p-6 text-center"><History className="mx-auto text-base-content/25" size={26} /><p className="mt-3 text-sm font-semibold">No stays recorded yet</p><p className="mt-1 text-xs text-base-content/45">Reservation participation will appear here automatically.</p></div>
        ) : <div className="space-y-3">{stays.map((stay) => <StayHistoryCard key={`${stay.reservationId}-${stay.reservationVersion}`} stay={stay} />)}</div>}
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

function GuestForm({ state, submitting, error, onSubmit, onClose }: {
  state: GuestFormState;
  submitting: boolean;
  error: unknown;
  onSubmit: (values: GuestWriteValues) => void;
  onClose: () => void;
}) {
  const guest = state ?? null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        {Boolean(error) && <ErrorState error={error} />}
        <FormActions submitting={submitting} submitLabel={guest ? "Save changes" : "Create guest"} onCancel={onClose} />
      </form>
    </Modal>
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

function ArchiveGuestModal({ guest, submitting, error, onConfirm, onClose }: {
  guest: GuestProfile | null;
  submitting: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={Boolean(guest)} title="Archive guest profile?" description="Archived profiles remain available for historical records." onClose={onClose}>
      {guest && <div><div className="flex items-center gap-3 rounded-lg bg-base-200 p-4"><InitialAvatar name={guest.displayName} /><div><p className="font-semibold">{guest.displayName}</p><p className="mt-1 text-xs text-base-content/45">Stay history and reservation links are preserved.</p></div></div>{Boolean(error) && <div className="mt-4"><ErrorState error={error} /></div>}<ModalActions><button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Keep active</button><button type="button" className="btn btn-error btn-sm sm:btn-md" disabled={submitting} onClick={onConfirm}>{submitting && <span className="loading loading-spinner loading-sm" />}Archive guest</button></ModalActions></div>}
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
