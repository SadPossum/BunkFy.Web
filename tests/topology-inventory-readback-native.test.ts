import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Browser, Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeChromium } from "./support/nativeChromium";

// Actual Spaces/editor/query lifecycle and Chromium. Identity, permissions and
// HTTP transport are synthetic; this verifies client recovery, not server grants.
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,useNavigate} from 'react-router';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ApiError} from '/src/api/client.ts';
import {SpacesPage} from '/src/features/spaces/SpacesPage.tsx';
import {RouteNavigationLeaseProvider} from '/src/app/routeNavigationLease.tsx';
import '/src/styles.css';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const propertyId=id(1),roomId=id(2),otherRoomId=id(3);
const params=new URLSearchParams(location.search);
const state=window.topologyFixture={subject:'owner',permissions:true,propertiesRead:true,inventoryRead:true,created:!params.has('create'),bedsCreated:params.has('existing-beds'),available:params.has('ready'),readyAfter:Number(params.get('readyAfter')??2),reads:[],inventoryReads:0,readbacks:0,roomWrites:0,bedWrites:0,inventoryError:0,hold:false,held:false,roomName:'New dorm',roomRevision:1,bedLabels:['1','2'],bedRevision:1,pendingRename:false,pendingBedRename:false};
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:20000,refetchOnWindowFocus:false},mutations:{retry:0}}});
const physical=()=>({propertyId,roomId,name:state.roomName,buildingLabel:'Main',floorLabel:'1',status:'active',version:state.roomRevision+(state.bedsCreated?2:0)});
const other=()=>({...physical(),roomId:otherRoomId,name:'Existing room'});
const beds=()=>state.bedsCreated?[1,2].map(n=>({propertyId,roomId,bedId:id(10+n),label:state.bedLabels[n-1],status:'active',version:n===1?state.bedRevision:1,roomVersion:physical().version})):[];
const inventory=(room,includeBeds,bedRows=beds())=>({propertyId,roomId:room.roomId,roomName:room.name,buildingLabel:room.buildingLabel,floorLabel:room.floorLabel,salesMode:'unconfigured',version:1,units:[{propertyId,roomId:room.roomId,inventoryUnitId:id(room.roomId===roomId?20:21),bedId:null,kind:params.has('legacy')?1:'room',label:room.name,isSellable:false,isTopologyActive:true},...(includeBeds?bedRows.map((bed,n)=>({propertyId,roomId,inventoryUnitId:id(30+n),bedId:bed.bedId,kind:params.has('legacy')?2:'bed',label:bed.label,isSellable:false,isTopologyActive:true})):[])]});
state.request=async(path,options)=>{
 const method=options?.method??'GET';state.reads.push({path,method,subject:state.subject});
 if(path==='/api/properties/'+propertyId+'/rooms'&&method==='POST'){state.roomWrites++;state.created=true;state.inventoryReads=0;state.readbacks=0;return {propertyId,roomId,status:'active',version:1};}
 if(path==='/api/properties/'+propertyId+'/rooms/'+roomId+'/beds/batch'&&method==='POST'){state.bedWrites++;state.bedsCreated=true;state.inventoryReads=0;state.readbacks=0;return {propertyId,roomId,affectedBedCount:2,roomVersion:3};}
 if(path==='/api/properties/'+propertyId+'/rooms/'+roomId&&method==='PUT'){state.roomWrites++;state.previousRoom=physical();state.roomName=JSON.parse(options.body).name;state.roomRevision++;state.pendingRename=true;state.inventoryReads=0;state.readbacks=0;return {propertyId,roomId,status:'active',version:physical().version};}
 if(path==='/api/properties/'+propertyId+'/rooms/'+roomId+'/beds/'+id(11)&&method==='PUT'){state.bedWrites++;state.previousBeds=beds();state.bedLabels[0]=JSON.parse(options.body).label;state.bedRevision++;state.roomRevision++;state.pendingBedRename=true;state.inventoryReads=0;state.readbacks=0;return {propertyId,roomId,bedId:id(11),status:'active',version:state.bedRevision,roomVersion:physical().version};}
 if(path.startsWith('/api/properties/'+propertyId+'/rooms?'))return {rooms:[other(),...(state.created?[physical()]:[])],page:1,pageSize:100,hasMore:false};
 if(path.includes('/beds?'))return {beds:path.includes('/'+roomId+'/')?beds():[],page:1,pageSize:100,hasMore:false};
 if(path.startsWith('/api/inventory/properties/'+propertyId+'/rooms?')){
  state.inventoryReads++;if(state.created)state.readbacks++;
  if(params.has('newer-inventory')&&!state.newerInventoryReleased){state.roomName='Renamed dorm';state.roomRevision++;state.newerInventoryReleased=true;}
  if(state.hold){state.held=true;await new Promise(resolve=>state.release=resolve);}
  if(state.inventoryError)throw new ApiError('Synthetic Inventory failure',state.inventoryError);
  const ready=state.available||state.readbacks>=state.readyAfter;
  return {rooms:[inventory(other(),false),...(state.created&&(ready||params.has('beds')||state.pendingRename||state.pendingBedRename)?[inventory(state.pendingRename&&!ready?state.previousRoom:physical(),ready||state.pendingBedRename,state.pendingBedRename&&!ready?state.previousBeds:beds())]:[])],page:1,pageSize:100,hasMore:false};
 }
 if(path.includes('/availability?')){const query=new URL(path,'http://fixture.invalid').searchParams;return {propertyId,arrival:query.get('arrival'),departure:query.get('departure'),units:[]};}
 if(path.includes('/blocks?'))return {blocks:[],page:1,pageSize:100,hasMore:false};
 throw Error('Unexpected fixture request: '+method+' '+path);
};
function Content(){const [,render]=useState(0),navigate=useNavigate();state.change=patch=>{Object.assign(state,patch);render(v=>v+1);};state.navigate=path=>navigate(path);return <RouteNavigationLeaseProvider><SpacesPage/></RouteNavigationLeaseProvider>;}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><BrowserRouter><Content/></BrowserRouter></QueryClientProvider>);
`;
let server: ViteDevServer;
let browser: Browser;
let origin: string;
const errors: string[] = [];
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const propertyId = id(1), roomId = id(2), otherRoomId = id(3);
beforeAll(async () => {
  const root = process.cwd(), entry = normalizePath(root + "/__topology_readback_fixture.tsx");
  server = await createServer({ configFile: false, root, logLevel: "error", cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-topology-readback-")),
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-router", "@tanstack/react-query", "lucide-react", "@radix-ui/react-popover", "@radix-ui/react-select", "@daypicker/react"] },
    plugins: [react(), tailwindcss(), { name: "topology-readback-fixture",
      resolveId: id => id === entry || id === "/__topology_readback_fixture.tsx" ? entry : undefined,
      load(id) {
        if (id === entry) return fixture;
        if (id === normalizePath(root + "/src/app/session.tsx")) return `export function useSession(){const s=window.topologyFixture;return {request:s.request,session:{tenantId:'tenant',subjectId:s.subject,username:s.subject+'@example.invalid',sessionId:s.subject}};}`;
        if (id === normalizePath(root + "/src/app/workspace.tsx")) return `export function useWorkspace(){const property={propertyId:'${propertyId}',name:'Synthetic property',code:'SYN',status:'active',processingStatus:'enabled',timeZoneId:'UTC',canonicalTimeZoneId:'UTC',timeZoneStatus:'valid',version:1};return {properties:[property],selectedProperty:property,selectedPropertyId:property.propertyId,propertiesLoaded:true,propertiesLoading:false,propertiesFetching:false,propertiesError:null,refetchProperties:async()=>{},setSelectedPropertyId:()=>{}};}`;
        if (id === normalizePath(root + "/src/app/permissions.ts")) return readFileSync(id, "utf8").replace(/^export \{[\s\S]*?\} from "\.\/accessAuthority";/, `export function usePermissions(){const s=window.topologyFixture;return {hasData:true,isLoading:false,isFetching:false,error:null,refetch:async()=>{},allows:permission=>s.permissions&&[...(s.propertiesRead?['properties.read']:[]),'properties.rooms.manage','properties.beds.manage',...(s.inventoryRead?['inventory.read','inventory.configure']:[])].includes(permission)};}`);
      },
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/spaces")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__topology_readback_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();origin = server.resolvedUrls!.local[0];browser = await launchNativeChromium();
}, 60000);
afterAll(async () => { await browser?.close();await server?.close();expect(errors).toEqual([]); });
async function open(query = "") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + `spaces?property=${propertyId}&room=${query.includes("create") ? otherRoomId : roomId}&${query}`);
  await page.getByRole("heading", { name: query.includes("create") ? "Existing room" : "New dorm", exact: true }).waitFor();
  return page;
}
async function change(page: Page, patch: Record<string, unknown>) { await page.evaluate(patch => (window as unknown as { topologyFixture: { change(patch: Record<string, unknown>): void } }).topologyFixture.change(patch), patch); }
async function values(page: Page) { return page.evaluate("({reads:window.topologyFixture.reads,inventoryReads:window.topologyFixture.inventoryReads,readbacks:window.topologyFixture.readbacks,roomWrites:window.topologyFixture.roomWrites,bedWrites:window.topologyFixture.bedWrites})") as Promise<{reads: {path: string; method: string; subject: string}[]; inventoryReads: number; readbacks: number; roomWrites: number; bedWrites: number}>; }

describe("exact-target Inventory readback after physical topology changes", () => {
  it("loads delayed selling controls after a confirmed room creation without reloading or another write", async () => {
    const page = await open("create=1");
    try {
      await page.getByRole("button", { name: "Add room", exact: true }).click();
      await page.getByLabel("Room name or number", { exact: true }).fill("New dorm");
      await page.locator("form").filter({ has: page.getByLabel("Room name or number", { exact: true }) }).getByRole("button", { name: "Add room", exact: true }).click();
      await page.getByRole("heading", { name: "New dorm", exact: true }).waitFor();
      await page.getByRole("button", { name: "Edit selling setup", exact: true }).waitFor();
      expect(new URL(page.url()).searchParams.get("room")).toBe(roomId);
      const result = await values(page);expect(result.roomWrites).toBe(1);expect(result.bedWrites).toBe(0);expect(result.readbacks).toBe(2);
    } finally { await page.close(); }
  }, 15000);

  it("recovers newly added bed counterparts without repeating the batch", async () => {
    const page = await open("beds=1&ready=1");
    try {
      await change(page, { available: false });
      await page.getByRole("button", { name: "Add beds", exact: true }).click();await page.getByLabel("Number of beds", { exact: true }).fill("2");
      await page.getByRole("button", { name: "Add 2 beds", exact: true }).click();await page.getByLabel("Number of beds", { exact: true }).waitFor({ state: "hidden" });
      await expect.poll(async () => (await values(page)).readbacks).toBe(2);
      expect(await page.getByText("Updating selling details", { exact: true }).count()).toBe(0);
      const result = await values(page);expect(result.bedWrites).toBe(1);expect(result.roomWrites).toBe(0);
      expect(new URL(page.url()).searchParams.get("room")).toBe(roomId);
    } finally { await page.close(); }
  }, 15000);

  it("refreshes an older physical snapshot when Inventory already has newer copied facts", async () => {
    const page = await open("ready=1&newer-inventory=1");
    try {
      await page.getByRole("heading", { name: "Renamed dorm", exact: true }).waitFor();
      await expect.poll(() => page.getByRole("button", { name: "Edit selling setup", exact: true }).isEnabled()).toBe(true);
      expect((await values(page)).inventoryReads).toBe(2);expect((await values(page)).roomWrites).toBe(0);
    } finally { await page.close(); }
  }, 15000);

  it("refreshes a copied room name after a confirmed rename", async () => {
    const page = await open("ready=1");
    try {
      await change(page, { available: false });await page.getByRole("button", { name: "Edit room", exact: true }).click();
      await page.getByLabel("Room name or number", { exact: true }).fill("Renamed dorm");await page.getByRole("button", { name: "Save room", exact: true }).click();
      await page.getByRole("heading", { name: "Renamed dorm", exact: true }).waitFor();
      await expect.poll(async () => (await values(page)).readbacks).toBe(2);
      await expect.poll(() => page.getByRole("button", { name: "Edit selling setup", exact: true }).isEnabled()).toBe(true);
      expect((await values(page)).roomWrites).toBe(1);expect(new URL(page.url()).searchParams.get("room")).toBe(roomId);
    } finally { await page.close(); }
  }, 15000);

  it("refreshes a copied bed label without confusing configuration and physical versions", async () => {
    const page = await open("beds=1&existing-beds=1&ready=1");
    try {
      await page.evaluate(path => (window as unknown as { topologyFixture: { navigate(path: string): void } }).topologyFixture.navigate(path), `/spaces?property=${propertyId}&room=${roomId}&bed=${id(11)}&unit=${id(30)}`);
      await page.getByLabel("Edit bed 1", { exact: true }).waitFor();await change(page, { available: false });await page.getByLabel("Edit bed 1", { exact: true }).click();
      await page.getByLabel("Bed label", { exact: true }).fill("Window");await page.getByRole("button", { name: "Save bed", exact: true }).click();
      await page.getByRole("heading", { name: "Window", exact: true }).waitFor();
      await expect.poll(async () => (await values(page)).readbacks).toBe(2);
      await expect.poll(() => page.getByRole("button", { name: "Edit selling setup", exact: true }).isEnabled()).toBe(true);
      expect((await values(page)).bedWrites).toBe(1);expect(new URL(page.url()).searchParams.get("bed")).toBe(id(11));
    } finally { await page.close(); }
  }, 15000);

  it.each(["room", "beds"])("stops after a finite budget for missing %s and offers a local refresh that can recover", async missing => {
    const page = await open("readyAfter=999" + (missing === "beds" ? "&beds=1&existing-beds=1" : ""));
    try {
      await page.getByText("Selling details are delayed", { exact: true }).waitFor();
      const exhausted = await values(page);expect(exhausted.readbacks).toBe(4);
      if (missing === "beds") expect(await page.getByRole("button", { name: "Edit selling setup", exact: true }).isDisabled()).toBe(true);
      await page.waitForLoadState("networkidle");expect((await values(page)).readbacks).toBe(4);
      await change(page, { available: true });await page.getByRole("button", { name: "Refresh selling details", exact: true }).click();
      await expect.poll(() => page.getByRole("button", { name: "Edit selling setup", exact: true }).isEnabled()).toBe(true);expect((await values(page)).readbacks).toBe(5);
      expect((await values(page)).reads.every(r => r.method === "GET")).toBe(true);
    } finally { await page.close(); }
  }, 15000);

  it.each(["permission", "physical permission", "actor", "room", "property"] as const)("abandons the old target retry when %s changes", async boundary => {
    const page = await open("readyAfter=999");
    try {
      await page.getByText("Updating selling details", { exact: true }).waitFor();
      if (boundary === "permission") await change(page, { inventoryRead: false });
      else if (boundary === "physical permission") await change(page, { propertiesRead: false });
      else if (boundary === "actor") await change(page, { subject: "different-actor", permissions: false });
      else await page.evaluate(path => (window as unknown as { topologyFixture: { navigate(path: string): void } }).topologyFixture.navigate(path), `/spaces?property=${boundary === "property" ? id(99) : propertyId}&room=${otherRoomId}&readyAfter=999`);
      await page.waitForLoadState("networkidle");
      expect((await values(page)).inventoryReads).toBe(1);
      expect(await page.getByText("Updating selling details", { exact: true }).count()).toBe(0);
    } finally { await page.close(); }
  }, 15000);

  it.each([403, 503])("stops automatic readback on an Inventory %s and keeps source recovery local", async status => {
    const page = await open("readyAfter=999");
    try {
      await page.getByText("Updating selling details", { exact: true }).waitFor();await change(page, { inventoryError: status });
      await page.getByText("Selling details are not current", { exact: true }).waitFor();
      await page.waitForLoadState("networkidle");expect((await values(page)).inventoryReads).toBe(2);
      expect(await page.getByRole("button", { name: "Refresh selling details", exact: true }).count()).toBe(0);
      await change(page, { inventoryError: 0, available: true });
      await page.getByRole("region", { name: "Selling", exact: true }).getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByRole("button", { name: "Edit selling setup", exact: true }).waitFor();expect((await values(page)).inventoryReads).toBe(3);
    } finally { await page.close(); }
  }, 15000);

  it("pauses offline without spending retries and resumes when connected", async () => {
    const page = await open("readyAfter=999");
    try {
      await page.getByText("Updating selling details", { exact: true }).waitFor();await page.context().setOffline(true);
      await page.getByText("Reconnect to refresh selling details", { exact: true }).waitFor();await page.waitForLoadState("networkidle");
      expect((await values(page)).inventoryReads).toBe(1);expect(await page.getByRole("button", { name: "Refresh selling details", exact: true }).isDisabled()).toBe(true);
      await change(page, { available: true });await page.context().setOffline(false);
      await page.getByRole("button", { name: "Edit selling setup", exact: true }).waitFor();expect((await values(page)).inventoryReads).toBe(2);
    } finally { await page.close(); }
  }, 15000);

  it.each([["string kinds", ""], ["legacy numeric kinds", "legacy=1"]])("leaves a complete successful source alone with %s", async (_label, query) => {
    const page = await open("ready=1&existing-beds=1&" + query);
    try { await page.getByRole("button", { name: "Edit selling setup", exact: true }).waitFor();await page.waitForLoadState("networkidle");expect((await values(page)).inventoryReads).toBe(1);expect(await page.getByRole("button", { name: "Refresh selling details", exact: true }).count()).toBe(0); }
    finally { await page.close(); }
  }, 15000);
});
