import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RetirementProcessSummary } from "../src/api/types";
import { retirementAttemptCurrent } from "../src/features/properties/topologyRetirementEditorModel";
import { advanceRetirementObservation, refreshRetirementDependents, retirementDependentQuery, retirementDependentReadState, retirementObservation, type RetirementObservation } from "../src/features/properties/topologyRetirementReadback";

const scope = { tenantId: "tenant-a", propertyId: "property-a", roomId: "room-a" };
const current = { context: "session-a/property-a/room-a/bed-a", instance: 1 };
const summary = { topologyChangeId: "process-a", status: 2, version: 2 } as RetirementProcessSummary;
const observation = (status: RetirementProcessSummary["status"], version: number, active: boolean | null = true) => retirementObservation(current.context, current.instance, { ...summary, status, version }, active);
const clients: QueryClient[] = [];
const cleanups: (() => void)[] = [];
function cache() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  clients.push(client);
  return client;
}
function reader(client: QueryClient, key: QueryKey, queryFn = vi.fn(async () => "current"), enabled = true) {
  const observer = new QueryObserver(client, { queryKey: key, initialData: "previous", queryFn, enabled });
  cleanups.push(observer.subscribe(() => {}));
  return queryFn;
}
afterEach(() => { for (const dispose of cleanups.splice(0)) dispose(); for (const client of clients.splice(0)) client.clear(); });

describe("retirement lifecycle observation", () => {
  it("refreshes normal async completion once, not on every poll or impact-only version", async () => {
    const client = cache();
    const reads = reader(client, ["beds", scope.propertyId, scope.roomId]);
    let previous: RetirementObservation | null = null;
    async function observe(next: RetirementObservation) {
      const result = advanceRetirementObservation(previous, next); previous = result.observation;
      if (result.refresh) await refreshRetirementDependents(client, scope, () => retirementAttemptCurrent(next, current));
    }
    await observe(observation(2, 2));
    for (let index = 0; index < 20; index++) await observe(observation(2, 2));
    await observe(observation(2, 3));
    expect(reads).toHaveBeenCalledTimes(1);
    await observe(observation(4, 4, false));
    for (let index = 0; index < 20; index++) await observe(observation(4, 4, false));
    await observe(observation(2, 2));
    expect(reads).toHaveBeenCalledTimes(2);
    expect(previous).toMatchObject({ status: 4, version: 4, topologyActive: false });
  });
  it.each([1, 3, 4, 5, 6] as const)("observes meaningful status %s including stop and rejection", (status) => {
    const result = advanceRetirementObservation(observation(2, 2), observation(status, 3, status !== 4));
    expect(result.refresh).toBe(true);
    expect(advanceRetirementObservation(result.observation, observation(status, 3, status !== 4)).refresh).toBe(false);
  });
  it("refreshes an initially discovered terminal process and a new attempt after stopped", () => {
    expect(advanceRetirementObservation(null, observation(4, 4, false)).refresh).toBe(true);
    const next = { ...observation(1, 1), processId: "process-b" };
    expect(advanceRetirementObservation(observation(6, 5), next)).toEqual({ observation: next, refresh: true });
  });
  it("coalesces receipt and identical authoritative readback without inferring topology", () => {
    const receipt = advanceRetirementObservation(observation(2, 2), observation(4, 4, null));
    expect(receipt).toMatchObject({ refresh: true, observation: { topologyActive: null } });
    const readback = advanceRetirementObservation(receipt.observation, observation(4, 4, false));
    expect(readback).toMatchObject({ refresh: false, observation: { topologyActive: false } });
    expect(advanceRetirementObservation(readback.observation, observation(4, 4, null)).refresh).toBe(false);
    // A separately advancing physical read is meaningful even at the same process revision.
    expect(advanceRetirementObservation(observation(3, 3, true), observation(3, 3, false)).refresh).toBe(true);
  });
  it.each([
    { ...current, context: "session-b/property-a/room-a/bed-a" },
    { ...current, context: "session-a/property-b/room-a/bed-a" },
    { ...current, context: "session-a/property-a/room-b/bed-a" },
    { ...current, context: "session-a/property-a/room-a/bed-b" },
    { ...current, instance: 2 },
  ])("fences late observation from changed context %s", async (changed) => {
    const client = cache(); const reads = reader(client, ["inventory-rooms", scope.propertyId]);
    await refreshRetirementDependents(client, scope, () => retirementAttemptCurrent(current, changed));
    expect(reads).not.toHaveBeenCalled();
    expect(client.getQueryState(["inventory-rooms", scope.propertyId])?.isInvalidated).toBe(false);
    expect(advanceRetirementObservation(observation(4, 4, false), { ...observation(4, 4, false), ...changed }).refresh).toBe(true);
  });
});

describe("bounded dependent read refresh and recovery", () => {
  it("refetches only affected active reads, invalidates inactive adjacent views, and never refetches the owner or a mutation", async () => {
    const client = cache();
    const affected = [["rooms", scope.propertyId], ["beds", scope.propertyId, scope.roomId], ["inventory-rooms", scope.propertyId], ["availability", scope.propertyId, "date-a"],
      ["reservation-calendar", scope.propertyId, "date-a"], ["reservation-operations", scope.propertyId], ["operational-preview", scope.tenantId, scope.propertyId, "inventory"]];
    const excluded = [["properties", scope.tenantId], ["rooms", "other-property"], ["beds", scope.propertyId, "other-room"], ["blocks", scope.propertyId],
      ["retirement-context", current.context, scope.propertyId, scope.roomId], ["retirement-known", current.context, scope.propertyId, "process-a"], ["operational-preview", "other-tenant", scope.propertyId]];
    const reads = affected.map((key) => reader(client, key));
    const otherReads = excluded.map((key) => reader(client, key));
    const disabled = reader(client, ["availability", scope.propertyId, "unauthorized-date"], undefined, false);
    const dormant = ["reservation-calendar", scope.propertyId, "inactive-date"];
    client.setQueryData(dormant, "previous");
    const post = vi.fn();
    const mutationObserver = client.getMutationCache().build(client, { mutationKey: ["retirement", scope.propertyId], mutationFn: post });
    await refreshRetirementDependents(client, scope, () => true);
    for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
    for (const read of [...otherReads, disabled, post]) expect(read).not.toHaveBeenCalled();
    expect(mutationObserver.state.status).toBe("idle");
    expect(client.getQueryState(dormant)?.isInvalidated).toBe(true);
    for (const key of excluded) expect(retirementDependentQuery(key, scope)).toBe(false);
    expect(retirementDependentReadState(client, scope)).toBe("current");
  });
  it("keeps failed physical reads unconfirmed without optimistic data and clears the notice after the existing scoped retry", async () => {
    const client = cache();
    const key = ["beds", scope.propertyId, scope.roomId];
    const reads = reader(client, key, vi.fn(async () => { throw new Error("503 controlled"); }));
    await refreshRetirementDependents(client, scope, () => true);
    expect(retirementDependentReadState(client, scope)).toBe("unconfirmed");
    expect(client.getQueryData(key)).toBe("previous");
    reads.mockImplementation(async () => "retired from actual read");
    await client.refetchQueries({ queryKey: key, exact: true });
    expect(retirementDependentReadState(client, scope)).toBe("current");
    expect(client.getQueryData(key)).toBe("retired from actual read");
  });
  it("reports in-flight facts as unconfirmed, preserves the retirement query and ignores unrelated failure", async () => {
    const client = cache(); let finish!: (value: string) => void;
    const key = ["inventory-rooms", scope.propertyId];
    reader(client, key, vi.fn(() => new Promise<string>((resolve) => { finish = resolve; })));
    const contextKey = ["retirement-context", current.context, scope.propertyId, scope.roomId];
    client.setQueryData(contextKey, { process: { ...summary, status: 4, version: 4 }, isTopologyActive: false });
    const pending = refreshRetirementDependents(client, scope, () => true);
    expect(retirementDependentReadState(client, scope)).toBe("refreshing");
    expect(client.getQueryData(key)).toBe("previous");
    expect(client.getQueryData(contextKey)).toMatchObject({ process: { status: 4 }, isTopologyActive: false });
    finish("current"); await pending;
    reader(client, ["blocks", scope.propertyId], vi.fn(async () => { throw new Error("unrelated failure"); }));
    await client.refetchQueries({ queryKey: ["blocks", scope.propertyId] });
    expect(retirementDependentReadState(client, scope)).toBe("current");
  });
});
