import { useQuery } from "@tanstack/react-query";
import { Check, Search, UserRound, X } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import type { GuestListItem, GuestListResponse, GuestProfile } from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { ErrorState, InitialAvatar } from "../../components/ui/primitives";
import { guestCandidateIsCurrent } from "./reservationsMutationAuthority";

export function GuestRecordPicker({ propertyId, selectedGuest, onSelect, onSelectionAuthorityChange, label = "Guest record", disabled = false, selectionEnabled = true }: {
  propertyId: string;
  selectedGuest: GuestListItem | null;
  onSelect: (guest: GuestListItem | null) => void;
  onSelectionAuthorityChange?: (current: boolean) => void;
  label?: string;
  disabled?: boolean;
  selectionEnabled?: boolean;
}) {
  const { request } = useSession();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const discovering = search.trim().length > 0 && !selectedGuest;
  const searchSettled = discovering && search.trim() === deferredSearch;
  const params = new URLSearchParams({ status: "1", page: "1", pageSize: "8" });
  if (deferredSearch) params.set("search", deferredSearch);
  const guests = useQuery({
    queryKey: ["guest-picker", propertyId, deferredSearch],
    queryFn: ({ signal }) => request<GuestListResponse>(`/api/guests/properties/${propertyId}?${params}`, { signal }),
    enabled: !disabled && searchSettled,
    staleTime: 15_000,
  });
  const selectedProfile = useQuery({
    queryKey: ["guest", propertyId, selectedGuest?.guestId],
    queryFn: async ({ signal }) => {
      const profile = await request<GuestProfile>(`/api/guests/properties/${propertyId}/${selectedGuest!.guestId}`, { signal });
      if (profile.guestId !== selectedGuest!.guestId) throw new Error("The selected Guest Record could not be confirmed.");
      return profile;
    },
    enabled: !disabled && Boolean(selectedGuest),
    staleTime: 15_000,
  });
  const activeQuery = selectedGuest ? selectedProfile : guests;
  const source = createCompositeSource({
    label: "Guest Record directory",
    hasData: activeQuery.data !== undefined,
    isLoading: activeQuery.isLoading,
    error: activeQuery.error,
    isFetching: activeQuery.isFetching,
    refetch: () => activeQuery.refetch(),
  });
  const sourceUsable = compositeSourceUsable(source.state);
  const sourceCurrent = !disabled && compositeSourceCurrent(source) && !activeQuery.isPaused;
  const guestItems = sourceUsable && searchSettled ? guests.data?.guests ?? [] : [];
  const selectedGuestCurrent = Boolean(
    selectedGuest && sourceCurrent &&
      guestCandidateIsCurrent(selectedProfile.data?.guestId === selectedGuest.guestId ? [selectedProfile.data] : [], selectedGuest),
  );

  useEffect(() => {
    onSelectionAuthorityChange?.(selectedGuestCurrent);
  }, [onSelectionAuthorityChange, selectedGuestCurrent]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-base-content/45">Optional</span>
      </div>
      {!disabled && (selectedGuest || searchSettled) && source.state !== "unavailable" && (
        <CompositeSourceNotice
          className="mb-2"
          sources={[source]}
          title="Guest Record results are delayed"
        />
      )}
      {!disabled && (selectedGuest || searchSettled) && source.state === "unavailable" && (
        <div className="mb-2"><ErrorState error={activeQuery.error} retry={() => void activeQuery.refetch()} title={selectedGuest ? "Guest Record could not be confirmed" : "Guest Record search is unavailable"} /></div>
      )}
      {selectedGuest ? (
        <div className="flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
          <InitialAvatar name={selectedGuest.displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{selectedGuest.displayName}</p>
            <p className="truncate text-xs text-base-content/50">{selectedGuest.email || selectedGuest.phone || "Guest Record selected"}</p>
          </div>
          <span className={`badge border-0 ${selectedGuestCurrent ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/60"}`}><Check size={12} />Selected</span>
          {!disabled && <button type="button" className="btn btn-circle btn-ghost btn-sm" onClick={() => { onSelect(null); setSearch(""); }} aria-label={`Remove ${selectedGuest.displayName}`}><X size={16} /></button>}
        </div>
      ) : disabled ? (
        <div className="rounded-lg border border-dashed border-base-300 p-4 text-sm text-base-content/55">Guest record access is required to search profiles.</div>
      ) : (
        <div className="rounded-lg border border-base-300 bg-base-100 p-2">
          <label className="input input-sm flex w-full items-center gap-2 border-0 bg-base-200 focus-within:outline-primary">
            <Search size={15} className="text-base-content/40" />
            <input className="grow" aria-label="Search Guest Records" placeholder="Search by name, email or phone" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {!discovering ? null : !searchSettled || source.state === "loading" ? (
            <div className="flex items-center justify-center gap-2 p-5 text-sm text-base-content/50"><span className="loading loading-spinner loading-sm" />Loading guests</div>
          ) : source.state === "unavailable" ? null : guestItems.length > 0 ? (
            <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
              {guestItems.map((guest) => (
                <button key={guest.guestId} type="button" className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition enabled:hover:bg-base-200 enabled:focus-visible:bg-base-200 disabled:cursor-not-allowed disabled:opacity-65" disabled={!sourceCurrent || !selectionEnabled} onClick={() => onSelect(guest)}>
                  <InitialAvatar name={guest.displayName} size="sm" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{guest.displayName}</span><span className="block truncate text-xs text-base-content/45">{guest.email || guest.phone || "No contact details"}</span></span>
                  <UserRound size={16} className="text-base-content/35" />
                </button>
              ))}
            </div>
          ) : (
            <p className="p-4 text-center text-sm text-base-content/50">No active Guest Records match.</p>
          )}
        </div>
      )}
    </div>
  );
}
