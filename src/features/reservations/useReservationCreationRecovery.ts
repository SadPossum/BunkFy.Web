import { useCallback, useEffect, useState } from "react";
import { readReservationRecovery, reservationRecoveryEvent, reservationRecoveryKey } from "./reservationCreationRecovery";

export function useReservationCreationRecovery() {
  const [snapshot, setSnapshot] = useState(readReservationRecovery);
  const refresh = useCallback(() => setSnapshot(readReservationRecovery()), []);
  useEffect(() => {
    const storageChanged = (event: StorageEvent) => { if (event.key === null || event.key === reservationRecoveryKey) refresh(); };
    window.addEventListener(reservationRecoveryEvent, refresh);
    window.addEventListener("storage", storageChanged);
    return () => { window.removeEventListener(reservationRecoveryEvent, refresh); window.removeEventListener("storage", storageChanged); };
  }, [refresh]);
  return { snapshot, refresh };
}
