import { useId } from "react";

type FailureKind = "receipt" | "run" | "reprocessing";
type FailureCopy = { title: string; message: string };

const setupMissing: FailureCopy = {
  title: "Connection setup needs attention",
  message: "BunkFy couldn't find the prepared settings for this connection. Ask your administrator to check its configuration and credential references.",
};
const sourceUnreadable: FailureCopy = {
  title: "Original source data could not be read",
  message: "The retained source data was missing or didn't match its recorded copy. Ask the person who manages this connection to review the source and receipt before another attempt.",
};
const readerMismatch: FailureCopy = {
  title: "Selected reader was unavailable",
  message: "The selected parser or version wasn't available for this attempt. Ask your administrator to check the reader installed on the worker.",
};
const rejectedUpdates: FailureCopy = {
  title: "Some source updates were rejected",
  message: "Review the source's submission errors and any recorded receipts with the connection administrator before running it again.",
};

// Runs normalize codes to lowercase; receipts retain the original code. Match
// exact identifiers in either form and preserve the recorded text for support.
const knownFailures: ReadonlyMap<string, FailureCopy> = new Map([
  ["ingestion.reservationsourcenotlinked", {
    title: "Booking wasn't linked to this source",
    message: "BunkFy couldn't apply this cancellation because the source record wasn't linked to a booking. Check the connection and external booking reference, and confirm that the original booking was imported.",
  }],
  ["ingestion.normalizedreservationobservationinvalid", {
    title: "Booking data could not be read",
    message: "The source update didn't match the booking format BunkFy accepts. Ask the connection administrator to check the booking details supplied by the source.",
  }],
  ["ingestion.adapterconfigurationmaterialnotfound", setupMissing],
  ["ingestion.adapterconfigurationreferenceinvalid", {
    title: "Connection setup needs attention",
    message: "The connection's setup reference wasn't valid. Ask your administrator to check its configuration reference.",
  }],
  ["ingestion.adapterconfigurationschemamismatch", {
    title: "Connection setup needs attention",
    message: "The prepared settings used a version this connector couldn't read. Ask your administrator to update the connector setup.",
  }],
  ["ingestion.adapterconfigurationmaterialinvalid", {
    title: "Connection setup needs attention",
    message: "BunkFy couldn't read the prepared settings for this connection. Ask your administrator to review the connector setup.",
  }],
  ["ingestion.reservationbaselineunavailable", {
    title: "Booking history needs review",
    message: "BunkFy couldn't find a previously accepted import to compare with this update. Ask the connection administrator to review the linked booking and its import history.",
  }],
  ["ingestion.rawpayloadinvalid", sourceUnreadable],
  ["ingestion.reprocessingrawpayloadinvalid", sourceUnreadable],
  ["ingestion.rawpayloadunavailable", {
    title: "Original source data is no longer retained",
    message: "The original source data has been removed and can't be read from this receipt. Ask your administrator whether the original source has the information you need.",
  }],
  ["ingestion.reprocessingparsernotregistered", readerMismatch],
  ["ingestion.reprocessingparsermismatch", readerMismatch],
  ["ingestion.reprocessingparsersourceunsupported", {
    title: "Selected reader doesn't support this source",
    message: "This parser couldn't process the source's record format. Ask the connection administrator to check the selected parser and source type.",
  }],
  ["ingestion.connectionnotenabled", {
    title: "Connection was disabled",
    message: "This connection wasn't accepting source updates when the operation ran. Ask the connection administrator to review its status before another attempt.",
  }],
  ["imap.observation-rejected", rejectedUpdates],
  ["fake-http.observation-rejected", rejectedUpdates],
]);

const fallback: Record<FailureKind, FailureCopy> = {
  receipt: {
    title: "Source update needs attention",
    message: "This update couldn't be processed. Review its technical details with the person who manages this connection.",
  },
  run: {
    title: "Run needs attention",
    message: "Review the accepted and rejected counts, any recorded receipts, and the technical details with the person who manages this connection before running the source again.",
  },
  reprocessing: {
    title: "Reprocessing needs attention",
    message: "Review the recorded outputs and technical details with the person who manages this connection before starting another attempt.",
  },
};

export function IngestionFailure({ reason, kind }: { reason?: string | null; kind: FailureKind }) {
  const headingId = useId();
  const copy = knownFailures.get(reason?.trim().toLowerCase() ?? "") ?? fallback[kind];
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-lg border border-error/20 bg-error/8 p-4">
      <h3 id={headingId} className="font-semibold">{copy.title}</h3>
      <p className="mt-2 text-sm leading-6 text-base-content/75">{copy.message}</p>
      <details className="mt-3 min-w-0 text-sm">
        <summary className="cursor-pointer font-medium">Technical details</summary>
        {reason?.trim() ? (
          <code className="mt-2 block whitespace-pre-wrap break-all font-mono text-xs leading-5 text-base-content/65">{reason}</code>
        ) : (
          <p className="mt-2 text-xs text-base-content/65">No technical reason was recorded for this item.</p>
        )}
      </details>
    </section>
  );
}
