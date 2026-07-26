import { useMutation } from "@tanstack/react-query";
import { Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  DataRightsCase,
  DataRightsSelectedSubjectsResponse,
  DataRightsSubjectCandidate,
  DataRightsSubjectDiscoveryResponse,
} from "../../api/types";
import { useSession } from "../../app/session";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { ErrorState } from "../../components/ui/primitives";

type LookupKind = "recordId" | "email" | "phone";

export function PrivacyRequestDiscovery({
  propertyId,
  dataRightsCase,
  selected,
  selectedLoading,
  onCaseUpdated,
  refreshSelected,
}: {
  propertyId: string;
  dataRightsCase: DataRightsCase;
  selected: DataRightsSelectedSubjectsResponse | undefined;
  selectedLoading: boolean;
  onCaseUpdated: (updated: DataRightsCase) => Promise<void>;
  refreshSelected: () => Promise<unknown>;
}) {
  const { request } = useSession();
  const [lookupKind, setLookupKind] = useState<LookupKind>("recordId");
  const [lookup, setLookup] = useState("");
  const [name, setName] = useState("");
  const [candidates, setCandidates] = useState<DataRightsSubjectCandidate[]>([]);
  const selectedSubject = selected?.subjects[0];
  const discover = useMutation({
    mutationFn: () => request<DataRightsSubjectDiscoveryResponse>(
      `/api/data-rights/properties/${propertyId}/cases/${dataRightsCase.id}/subjects/discover`,
      {
        method: "POST",
        body: JSON.stringify({
          recordId: lookupKind === "recordId" ? lookup.trim() : null,
          email: lookupKind === "email" ? lookup.trim() : null,
          phone: lookupKind === "phone" ? lookup.trim() : null,
          name: name.trim() || null,
          dateOfBirth: null,
          ownerKey: "reservations",
        }),
      },
    ),
    onSuccess: (response) => setCandidates(response.candidates),
  });
  const select = useMutation({
    mutationFn: (candidate: DataRightsSubjectCandidate) => request<DataRightsCase>(
      `/api/data-rights/properties/${propertyId}/cases/${dataRightsCase.id}/subjects/select`,
      {
        method: "POST",
        body: JSON.stringify({
          coordinate: candidate.coordinate,
          expectedVersion: dataRightsCase.version,
        }),
      },
    ),
    onSuccess: async (updated) => {
      setCandidates([]);
      await onCaseUpdated(updated);
      await refreshSelected();
    },
  });
  const unselect = useMutation({
    mutationFn: () => request<DataRightsCase>(
      `/api/data-rights/properties/${propertyId}/cases/${dataRightsCase.id}/subjects/unselect`,
      {
        method: "POST",
        body: JSON.stringify({
          coordinate: {
            ownerKey: selectedSubject?.ownerKey,
            recordType: selectedSubject?.recordType,
            recordId: selectedSubject?.recordId,
          },
          expectedVersion: dataRightsCase.version,
        }),
      },
    ),
    onSuccess: async (updated) => {
      await onCaseUpdated(updated);
      await refreshSelected();
    },
  });

  useEffect(() => {
    setLookupKind("recordId");
    setLookup("");
    setName("");
    setCandidates([]);
  }, [dataRightsCase.id, propertyId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCandidates([]);
    discover.mutate();
  }

  return (
    <section className="border-t border-base-300 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Reservation match</h3>
          <p className="mt-1 text-sm text-base-content/55">
            Search one exact identifier. Contact details remain masked in the results.
          </p>
        </div>
        {selectedSubject && (
          <span className="inline-flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-semibold text-success">
            <ShieldCheck size={15} />
            One reservation selected
          </span>
        )}
      </div>

      {dataRightsCase.selectedSubjectCount > 0 && selectedLoading && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-base-200 px-4 py-4 text-sm text-base-content/55">
          <span className="loading loading-spinner loading-sm text-primary" />
          Loading selected reservation
        </div>
      )}

      {selectedSubject
        ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-success/25 bg-success/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Reservation {shortRecordId(selectedSubject.recordId)}</p>
              <p className="mt-1 text-xs text-base-content/50">
                Selection version {selectedSubject.recordVersion} - matched {formatDateTime(selectedSubject.selectedAtUtc)}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost text-error"
              disabled={unselect.isPending}
              onClick={() => unselect.mutate()}
            >
              <Trash2 size={15} />
              Remove selection
            </button>
          </div>
        )
        : dataRightsCase.selectedSubjectCount === 0 && (
          <form className="mt-4 space-y-4" onSubmit={submit}>
            <SegmentedTabs
              value={lookupKind}
              ariaLabel="Reservation lookup type"
              onValueChange={(value) => {
                setLookupKind(value);
                setLookup("");
                setCandidates([]);
              }}
              options={[
                { value: "recordId", label: "Reservation ID" },
                { value: "email", label: "Email" },
                { value: "phone", label: "Phone" },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <label className="form-control block">
                <span className="label-text mb-1.5 block text-sm font-semibold">
                  {lookupLabel(lookupKind)}
                </span>
                <input
                  className="input input-bordered w-full"
                  type={lookupKind === "email" ? "email" : "text"}
                  value={lookup}
                  onChange={(event) => setLookup(event.target.value)}
                  placeholder={lookupPlaceholder(lookupKind)}
                  required
                />
              </label>
              <label className="form-control block">
                <span className="label-text mb-1.5 block text-sm font-semibold">Guest name (optional)</span>
                <input
                  className="input input-bordered w-full"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Used only to narrow the match"
                />
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={discover.isPending || !lookup.trim()}
              >
                {discover.isPending
                  ? <span className="loading loading-spinner loading-sm" />
                  : <Search size={16} />}
                Search
              </button>
            </div>
          </form>
        )}

      {(discover.error || select.error || unselect.error) && (
        <div className="mt-4">
          <ErrorState error={discover.error ?? select.error ?? unselect.error} />
        </div>
      )}

      {!selectedSubject && candidates.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {candidates.map((candidate) => (
            <button
              key={`${candidate.coordinate.recordType}:${candidate.coordinate.recordId}`}
              type="button"
              className="rounded-lg border border-base-300 bg-base-100 p-4 text-left transition hover:border-primary/40 hover:bg-primary/5 focus-visible:border-primary"
              disabled={select.isPending}
              onClick={() => select.mutate(candidate)}
            >
              <span className="block font-semibold">{candidate.displayName}</span>
              <span className="mt-2 block text-xs leading-5 text-base-content/50">
                {candidate.emailHint || "No email hint"}
                <br />
                {candidate.phoneHint || "No phone hint"}
              </span>
              <span className="mt-3 block text-xs font-semibold text-primary">
                Select reservation {shortRecordId(candidate.coordinate.recordId)}
              </span>
            </button>
          ))}
        </div>
      )}

      {!selectedSubject && discover.isSuccess && candidates.length === 0 && (
        <p className="mt-4 rounded-lg bg-base-200 px-4 py-3 text-sm text-base-content/55">
          No reservation matched that exact identifier in this property.
        </p>
      )}
    </section>
  );
}

function lookupLabel(kind: LookupKind): string {
  if (kind === "recordId") return "Reservation ID";
  if (kind === "email") return "Booking email";
  return "Booking phone";
}

function lookupPlaceholder(kind: LookupKind): string {
  if (kind === "recordId") return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  if (kind === "email") return "guest@example.com";
  return "+44 20 1234 5678";
}

function shortRecordId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
