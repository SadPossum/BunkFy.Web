import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { OfflineRequestError, assertRequestCanStart } from "../../api/requestConnectivity";
import { useProductCapabilities } from "../../app/productCapabilities";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { FormSection } from "../../components/ui/FormLayout";
import { PinFields } from "../stations/PinFields";
import type { StationManagementResult, StationOwnPinStatus } from "../stations/stationTypes";
import { readPinChangeIntent, savePinChangeIntent, type PinChangeIntent } from "../stations/pinChangeRecovery";

export function StaffPinPanel() {
  const { staffPinEnabled } = useProductCapabilities();
  const { selectedProperty } = useWorkspace();
  const { session } = useSession();
  if (!staffPinEnabled || !selectedProperty || !session) return null;
  return <OwnPinEditor key={`${session.generation}:${selectedProperty.propertyId}`}
    propertyId={selectedProperty.propertyId} propertyName={selectedProperty.name} />;
}

function OwnPinEditor({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const { request, session } = useSession();
  const endpoint = `/api/station-setup/properties/${propertyId}`;
  const status = useQuery({ queryKey: ["stations", "own-pin", session?.generation, propertyId],
    queryFn: ({ signal }) => request<StationOwnPinStatus>(`${endpoint}/pin`, { signal }),
    retry: false, refetchOnWindowFocus: true });
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const recoveryKey = `bunkfy.pin-change.v1:${session?.subjectId}:${session?.tenantId}:${propertyId}`;
  const [unresolved, setUnresolved] = useState<PinChangeIntent | null>(() => readPinChangeIntent(recoveryKey));
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [message, setMessage] = useState("");
  const usable = status.data?.state === 0 && status.data.status && !status.isFetching && !status.error;
  const pin = status.data?.status;

  function confirmed(result: StationManagementResult) {
    if (result.state !== 0 || result.receipt?.kind !== 15 || !result.receipt.version) throw new Error("The PIN change is not confirmed.");
    try { savePinChangeIntent(recoveryKey, null); } catch { /* The confirmed receipt remains authoritative. */ }
    setUnresolved(null); setRetryAllowed(false); setEditing(false);
    setMessage("PIN saved. Use it at an approved shared station. Your previous station sessions are locked.");
    // Receipt success is terminal. A later read failure must not relabel it as unknown.
    void status.refetch();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!usable || !pin || inFlight.current || (unresolved && !retryAllowed)) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = String(data.get("pin") ?? "");
    if (!/^[0-9]{6}$/.test(value) || value !== data.get("confirmPin")) {
      setMessage("Enter the same 6-digit PIN in both fields."); return;
    }
    inFlight.current = true; setPending(true); setMessage("");
    const intent = unresolved ?? { operationId: crypto.randomUUID(), expectedRevision: pin.revision, startedAt: Date.now() };
    form.reset(); // Never retain the PIN in mutation caches, storage or recovery state.
    let sent = false;
    try {
      assertRequestCanStart({ method: "PUT" });
      savePinChangeIntent(recoveryKey, intent);
      setUnresolved(intent); setRetryAllowed(false);
      sent = true;
      const result = await request<StationManagementResult>(`${endpoint}/pin`, { method: "PUT",
        body: JSON.stringify({ operationId: intent.operationId, expectedRevision: intent.expectedRevision, pin: value }) });
      confirmed(result);
    } catch (error) {
      if (!sent) setMessage(error instanceof OfflineRequestError ? error.message
        : "Your browser cannot save a recovery reference. The PIN change was not sent. Enable session storage and try again.");
      else if (error instanceof ApiError && [400, 403, 409].includes(error.status) && !unresolved) {
        try { savePinChangeIntent(recoveryKey, null); } catch { /* An explicit rejection cannot have applied. */ }
        setUnresolved(null);
        setMessage(error.status === 409 ? "Your PIN changed elsewhere. Refresh its status before trying again."
          : "The server did not allow this PIN change. Refresh your status; if it continues, check your staff registration and recent multi-factor sign-in.");
        await status.refetch();
      } else setMessage("We could not confirm the PIN change. Check its result before starting another change.");
    } finally { inFlight.current = false; setPending(false); }
  }

  async function checkResult() {
    if (!unresolved || inFlight.current) return;
    inFlight.current = true; setPending(true);
    try { confirmed(await request<StationManagementResult>(`${endpoint}/operations/${unresolved.operationId}`)); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setRetryAllowed(true); setEditing(true);
        setMessage("No receipt is available yet. Check again, or re-enter the same PIN to retry the original change. A delayed successful change will not be repeated.");
        await status.refetch();
      } else setMessage("The result is still unavailable. Keep this page open and try Check result again.");
    } finally { inFlight.current = false; setPending(false); }
  }

  return <FormSection title="Staff PIN" icon={<KeyRound size={18} />}
    description={`For shared stations at ${propertyName}. The same PIN applies across your approved properties in this workspace.`}>
    {!usable ? <div className="text-sm leading-6">
      <p>{status.isLoading || status.isFetching ? "Checking PIN status…"
        : "PIN status is unavailable. A manager must register your linked staff profile for shared stations."}</p>
      {!status.isFetching && <button className="btn btn-outline btn-sm mt-3" type="button" onClick={() => void status.refetch()}>Refresh status</button>}
    </div> : !editing && !unresolved ? <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">{pin?.pin === 1 ? "Your PIN is set." : "Set a PIN before using a shared station."}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditing(true); setMessage(""); }}>
        {pin?.pin === 1 ? "Change PIN" : "Set PIN"}</button>
    </div> : null}
    {editing && usable && (!unresolved || retryAllowed) && <form onSubmit={save} className="max-w-xl space-y-4">
      <p className="text-sm leading-6 text-base-content/70">Saving a PIN locks your active station sessions. You’ll need a recent multi-factor sign-in to save.</p>
      <PinFields confirm disabled={pending || !usable} />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="submit" disabled={pending || !usable}>{unresolved ? "Retry original change" : "Save PIN"}</button>
        <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => { setEditing(false); setMessage(""); }}>Cancel</button>
      </div>
    </form>}
    {message && <p className="mt-3 max-w-prose text-sm leading-6" role="status">{message}</p>}
    {unresolved && <button className="btn btn-outline mt-3" type="button" disabled={pending} onClick={() => void checkResult()}>
      {pending ? "Checking…" : "Check result"}</button>}
  </FormSection>;
}
