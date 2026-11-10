import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { type Browser } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeChromium } from "./support/nativeChromium";
import { warmNativeFixture } from "./support/warmNativeFixture";

// Real integration form and browser controls; the API and grants are fixtures.
const fixture = `
import React from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {IntegrationsPage} from "/src/features/integrations/IntegrationsPage.tsx";
import "/src/styles.css";
window.connectorCreates=[];
window.connectorRequest=async(path,options)=>{
 if(options?.method==="POST"){
  window.connectorCreates.push({path,body:JSON.parse(options.body)});
  return new Promise(()=>{});
 }
 if(path.endsWith("/adapter-types"))return {adapterTypes:[
  {adapterType:"fake.http",executionModes:[1]},
  {adapterType:"imap.reservation-json",executionModes:[1]}
 ]};
 if(path.includes("/connections?"))return {connections:[],page:1,pageSize:30,totalCount:0};
 throw Error("Unexpected fixture request: "+path);
};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><MemoryRouter><main><IntegrationsPage/></main></MemoryRouter></QueryClientProvider>);
`;

let server: ViteDevServer;
let browser: Browser;
let origin: string;
const runtimeErrors: string[] = [];
beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__connector_setup_fixture.tsx");
  server = await createServer({ configFile: false, root: process.cwd(),
    cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-connector-setup-")), logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-router", "@tanstack/react-query", "lucide-react", "@radix-ui/react-popover", "@radix-ui/react-select", "@daypicker/react"] },
    plugins: [react(), tailwindcss(), {
      name: "connector-setup-fixture",
      resolveId: id => id === "/__connector_setup_fixture.tsx" || id === entry ? entry : undefined,
      load(id) {
        if (id === entry) return fixture;
        if (id === normalizePath(process.cwd() + "/src/app/session.tsx")) return 'export function useSession(){return {request:(...args)=>window.connectorRequest(...args),session:{tenantId:"workspace-a",subjectId:"actor-a"}};}';
        if (id === normalizePath(process.cwd() + "/src/app/workspace.tsx")) return 'export function useWorkspace(){return {selectedProperty:{propertyId:"property-a",name:"Fixture hostel"},selectedPropertyId:"property-a",setSelectedPropertyId:()=>{}};}';
        if (id === normalizePath(process.cwd() + "/src/app/accessAuthority.tsx")) return 'export const accessAuthorityChecksMatchTenant=()=>true; export function useAccessPermissions(){return {hasData:true,isLoading:false,isFetching:false,error:null,allows:()=>true,refetch:async()=>{}};}';
      },
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__connector-setup")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__connector_setup_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
  await warmNativeFixture(browser, new URL("/__connector-setup", origin).href);
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(runtimeErrors).toEqual([]); });

it("uses a real source by default and requires explicit opt-in for a test connector", async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => runtimeErrors.push(error.message));
  try {
    await page.goto(new URL("/__connector-setup", origin).href);
    await page.getByRole("button", { name: "New connection", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Booking source"]')?.textContent?.includes("Reservation email inbox"));
    await page.getByRole("combobox", { name: "Booking source", exact: true }).click();
    expect(await page.getByRole("option", { name: "Test HTTP source (development)", exact: true }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.locator("summary").filter({ hasText: "Developer tools" }).click();
    await page.getByLabel("Show test connectors", { exact: true }).check();
    await page.getByRole("combobox", { name: "Booking source", exact: true }).click();
    await page.getByRole("option", { name: "Test HTTP source (development)", exact: true }).click();
    await page.getByText("A synthetic HTTP source for development and integration tests. It is not a booking provider.", { exact: true }).waitFor();
    await page.getByLabel("Show test connectors", { exact: true }).uncheck();
    await page.waitForFunction(() => document.querySelector('[aria-label="Booking source"]')?.textContent?.includes("Reservation email inbox"));
    await page.getByLabel("Configuration reference", { exact: true }).fill("prepared-source-a");
    await page.getByRole("dialog").getByRole("button", { name: "Create connection", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { connectorCreates: unknown[] }).connectorCreates.length === 1);
    const creates = await page.evaluate(() => (window as unknown as { connectorCreates: { path: string; body: Record<string, unknown> }[] }).connectorCreates);
    expect(creates[0].path).toBe("/api/ingestion/properties/property-a/connections");
    expect(creates[0].body.adapterType).toBe("imap.reservation-json");
    expect(creates[0].body.configurationReference).toBe("prepared-source-a");
    expect(creates[0].body.secretReference).toBeNull();
  } finally { await page.close(); }
}, 30000);
