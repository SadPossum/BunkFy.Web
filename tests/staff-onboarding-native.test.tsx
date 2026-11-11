import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeChromium } from "./support/nativeChromium";

// Actual pages, query lifecycle and Chromium; identity, grants and HTTP replies
// are synthetic. Real restricted-identity authorization needs separate API proof.
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ApiError} from '/src/api/client.ts';
import {StaffPage} from '/src/features/staff/StaffPage.tsx';
import {InvitationVerificationRecovery} from '/src/features/workspaces/InvitationVerificationRecovery.tsx';
import '/src/styles.css';
const params=new URLSearchParams(location.search);
const properties=['alpha','beta'].map(propertyId=>({propertyId,name:propertyId==='alpha'?'Alpha Hostel':'Beta Hostel',code:propertyId,timeZoneId:'UTC',status:'active',processingStatus:'enabled',version:1}));
const state=window.staffFixture={property:'alpha',subject:'viewer',tenant:'tenant',workspaceRead:params.has('workspace'),allowedProperty:'alpha',propertyAuthority:'ready',tenantAuthority:'ready',requests:[],held:false,hold:false,detailError:0,mismatch:false,emailEnabled:!params.has('email-disabled'),cooldown:params.has('cooldown'),confirmed:0,methodsFailure:false};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:0}}});
const member=(propertyId='alpha')=>({staffMemberId:'member',displayName:propertyId==='alpha'?'Alpha colleague':'Beta colleague',jobTitle:'Front desk',department:'Reception',status:1,version:2,assignments:[{assignmentId:'assignment',propertyId,propertyJobTitle:'Night shift',isPrimary:true,effectiveFrom:'2026-11-01'}]});
state.request=async(path,options)=>{
 const method=options?.method??'GET';state.requests.push({path,method,body:options?.body});
 if(path==='/api/auth/methods'){
  if(state.methodsFailure)throw new ApiError('Synthetic methods failure',503);
  return {emails:[{id:'email',email:'viewer@example.invalid',isActive:true,isVerified:false}]};
 }
 if(path==='/api/auth/email-verification'){
  if(state.cooldown)throw new ApiError('Wait before requesting another email verification message.',429,'Auth.EmailVerificationRequestTooSoon');
  return null;
 }
 if(path==='/api/auth/email-verification/confirm'){
  if(JSON.parse(options.body).code!=='valid-existing-code')throw new ApiError('Verification code is invalid.',400);
  return null;
 }
 if(path.startsWith('/api/staff/properties/')){
  const propertyId=path.split('/')[4];
  if(/\\/members\\?/.test(path))return {items:[{...member(propertyId),assignment:member(propertyId).assignments[0]}],page:1,pageSize:30,hasMore:false};
  const saved=member(propertyId);if(state.subject!=='viewer')saved.displayName='New actor colleague';
  if(state.hold&&state.subject==='viewer'){state.held=true;await new Promise(resolve=>state.release=resolve);}
  if(state.detailError)throw new ApiError('Synthetic detail denial',state.detailError);
  return state.mismatch==='property'?{...saved,assignments:[{...saved.assignments[0],propertyId:'other-property'}]}:state.mismatch?{...saved,staffMemberId:'other-member'}:saved;
 }
 if(path.startsWith('/api/staff/members?')&&state.workspaceRead)return {items:[{...member(),currentPropertyCount:1}],page:1,pageSize:30,hasMore:false};
 if(path==='/api/staff/members/member'&&state.workspaceRead)return member();
 throw Error('Unexpected fixture request: '+path);
};
state.refresh=()=>client.invalidateQueries({queryKey:['staff-member']});
function Fixture(){const [version,setVersion]=useState(0);state.change=patch=>{Object.assign(state,patch);setVersion(v=>v+1);};return <QueryClientProvider client={client}><BrowserRouter><output hidden>{version}</output>{params.has('verification')?<InvitationVerificationRecovery request={state.request} recipientBound={false} onVerified={()=>state.confirmed++}/>:<StaffPage/>}</BrowserRouter></QueryClientProvider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
let server: ViteDevServer;
let browser: Browser;
let origin: string;
const runtimeErrors: string[] = [];
beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__staff_onboarding_fixture.tsx");
  server = await createServer({ configFile: false, root: process.cwd(), logLevel: "error",
    cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-staff-onboarding-")),
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-router", "@tanstack/react-query", "lucide-react", "@radix-ui/react-popover", "@radix-ui/react-select", "@daypicker/react"] },
    plugins: [react(), tailwindcss(), { name: "staff-onboarding-fixture",
      resolveId: id => id === entry || id === "/__staff_onboarding_fixture.tsx" ? entry : undefined,
      load(id) {
        if (id === entry) return fixture;
        if (id === normalizePath(process.cwd() + "/src/app/session.tsx")) return `export function useSession(){const s=window.staffFixture;return {request:s.request,session:{tenantId:s.tenant,subjectId:s.subject,username:s.subject+'@example.invalid',sessionId:s.subject}};}`;
        if (id === normalizePath(process.cwd() + "/src/app/workspace.tsx")) return `export function useWorkspace(){const s=window.staffFixture;const properties=${JSON.stringify(["alpha", "beta"].map(propertyId => ({ propertyId, name: propertyId === "alpha" ? "Alpha Hostel" : "Beta Hostel", code: propertyId, timeZoneId: "UTC", status: "active", processingStatus: "enabled", version: 1 })))};return {properties,selectedPropertyId:s.property,selectedProperty:properties.find(p=>p.propertyId===s.property)??null,setSelectedPropertyId:property=>s.change({property}),propertiesLoaded:true,propertiesLoading:false,propertiesFetching:false,propertiesError:null,refetchProperties:async()=>{}};}`;
        if (id === normalizePath(process.cwd() + "/src/app/productCapabilities.tsx")) return 'export function useProductCapabilities(){return {emailVerificationEnabled:window.staffFixture.emailEnabled};}';
        if (id === normalizePath(process.cwd() + "/src/app/permissions.ts")) return readFileSync(id, "utf8").replace(/^export \{[\s\S]*?\} from "\.\/accessAuthority";/, `export function usePermissions(checks){const s=window.staffFixture;const property=checks.some(c=>c.scope.includes('/property:'));const status=property?s.propertyAuthority:s.tenantAuthority;return {hasData:status!=='loading'&&status!=='unavailable',isLoading:status==='loading',isFetching:status==='refreshing',error:status==='unavailable'?Error('Synthetic authority failure'):null,refetch:async()=>{},allows:(permission,scope)=>status!=='loading'&&status!=='unavailable'&&permission==='staff.read'&&(scope==='tenant:'+s.tenant?s.workspaceRead:scope==='tenant:'+s.tenant+'/property:'+s.allowedProperty)};}`);
      },
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__staff-onboarding")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__staff_onboarding_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(runtimeErrors).toEqual([]); });
async function open(query = "", width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  page.on("pageerror", error => runtimeErrors.push(error.message));
  await page.goto(origin + "__staff-onboarding" + query);
  await page.getByRole("heading", { name: query.includes("verification") ? "Verify your account email" : "Staff", exact: true }).waitFor();
  return page;
}
async function change(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(patch => (window as unknown as { staffFixture: { change: (patch: Record<string, unknown>) => void } }).staffFixture.change(patch), patch);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function requests(page: Page) {
  return page.evaluate("window.staffFixture.requests") as Promise<Array<{path: string; method: string; body?: string}>>;
}
function expectPropertyOnlyRequests(reads: Array<{path: string; method: string}>) {
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(r => r.method === "GET" && r.path.startsWith("/api/staff/properties/"))).toBe(true);
}

describe("property-scoped Staff directory", () => {
  it("opens the property directory and detail without workspace or sensitive reads", async () => {
    const page = await open();
    try {
      await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Alpha colleague", exact: true }); await dialog.waitFor();
      await dialog.getByText("Night shift", { exact: true }).waitFor();
      expect(await dialog.getByRole("tab").count()).toBe(0);
      expect(await page.getByRole("button", { name: "Add staff member", exact: true }).count()).toBe(0);
      expect(await page.getByRole("tab", { name: "Workspace", exact: true }).isDisabled()).toBe(true);
      expectPropertyOnlyRequests(await requests(page));
    } finally { await page.close(); }
  });
  it("keeps an explicit denied workspace bookmark exact and offers the property directory", async () => {
    const page = await open("?scope=workspace");
    try {
      await page.getByRole("heading", { name: "Workspace Staff access is restricted", exact: true }).waitFor();
      expect(new URL(page.url()).searchParams.get("scope")).toBe("workspace"); expect(await requests(page)).toEqual([]);
      await page.getByRole("tab", { name: "Alpha Hostel", exact: true }).click();
      await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).waitFor();
      expectPropertyOnlyRequests(await requests(page));
    } finally { await page.close(); }
  });
  it("opens an exact property member link on a narrow mobile screen", async () => {
    const page = await open("?scope=property&member=member&section=account", 390);
    try {
      const dialog = page.getByRole("dialog", { name: "Alpha colleague", exact: true }); await dialog.waitFor();
      await dialog.getByText("Alpha Hostel", { exact: true }).waitFor();
      expect(await dialog.getByRole("tab").count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(new URL(page.url()).searchParams.get("member")).toBe("member");
      expectPropertyOnlyRequests(await requests(page));
    } finally { await page.close(); }
  });
  it("waits for property authority and issues no directory reads while it is unavailable", async () => {
    const page = await open("?scope=property");
    try {
      await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).waitFor();
      await change(page, { propertyAuthority: "unavailable" });
      expect(await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).count()).toBe(0);
      const count = (await requests(page)).length;
      await change(page, { property: "beta" });
      expect((await requests(page)).length).toBe(count);
      await change(page, { propertyAuthority: "ready", allowedProperty: "beta" });
      await page.getByRole("button", { name: "Open Beta colleague", exact: true }).waitFor();
      expectPropertyOnlyRequests(await requests(page));
    } finally { await page.close(); }
  });
  it("removes the profile and current member link when property access is revoked", async () => {
    const page = await open("?scope=property&member=member");
    try {
      await page.getByRole("dialog", { name: "Alpha colleague", exact: true }).waitFor();
      const count = (await requests(page)).length;
      await change(page, { allowedProperty: null });
      await page.getByRole("heading", { name: "Staff access is restricted", exact: true }).waitFor();
      expect(await page.getByRole("dialog").count()).toBe(0);
      expect(new URL(page.url()).searchParams.has("member")).toBe(false);
      expect((await requests(page)).length).toBe(count);
    } finally { await page.close(); }
  });
  it("does not repaint a late detail after moving to a denied property", async () => {
    const page = await open("?scope=property");
    try {
      await change(page, { hold: true });
      await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).click();
      await page.waitForFunction("window.staffFixture.held");
      await change(page, { property: "beta" });
      await page.getByRole("heading", { name: "Staff access is restricted", exact: true }).waitFor();
      await page.evaluate("window.staffFixture.release()");
      expect(await page.getByRole("dialog").count()).toBe(0);
      expectPropertyOnlyRequests(await requests(page));
    } finally { await page.close(); }
  });
  it.each([403, 404])("hides previously read details after an authoritative %s denial", async status => {
    const page = await open("?scope=property&member=member");
    try {
      const dialog = page.getByRole("dialog"); await dialog.getByText("Night shift", { exact: true }).waitFor();
      await change(page, { detailError: status }); await page.evaluate("window.staffFixture.refresh()");
      await dialog.getByText("Property Staff profile unavailable", { exact: true }).waitFor();
      expect(await dialog.getByText("Night shift", { exact: true }).count()).toBe(0);
      await change(page, { detailError: 503 }); await page.evaluate("window.staffFixture.refresh()");
      expect(await dialog.getByText("Night shift", { exact: true }).count()).toBe(0);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).click();
      await dialog.getByText("Property Staff profile unavailable", { exact: true }).waitFor();
      expect(await dialog.getByText("Night shift", { exact: true }).count()).toBe(0);
      await change(page, { detailError: 0 }); await page.evaluate("window.staffFixture.refresh()");
      await dialog.getByText("Night shift", { exact: true }).waitFor();
    } finally { await page.close(); }
  });
  it.each(["member", "property"])("rejects a detail receipt for a different %s", async mismatch => {
    const page = await open("?scope=property");
    try {
      await change(page, { mismatch });
      await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).click();
      const dialog = page.getByRole("dialog"); await dialog.getByText("Property Staff profile unavailable", { exact: true }).waitFor();
      expect(await dialog.getByText("Night shift", { exact: true }).count()).toBe(0);
    } finally { await page.close(); }
  });
  it("separates actor detail reads and cannot repaint an older actor's late response", async () => {
    const page = await open("?scope=property");
    try {
      await change(page, { hold: true });
      await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).click();
      await page.waitForFunction("window.staffFixture.held");
      await change(page, { subject: "other-actor" });
      await page.getByRole("dialog", { name: "New actor colleague", exact: true }).waitFor();
      await page.evaluate("window.staffFixture.release()");
      expect(await page.getByRole("dialog", { name: "Alpha colleague", exact: true }).count()).toBe(0);
      expect(await page.getByRole("dialog", { name: "New actor colleague", exact: true }).isVisible()).toBe(true);
    } finally { await page.close(); }
  });
  it("retains the workspace directory and full detail route for a workspace reader", async () => {
    const page = await open("?workspace=1");
    try {
      await page.getByRole("button", { name: "Open Alpha colleague", exact: true }).click();
      await page.getByRole("dialog", { name: "Alpha colleague", exact: true }).waitFor();
      expect((await requests(page)).some(r => r.path === "/api/staff/members/member")).toBe(true);
      expect(await page.getByRole("tab", { name: "Workspace", exact: true }).isDisabled()).toBe(false);
    } finally { await page.close(); }
  });
});

describe("invitation verification recovery", () => {
  it("accepts an existing code immediately without sending a replacement", async () => {
    const page = await open("?verification=1");
    try {
      await page.getByRole("textbox", { name: "Verification code", exact: true }).fill("valid-existing-code");
      await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
      await page.waitForFunction("window.staffFixture.confirmed===1");
      expect((await requests(page)).filter(r => r.method === "POST")).toEqual([{ path: "/api/auth/email-verification/confirm", method: "POST", body: '{"code":"valid-existing-code"}' }]);
    } finally { await page.close(); }
  });
  it("keeps existing code entry usable when sending is in cooldown", async () => {
    const page = await open("?verification=1&cooldown=1");
    try {
      await page.getByRole("button", { name: "Send code to viewer@example.invalid", exact: true }).click();
      await page.getByText("Wait before requesting another email verification message.", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Verification code", exact: true }).fill("valid-existing-code");
      await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
      await page.waitForFunction("window.staffFixture.confirmed===1");
    } finally { await page.close(); }
  });
  it("retains invalid code input for correction and continues only on successful verification", async () => {
    const page = await open("?verification=1");
    try {
      const input=page.getByRole("textbox", { name: "Verification code", exact: true });
      await input.fill("invalid-code"); await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
      await page.getByText("Verification code is invalid.", { exact: true }).waitFor();
      expect(await page.evaluate("window.staffFixture.confirmed")).toBe(0);expect(await input.inputValue()).toBe("invalid-code");
      await input.fill("valid-existing-code"); await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
      await page.waitForFunction("window.staffFixture.confirmed===1");
    } finally { await page.close(); }
  });
  it("keeps the initial send flow and enables continuation only with a code", async () => {
    const page = await open("?verification=1");
    try {
      expect(await page.getByRole("button", { name: "Verify and continue", exact: true }).isDisabled()).toBe(true);
      await page.getByRole("button", { name: "Send code to viewer@example.invalid", exact: true }).click();
      await page.getByRole("button", { name: "Send code to viewer@example.invalid", exact: true }).waitFor({ state:"hidden" });
      expect(await page.getByRole("textbox", { name: "Verification code", exact: true }).isVisible()).toBe(true);
      expect(await page.evaluate("window.staffFixture.confirmed")).toBe(0);
    } finally { await page.close(); }
  });
  it("keeps disabled-delivery guidance and sends no requests", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin+"__staff-onboarding?verification=1&email-disabled=1");
      await page.getByText(/email delivery is disabled in this deployment/).waitFor();
      expect(await page.getByRole("textbox", { name: "Verification code", exact: true }).count()).toBe(0);
      expect(await requests(page)).toEqual([]);
    } finally { await page.close(); }
  });
});
