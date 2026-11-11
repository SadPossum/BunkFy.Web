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

// Actual activity readers and detail dialogs. HTTP data and identity are fixtures.
const fixture = `
import React from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {IngestionActivity} from "/src/features/integrations/IngestionActivity.tsx";
import {createCompositeSource} from "/src/app/compositeSourceState.ts";
import "/src/styles.css";
const scenario=new URLSearchParams(location.search).get("scenario")||"receipt-known",now="2026-11-11T09:30:00Z";
window.activityWrites=[];
const unknown="Future.Adapter."+"long-reference-".repeat(25)+"<img src=x onerror=alert(1)>";
const receipt={receiptId:"receipt-a",propertyId:"property-a",connectionId:"connection-a",operationId:"operation-a",sourceRecordType:"reservation.v1",externalId:"booking-a",contentHash:"a".repeat(64),rawPayloadStatus:1,rawPayloadRetainUntilUtc:"2099-01-01T00:00:00Z",observedAtUtc:now,receivedAtUtc:now,status:3,rejectionReason:scenario==="receipt-unknown"?unknown:scenario==="receipt-prototype"?"constructor":scenario==="receipt-missing"?null:"Ingestion.ReservationSourceNotLinked"};
if(scenario==="receipt-processed"){receipt.status=2;receipt.rejectionReason=null;}
const run={runId:"run-a",connectionId:"connection-a",propertyId:"property-a",executionKind:1,version:1,startedAtUtc:now,completedAtUtc:now,status:scenario==="run-partial"?3:4,observedCount:2,acceptedCount:scenario==="run-partial"?1:0,rejectedCount:1,errorCode:scenario==="run-partial"?"imap.observation-rejected":scenario==="run-missing"?null:"ingestion.adapterconfigurationmaterialnotfound"};
const attempt={attemptId:"attempt-a",propertyId:"property-a",connectionId:"connection-a",sourceReceiptId:"receipt-a",taskRunId:"task-a",parserType:"mail.reader",parserVersion:1,status:5,lastTaskAttempt:1,parsedCount:1,acceptedCount:0,duplicateCount:0,rejectedCount:1,lastErrorCode:"Ingestion.ReprocessingRawPayloadInvalid",requestedAtUtc:now,startedAtUtc:now,completedAtUtc:now,reservationExpiresAtUtc:"2099-01-01T00:00:00Z",version:1};
window.activityRequest=async(path,options)=>{
 if(options?.method&&options.method!=="GET"){window.activityWrites.push({path,method:options.method});throw Error("Unexpected mutation");}
 const p=new URL(path,"http://fixture").pathname;
 if(p.endsWith("/receipts/receipt-a"))return receipt;
 if(p.endsWith("/receipts"))return {receipts:[receipt],page:1,pageSize:30,hasMore:false};
 if(p.endsWith("/runs/run-a"))return run;
 if(p.endsWith("/runs"))return {runs:[run],page:1,pageSize:30,hasMore:false};
 if(p.endsWith("/reprocessing-attempts/attempt-a"))return {attempt,outputs:[]};
 if(p.endsWith("/reprocessing-attempts"))return {attempts:[attempt],page:1,pageSize:30,hasMore:false};
 throw Error("Unexpected fixture read: "+path);
};
const selection=scenario.startsWith("run-")?"run=run-a":scenario==="reprocessing"?"attempt=attempt-a":"receipt=receipt-a";
const source=createCompositeSource({label:"Fixture directory",hasData:true,isLoading:false,error:null,isFetching:false,refetch:async()=>{}});
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><MemoryRouter initialEntries={["/?property=property-a&"+selection]}><main className="p-4"><IngestionActivity propertyId="property-a" connections={[{connectionId:"connection-a",adapterType:"imap.reservation-json",executionMode:1,status:1,conflictPolicy:1}]} connectionSource={source} adapterTypes={[]} adapterTypeSource={source} canReadRawPayloads={false}/></main></MemoryRouter></QueryClientProvider>);
`;

let server: ViteDevServer;
let browser: Browser;
let origin: string;
const errors: string[] = [];
beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__ingestion_failure_fixture.tsx");
  server = await createServer({ configFile: false, root: process.cwd(),
    cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-ingestion-failure-")), logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-router", "@tanstack/react-query", "lucide-react", "@radix-ui/react-popover", "@radix-ui/react-select", "@daypicker/react"] },
    plugins: [react(), tailwindcss(), {
      name: "ingestion-failure-fixture",
      resolveId: id => id === "/__ingestion_failure_fixture.tsx" || id === entry ? entry : undefined,
      load(id) {
        if (id === entry) return fixture;
        if (id === normalizePath(process.cwd() + "/src/app/session.tsx")) return "export function useSession(){return {request:(...args)=>window.activityRequest(...args),download:()=>{throw Error('Unexpected download');}};}";
      },
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__ingestion-failure")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__ingestion_failure_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
  await warmNativeFixture(browser, new URL("/__ingestion-failure", origin).href);
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(errors).toEqual([]); });

async function open(scenario: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(new URL("/__ingestion-failure?scenario=" + scenario, origin).href);
  await page.getByRole("dialog").waitFor();
  return page;
}

async function assertReadOnly(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { activityWrites: unknown[] }).activityWrites)).toEqual([]);
  expect(await page.getByRole("button", { name: "Download raw payload", exact: true }).count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}

it("explains an unlinked cancellation immediately and preserves its recorded reason", async () => {
  const page = await open("receipt-known");
  try {
    const notice = page.getByRole("region", { name: "Booking wasn't linked to this source", exact: true });
    await notice.waitFor({ timeout: 3000 });
    expect(await notice.innerText()).toContain("external booking reference");
    const rect = await notice.boundingBox();
    expect(rect!.y).toBeGreaterThan(0);
    expect(rect!.y + rect!.height).toBeLessThan(750);
    const reason = notice.getByText("Ingestion.ReservationSourceNotLinked", { exact: true });
    expect(await reason.isVisible()).toBe(false);
    await notice.getByText("Technical details", { exact: true }).click();
    await reason.waitFor();
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it.each(["receipt-unknown", "receipt-prototype"])("keeps unknown %s reasons intact as text without inventing a cause", async scenario => {
  const page = await open(scenario);
  try {
    const notice = page.getByRole("region", { name: "Source update needs attention", exact: true });
    await notice.waitFor();
    expect(await notice.innerText()).toContain("person who manages this connection");
    await notice.getByText("Technical details", { exact: true }).click();
    const raw = await notice.locator("code").innerText();
    expect(raw).toBe(scenario === "receipt-prototype" ? "constructor" : "Future.Adapter." + "long-reference-".repeat(25) + "<img src=x onerror=alert(1)>");
    expect(await page.locator("img").count()).toBe(0);
    expect(await notice.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("explains a rejected receipt even when no reason was recorded", async () => {
  const page = await open("receipt-missing");
  try {
    const notice = page.getByRole("region", { name: "Source update needs attention", exact: true });
    await notice.waitFor();
    await notice.getByText("Technical details", { exact: true }).click();
    expect(await notice.innerText()).toContain("No technical reason was recorded");
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("keeps a processed receipt free of failure feedback", async () => {
  const page = await open("receipt-processed");
  try {
    await page.getByRole("heading", { name: "reservation.v1 observation", exact: true }).waitFor();
    expect(await page.getByText(/^processed$/i).count()).toBeGreaterThan(0);
    expect(await page.getByRole("region", { name: /needs attention|wasn't linked/ }).count()).toBe(0);
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("preserves partial success and accepted/rejected counts alongside run guidance", async () => {
  const page = await open("run-partial");
  try {
    await page.getByRole("region", { name: "Some source updates were rejected", exact: true }).waitFor();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/^partially succeeded$/i).waitFor();
    expect(await dialog.getByText("Accepted", { exact: true }).locator("..").innerText()).toMatch(/1\s+Accepted/);
    expect(await dialog.getByText("Rejected", { exact: true }).locator("..").innerText()).toMatch(/1\s+Rejected/);
    expect(await dialog.innerText()).not.toMatch(/no bookings changed|nothing was imported/i);
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("recognizes the worker's normalized configuration error code", async () => {
  const page = await open("run-setup");
  try {
    const notice = page.getByRole("region", { name: "Connection setup needs attention", exact: true });
    await notice.waitFor();
    expect(await notice.innerText()).toContain("configuration and credential references");
    await notice.getByText("Technical details", { exact: true }).click();
    expect(await notice.locator("code").innerText()).toBe("ingestion.adapterconfigurationmaterialnotfound");
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("offers honest run guidance when no error code was recorded", async () => {
  const page = await open("run-missing");
  try {
    const notice = page.getByRole("region", { name: "Run needs attention", exact: true });
    await notice.waitFor();
    expect(await notice.innerText()).toContain("accepted and rejected counts");
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);

it("puts reprocessing failure guidance before output metrics without replaying data", async () => {
  const page = await open("reprocessing");
  try {
    const notice = page.getByRole("region", { name: "Original source data could not be read", exact: true });
    await notice.waitFor();
    expect(await notice.innerText()).not.toContain("deleted");
    const box = await notice.boundingBox();
    const outputs = await page.getByRole("heading", { name: "Outputs", exact: true }).boundingBox();
    expect(box!.y).toBeLessThan(outputs!.y);
    await notice.getByText("Technical details", { exact: true }).click();
    expect(await notice.locator("code").innerText()).toBe("Ingestion.ReprocessingRawPayloadInvalid");
    await assertReadOnly(page);
  } finally { await page.close(); }
}, 20000);
