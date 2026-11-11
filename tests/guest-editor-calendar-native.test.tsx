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

// Actual GuestEditor and portalled DatePicker. Authority/save transitions are
// controlled component inputs, not real backend permissions or writes.
const fixture = `
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GuestEditor} from '/src/features/guests/GuestsPage.tsx';
import {resolveGuestUpdateAttempt} from '/src/features/guests/guestManagementAttempt.ts';
import '/src/styles.css';
const profile={guestId:'synthetic-guest',originPropertyId:'synthetic-property',displayName:'Morgan Guest',legalName:null,email:null,phone:null,dateOfBirth:'1990-06-12',nationalityCountryCode:null,preferredLanguageTag:null,languageTags:[],notes:null,status:1,version:7,createdBy:'synthetic-staff',createdAtUtc:'2026-09-01T10:00:00Z',lastChangedBy:'synthetic-staff',lastChangedAtUtc:'2026-09-01T10:00:00Z',archivedAtUtc:null};
const payload={displayName:profile.displayName,legalName:null,email:null,phone:null,dateOfBirth:profile.dateOfBirth,nationalityCountryCode:null,preferredLanguageTag:null,languageTags:[],notes:null};
const attempt=resolveGuestUpdateAttempt(null,profile.originPropertyId,profile.guestId,profile.version,payload);
window.guestSubmissions=[];
function App(){const [boundary,setBoundary]=useState(null);useEffect(()=>{window.setGuestBoundary=setBoundary;},[]);
return <main className='p-4'><GuestEditor state={new URLSearchParams(location.search).get('mode')==='create'?null:profile}
 submitting={boundary==='submitting'} error={null} sources={[]} authorityCurrent={boundary!=='authority'} authorityMessage='Guest access is being checked.'
 recovery={boundary==='recovery'?{attempt,uncertain:true}:null} recoveryAllowed={false} onRetry={()=>{}}
 onSubmit={values=>window.guestSubmissions.push(values)} onClose={()=>{}}/></main>;}
createRoot(document.getElementById('root')).render(<App/>);
`;

let server: ViteDevServer;
let browser: Browser;
let origin: string;
const errors: string[] = [];
beforeAll(async () => {
  const root = process.cwd(), entry = normalizePath(root + "/__guest_editor_calendar_fixture.tsx");
  server = await createServer({ configFile: false, root, logLevel: "error",
    cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-guest-editor-calendar-")),
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-router", "@tanstack/react-query", "@radix-ui/react-popover", "@daypicker/react", "lucide-react"] },
    plugins: [react(), tailwindcss(), {
      name: "guest-editor-calendar-fixture",
      resolveId: id => id === "/__guest_editor_calendar_fixture.tsx" || id === entry ? entry : undefined,
      load: id => id === entry ? fixture : undefined,
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__guest-editor-calendar")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__guest_editor_calendar_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0];
  browser = await launchNativeChromium();
  await warmNativeFixture(browser, new URL("/__guest-editor-calendar", origin).href);
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(errors).toEqual([]); });

type Boundary = "authority" | "submitting" | "recovery";
type FixtureWindow = Window & {
  setGuestBoundary: (value: Boundary | null) => void;
  guestSubmissions: { displayName: string; dateOfBirth: string }[];
};
const cases = [
  { mode: "create", boundary: "authority", view: "days" },
  { mode: "create", boundary: "submitting", view: "years" },
  { mode: "edit", boundary: "authority", view: "months" },
  { mode: "edit", boundary: "submitting", view: "days" },
  { mode: "edit", boundary: "recovery", view: "years" },
] as const;
async function submissions(page: Page) { return page.evaluate(() => (window as unknown as FixtureWindow).guestSubmissions); }

it.each(cases)("closes the $mode birth-date $view picker during $boundary and preserves the draft", async ({ mode, boundary, view }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(new URL(`/__guest-editor-calendar?mode=${mode}`, origin).href);
    await page.getByLabel("Display name", { exact: true }).fill("Draft guest name");
    const trigger = page.locator('form button[aria-label^="Date of birth (optional)"]');
    const calendar = page.getByRole("dialog", { name: "Date of birth (optional) calendar", exact: true });
    const date = page.locator('input[name="dateOfBirth"]');
    if (mode === "create") {
      await trigger.click();
      await calendar.getByRole("gridcell").getByRole("button").nth(15).click();
    }
    const draftDate = await date.inputValue();
    expect(draftDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await trigger.click();
    if (view !== "days") await calendar.getByRole("button", { name: `Date of birth (optional) ${view === "years" ? "choose year" : "month"}`, exact: true }).click();
    await page.evaluate(value => (window as unknown as FixtureWindow).setGuestBoundary(value), boundary);
    await expect.poll(() => trigger.isDisabled()).toBe(true);
    await expect.poll(() => calendar.isVisible()).toBe(false);
    await page.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(await submissions(page)).toEqual([]);
    await page.evaluate(() => (window as unknown as FixtureWindow).setGuestBoundary(null));
    await expect.poll(() => trigger.isEnabled()).toBe(true);
    expect(await date.inputValue()).toBe(draftDate);
    expect(await page.getByLabel("Display name", { exact: true }).inputValue()).toBe("Draft guest name");
    await trigger.click();
    const choice = calendar.getByRole("gridcell").getByRole("button").nth(16);
    await choice.click();
    await expect.poll(() => calendar.isVisible()).toBe(false);
    const nextDate = await date.inputValue();
    expect(nextDate).not.toBe(draftDate);
    await page.getByRole("button", { name: mode === "create" ? "Create guest record" : "Save changes", exact: true }).click();
    expect(await submissions(page)).toEqual([expect.objectContaining({ displayName: "Draft guest name", dateOfBirth: nextDate })]);
  } finally { await page.close(); }
}, 30000);
