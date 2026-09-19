import { useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { readReservationRecovery } from "./reservationCreationRecovery";

type AccessRecoveryOwner = {
  identity: string;
  phase: "normal" | "reset" | "fresh";
  revision: number;
  pendingEditor: string | null;
  admittedScope: string | null;
};

type CreateAccessDecision = { scope: string; complete: boolean; current: boolean; allowed: boolean };

// This owner contains no form fields. It survives protected query-cache scrubbing,
// but belongs only to the current open editor's actor, session and property.
export function useReservationAccessRecovery(identity: string, open: boolean, error: unknown, freshEntryAllowed: boolean, decision: CreateAccessDecision) {
  const activeIdentity = open ? identity : "";
  const [stored, setOwner] = useState<AccessRecoveryOwner>({ identity: activeIdentity, phase: "normal", revision: 0, pendingEditor: null, admittedScope: null });
  let owner = stored.identity === activeIdentity ? stored
    : { identity: activeIdentity, phase: "normal" as const, revision: stored.revision + 1, pendingEditor: null, admittedScope: null };
  // Missing response keys or a changed registration cannot establish a denial
  // of this editor. Cached error/refetch states never create a decision edge.
  if (owner.admittedScope && (!decision.complete || owner.admittedScope !== decision.scope)) {
    owner = { ...owner, admittedScope: null };
  }
  const explicitlyDenied = decision.complete && decision.current && !error && !decision.allowed
    && Boolean(decision.scope) && owner.admittedScope === decision.scope;
  if (activeIdentity && owner.phase !== "reset"
    && ((error instanceof ApiError && error.status === 403) || explicitlyDenied)) {
    owner = { ...owner, phase: "reset", revision: owner.revision + 1, admittedScope: null };
  } else if (activeIdentity && owner.phase !== "reset" && freshEntryAllowed && decision.complete
    && decision.current && !error && decision.allowed && decision.scope && owner.admittedScope !== decision.scope) {
    owner = { ...owner, admittedScope: decision.scope };
  }
  // Adjust before rendering children: a rejected editor must never commit again
  // while the provider's layout effect removes its protected property snapshot.
  if (owner !== stored) setOwner(owner);
  const editorKey = `${identity}:${owner.revision}:${owner.phase}`;
  const latest = useRef({ identity: activeIdentity, editorKey, freshEntryAllowed });
  latest.current = { identity: activeIdentity, editorKey, freshEntryAllowed };

  return {
    phase: owner.phase,
    editorKey,
    pending: Boolean(owner.pendingEditor),
    setSavePending: (pending: boolean) => setOwner((current) => {
      if (current.identity !== activeIdentity || !activeIdentity) return current;
      if (pending) return latest.current.editorKey === editorKey ? { ...current, pendingEditor: editorKey } : current;
      return current.pendingEditor === editorKey ? { ...current, pendingEditor: null } : current;
    }),
    startFresh: () => {
      if (latest.current.identity !== activeIdentity || latest.current.editorKey !== editorKey
        || !latest.current.freshEntryAllowed || readReservationRecovery().kind !== "none") return;
      setOwner((current) => current.identity === activeIdentity && current.phase === "reset" && !current.pendingEditor
        ? { ...current, phase: "fresh", revision: current.revision + 1 } : current);
    },
  };
}
