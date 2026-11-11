import { launchNativeChromium } from "./support/nativeChromium";
import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The test server exposes the existing local form without changing its product
// exports. Only session transport/authority props are synthetic, not the form.
// No server privacy case, authorization, approval or execution is exercised.
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {CreatePrivacyRequestModal} from '/src/features/data-rights/PrivacyRequestsPage.tsx';
import {ApiError} from '/src/api/client.ts';import '/src/styles.css';
const params=new URLSearchParams(location.search);window.caseWrites=[];window.casePending=[];window.caseCreated=0;window.caseSettled=0;
window.caseRequest=(path,options)=>{window.caseWrites.push({path,...JSON.parse(options.body)});return new Promise((resolve,reject)=>window.casePending.push(status=>status===200?resolve({id:'fixture-case'}):reject(new ApiError('Controlled case creation failure',status)))).finally(()=>window.caseSettled++);};
window.releaseCase=status=>window.casePending.shift()(status);
function Fixture(){const [open,setOpen]=useState(true),[mounted,setMounted]=useState(true),[current,setCurrent]=useState(true);window.setCaseAuthority=setCurrent;window.unmountCaseForm=()=>setMounted(false);
return <main className='p-6'><button onClick={()=>setOpen(true)}>Open draft</button>{mounted&&<CreatePrivacyRequestModal open={open} scope={params.has('staff')?{kind:'staff'}:{kind:'guest',propertyId:'property'}} operatorScopeKey='operator' authorityCurrent={current} authoritySource={{label:'Privacy permissions',state:current?'ready':'stale',isFetching:false,refetch:async()=>setCurrent(true)}} onClose={()=>setOpen(false)} onCreated={async()=>{window.caseCreated++;if(params.has('readback'))await new Promise(resolve=>window.releaseCaseReadback=resolve);setOpen(false);}}/>}</main>;}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{mutations:{retry:false}}})}><Fixture/></QueryClientProvider>);
`;
let server: ViteDevServer, browser: Browser, origin: string;
const errors: string[] = [];
beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__privacy_case_fixture.tsx"), form = normalizePath(process.cwd() + "/src/features/data-rights/PrivacyRequestsPage.tsx"), session = normalizePath(process.cwd() + "/src/app/session.tsx");
  server = await createServer({ configFile: false, root: process.cwd(), logLevel: "error", cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-privacy-case-native-")),
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "@tanstack/react-query", "lucide-react", "@radix-ui/react-select", "@radix-ui/react-popover", "react-router"] },
    plugins: [{
      name: "privacy-case-fixture",
      resolveId(id) {
        if (id === entry || id === "/__privacy_case_fixture.tsx") return entry;
      },
      load: id => id === entry ? fixture : id === session ? "export const useSession=()=>({request:(...args)=>window.caseRequest(...args)});" : undefined,
      transform: (code, id) => id.split("?")[0] === form ? code + "\nexport { CreatePrivacyRequestModal };\n" : undefined,
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__privacy-case")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__privacy_case_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }, react(), tailwindcss()], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(errors).toEqual([]); });
type CaseWindow = Window & { caseWrites: Array<{ operationId: string }>; caseCreated: number; caseSettled: number; releaseCase(status: number): void; setCaseAuthority(current: boolean): void; unmountCaseForm(): void; releaseCaseReadback(): void };
async function open(query = "") { const page = await browser.newPage({ viewport: { width: 1024, height: 900 } }); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto(origin + "__privacy-case" + query); await page.getByRole("dialog").waitFor(); return page; }
const type = (page: Page) => page.getByRole("combobox", { name: "Privacy request type", exact: true, includeHidden: true });
const source = (page: Page) => page.getByRole("combobox", { name: "Privacy request source", exact: true, includeHidden: true });
const submit = (page: Page) => page.getByRole("button", { name: "Create request", exact: true });
const writes = (page: Page) => page.evaluate(() => (window as unknown as CaseWindow).caseWrites);
const release = (page: Page, status: number) => page.evaluate(status => (window as unknown as CaseWindow).releaseCase(status), status);

describe("native privacy case draft ownership", () => {
  it.each(["guest", "staff"])("freezes the %s intent while pending and preserves it and its retry identity after failure", async scope => {
    const page = await open(scope === "staff" ? "?staff" : "");
    try {
      await source(page).click(); await page.getByRole("option", { name: /An authorized representative/ }).click();
      const selected = await source(page).innerText(); await submit(page).click(); await expect.poll(async () => (await writes(page)).length).toBe(1);
      await expect.poll(() => type(page).isDisabled()).toBe(true); expect(await source(page).isDisabled()).toBe(true);
      await release(page, 503); await expect.poll(() => type(page).isDisabled()).toBe(false); expect(await source(page).innerText()).toBe(selected);
      await submit(page).click(); await expect.poll(async () => (await writes(page)).length).toBe(2);
      const requests = await writes(page); expect(requests[1]).toEqual(requests[0]);
      await release(page, 503); await expect.poll(() => type(page).isDisabled()).toBe(false); expect(await page.evaluate(() => (window as unknown as CaseWindow).caseCreated)).toBe(0);
    } finally { await page.close(); }
  }, 20000);

  it("keeps the accepted intent fixed until its parent readback finishes", async () => {
    const page = await open("?readback");
    try {
      await submit(page).click(); await expect.poll(async () => (await writes(page)).length).toBe(1); await release(page, 200);
      await expect.poll(() => page.evaluate(() => (window as unknown as CaseWindow).caseCreated)).toBe(1);
      await expect.poll(() => type(page).isDisabled()).toBe(true); expect(await source(page).isDisabled()).toBe(true); expect(await page.getByRole("button", { name: "Close dialog", exact: true }).isDisabled()).toBe(true);
      await page.evaluate(() => (window as unknown as CaseWindow).releaseCaseReadback()); await expect.poll(() => page.getByRole("dialog").isVisible()).toBe(false);
    } finally { await page.close(); }
  }, 20000);

  it.each(["guest", "staff"])("does not deliver late %s creation to a form owner that unmounted", async scope => {
    const page = await open(scope === "staff" ? "?staff" : "");
    try {
      await submit(page).click(); await expect.poll(async () => (await writes(page)).length).toBe(1); await page.evaluate(() => (window as unknown as CaseWindow).unmountCaseForm());
      await expect.poll(() => page.getByRole("dialog").isVisible()).toBe(false); await release(page, 200);
      await expect.poll(() => page.evaluate(() => (window as unknown as CaseWindow).caseSettled)).toBe(1); await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      expect(await page.evaluate(() => (window as unknown as CaseWindow).caseCreated)).toBe(0);
    } finally { await page.close(); }
  }, 20000);

  it.each(["guest", "staff"])("closes the %s type popup and keeps the draft when authority is no longer current", async scope => {
    const page = await open(scope === "staff" ? "?staff" : "");
    try {
      const selected = await type(page).innerText(); await type(page).click(); await page.getByRole("listbox").waitFor(); await page.evaluate(() => (window as unknown as CaseWindow).setCaseAuthority(false));
      await expect.poll(() => type(page).isDisabled()).toBe(true); await expect.poll(() => page.getByRole("listbox").isVisible()).toBe(false); expect(await type(page).innerText()).toBe(selected);
      await page.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit()); expect(await writes(page)).toEqual([]);
      await page.evaluate(() => (window as unknown as CaseWindow).setCaseAuthority(true)); await expect.poll(() => type(page).isDisabled()).toBe(false);
    } finally { await page.close(); }
  }, 20000);

  it("ignores another submit event while the same create is pending", async () => {
    const page = await open();
    try {
      await submit(page).click(); await expect.poll(async () => (await writes(page)).length).toBe(1); await page.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit());
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50))); expect((await writes(page)).length).toBe(1);
    } finally { await page.close(); }
  }, 20000);

  it("keeps Escape and all close actions disabled while create is pending", async () => {
    const page = await open();
    try {
      await submit(page).click(); await expect.poll(async () => (await writes(page)).length).toBe(1); await expect.poll(() => page.getByRole("button", { name: "Close dialog", exact: true }).isDisabled()).toBe(true);
      expect(await page.getByRole("button", { name: "Cancel", exact: true }).isDisabled()).toBe(true);
      await page.keyboard.press("Escape"); expect(await page.getByRole("dialog").isVisible()).toBe(true);
    } finally { await page.close(); }
  }, 20000);

  it("keeps ordinary cancellation and a fresh default draft without sending anything", async () => {
    const page = await open();
    try {
      await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect.poll(() => page.getByRole("dialog").isVisible()).toBe(false); await page.getByRole("button", { name: "Open draft", exact: true }).click();
      expect(await type(page).innerText()).toContain("Data export"); expect(await writes(page)).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
});
