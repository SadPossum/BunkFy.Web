type Handoff = (setupGrantId?: string) => Promise<void>;
let handoff: Handoff | undefined;

// In-memory only. Setup grants never enter URLs, browser storage or query caches.
export function installStationHandoff(action: Handoff) { handoff = action; }
export async function enterStation(setupGrantId?: string) {
  if (!handoff) throw new Error("Reload BunkFy before setting up this station.");
  await handoff(setupGrantId);
}
