import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mounted real workspace, DatePickers and local CSS in Chromium. Only the
// parent data/selection callbacks are synthetic; this is not live API or UX
// acceptance evidence. Main and independent reviewers own seeded app flows.
const fixture = `
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {SpacesRoomWorkspace} from "/src/features/spaces/SpacesRoomWorkspace.tsx";
import {spacesOverviewUnits} from "/src/features/spaces/spacesWorkspace.ts";
import {useSpacesRetryFocus} from "/src/features/spaces/useSpacesRetryFocus.ts";
import {CompositeSourceNotice} from "/src/components/ui/CompositeSourceNotice.tsx";
import "/src/styles.css";
const rooms = ["101", "102"].map(id => ({roomId:id, propertyId:"synthetic", name:"Dorm " + id, location:"Demo House", inventoryUnits:location.search.includes("roomControls") ? ["A","B"].map(suffix=>({roomId:id,bedId:id+suffix,inventoryUnitId:"unit"+id+suffix,kind:"bed",label:id+"-"+suffix,isSellable:true,isTopologyActive:true})) : [], physicalStatus:"active", inventoryState:"present", salesMode:"bedLevel"}));
function Fixture() {
  const [selection, setSelection] = useState(new URLSearchParams(location.search).get("selected") ?? "101");
  const [bedSelection,setBedSelection] = useState(null);
  const [workspaceKey,setWorkspaceKey] = useState(0);
  const [filter, setFilter] = useState("");
  const [range, setRange] = useState(location.search.includes("invalidDates") ? {arrival:"2026-99-01", departure:""} : {arrival:"2026-09-06", departure:"2026-09-08"});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("Dorm 101");
  const [mode, setMode] = useState(location.search.includes("retry") ? "stale" : "ready");
  const [context, setContext] = useState("original actor / property / route");
  const [denied, setDenied] = useState(false);
  const [requests, setRequests] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [notice, setNotice] = useState("layout");
  const noticeState = {active:true, pending:mode.startsWith("pending"), retryable:mode === "stale"};
  const retryFocus = useSpacesRetryFocus({owner:JSON.stringify([context, selection]), enabled:!editing && mounted, ready:mode === "ready", denied,
    notices:{layout:{...noticeState,active:notice === "layout"},availability:{...noticeState,active:notice === "availability"}}});
  window.spacesHarness = {settle:setMode, changeContext:setContext, deny:() => setDenied(true), unmount:() => setMounted(false), changeNotice:setNotice, resetWorkspace:()=>setWorkspaceKey(n=>n+1)};
  const source = {label:"Synthetic inventory", state:mode === "ready" ? "ready" : mode === "pending" && location.search.includes("replaceRetry") ? "loading" : "stale", isFetching:mode.startsWith("pending"),
    refetch:async () => {setRequests(n => n + 1); setMode("pending");}};
  const selected = rooms.find(room => room.roomId === selection) ?? null;
  return <main style={{padding:16}}><output aria-label="Retry requests">{requests}</output>
    <button>Unrelated destination</button>
    <div ref={notice === "layout" ? retryFocus.layoutNotice : retryFocus.availabilityNotice} className="contents" onClickCapture={retryFocus.remember}><CompositeSourceNotice sources={[source]} keepRetryFocusable/></div>
    {mounted && <section ref={retryFocus.surface} className="spaces-room-frame">
    <SpacesRoomWorkspace key={workspaceKey} rooms={rooms} selectedRoom={selected} selectedUnit={bedSelection} selectedUnits={selected ? spacesOverviewUnits(selected) : []} physicalBedCount={selected?.inventoryUnits.length ?? 0}
      availability={{rows:[], total:0, reportedAvailable:0, reportedUnavailable:0, unresolvedTargets:0, contextMismatch:false}}
      inventoryCurrent={true} mayReadInventory={!location.search.includes("noInventory")} range={range} timeZoneId="Europe/London" locked={editing}
      onRangeChange={setRange} onSelectRoom={id=>{setSelection(id);setBedSelection(null);}} onSelectUnit={setBedSelection} filter={filter} onFilterChange={setFilter}
      requestedTarget={!location.search.includes("implicitTarget") && Boolean(selection)} selectionKey={selection+(bedSelection?.key ?? "")}
      sourceNotice={<p role="status" data-source-notice>Inventory source notice outside controls</p>}
      inspector={<><h3 data-inspector-heading tabIndex={-1}>{bedSelection?.label ?? selected?.name ?? "Requested room is unavailable"}</h3>
        <p>Physical status: active</p><button disabled={editing} onClick={() => setEditing(true)}>Edit room</button>
        {editing && <div data-topology-editor><label>Room name<input aria-label="Room name" value={draft} onChange={event => setDraft(event.target.value)}/></label><button onClick={() => setEditing(false)}>Cancel</button></div>}
        <section aria-label="Selected holds">No holds for this space</section></>}/>
  </section>}</main>;
}
createRoot(document.getElementById("root")).render(<Fixture/>);
`;
let server: ViteDevServer;
let browser: Browser;
let origin: string;
const runtimeErrors: string[] = [];
beforeAll(async () => {
  const fixturePath = process.cwd() + "/__spaces_disclosure_fixture.tsx";
  // This virtual entry must not share the app's optimizer generation or scan
  // its unrelated index.html while mounted tests are navigating.
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-spaces-disclosure-vite-")), logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "lucide-react", "@radix-ui/react-popover", "@daypicker/react"] },
    plugins: [react(), tailwindcss(), {
      name: "spaces-disclosure-test-fixture",
      resolveId: id => id === "/__spaces_disclosure_fixture.tsx" || id === fixturePath ? fixturePath : undefined,
      load: id => id === fixturePath ? fixture : undefined,
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/__spaces-disclosure")) return next();
          void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__spaces_disclosure_fixture.tsx"></script></body></html>')
            .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
        });
      },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0];
  browser = await chromium.launch({ headless: true });
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(runtimeErrors).toEqual([]); });
async function open(width = 320, query = "", touch = false) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: touch });
  page.setDefaultTimeout(5000);
  const startupErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") { runtimeErrors.push(message.text()); startupErrors.push(message.text()); } });
  page.on("response", response => { if (response.status() >= 400) startupErrors.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", request => startupErrors.push(`${request.failure()?.errorText} ${request.url()}`));
  await page.goto(origin + "__spaces-disclosure" + query);
  try { await page.getByRole("region", { name: "Rooms and beds comparison" }).waitFor(); }
  catch (error) { await page.close(); throw new Error(`Spaces fixture startup failed: ${JSON.stringify(startupErrors)}`, { cause: error }); }
  return page;
}
const toggle = (page: Page) => page.getByRole("button", { name: /Find another room or check dates/ });
const arrival = (page: Page) => page.getByRole("button", { name: /^Arrival date:/ });
const search = (page: Page) => page.getByRole("searchbox", { name: "Find a room or bed" });
async function settledResize(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

describe("Spaces single mounted selected-context disclosure", () => {
  it.each(["explicit", "implicit"])("R2: %s room edit after browsing stays visible through narrow resize and cancel", async target => {
    const page = await open(1440, '?roomControls' + (target === 'implicit' ? '&implicitTarget' : ''));
    try {
      await page.getByRole('button', { name: /spaces in Dorm 101/ }).click();
      await search(page).fill('101-A');
      await search(page).fill('');
      await page.getByRole('button', { name: 'Edit room', exact: true }).click();
      const draft = page.getByRole('textbox', { name: 'Room name', exact: true });
      await draft.fill('Keep this unsaved room draft');
      await draft.evaluate(e => { (window as unknown as { roomDraft: Element }).roomDraft = e; });
      for (const width of [320, 1024]) {
        await settledResize(page, width);
        expect(await draft.isVisible()).toBe(true);
        expect(await draft.inputValue()).toBe('Keep this unsaved room draft');
        expect(await draft.evaluate(e => e === (window as unknown as { roomDraft: Element }).roomDraft)).toBe(true);
        expect(await page.getByRole('button', { name: 'Cancel', exact: true }).isVisible()).toBe(true);
      }
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await settledResize(page, 320);
      expect(await page.getByRole('button', { name: 'Edit room', exact: true }).isVisible()).toBe(true);
      expect(await page.locator('[data-spaces-view]').getAttribute('data-spaces-view')).toBe('selection');
      await page.getByRole('button', { name: 'Back to rooms & beds', exact: true }).click();
      expect(await page.locator('[data-spaces-view]').getAttribute('data-spaces-view')).toBe('navigator');
      expect(await search(page).isVisible()).toBe(true);
    } finally { await page.close(); }
  }, 30000);

  it.each(["click", "Enter", "Space"])("UR038: selected room collapses and reopens once with %s without changing inspector", async input => {
    const page = await open(1440, "?roomControls");
    try {
      const disclosure=page.getByRole("button",{name:/spaces in Dorm 101/});
      const inspector=page.locator('#spaces-selection-inspector');
      await inspector.evaluate(e=>{(window as unknown as {savedInspector:Element}).savedInspector=e;});
      expect(await disclosure.isEnabled()).toBe(true);
      const act=()=>input==="click"?disclosure.click():disclosure.press(input);
      await act();
      expect(await disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(await page.getByRole('button',{name:'101-A',exact:true}).isVisible()).toBe(false);
      expect(await page.getByRole('heading',{name:'Dorm 101',exact:true}).isVisible()).toBe(true);
      expect(await disclosure.evaluate(e=>document.activeElement===e)).toBe(true);
      await act();
      expect(await disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(await page.getByRole('button',{name:'101-A',exact:true}).isVisible()).toBe(true);
      expect(await inspector.evaluate(e=>e===(window as unknown as {savedInspector:Element}).savedInspector)).toBe(true);
    } finally { await page.close(); }
  },30000);

  it("UR038: hidden selected bed and dirty inspector survive resize; active editor still locks disclosure",async()=>{
    const page=await open(1440,'?roomControls');
    try{
      await page.getByRole('button',{name:'101-A',exact:true}).click();
      await page.getByRole('heading',{name:'101-A',exact:true}).waitFor();
      const disclosure=page.getByRole('button',{name:/spaces in Dorm 101/});
      expect(await disclosure.isEnabled()).toBe(true);await disclosure.click();
      expect(await page.getByRole('heading',{name:'101-A',exact:true}).isVisible()).toBe(true);
      await page.getByRole('button',{name:'Edit room',exact:true}).click();
      const draft=page.getByRole('textbox',{name:'Room name'});await draft.fill('Preserved edit');
      await draft.evaluate(e=>{(window as unknown as {savedDraft:Element}).savedDraft=e;});
      expect(await disclosure.isDisabled()).toBe(true);
      await settledResize(page,320);await settledResize(page,1440);
      expect(await draft.inputValue()).toBe('Preserved edit');
      expect(await draft.evaluate(e=>e===(window as unknown as {savedDraft:Element}).savedDraft)).toBe(true);
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      expect(await disclosure.getAttribute('aria-expanded')).toBe('false');await disclosure.press('Enter');
      expect(await page.getByRole('button',{name:'101-A',exact:true}).getAttribute('aria-pressed')).toBe('true');
      expect(await page.locator('[data-space-selection="bed:101A"]').count()).toBe(1);
    }finally{await page.close();}
  },30000);

  it("UR038: search reveals a collapsed selected branch without erasing its choice",async()=>{
    const page=await open(1440,'?roomControls');
    try{
      const disclosure=page.getByRole('button',{name:/spaces in Dorm 101/});
      expect(await disclosure.isEnabled()).toBe(true);await disclosure.click();
      await search(page).fill('101-A');
      expect(await disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(await disclosure.isDisabled()).toBe(true);
      expect(await disclosure.getAttribute('title')).toBe('Search results stay expanded');
      expect(await page.getByRole('button',{name:'101-A',exact:true}).isVisible()).toBe(true);
      await page.getByRole('button',{name:'Clear search',exact:true}).click();
      expect(await disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(await page.getByRole('heading',{name:'Dorm 101',exact:true}).isVisible()).toBe(true);
    }finally{await page.close();}
  },30000);

  it("UR038: selections do not erase a room's explicit choice; an authority workspace remount resets it",async()=>{
    const page=await open(1440,'?roomControls');
    try{
      const first=page.getByRole('button',{name:/spaces in Dorm 101/});expect(await first.isEnabled()).toBe(true);await first.click();
      await page.getByRole('button',{name:/^Dorm 102/}).click();
      expect(await page.getByRole('button',{name:/spaces in Dorm 102/}).getAttribute('aria-expanded')).toBe('true');
      await page.getByRole('button',{name:/^Dorm 101/}).click();
      expect(await first.getAttribute('aria-expanded')).toBe('false');
      await page.evaluate(()=>(window as unknown as {spacesHarness:{resetWorkspace():void}}).spacesHarness.resetWorkspace());
      await page.getByRole('button',{name:'Hide spaces in Dorm 101'}).waitFor();
      expect(await page.getByRole('button',{name:'101-A',exact:true}).isVisible()).toBe(true);
    }finally{await page.close();}
  },30000);

  it("starts selected room compact, with applied dates and critical notices outside the hidden controls", async () => {
    const page = await open();
    try {
      expect(await toggle(page).count()).toBe(1);
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
      expect(await toggle(page).textContent()).toContain("Sep 6, 2026");
      expect(await toggle(page).textContent()).toContain("Sep 8, 2026");
      expect(await page.locator(".spaces-room-toolbar").isVisible()).toBe(false);
      expect(await page.getByRole("heading", { name: "Dorm 101", exact: true }).isVisible()).toBe(true);
      expect(await page.getByRole("button", { name: "Edit room", exact: true }).isVisible()).toBe(true);
      expect(await page.locator("[data-source-notice]").isVisible()).toBe(true);
      expect(await page.locator("input[type=search]").count()).toBe(1);
      expect(await page.locator('form[aria-label="Night availability dates"]').count()).toBe(1);
      await toggle(page).click();
      expect(await search(page).isVisible()).toBe(true);
      expect(await page.getByText(/The Until date is not included/).isVisible()).toBe(true);
      expect(await page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    } finally { await page.close(); }
  }, 30000);

  it("keeps date nodes and unsubmitted drafts through collapse, resize and selection; summary remains applied until submit", async () => {
    const page = await open();
    try {
      await toggle(page).click();
      await arrival(page).evaluate(el => { (window as unknown as { savedArrival: Element }).savedArrival = el; });
      await arrival(page).click();
      await page.getByRole("button", { name: /September 5th, 2026/ }).click();
      expect(await arrival(page).getAttribute("aria-label")).toContain("September 5, 2026");
      expect(await toggle(page).textContent()).toContain("Sep 6, 2026");
      await toggle(page).click();
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
      expect(await toggle(page).evaluate(el => el === document.activeElement)).toBe(true);
      await toggle(page).press("Enter");
      await settledResize(page, 1440);
      await settledResize(page, 320);
      expect(await arrival(page).evaluate(el => el === (window as unknown as { savedArrival: Element }).savedArrival)).toBe(true);
      expect(await arrival(page).getAttribute("aria-label")).toContain("September 5, 2026");
      await page.getByRole("button", { name: "Check dates", exact: true }).click();
      expect(await toggle(page).textContent()).toContain("Sep 5, 2026");
      await page.getByRole("button", { name: "Back to rooms & beds" }).click();
      await page.getByRole("button", { name: /^Dorm 102/ }).click();
      await page.getByRole("heading", { name: "Dorm 102", exact: true }).waitFor();
      expect(await page.getByRole("heading", { name: "Dorm 102", exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
      expect(await page.locator(".spaces-room-toolbar input[type=search]").count()).toBe(1);
    } finally { await page.close(); }
  }, 30000);

  it.each(["search", "submit", "portal"])("retains the exact focused %s through wide-to-narrow resize without hiding or remounting", async target => {
    const page = await open(1440);
    try {
      if (target === "portal") {
        await arrival(page).click();
        await page.getByRole("button", { name: "Arrival date choose year" }).click();
        await page.getByRole("textbox", { name: "Arrival date year", exact: true }).fill("2027");
      } else await (target === "search" ? search(page) : page.getByRole("button", { name: "Check dates", exact: true })).focus();
      await page.evaluate(() => { (window as unknown as { focused: Element | null }).focused = document.activeElement; });
      await settledResize(page, 320);
      expect(await page.evaluate(() => document.activeElement === (window as unknown as { focused: Element }).focused)).toBe(true);
      expect(await page.locator(".spaces-room-toolbar").isVisible()).toBe(true);
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("true");
      if (target === "portal") {
        expect(await page.getByRole("textbox", { name: "Arrival date year", exact: true }).inputValue()).toBe("2027");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        expect(await arrival(page).evaluate(el => el === document.activeElement)).toBe(true);
      }
      await page.getByRole("heading", { name: "Dorm 101", exact: true }).focus();
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
    } finally { await page.close(); }
  }, 30000);

  it.each(["arrival", "search", "submit", "portal"])("R2: one pointer closes the %s focus-retained toolbar, and one independent click reopens it", async target => {
    const page = await open(320);
    try {
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
      await settledResize(page, 1440);
      await arrival(page).evaluate(el => { (window as unknown as {savedArrival:Element}).savedArrival = el; });
      if (target === "portal") {
        await arrival(page).click();
        await page.getByRole("button", {name:"Arrival date choose year"}).click();
        await page.getByRole("textbox", {name:"Arrival date year",exact:true}).fill("2031");
      } else await (target === "arrival" ? arrival(page) : target === "search" ? search(page) : page.getByRole("button", {name:"Check dates",exact:true})).focus();
      await settledResize(page,320);
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("true");
      await toggle(page).click();
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
      expect(await page.locator(".spaces-room-toolbar").isVisible()).toBe(false);
      expect(await toggle(page).evaluate(el => el === document.activeElement)).toBe(true);
      expect(await page.getByRole("dialog").count()).toBe(0);
      await toggle(page).click();
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("true");
      expect(await arrival(page).evaluate(el => el === (window as unknown as {savedArrival:Element}).savedArrival)).toBe(true);
      expect(await page.locator('form[aria-label="Night availability dates"]').count()).toBe(1);
    } finally { await page.close(); }
  },30000);

  it("R2: emulated touch closes and reopens once without changing the retained date node", async () => {
    const page=await open(1440,"",true);
    try {
      await arrival(page).evaluate(el => { (window as unknown as {savedArrival:Element}).savedArrival=el; });
      await arrival(page).focus(); await settledResize(page,320);
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("true");
      await toggle(page).tap();
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
      expect(await toggle(page).evaluate(el => el === document.activeElement)).toBe(true);
      await toggle(page).tap();
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("true");
      expect(await arrival(page).evaluate(el => el === (window as unknown as {savedArrival:Element}).savedArrival)).toBe(true);
    } finally { await page.close(); }
  },30000);

  it.each(["cancel", "pointer-elsewhere", "click-elsewhere"])("R2: %s clears a partially started pointer intent before any later activation", async interruption => {
    const page=await open(1440);
    try {
      await arrival(page).focus(); await settledResize(page,320);
      // Synthetic interruption events supplement native pointer/touch tests;
      // no physical-device cancellation behavior is inferred from this cell.
      await toggle(page).dispatchEvent("pointerdown",{isPrimary:true,button:0,pointerId:71,pointerType:"touch"});
      if(interruption==="cancel") await toggle(page).dispatchEvent("pointercancel",{isPrimary:true,pointerId:71,pointerType:"touch"});
      else await page.getByRole("button",{name:"Unrelated destination"}).dispatchEvent(interruption==="click-elsewhere"?"click":"pointerdown",{isPrimary:true,button:0,pointerId:72,detail:1});
      await page.getByRole("heading",{name:"Dorm 101",exact:true}).focus();
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
      await toggle(page).dispatchEvent("click",{detail:1});
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("true");
    } finally { await page.close(); }
  },30000);

  it.each(["Enter", "Space"])("R2: native %s toggles exactly once using current state after pointer cancellation", async key => {
    const page=await open(1440);
    try {
      await arrival(page).focus(); await settledResize(page,320);
      await toggle(page).dispatchEvent("pointerdown",{isPrimary:true,button:0,pointerId:71});
      await toggle(page).dispatchEvent("pointercancel",{pointerId:71});
      await toggle(page).focus();
      const before=await toggle(page).getAttribute("aria-expanded");
      await toggle(page).press(key);
      expect(await toggle(page).getAttribute("aria-expanded")).toBe(before==="true"?"false":"true");
      await toggle(page).press(key);
      expect(await toggle(page).getAttribute("aria-expanded")).toBe(before);
      expect(await toggle(page).evaluate(el=>el===document.activeElement)).toBe(true);
    } finally { await page.close(); }
  },30000);

  it("keeps wide and no-selection controls open, exact missing-target truth, and the same focused editor/draft on resize", async () => {
    const page = await open(1024, "?selected=");
    try {
      expect(await search(page).isVisible()).toBe(true);
      await settledResize(page, 320);
      expect(await search(page).isVisible()).toBe(true);
      await page.getByRole("button", { name: /^Dorm 101/ }).click();
      await page.getByRole("button", { name: "Edit room", exact: true }).click();
      await page.getByRole("textbox", { name: "Room name" }).fill("Retained dirty room draft");
      await settledResize(page, 1440); await settledResize(page, 320);
      expect(await page.getByRole("textbox", { name: "Room name" }).inputValue()).toBe("Retained dirty room draft");
      expect(await page.getByRole("textbox", { name: "Room name" }).evaluate(el => el === document.activeElement)).toBe(true);
      expect(await page.locator("[data-topology-editor]").count()).toBe(1);
      expect(await page.getByRole("button", { name: "Back to rooms & beds" }).isDisabled()).toBe(true);
      await page.goto(origin + "__spaces-disclosure?selected=missing");
      await page.getByRole("heading", { name: "Requested room is unavailable" }).waitFor();
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
      expect(await page.locator("[data-source-notice]").isVisible()).toBe(true);
    } finally { await page.close(); }
  }, 30000);

  it("does not offer date checking without inventory read and reports no runtime errors", async () => {
    const page = await open(320, "?noInventory");
    try {
      const find = page.getByRole("button", { name: "Find another room or bed" });
      await find.click();
      expect(await search(page).isVisible()).toBe(true);
      expect(await page.locator('form[aria-label="Night availability dates"]').count()).toBe(0);
      expect(runtimeErrors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it("does not invent an applied date for an invalid or incomplete deep-linked range", async () => {
    const page = await open(320, "?invalidDates");
    try {
      expect(await toggle(page).textContent()).toContain("Dates need checking");
      expect(await toggle(page).textContent()).not.toContain("Applied:");
      await toggle(page).click();
      expect(await page.getByRole("button", { name: "Check dates", exact: true }).isDisabled()).toBe(true);
      expect(await page.getByRole("alert").textContent()).toContain("No availability request is sent");
    } finally { await page.close(); }
  }, 30000);

  it.each(["Enter", "Space"])("hands %s Retry success to the exact visible selected context and retains native pending/repeat/offline focus", async key => {
    const page = await open(320, "?retry");
    try {
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await retry.focus(); await retry.press(key);
      expect(await retry.getAttribute("aria-disabled")).toBe("true");
      expect(await retry.evaluate(el => (el as HTMLButtonElement).disabled)).toBe(false);
      expect(await retry.evaluate(el => el === document.activeElement)).toBe(true);
      await retry.press("Enter"); await retry.press("Space");
      expect(await page.getByRole("status", { name: "Retry requests" }).textContent()).toBe("1");
      await page.evaluate(() => (window as unknown as {spacesHarness:{settle:(mode:string)=>void}}).spacesHarness.settle("stale"));
      await retry.press(key);
      expect(await page.getByRole("status", { name: "Retry requests" }).textContent()).toBe("2");
      await page.context().setOffline(true);
      const offline = page.getByRole("button", { name: "Reconnect to retry", exact: true });
      expect(await offline.evaluate(el => el === document.activeElement)).toBe(true);
      await offline.press("Enter");
      expect(await page.getByRole("status", { name: "Retry requests" }).textContent()).toBe("2");
      await page.context().setOffline(false);
      await page.evaluate(() => (window as unknown as {spacesHarness:{settle:(mode:string)=>void}}).spacesHarness.settle("ready"));
      await retry.waitFor({state:"detached"});
      expect(await page.getByRole("heading", { name: "Dorm 101", exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
      expect(await toggle(page).getAttribute("aria-expanded")).toBe("false");
    } finally { await page.close(); }
  }, 30000);

  it.each(["Enter", "Space"])("R2: restores %s retry focus when fetching actually unmounts the old notice and another failure remounts it", async key => {
    const page=await open(320,"?retry&replaceRetry");
    try {
      const retry=page.getByRole("button",{name:"Try again",exact:true});
      await retry.evaluate(el => { (window as unknown as {oldRetry:Element}).oldRetry=el; });
      await retry.focus(); await retry.press(key);
      await retry.waitFor({state:"detached"});
      expect(await page.evaluate(() => document.activeElement===document.body)).toBe(true);
      await page.evaluate(() => (window as unknown as {spacesHarness:{settle:(mode:string)=>void}}).spacesHarness.settle("pending-visible"));
      await retry.waitFor();
      expect(await retry.getAttribute("aria-busy")).toBe("true");
      expect(await page.evaluate(() => document.activeElement===document.body)).toBe(true);
      await page.evaluate(() => (window as unknown as {spacesHarness:{settle:(mode:string)=>void}}).spacesHarness.settle("stale"));
      await retry.waitFor();
      expect(await retry.evaluate(el => el !== (window as unknown as {oldRetry:Element}).oldRetry)).toBe(true);
      expect(await retry.evaluate(el => el === document.activeElement)).toBe(true);
      await retry.press(key); await retry.waitFor({state:"detached"});
      await page.evaluate(() => (window as unknown as {spacesHarness:{settle:(mode:string)=>void}}).spacesHarness.settle("ready"));
      expect(await page.getByRole("heading",{name:"Dorm 101",exact:true}).evaluate(el => el === document.activeElement)).toBe(true);
      expect(await page.getByRole("status",{name:"Retry requests"}).textContent()).toBe("2");
    } finally { await page.close(); }
  },30000);

  it.each(["move", "pointer", "Tab", "context", "denied", "notice", "unmount"])("R2: a remounted failed Retry does not steal focus after %s", async condition => {
    const page=await open(320,"?retry&replaceRetry");
    try {
      const retry=page.getByRole("button",{name:"Try again",exact:true});
      await retry.focus(); await retry.press("Enter"); await retry.waitFor({state:"detached"});
      const unrelated=page.getByRole("button",{name:"Unrelated destination"});
      if(condition==="move") await unrelated.focus();
      if(condition==="pointer") await page.mouse.click(5,5);
      if(condition==="Tab") await page.keyboard.press("Tab");
      if(condition==="context") await page.evaluate(() => (window as unknown as {spacesHarness:{changeContext:(value:string)=>void}}).spacesHarness.changeContext("changed actor / property / navigation"));
      if(condition==="denied") await page.evaluate(() => (window as unknown as {spacesHarness:{deny:()=>void}}).spacesHarness.deny());
      if(condition==="notice") await page.evaluate(() => (window as unknown as {spacesHarness:{changeNotice:(id:string)=>void}}).spacesHarness.changeNotice("availability"));
      if(condition==="unmount") await page.evaluate(() => (window as unknown as {spacesHarness:{unmount:()=>void}}).spacesHarness.unmount());
      await page.evaluate(() => (window as unknown as {spacesHarness:{settle:(mode:string)=>void}}).spacesHarness.settle("stale"));
      await retry.waitFor();
      expect(await retry.evaluate(el=>el===document.activeElement)).toBe(false);
      if(condition==="move") expect(await unrelated.evaluate(el=>el===document.activeElement)).toBe(true);
    } finally { await page.close(); }
  },30000);

  it.each(["move", "pointer", "context", "denied", "unmount"])("does not steal focus after %s cancels Retry ownership", async condition => {
    const page = await open(1024, "?retry");
    try {
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await retry.focus(); await retry.press("Enter");
      const unrelated = page.getByRole("button", { name: "Unrelated destination" });
      if (condition === "move") await unrelated.focus();
      if (condition === "pointer") await page.mouse.click(5, 5);
      if (condition === "context") await page.evaluate(() => (window as unknown as {spacesHarness:{changeContext:(value:string)=>void}}).spacesHarness.changeContext("new actor / property / route"));
      if (condition === "denied") await page.evaluate(() => (window as unknown as {spacesHarness:{deny:()=>void}}).spacesHarness.deny());
      if (condition === "unmount") await page.evaluate(() => (window as unknown as {spacesHarness:{unmount:()=>void}}).spacesHarness.unmount());
      await page.evaluate(() => (window as unknown as {spacesHarness:{settle:(mode:string)=>void}}).spacesHarness.settle("ready"));
      await retry.waitFor({state:"detached"});
      expect(await page.evaluate(() => document.activeElement?.matches('[data-inspector-heading], .spaces-room-back, input[type="search"]'))).toBe(false);
      if (condition === "move") expect(await unrelated.evaluate(el => el === document.activeElement)).toBe(true);
    } finally { await page.close(); }
  }, 30000);

  it.each(["", "missing"])("restores a truthful non-mutating successor for requested target '%s'", async selection => {
    const page = await open(320, "?retry&selected=" + selection);
    try {
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await retry.focus(); await retry.press("Enter");
      await page.evaluate(() => (window as unknown as {spacesHarness:{settle:(mode:string)=>void}}).spacesHarness.settle("ready"));
      await retry.waitFor({state:"detached"});
      if (selection) expect(await page.getByRole("heading", { name: "Requested room is unavailable" }).evaluate(el => el === document.activeElement)).toBe(true);
      else expect(await search(page).evaluate(el => el === document.activeElement)).toBe(true);
    } finally { await page.close(); }
  }, 30000);
});
