import { useEffect, useState } from "react";
import { browserIsOnline } from "../api/requestConnectivity";

export function useNetworkStatus(): { isOnline: boolean; isOffline: boolean } {
  const [isOnline, setIsOnline] = useState(browserIsOnline);

  useEffect(() => {
    const update = () => setIsOnline(browserIsOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return { isOnline, isOffline: !isOnline };
}
