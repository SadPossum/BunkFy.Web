import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  DataRightsCase,
  DataRightsSelectedSubject,
  DataRightsSelectedSubjectsResponse,
  DataRightsSubjectCandidate,
  DataRightsSubjectDiscoveryResponse,
} from "../../api/types";
import { useSession } from "../../app/session";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { ErrorState } from "../../components/ui/primitives";
import {
  createDataRightsDiscoveryAttempt,
  isDataRightsDiscoveryAttemptCurrent,
  type DataRightsDiscoveryAttempt,
  type DataRightsDiscoveryCriteria,
  type DataRightsDiscoveryLookupKind,
  type DataRightsDiscoveryOwner,
} from "./dataRightsDiscoveryAttempt";
import { PrivacyRequestRestrictionTarget } from "./PrivacyRequestRestrictionTarget";
import {
  dataRightsOperationKind,
  isDataRightsRestriction,
} from "./dataRightsWorkflow";

const ownerOptions = [
  { value: "guests", label: "Guest record" },
  { value: "reservations", label: "Reservation" },
  { value: "ingestion", label: "Source evidence" },
] as const;

export function PrivacyRequestDiscovery({
  basePath,
  scopeKind,
  dataRightsCase,
  selected,
  selectedLoading,
  onCaseUpdated,
  refreshSelected,
  refreshCase,
  onRestrictionTargetCurrentChange,
}: {
  basePath: string;
  scopeKind: "guest" | "staff";
  dataRightsCase: DataRightsCase;
  selected: DataRightsSelectedSubjectsResponse | undefined;
  selectedLoading: boolean;
  onCaseUpdated: (updated: DataRightsCase) => Promise<void>;
  refreshSelected: () => Promise<unknown>;
  refreshCase: () => Promise<unknown>;
  onRestrictionTargetCurrentChange: (current: boolean) => void;
}) {
  const { request } = useSession();
  const restriction = isDataRightsRestriction(dataRightsCase);
  const targetBoundRelease =
    dataRightsOperationKind(dataRightsCase) === "restriction-release" &&
    dataRightsCase.restrictionTargetingContractVersion !== null &&
    dataRightsCase.restrictionTargetingContractVersion !== undefined;
  const singleSubject = scopeKind === "staff" || restriction;
  const [ownerKey, setOwnerKey] = useState<DataRightsDiscoveryOwner>(
    scopeKind === "staff" ? "staff" : restriction ? "guests" : "reservations",
  );
  const [lookupKind, setLookupKind] = useState<DataRightsDiscoveryLookupKind>("recordId");
  const [lookup, setLookup] = useState("");
  const [name, setName] = useState("");
  const discoveryGeneration = useRef(0);
  const discoveryController = useRef<AbortController | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<{
    attempt: DataRightsDiscoveryAttempt;
    response: DataRightsSubjectDiscoveryResponse;
  } | null>(null);
  const [discoveryError, setDiscoveryError] = useState<unknown>(null);
  const selectedSubjects = selected?.subjects ?? [];
  const discoveryCriteria: DataRightsDiscoveryCriteria = {
    caseId: dataRightsCase.id,
    caseVersion: dataRightsCase.version,
    scopeKind,
    ownerKey,
    lookupKind,
    lookup,
    name,
  };
  const discoveryCriteriaRef = useRef(discoveryCriteria);
  discoveryCriteriaRef.current = discoveryCriteria;
  const visibleDiscovery = discoveryResult &&
      isDataRightsDiscoveryAttemptCurrent(
        discoveryResult.attempt,
        discoveryCriteria,
        discoveryGeneration.current,
      )
    ? discoveryResult.response
    : null;
  const candidates = visibleDiscovery?.candidates ?? [];
  const discover = useMutation({
    mutationFn: ({
      attempt,
      controller,
    }: {
      attempt: DataRightsDiscoveryAttempt;
      controller: AbortController;
    }) => request<DataRightsSubjectDiscoveryResponse>(
      `${basePath}/subjects/discover`,
      {
        method: "POST",
        body: JSON.stringify(attempt.request),
        signal: controller.signal,
      },
    ),
    onSuccess: (response, { attempt, controller }) => {
      if (discoveryController.current === controller) {
        discoveryController.current = null;
      }
      if (!isDataRightsDiscoveryAttemptCurrent(
        attempt,
        discoveryCriteriaRef.current,
        discoveryGeneration.current,
      )) return;
      setDiscoveryError(null);
      setDiscoveryResult({ attempt, response });
    },
    onError: (error, { attempt, controller }) => {
      if (discoveryController.current === controller) {
        discoveryController.current = null;
      }
      if (controller.signal.aborted || !isDataRightsDiscoveryAttemptCurrent(
        attempt,
        discoveryCriteriaRef.current,
        discoveryGeneration.current,
      )) return;
      setDiscoveryError(error);
    },
  });
  const select = useMutation({
    mutationFn: (candidate: DataRightsSubjectCandidate) => request<DataRightsCase>(
      `${basePath}/subjects/select`,
      {
        method: "POST",
        body: JSON.stringify({
          coordinate: candidate.coordinate,
          expectedVersion: dataRightsCase.version,
        }),
      },
    ),
    onSuccess: async (updated) => {
      clearDiscovery();
      await onCaseUpdated(updated);
      await refreshSelected();
    },
  });
  const unselect = useMutation({
    mutationFn: (subject: DataRightsSelectedSubject) => request<DataRightsCase>(
      `${basePath}/subjects/unselect`,
      {
        method: "POST",
        body: JSON.stringify({
          coordinate: {
            ownerKey: subject.ownerKey,
            recordType: subject.recordType,
            recordId: subject.recordId,
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
    clearDiscovery();
    setOwnerKey(scopeKind === "staff" ? "staff" : restriction ? "guests" : "reservations");
    setLookupKind("recordId");
    setLookup("");
    setName("");
  }, [dataRightsCase.id, restriction, scopeKind]);

  useEffect(() => {
    clearDiscovery();
  }, [dataRightsCase.version]);

  useEffect(() => () => {
    discoveryGeneration.current += 1;
    const controller = discoveryController.current;
    discoveryController.current = null;
    if (controller) controller.abort();
  }, []);

  function clearDiscovery() {
    discoveryGeneration.current += 1;
    const controller = discoveryController.current;
    discoveryController.current = null;
    if (controller) controller.abort();
    setDiscoveryResult(null);
    setDiscoveryError(null);
    discover.reset();
  }

  function changeOwner(nextOwner: DataRightsDiscoveryOwner) {
    clearDiscovery();
    setOwnerKey(nextOwner);
    setLookupKind("recordId");
    setLookup("");
    setName("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearDiscovery();
    const controller = new AbortController();
    const attempt = createDataRightsDiscoveryAttempt(
      discoveryCriteriaRef.current,
      discoveryGeneration.current,
    );
    discoveryController.current = controller;
    discover.mutate({ attempt, controller });
  }

  return (
    <section className="border-t border-base-300 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Data subject match</h3>
          <p className="mt-1 max-w-2xl text-sm text-base-content/55">
            {scopeKind === "staff"
              ? "Select one staff profile using its exact Staff ID or exact account subject ID. Contact details remain masked."
              : restriction
                ? "Select exactly one Guest Record. Processing limits stay owned and enforced by the Guests module."
                : "Select only records confirmed to belong to this request. Contact details stay masked, and source evidence is found only through an exact reservation ID."}
          </p>
        </div>
        {dataRightsCase.selectedSubjectCount > 0 && (
          <span className="inline-flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-semibold text-success">
            <ShieldCheck size={15} />
            {selectionCountLabel(dataRightsCase.selectedSubjectCount)}
          </span>
        )}
      </div>

      {dataRightsCase.selectedSubjectCount > 0 && selectedLoading && !selectedSubjects.length && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-base-200 px-4 py-4 text-sm text-base-content/55">
          <span className="loading loading-spinner loading-sm text-primary" />
          Loading selected records
        </div>
      )}

      {selectedSubjects.length > 0 && (
        <div className="mt-4 divide-y divide-base-300 rounded-lg border border-success/25 bg-success/5">
          {selectedSubjects.map((subject) => (
            <div
              key={subjectKey(subject)}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold">
                  {dataOwnerLabel(subject.ownerKey)} {shortRecordId(subject.recordId)}
                </p>
                <p className="mt-1 text-xs text-base-content/50">
                  Record version {subject.recordVersion} - selected {formatDateTime(subject.selectedAtUtc)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost text-error"
                disabled={unselect.isPending || select.isPending}
                onClick={() => unselect.mutate(subject)}
              >
                <Trash2 size={15} />
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {targetBoundRelease && dataRightsCase.selectedSubjectCount === 1 && (
        <PrivacyRequestRestrictionTarget
          basePath={basePath}
          dataRightsCase={dataRightsCase}
          onCaseUpdated={onCaseUpdated}
          refreshCase={refreshCase}
          onCurrentChange={onRestrictionTargetCurrentChange}
        />
      )}

      {singleSubject && dataRightsCase.selectedSubjectCount === 1
        ? (
          <p className="mt-5 rounded-lg border border-success/20 bg-success/8 px-4 py-3 text-sm text-base-content/65">
            {scopeKind === "staff"
              ? "The required Staff profile is selected. Remove it first if this request points to the wrong person."
              : "The required Guest Record is selected. Remove it first if this request points to the wrong guest."}
          </p>
        )
        : (
          <form className="mt-5 space-y-4" onSubmit={submit}>
        {scopeKind === "guest" && !restriction && (
          <div>
            <span className="mb-2 block text-sm font-semibold">Record owner</span>
            <SegmentedTabs
              value={ownerKey}
              ariaLabel="Data record owner"
              stretch
              onValueChange={changeOwner}
              options={ownerOptions}
            />
          </div>
        )}

        {scopeKind === "staff" && (
          <SegmentedTabs
            value={lookupKind}
            ariaLabel="Staff lookup type"
            onValueChange={(value) => {
              clearDiscovery();
              setLookupKind(value);
              setLookup("");
            }}
            options={[
              { value: "recordId", label: "Staff ID" },
              { value: "accountSubjectId", label: "Account subject ID" },
            ]}
          />
        )}

        {scopeKind === "guest" && ownerKey !== "ingestion" && (
          <SegmentedTabs
            value={lookupKind}
            ariaLabel={`${dataOwnerLabel(ownerKey)} lookup type`}
            onValueChange={(value) => {
              clearDiscovery();
              setLookupKind(value);
              setLookup("");
            }}
            options={[
              { value: "recordId", label: ownerKey === "guests" ? "Guest ID" : "Reservation ID" },
              { value: "email", label: "Email" },
              { value: "phone", label: "Phone" },
            ]}
          />
        )}

        <div className={`grid gap-3 sm:items-end ${
          scopeKind === "staff" || ownerKey === "ingestion"
            ? "sm:grid-cols-[minmax(0,1fr)_auto]"
            : "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        }`}>
          <label className="form-control block">
            <span className="label-text mb-1.5 block text-sm font-semibold">
              {lookupLabel(ownerKey, lookupKind)}
            </span>
            <input
              className="input input-bordered w-full"
              type={lookupKind === "email" ? "email" : "text"}
              value={lookup}
              onChange={(event) => {
                clearDiscovery();
                setLookup(event.target.value);
              }}
              placeholder={lookupPlaceholder(lookupKind)}
              required
            />
          </label>
          {scopeKind === "guest" && ownerKey !== "ingestion" && (
            <label className="form-control block">
              <span className="label-text mb-1.5 block text-sm font-semibold">
                Guest name (optional)
              </span>
              <input
                className="input input-bordered w-full"
                value={name}
                onChange={(event) => {
                  clearDiscovery();
                  setName(event.target.value);
                }}
                placeholder="Used only to narrow the match"
              />
            </label>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={discover.isPending || select.isPending || unselect.isPending || !lookup.trim()}
          >
            {discover.isPending
              ? <span className="loading loading-spinner loading-sm" />
              : <Search size={16} />}
            Search
          </button>
        </div>
          </form>
        )}

      {(discoveryError || select.error || unselect.error) && (
        <div className="mt-4">
          <ErrorState error={discoveryError ?? select.error ?? unselect.error} />
        </div>
      )}

      {visibleDiscovery?.limitReached && candidates.length > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-base-content/65">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" />
          <p>
            The result limit was reached. Refine the exact identifier if the expected record is not shown.
          </p>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {candidates.map((candidate) => (
            <CandidateButton
              key={candidateKey(candidate)}
              candidate={candidate}
              alreadySelected={selectedSubjects.some((subject) =>
                subject.ownerKey === candidate.coordinate.ownerKey &&
                subject.recordType === candidate.coordinate.recordType &&
                subject.recordId === candidate.coordinate.recordId)}
              contactHintsVisible={ownerKey !== "ingestion"}
              disabled={
                select.isPending ||
                unselect.isPending ||
                (singleSubject && dataRightsCase.selectedSubjectCount >= 1)
              }
              onSelect={() => select.mutate(candidate)}
            />
          ))}
        </div>
      )}

      {visibleDiscovery && visibleDiscovery.candidates.length === 0 && (
        <p className="mt-4 rounded-lg bg-base-200 px-4 py-3 text-sm text-base-content/55">
          No {dataOwnerLabel(ownerKey).toLowerCase()} matched that exact identifier
          {scopeKind === "guest" ? " in this property" : " in this workspace"}.
        </p>
      )}
    </section>
  );
}

function CandidateButton({
  candidate,
  alreadySelected,
  contactHintsVisible,
  disabled,
  onSelect,
}: {
  candidate: DataRightsSubjectCandidate;
  alreadySelected: boolean;
  contactHintsVisible: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-lg border border-base-300 bg-base-100 p-4 text-left transition hover:border-primary/40 hover:bg-primary/5 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-55"
      disabled={disabled || alreadySelected}
      onClick={onSelect}
    >
      <span className="block font-semibold">{candidate.displayName}</span>
      {contactHintsVisible && (
        <span className="mt-2 block text-xs leading-5 text-base-content/50">
          {candidate.emailHint || "No email hint"}
          <br />
          {candidate.phoneHint || "No phone hint"}
        </span>
      )}
      <span className="mt-3 block text-xs font-semibold text-primary">
        {alreadySelected
          ? "Already selected"
          : (
            <>
              Select {dataOwnerLabel(candidate.coordinate.ownerKey).toLowerCase()}{" "}
              {shortRecordId(candidate.coordinate.recordId)}
            </>
          )}
      </span>
    </button>
  );
}

function lookupLabel(
  owner: DataRightsDiscoveryOwner,
  kind: DataRightsDiscoveryLookupKind,
): string {
  if (owner === "staff") {
    return kind === "accountSubjectId" ? "Account subject ID" : "Staff ID";
  }
  if (owner === "ingestion") return "Reservation ID";
  if (kind === "recordId") return owner === "guests" ? "Guest ID" : "Reservation ID";
  if (kind === "email") return owner === "guests" ? "Guest email" : "Booking email";
  return owner === "guests" ? "Guest phone" : "Booking phone";
}

function lookupPlaceholder(kind: DataRightsDiscoveryLookupKind): string {
  if (kind === "accountSubjectId") return "Exact authentication subject ID";
  if (kind === "recordId") return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  if (kind === "email") return "guest@example.com";
  return "+44 20 1234 5678";
}

function dataOwnerLabel(ownerKey: string): string {
  if (ownerKey === "staff") return "Staff profile";
  if (ownerKey === "guests") return "Guest record";
  if (ownerKey === "reservations") return "Reservation";
  if (ownerKey === "ingestion") return "Source evidence";
  return "Data record";
}

function selectionCountLabel(count: number): string {
  return `${count} ${count === 1 ? "record" : "records"} selected`;
}

function subjectKey(subject: DataRightsSelectedSubject): string {
  return `${subject.ownerKey}:${subject.recordType}:${subject.recordId}`;
}

function candidateKey(candidate: DataRightsSubjectCandidate): string {
  return `${candidate.coordinate.ownerKey}:${candidate.coordinate.recordType}:${candidate.coordinate.recordId}`;
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
