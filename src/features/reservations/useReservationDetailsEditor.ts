import { useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import type { Reservation, ReservationMutationReceipt } from "../../api/types";
import type { RouteNavigationLease } from "../../app/routeNavigationLease";
import { useSession } from "../../app/session";
import { resolveReservationGuestDetailsAttempt, type ReservationGuestDetailsAttempt, type ReservationGuestDetailsAttemptPayload } from "./reservationGuestDetailsAttempt";

export type BookingDetailsDraft = {
  primaryGuestName: string; guestCount: string; email: string; phone: string; notes: string;
  expectedArrivalTime: string; expectedDepartureTime: string;
};
export function bookingDetailsDraft(item: Reservation): BookingDetailsDraft {
  return { primaryGuestName: item.primaryGuestName, guestCount: String(item.guestCount), email: item.email ?? "",
    phone: item.phone ?? "", notes: item.notes ?? "", expectedArrivalTime: item.expectedArrivalTime?.slice(0, 5) ?? "",
    expectedDepartureTime: item.expectedDepartureTime?.slice(0, 5) ?? "" };
}
export function bookingDetailsPayload(item: Pick<Reservation, "propertyId" | "reservationId" | "detailsRevision">, draft: BookingDetailsDraft): ReservationGuestDetailsAttemptPayload {
  const optional = (value: string) => value.trim() || null;
  return { propertyId: item.propertyId, reservationId: item.reservationId, expectedDetailsRevision: item.detailsRevision,
    primaryGuestName: draft.primaryGuestName.trim(), guestCount: Number(draft.guestCount), email: optional(draft.email),
    phone: optional(draft.phone), notes: optional(draft.notes), expectedArrivalTime: optional(draft.expectedArrivalTime), expectedDepartureTime: optional(draft.expectedDepartureTime) };
}
type Editor = { baseline: BookingDetailsDraft; draft: BookingDetailsDraft; detailsRevision: number;
  attempt: ReservationGuestDetailsAttempt | null; sending: boolean; error: unknown };

// Reservation-local, memory-only ordinary-details owner. A dispatched operation
// keeps its exact payload/revision even when successful readback advances it.
export function useReservationDetailsEditor({ identity, propertyId, reservationId, current, authorityCurrent, authorityLost, navigation, onSaved }: {
  identity: string; propertyId: string; reservationId: string | null; current?: Reservation;
  authorityCurrent: boolean; authorityLost: boolean; navigation: RouteNavigationLease;
  onSaved: (receipt: ReservationMutationReceipt) => Promise<void>;
}) {
  const { request } = useSession();
  const [stored, setStored] = useState<{ identity: string; editor: Editor | null }>({ identity, editor: null });
  const editor = stored.identity === identity && !authorityLost ? stored.editor : null;
  const dirty = Boolean(editor && JSON.stringify(editor.draft) !== JSON.stringify(editor.baseline));
  const unresolved = Boolean(editor?.attempt);
  const live = useRef({ identity, propertyId, reservationId, current, authorityCurrent, authorityLost, editor, mounted: true, onSaved });
  live.current = { identity, propertyId, reservationId, current, authorityCurrent, authorityLost, editor, mounted: live.current.mounted, onSaved };
  const commit = (value: Editor | null) => { live.current.editor = value; setStored({ identity, editor: value }); };
  useLayoutEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; };
  }, [identity]);
  useLayoutEffect(() => {
    if (stored.identity !== identity || authorityLost) setStored({ identity, editor: null });
    navigation.reportOwner({ engaged: dirty || unresolved, pending: unresolved, label: "booking details", authorityLost });
  }, [authorityLost, dirty, identity, navigation.reportOwner, stored.identity, unresolved]);
  const exactCurrent = () => {
    const value = live.current;
    return value.mounted && value.identity === identity && !value.authorityLost && value.authorityCurrent
      && value.current?.propertyId === propertyId && value.current.reservationId === reservationId;
  };
  function begin() {
    if (!exactCurrent() || live.current.editor?.attempt || !live.current.current) return;
    const baseline = bookingDetailsDraft(live.current.current);
    commit({ baseline, draft: { ...baseline }, detailsRevision: live.current.current.detailsRevision, attempt: null, sending: false, error: null });
  }
  function change(field: keyof BookingDetailsDraft, value: string) {
    const owner = live.current.editor;
    if (!owner || owner.attempt || !exactCurrent()) return;
    commit({ ...owner, draft: { ...owner.draft, [field]: value }, error: null });
  }
  function cancel() {
    if (live.current.identity !== identity || live.current.editor?.attempt) return;
    commit(null); // lease canonicalizes the original editor route, not queued Back
  }
  async function submit() {
    const owner = live.current.editor, item = live.current.current;
    if (!owner || owner.sending || !item || !exactCurrent()) return;
    if (!owner.attempt && item.detailsRevision !== owner.detailsRevision) {
      commit({ ...owner, error: new Error("Booking details changed while you were editing. Review the current details before a new save.") }); return;
    }
    const payload = bookingDetailsPayload({ propertyId, reservationId: item.reservationId, detailsRevision: owner.detailsRevision }, owner.draft);
    if (!payload.primaryGuestName || !Number.isInteger(payload.guestCount) || payload.guestCount < 1) return;
    const attempt = owner.attempt ?? resolveReservationGuestDetailsAttempt(null, payload);
    commit({ ...owner, attempt, sending: true, error: null });
    const owns = () => live.current.mounted && live.current.identity === identity && !live.current.authorityLost
      && live.current.editor?.attempt === attempt;
    try {
      const { propertyId: capturedProperty, reservationId: capturedReservation, ...details } = attempt.payload;
      const receipt = await request<ReservationMutationReceipt>(`/api/reservations/properties/${capturedProperty}/${capturedReservation}/guest-details`, {
        method: "PUT", body: JSON.stringify({ operationId: attempt.operationId, ...details }),
      });
      if (receipt.propertyId !== capturedProperty || receipt.reservationId !== capturedReservation
        || !Number.isInteger(receipt.detailsRevision) || receipt.detailsRevision <= attempt.payload.expectedDetailsRevision) {
        throw new Error("The save response could not be matched to these booking details. Retry the same change to confirm its result.");
      }
      if (!owns()) return;
      await live.current.onSaved(receipt);
      if (owns()) commit(null);
    } catch (error) {
      if (!owns()) return;
      // A definitive validation/revision rejection permits correction. Transport,
      // timeout, server and ambiguous response failures retain the same operation.
      const rejected = error instanceof ApiError && [400, 409, 422].includes(error.status);
      commit({ ...owner, attempt: rejected ? null : attempt, sending: false, error });
    }
  }
  return { editor, dirty, unresolved, begin, change, cancel, submit,
    revisionChanged: Boolean(editor && current && current.detailsRevision !== editor.detailsRevision),
    useCurrentDetails: () => { if (!live.current.editor?.attempt) begin(); } };
}
