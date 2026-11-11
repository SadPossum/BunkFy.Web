import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { inventoryKindLabel } from "../../api/labels";
import { useSession } from "../../app/session";
import { loadAllRoomInventory, roomInventoryMatchesProperty } from "../inventory/inventoryApi";
import { describeProposalDifference, sameAssignedSpaces } from "./proposalDifference";

export function ProposalDifference({ value, propertyId, canReadInventory }: {
  value: string | null | undefined;
  propertyId: string;
  canReadInventory: boolean;
}) {
  const { request } = useSession();
  const change = describeProposalDifference(value);
  const spacesChanged = change?.kind === "update"
    && (!change.baseline || !sameAssignedSpaces(change.baseline.inventoryUnitIds, change.incoming.inventoryUnitIds));
  const showSpaces = Boolean(change && (spacesChanged || change.kind === "cancel" && change.baseline));
  const inventory = useQuery({
    queryKey: ["inventory-rooms", propertyId],
    queryFn: ({ signal }) => loadAllRoomInventory(request, propertyId, signal),
    enabled: canReadInventory && showSpaces,
    staleTime: 30_000,
  });
  const labels = new Map<string, string>();
  if (canReadInventory && !inventory.isFetching && !inventory.error && inventory.data
    && roomInventoryMatchesProperty(inventory.data.rooms, propertyId)) {
    for (const room of inventory.data.rooms) for (const unit of room.units) {
      const label = inventoryKindLabel(unit.kind) === "room" ? room.roomName : `${room.roomName} · ${unit.label}`;
      if (label.trim()) labels.set(unit.inventoryUnitId.toLowerCase(), label);
    }
  }
  const shownIds = change?.kind === "update"
    ? [...(change.baseline?.inventoryUnitIds ?? []), ...change.incoming.inventoryUnitIds]
    : change?.baseline?.inventoryUnitIds ?? [];
  const missingNames = showSpaces && shownIds.some(id => !labels.has(id));

  return (
    <section aria-labelledby="proposal-difference-heading" className="min-w-0 space-y-4">
      <div>
        <h3 id="proposal-difference-heading" className="font-display text-lg font-semibold">
          {change?.kind === "cancel" ? "Cancellation requested by source"
            : change ? "Booking update from source" : "Change details unavailable"}
        </h3>
        {change?.kind === "cancel" ? (
          <p className="mt-2 text-sm leading-6 text-base-content/70">
            The source requested cancellation of the linked booking. Accepting this request cancels the booking and releases its reserved spaces.
          </p>
        ) : change ? (
          <p className="mt-2 text-sm leading-6 text-base-content/70">
            Compare with the last accepted source booking. Current staff edits may differ from this source snapshot.
          </p>
        ) : (
          <p className="mt-2 text-sm leading-6 text-base-content/65">
            {value ? "This source change cannot be summarized. Review the recorded technical details before making a decision."
              : "The difference is unavailable or has been removed by retention rules."}
          </p>
        )}
      </div>
      {change?.kind === "update" && (
        <>
          {!change.baseline && <p className="text-sm text-base-content/65">Previous source details are unavailable in this view. Only incoming values can be shown.</p>}
          <div className="overflow-hidden rounded-lg border border-base-300">
            <div className="grid grid-cols-2 gap-3 bg-base-200/60 px-4 py-3 text-xs font-semibold uppercase text-base-content/60">
              <span>Last accepted source</span><span>Incoming update</span>
            </div>
            {(!change.baseline || change.baseline.arrival !== change.incoming.arrival) && (
              <ChangeRow label="Arrival" before={change.baseline ? formatDate(change.baseline.arrival) : undefined} after={formatDate(change.incoming.arrival)} />
            )}
            {(!change.baseline || change.baseline.departure !== change.incoming.departure) && (
              <ChangeRow label="Departure" before={change.baseline ? formatDate(change.baseline.departure) : undefined} after={formatDate(change.incoming.departure)} />
            )}
            {spacesChanged && <ChangeRow label="Assigned spaces" before={change.baseline ? <SpaceNames ids={change.baseline.inventoryUnitIds} labels={labels} /> : undefined} after={<SpaceNames ids={change.incoming.inventoryUnitIds} labels={labels} />} />}
            {change.baseline && change.baseline.arrival === change.incoming.arrival && change.baseline.departure === change.incoming.departure && !spacesChanged && (
              <p className="p-4 text-sm text-base-content/65">Dates and assigned spaces match the last accepted source booking.</p>
            )}
          </div>
          <section aria-labelledby="proposal-guest-heading" className="rounded-lg border border-base-300 p-4">
            <h4 id="proposal-guest-heading" className="font-semibold">Incoming booking details</h4>
            <p className="mt-1 text-xs leading-5 text-base-content/55">Earlier guest and arrival-time details are not recorded in the source baseline.</p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Detail label="Guest" value={change.incoming.primaryGuestName} />
              <Detail label="Guests" value={change.incoming.guestCount?.toString()} />
              <Detail label="Email" value={change.incoming.email} /><Detail label="Phone" value={change.incoming.phone} />
              <Detail label="Expected arrival time" value={change.incoming.expectedArrivalTime} />
              <Detail label="Expected departure time" value={change.incoming.expectedDepartureTime} />
              <Detail label="Notes" value={change.incoming.notes} />
            </dl>
          </section>
        </>
      )}
      {change?.kind === "cancel" && change.baseline && (
        <div className="rounded-lg border border-base-300 p-4">
          <p className="text-xs font-semibold uppercase text-base-content/55">Last accepted source stay</p>
          <p className="mt-2 text-sm font-semibold">{formatDate(change.baseline.arrival)} → {formatDate(change.baseline.departure)}</p>
          <div className="mt-2 text-sm"><SpaceNames ids={change.baseline.inventoryUnitIds} labels={labels} /></div>
        </div>
      )}
      {change?.kind === "cancel" && !change.baseline && <p className="text-sm text-base-content/65">Previous source stay details are unavailable in this view. Open the linked reservation to check the booking.</p>}
      {missingNames && <p className="text-xs leading-5 text-base-content/60">
        {!canReadInventory ? "Room or bed names require inventory access. Space references are shown."
          : inventory.isFetching ? "Confirming room or bed names. Space references are shown for now."
            : "Room or bed names are unavailable. Space references are shown."}
        {canReadInventory && !inventory.isFetching && <button type="button" className="btn btn-link btn-xs h-auto px-1" onClick={() => void inventory.refetch()}>Refresh space names</button>}
      </p>}
      {showSpaces && shownIds.some(id => labels.has(id)) && <p className="text-xs leading-5 text-base-content/55">Room and bed names come from the current inventory directory.</p>}
      {change?.hasAdditionalFields && <p className="text-sm text-base-content/65">Additional source fields are recorded in Technical details. Review them before deciding.</p>}
      {value && (
        <details className="rounded-lg border border-base-300 bg-base-200/40" open={!change || change.hasAdditionalFields}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Technical details</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-4 pt-0 font-mono text-xs leading-6 text-base-content/70 [overflow-wrap:anywhere]">{value}</pre>
        </details>
      )}
    </section>
  );
}

function ChangeRow({ label, before, after }: { label: string; before?: ReactNode; after: ReactNode }) {
  return <div className="border-t border-base-300 px-4 py-3">
    <p className="text-xs font-semibold text-base-content/55">{label}</p>
    <div className="mt-2 grid grid-cols-2 gap-3 text-sm [overflow-wrap:anywhere]"><div>{before ?? <span className="text-base-content/50">Not recorded</span>}</div><div className="font-semibold">{after}</div></div>
  </div>;
}

function SpaceNames({ ids, labels }: { ids: string[]; labels: Map<string, string> }) {
  return <ul className="space-y-1 [overflow-wrap:anywhere]">{ids.map(id => <li key={id}>{labels.get(id) ?? `Space ${id}`}</li>)}</ul>;
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return <div className="min-w-0"><dt className="text-xs text-base-content/55">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm font-medium [overflow-wrap:anywhere]">{value?.trim() ? value : "Not set"}</dd></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value + "T00:00:00Z"));
}
