// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceStationsSettings } from "../src/features/workspaces/WorkspaceStationsSettings";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/app/session", () => ({ useSession: () => ({
  session: { tenantId: "synthetic-workspace", subjectId: "synthetic-manager", sessionId: "55555555-5555-4555-8555-555555555555", generation: "manager-generation" },
  request: mocks.request, completeConfirmedBrowserSignOut: vi.fn(),
}) }));
vi.mock("../src/app/workspace", () => ({ useWorkspace: () => ({ selectedProperty: { propertyId: "11111111-1111-4111-8111-111111111111", name: "QA Hostel" } }) }));
vi.mock("../src/app/permissions", () => ({ permissions: { stationsManage: "stations.manage" },
  tenantAccessScope: () => "tenant:synthetic-workspace", usePermissions: () => ({ hasData: true, error: null, allows: () => true }) }));
let root: Root, client: QueryClient, host: HTMLDivElement;
let staff: { canIssueStationOnlySetup: boolean; localGrantPresent: boolean; localGrantRevoked: boolean;
  checkOutGrantPresent: boolean; checkOutGrantRevoked: boolean; registered: boolean; pinRevision: number; registrationVersion: number; pin: number };
const button = (name: string) => [...host.querySelectorAll("button")].find(element => element.textContent === name);
async function click(element: HTMLElement | undefined | null) { expect(element).toBeTruthy(); await act(async () => element!.click()); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await settle();
  expect(predicate()).toBe(true);
}
async function prepareBrowser() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><WorkspaceStationsSettings /></QueryClientProvider>));
  await waitFor(() => Boolean(button("Taylor QA"))); await click(button("Taylor QA"));
  await waitFor(() => Boolean(button("Remove station access")));
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]'));
  await click(button("Prepare this browser")); await waitFor(() => host.textContent!.includes("Finish preparing this browser") && client.isFetching() === 0);
  await settle();
  expect(host.textContent).toContain("Finish preparing this browser");
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); sessionStorage.clear();
  staff = { canIssueStationOnlySetup: true, localGrantPresent: false, localGrantRevoked: false,
    checkOutGrantPresent: false, checkOutGrantRevoked: false, registered: true, pinRevision: 0, registrationVersion: 1, pin: 0 };
  mocks.request.mockReset().mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/operations")) {
      const command = JSON.parse(String(options?.body));
      return { state: 0, receipt: { kind: command.kind, stationId: "33333333-3333-4333-8333-333333333333", browserSessionId: "44444444-4444-4444-8444-444444444444",
        originalIssuerSessionId: "55555555-5555-4555-8555-555555555555", setupGrantId: command.kind === 13 ? "66666666-6666-4666-8666-666666666666" : undefined } };
    }
    if (path.includes("/stations?")) return { state: 0, items: [{ stationId: "33333333-3333-4333-8333-333333333333", label: "Reception", version: 1, revoked: false }], hasMore: false };
    if (path.includes("/members?")) return { items: [{ staffMemberId: "22222222-2222-4222-8222-222222222222", displayName: "Taylor QA" }], hasMore: false };
    if (path.endsWith("/staff/22222222-2222-4222-8222-222222222222")) return { state: 0, item: { ...staff } };
    throw new Error("Unexpected synthetic manager request");
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount()); client?.clear(); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe("station-only PIN preparation requires at least one independently active task", () => {
  it.each([
    ["check-in only", true, false, false, false],
    ["checkout only", false, false, true, false],
    ["both tasks", true, false, true, false],
  ])("offers setup for %s", async (_name, checkIn, checkInRevoked, checkOut, checkOutRevoked) => {
    Object.assign(staff, { localGrantPresent: checkIn, localGrantRevoked: checkInRevoked,
      checkOutGrantPresent: checkOut, checkOutGrantRevoked: checkOutRevoked });
    await prepareBrowser(); await click(button("Prepare staff PIN creation")); await settle();
    expect(mocks.request.mock.calls.filter(([, options]) => options?.method === "POST" && JSON.parse(String(options.body)).kind === 13)).toHaveLength(1);
  });
  it.each([
    ["neither task", false, false, false, false],
    ["revoked check-in only", true, true, false, false],
    ["revoked checkout only", false, false, true, true],
    ["both revoked", true, true, true, true],
  ])("does not offer or dispatch setup for %s", async (_name, checkIn, checkInRevoked, checkOut, checkOutRevoked) => {
    Object.assign(staff, { localGrantPresent: checkIn, localGrantRevoked: checkInRevoked,
      checkOutGrantPresent: checkOut, checkOutGrantRevoked: checkOutRevoked });
    await prepareBrowser(); expect(button("Prepare staff PIN creation")).toBeUndefined();
    expect(host.textContent).toContain("Allow check-in or checkout for this staff member");
    expect(mocks.request.mock.calls.filter(([, options]) => options?.method === "POST" && JSON.parse(String(options.body)).kind === 13)).toHaveLength(0);
    expect(button("Sign out and open station")).toBeTruthy();
  });
  it("keeps linked staff on their own Account Security PIN journey", async () => {
    Object.assign(staff, { canIssueStationOnlySetup: false, localGrantPresent: true, checkOutGrantPresent: true });
    await prepareBrowser(); expect(button("Prepare staff PIN creation")).toBeUndefined();
    expect(host.querySelector('a[href="/account?section=security"]')).toBeTruthy();
  });
  it("conceals preparation during status refresh and after losing the last active task", async () => {
    staff.checkOutGrantPresent = true; await prepareBrowser(); expect(button("Prepare staff PIN creation")).toBeTruthy();
    let release!: () => void;
    mocks.request.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { state: 0, item: { ...staff, checkOutGrantRevoked: true } }; });
    let refetch!: Promise<unknown>;
    await act(async () => { refetch = client.refetchQueries({ queryKey: ["stations", "staff-status"] }); });
    await waitFor(() => !button("Prepare staff PIN creation"));
    await act(async () => { release(); await refetch; }); await settle();
    expect(button("Prepare staff PIN creation")).toBeUndefined();
    expect(host.textContent).toContain("Allow check-in or checkout for this staff member");
  });
});
