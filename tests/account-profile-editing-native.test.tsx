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

// Actual self-service profile panel and shared onboarding fields. Only the
// account data and transport are synthetic; no backend authorization claim.
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AccountStaffProfilePanel} from '/src/features/account/AccountStaffProfilePanel.tsx';
import {ApiError} from '/src/api/client.ts';
import '/src/styles.css';
window.profileWrites=[];window.profileReadCount=0;window.profileSaveStatus=200;
window.profileHold=new URLSearchParams(location.search).get('hold');
let saved={staffMemberId:'synthetic-member',displayName:'Morgan Lee',legalName:null,workEmail:null,workPhone:null,jobTitle:null,department:null,version:7};
async function request(path,options){
 if(path!=='/api/staff/me')throw Error('Unexpected profile path');
 if(options?.method==='PUT'){
  const payload=JSON.parse(options.body);window.profileWrites.push(payload);
  if(window.profileHold==='write')await new Promise(resolve=>window.releaseProfile=resolve);
  if(window.profileSaveStatus!==200)throw new ApiError('Synthetic profile save failure',window.profileSaveStatus);
  saved={...saved,...payload,version:saved.version+1};
  return {staffMemberId:saved.staffMemberId,version:saved.version};
 }
 window.profileReadCount++;
 if(window.profileHold==='read')await new Promise(resolve=>window.releaseProfile=resolve);
 return {...saved};
}
function App(){const [member,setMember]=useState(saved);return <main className='p-4'><AccountStaffProfilePanel member={member} focused={false} canMutate request={request} onUpdated={setMember}/></main>;}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{mutations:{retry:false}}})}><App/></QueryClientProvider>);
`;

let server: ViteDevServer;
let browser: Browser;
let origin: string;
const errors: string[] = [];
beforeAll(async () => {
  const root = process.cwd(), entry = normalizePath(root + "/__account_profile_fixture.tsx");
  server = await createServer({ configFile: false, root, logLevel: "error",
    cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-account-profile-")),
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "@tanstack/react-query", "lucide-react"] },
    plugins: [react(), tailwindcss(), {
      name: "account-profile-fixture",
      resolveId: id => id === "/__account_profile_fixture.tsx" || id === entry ? entry : undefined,
      load: id => id === entry ? fixture : undefined,
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__account-profile")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__account_profile_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0];
  browser = await launchNativeChromium();
  await warmNativeFixture(browser, new URL("/__account-profile", origin).href);
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(errors).toEqual([]); });

type ProfileWrite = { operationId: string; expectedVersion: number; displayName: string };
type FixtureWindow = Window & {
  profileWrites: ProfileWrite[];
  profileReadCount: number;
  profileSaveStatus: number;
  profileHold: string | null;
  releaseProfile: () => void;
};
async function open(hold = "write") {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(new URL(`/__account-profile?hold=${hold}`, origin).href);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  return page;
}
async function writes(page: Page) {
  return page.evaluate(() => (window as unknown as FixtureWindow).profileWrites);
}
async function release(page: Page) {
  await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.profileHold = null; fixture.releaseProfile(); });
}

it.each(["write", "read"])("keeps profile fields fixed during the pending %s and blocks another submit", async hold => {
  const page = await open(hold);
  try {
    await page.getByLabel("Display name", { exact: true }).fill("Morgan Updated");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect.poll(() => writes(page).then(items => items.length)).toBe(1);
    if (hold === "read") await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).profileReadCount)).toBe(1);
    for (const field of await page.locator("form input").all()) expect(await field.isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Save profile", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Cancel", exact: true }).isDisabled()).toBe(true);
    await page.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await writes(page)).toHaveLength(1);
    await release(page);
    await page.getByRole("button", { name: "Edit profile", exact: true }).waitFor();
    expect(await page.getByText("Morgan Updated", { exact: true }).count()).toBe(1);
  } finally { await page.close(); }
}, 30000);

it("retains the submitted draft after a failed save and safely reuses its operation on retry", async () => {
  const page = await open("none");
  try {
    await page.evaluate(() => { (window as unknown as FixtureWindow).profileSaveStatus = 503; });
    await page.getByLabel("Display name", { exact: true }).fill("Morgan Retry");
    await page.getByLabel("Job title (optional)", { exact: true }).fill("Night manager");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.getByLabel("Display name", { exact: true }).inputValue()).toBe("Morgan Retry");
    expect(await page.getByLabel("Job title (optional)", { exact: true }).inputValue()).toBe("Night manager");
    for (const field of await page.locator("form input").all()) expect(await field.isEnabled()).toBe(true);
    await page.evaluate(() => { (window as unknown as FixtureWindow).profileSaveStatus = 200; });
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await page.getByRole("button", { name: "Edit profile", exact: true }).waitFor();
    const attempts = await writes(page);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(await page.getByText("Morgan Retry", { exact: true }).count()).toBe(1);
  } finally { await page.close(); }
}, 30000);

it("limits typed job titles and departments to the accepted staff profile length", async () => {
  const page = await open();
  try {
    for (const name of ["Job title (optional)", "Department (optional)"]) {
      const field = page.getByLabel(name, { exact: true });
      await field.pressSequentially("N".repeat(160));
      expect(await field.inputValue()).toHaveLength(128);
    }
    expect(await page.getByLabel("Display name", { exact: true }).getAttribute("maxlength")).toBe("256");
    expect(await page.getByLabel("Work email (optional)", { exact: true }).getAttribute("maxlength")).toBe("320");
    expect(await page.getByLabel("Work phone (optional)", { exact: true }).getAttribute("maxlength")).toBe("64");
    expect(await writes(page)).toHaveLength(0);
  } finally { await page.close(); }
}, 30000);
