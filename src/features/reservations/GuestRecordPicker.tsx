import { useQuery } from "@tanstack/react-query";
import { Check, Search, UserRound, X } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import type { GuestListItem, GuestListResponse } from "../../api/types";
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
  const params = new URLSearchParams({ status: "1", page: "1", pageSize: "8" });
  if (deferredSearch) params.set("search", deferredSearch);
  const guests = useQuery({
    queryKey: ["guest-picker", propertyId, deferredSearch],
    queryFn: () => request<GuestListResponse>(`/api/guests/properties/${propertyId}?${params}`),
    enabled: !disabled,
    staleTime: 15_000,
  });
  const source = createCompositeSource({
    label: "Guest Record directory",
    hasData: guests.data !== undefined,
    isLoading: guests.isLoading,
    error: guests.error,
    isFetching: guests.isFetching,
    refetch: () => guests.refetch(),
  });
  const sourceUsable = compositeSourceUsable(source.state);
  const sourceCurrent = compositeSourceCurrent(source);
  const guestItems = sourceUsable ? guests.data?.guests ?? [] : [];
  const selectedGuestCurrent = Boolean(
    selectedGuest && sourceCurrent &&
      guestCandidateIsCurrent(guestItems, selectedGuest),
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
      {!disabled && (
        <CompositeSourceNotice
          className="mb-2"
          sources={[source]}
          title="Guest Record results are delayed"
        />
      )}
      {selectedGuest ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
          <InitialAvatar name={selectedGuest.displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{selectedGuest.displayName}</p>
            <p className="truncate text-xs text-base-content/50">{selectedGuest.email || selectedGuest.phone || "Guest Record selected"}</p>
          </div>
          <span className={`badge border-0 ${selectedGuestCurrent ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/60"}`}><Check size={12} />Selected</span>
          {!disabled && <button type="button" className="btn btn-circle btn-ghost btn-sm" onClick={() => { onSelect(null); setSearch(""); }} aria-label={`Remove ${selectedGuest.displayName}`}><X size={16} /></button>}
        </div>
      ) : disabled ? (
        <div className="rounded-xl border border-dashed border-base-300 p-4 text-sm text-base-content/55">Guest Records access is required to search profiles.</div>
      ) : (
        <div className="rounded-xl border border-base-300 bg-base-100 p-2">
          <label className="input input-sm flex w-full items-center gap-2 border-0 bg-base-200 focus-within:outline-primary">
            <Search size={15} className="text-base-content/40" />
            <input className="grow" aria-label="Search Guest Records" placeholder="Search by name, email or phone" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {source.state === "loading" ? (
            <div className="flex items-center justify-center gap-2 p-5 text-sm text-base-content/50"><span className="loading loading-spinner loading-sm" />Loading guests</div>
          ) : source.state === "unavailable" ? (
            <div className="p-2"><ErrorState error={guests.error} retry={() => void guests.refetch()} /></div>
          ) : guestItems.length > 0 ? (
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
            <p className="p-4 text-center text-sm text-base-content/50">{deferredSearch ? "No active Guest Records match." : "No active Guest Records yet."}</p>
          )}
        </div>
      )}
    </div>
  );
}
