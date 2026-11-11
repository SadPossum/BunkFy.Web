import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeChromium } from "./support/nativeChromium";
import { warmNativeFixture } from "./support/warmNativeFixture";

// Actual queue, review dialog, queries and decision controls; API data and grants are fixtures.
const fixture = `
import React from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ProposalQueue} from "/src/features/integrations/ProposalQueue.tsx";
import "/src/styles.css";
const scenario=new URLSearchParams(location.search).get("scenario")||"update";
const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
const baseline={schemaVersion:1,arrival:"2026-12-01",departure:"2026-12-03",inventoryUnitIds:[a]};
const incoming={Kind:1,SourceSequence:2,Arrival:"2026-12-01",Departure:"2026-12-04",InventoryUnitIds:[a],PrimaryGuestName:"External guest",GuestCount:1,Email:null,Phone:null,Notes:null,ExpectedArrivalTime:"14:30:00",ExpectedDepartureTime:null};
if(scenario.startsWith("spaces"))incoming.InventoryUnitIds=[b];
if(scenario==="cancel")Object.assign(incoming,{Kind:2,Arrival:null,Departure:null,InventoryUnitIds:[],PrimaryGuestName:null,GuestCount:null,ExpectedArrivalTime:null});
if(scenario==="future")incoming.FutureCharge={amount:20};
const encoded=JSON.stringify({PreviousOperationalBaseline:scenario==="no-baseline"?null:JSON.stringify(baseline),IncomingSnapshot:JSON.stringify(incoming)});
const raw=scenario==="invalid"?'unparsed <img src=x onerror=alert(1)> '+"long-reference-".repeat(40):scenario==="redacted"?null:encoded;
const proposal={proposalId:"proposal-a",propertyId:"property-a",connectionId:"connection-a",receiptId:"receipt-a",reservationId:"reservation-a",baseReservationDetailsRevision:1,reasonCode:"connection-suggestions-only",sensitiveHistoryStatus:1,status:1,version:11,createdAtUtc:"2026-11-11T08:00:00Z",diff:raw};
const reservation={reservationId:"reservation-a",propertyId:"property-a",arrival:"2026-12-01",departure:scenario==="stale"?"2026-12-09":"2026-12-03",primaryGuestName:"Current staff name",guestCount:1,inventoryUnitIds:[a],status:2,holdsInventory:true,sourceKind:2,detailsRevision:scenario==="stale"?5:1,version:7,guests:[]};
const rooms={rooms:[{roomId:"room-a",propertyId:scenario==="spaces-wrong-property"?"property-b":"property-a",roomName:"North Dorm",units:[{inventoryUnitId:a,propertyId:"property-a",roomId:"room-a",kind:2,label:"Bed 1"},{inventoryUnitId:b,propertyId:"property-a",roomId:"room-a",kind:2,label:"Bed 2"}]}],hasMore:false};
window.proposalReads=[];window.proposalWrites=[];window.recordedDiff=raw;
window.proposalRequest=async(path,options)=>{
 if(options?.method&&options.method!=="GET"){window.proposalWrites.push({path,body:JSON.parse(options.body)});return new Promise(()=>{});}
 window.proposalReads.push(path);const p=new URL(path,"http://fixture").pathname;
 if(p.endsWith("/proposals/proposal-a"))return proposal;
 if(p.endsWith("/proposals"))return {proposals:[proposal],page:1,pageSize:25,hasMore:false};
 if(p.endsWith("/reservations/properties/property-a/reservation-a"))return reservation;
 if(p.endsWith("/inventory/properties/property-a/rooms")){if(scenario==="spaces-error")throw Error("Inventory unavailable");return rooms;}
 throw Error("Unexpected fixture read: "+path);
};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
if(scenario==="spaces-denied"||scenario==="spaces-error")client.setQueryData(["inventory-rooms","property-a"],{rooms:[{roomId:"room-a",propertyId:"property-a",roomName:"Old cached names",units:rooms.rooms[0].units}],hasMore:false},{updatedAt:1});
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/?property=property-a&proposal=proposal-a"]}><main className="p-4"><ProposalQueue propertyId="property-a" canReadSensitiveHistory={scenario!=="restricted"} canDecide={true} canSuggestGuestRecords={false} canReadInventory={scenario!=="spaces-denied"}/></main></MemoryRouter></QueryClientProvider>);
`;

let server: ViteDevServer;
let browser: Browser;
let origin: string;
const errors: string[] = [];
beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__proposal_review_fixture.tsx");
  server = await createServer({ configFile: false, root: process.cwd(),
    cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-proposal-review-")), logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-router", "@tanstack/react-query", "lucide-react", "@radix-ui/react-popover", "@radix-ui/react-select", "@daypicker/react"] },
    plugins: [react(), tailwindcss(), {
      name: "proposal-review-fixture",
      resolveId: id => id === "/__proposal_review_fixture.tsx" || id === entry ? entry : undefined,
      load(id) {
        if (id === entry) return fixture;
        if (id === normalizePath(process.cwd() + "/src/app/session.tsx")) return "export function useSession(){return {request:(...args)=>window.proposalRequest(...args)};}";
      },
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__proposal-review")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__proposal_review_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
  await warmNativeFixture(browser, new URL("/__proposal-review", origin).href);
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(errors).toEqual([]); });

async function open(scenario = "update") {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Pacific/Honolulu" });
  page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(new URL("/__proposal-review?scenario=" + scenario, origin).href);
  if (scenario !== "restricted") await page.getByRole("dialog").waitFor();
  return page;
}

async function assertReadOnly(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { proposalWrites: unknown[] }).proposalWrites)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}

it("shows a readable historical date comparison without guessing previous guest values", async () => {
  const page = await open();
  try {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Booking update from source", exact: true }).waitFor({ timeout: 3000 });
    await dialog.getByText("3 Dec 2026", { exact: true }).waitFor();
    await dialog.getByText("4 Dec 2026", { exact: true }).waitFor();
    expect(await dialog.getByText("External guest", { exact: true }).isVisible()).toBe(true);
    expect(await dialog.getByText("Current staff name", { exact: true }).count()).toBe(0);
    expect(await dialog.locator("pre").isVisible()).toBe(false);
    const rect = await dialog.getByText("4 Dec 2026", { exact: true }).boundingBox();
    expect(rect!.y + rect!.height).toBeLessThan(750);
    await dialog.getByText("Technical details", { exact: true }).click();
    expect(await dialog.locator("pre").textContent()).toBe(await page.evaluate(() => (window as unknown as { recordedDiff: string }).recordedDiff));
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("describes cancellation as an action and keeps explicit staff confirmation", async () => {
  const page = await open("cancel");
  try {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Cancellation requested by source", exact: true }).waitFor();
    expect(await dialog.innerText()).toContain("releases its reserved spaces");
    expect(await dialog.getByRole("heading", { name: "Incoming booking details", exact: true }).count()).toBe(0);
    await assertReadOnly(page);
    await dialog.getByRole("button", { name: "Review and apply", exact: true }).click();
    await dialog.getByRole("heading", { name: "Apply this external update?", exact: true }).waitFor();
    await assertReadOnly(page);
    await dialog.getByRole("button", { name: "Apply update", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { proposalWrites: unknown[] }).proposalWrites.length === 1);
    expect(await page.evaluate(() => (window as unknown as { proposalWrites: unknown[] }).proposalWrites)).toEqual([{ path: "/api/ingestion/properties/property-a/proposals/proposal-a/accept", body: { expectedProposalVersion: 11, expectedReservationDetailsRevision: 1 } }]);
  } finally { await page.close(); }
}, 20000);

it("preserves current revision validation without treating current edits as historical source data", async () => {
  const page = await open("stale");
  try {
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/This reservation is now at revision 5/).waitFor();
    await dialog.getByText("3 Dec 2026", { exact: true }).waitFor();
    expect(await dialog.getByText("9 Dec 2026", { exact: true }).count()).toBe(0);
    await dialog.getByRole("button", { name: "Review and apply", exact: true }).click();
    await dialog.getByRole("button", { name: "Apply update", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { proposalWrites: unknown[] }).proposalWrites.length === 1);
    expect(await page.evaluate(() => (window as unknown as { proposalWrites: { body: unknown }[] }).proposalWrites[0].body)).toEqual({ expectedProposalVersion: 11, expectedReservationDetailsRevision: 5 });
  } finally { await page.close(); }
}, 20000);

it("keeps rejection reason and proposal version requirements", async () => {
  const page = await open();
  try {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    const submit = dialog.getByRole("button", { name: "Reject proposal", exact: true });
    expect(await submit.isDisabled()).toBe(true);
    await dialog.getByLabel("Rejection reason", { exact: true }).fill("Staff confirmed a different departure");
    await submit.click();
    await page.waitForFunction(() => (window as unknown as { proposalWrites: unknown[] }).proposalWrites.length === 1);
    expect(await page.evaluate(() => (window as unknown as { proposalWrites: unknown[] }).proposalWrites)).toEqual([{ path: "/api/ingestion/properties/property-a/proposals/proposal-a/reject", body: { expectedProposalVersion: 11, reason: "Staff confirmed a different departure" } }]);
  } finally { await page.close(); }
}, 20000);

it("labels missing baseline honestly while retaining incoming values", async () => {
  const page = await open("no-baseline");
  try {
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/Previous source details are unavailable/).waitFor();
    await dialog.getByText("4 Dec 2026", { exact: true }).waitFor();
    expect(await dialog.getByText("Not recorded", { exact: true }).count()).toBeGreaterThan(0);
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("does not reconstruct redacted source details from the current booking", async () => {
  const page = await open("redacted");
  try {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Change details unavailable", exact: true }).waitFor();
    expect(await dialog.innerText()).toContain("removed by retention rules");
    expect(await dialog.locator("pre").count()).toBe(0);
    expect(await dialog.getByText("Current staff name", { exact: true }).count()).toBe(0);
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("keeps unsupported raw text visible, escaped and wrapped", async () => {
  const page = await open("invalid");
  try {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Change details unavailable", exact: true }).waitFor();
    expect(await dialog.locator("pre").isVisible()).toBe(true);
    expect(await dialog.locator("pre").textContent()).toBe(await page.evaluate(() => (window as unknown as { recordedDiff: string }).recordedDiff));
    expect(await dialog.locator("img").count()).toBe(0);
    expect(await dialog.locator("pre").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("surfaces additional future fields alongside the known summary", async () => {
  const page = await open("future");
  try {
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/Additional source fields are recorded/).waitFor();
    expect(await dialog.locator("pre").isVisible()).toBe(true);
    expect(await dialog.locator("pre").textContent()).toContain("FutureCharge");
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("resolves changed spaces to current room and bed names when permitted", async () => {
  const page = await open("spaces");
  try {
    await page.getByText("North Dorm · Bed 1", { exact: true }).waitFor();
    await page.getByText("North Dorm · Bed 2", { exact: true }).waitFor();
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it.each(["spaces-denied", "spaces-error", "spaces-wrong-property"])("does not use cached or unrelated names for %s", async scenario => {
  const page = await open(scenario);
  try {
    await page.getByText("Space 22222222-2222-4222-8222-222222222222", { exact: true }).waitFor();
    if (scenario === "spaces-error") await page.getByText(/Room or bed names are unavailable/).waitFor();
    expect(await page.getByText(/Old cached names|North Dorm/).count()).toBe(0);
    if (scenario === "spaces-denied") expect(await page.evaluate(() => (window as unknown as { proposalReads: string[] }).proposalReads.some(path => path.includes("/inventory/")))).toBe(false);
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("keeps sensitive-history restrictions on both the row and detail query", async () => {
  const page = await open("restricted");
  try {
    await page.getByText("Difference details restricted", { exact: true }).waitFor();
    const row = page.getByRole("button").filter({ hasText: "Connection suggestions only" });
    await row.waitFor(); expect(await row.isDisabled()).toBe(true);
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { proposalReads: string[] }).proposalReads.some(path => path.endsWith("/proposals/proposal-a") || path.includes("/inventory/")))).toBe(false);
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);
