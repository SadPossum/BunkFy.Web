import { useQuery } from "@tanstack/react-query";
import { Check, Search, UserRound, X } from "lucide-react";
import { useDeferredValue, useState } from "react";
import type { GuestListResponse, GuestProfile } from "../../api/types";
import { useSession } from "../../app/session";
import { ErrorState, InitialAvatar } from "../../components/ui/primitives";

export function GuestRecordPicker({ propertyId, selectedGuest, onSelect, label = "Guest record", disabled = false }: {
  propertyId: string;
  selectedGuest: GuestProfile | null;
  onSelect: (guest: GuestProfile | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const { request } = useSession();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const params = new URLSearchParams({ status: "1", page: "1", pageSize: "8" });
  if (deferredSearch) params.set("search", deferredSearch);
  const guests = useQuery({
    queryKey: ["guest-picker", propertyId, deferredSearch],
    queryFn: () => request<GuestListResponse>(`/api/guests/properties/${propertyId}?${params}`),
    enabled: !disabled && !selectedGuest,
    staleTime: 15_000,
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-base-content/45">Optional</span>
      </div>
      {selectedGuest ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
          <InitialAvatar name={selectedGuest.displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{selectedGuest.displayName}</p>
            <p className="truncate text-xs text-base-content/50">{selectedGuest.email || selectedGuest.phone || "Guest Record selected"}</p>
          </div>
          <span className="badge border-0 bg-primary text-primary-content"><Check size={12} />Linked</span>
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
          {guests.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-5 text-sm text-base-content/50"><span className="loading loading-spinner loading-sm" />Loading guests</div>
          ) : guests.error ? (
            <div className="p-2"><ErrorState error={guests.error} retry={() => void guests.refetch()} /></div>
          ) : (guests.data?.guests.length ?? 0) > 0 ? (
            <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
              {guests.data?.guests.map((guest) => (
                <button key={guest.guestId} type="button" className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-base-200 focus-visible:bg-base-200" onClick={() => onSelect(guest)}>
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
