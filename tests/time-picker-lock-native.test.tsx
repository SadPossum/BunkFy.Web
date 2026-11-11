import { launchNativeChromium } from "./support/nativeChromium";
import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Actual time widget and correction form; local state/callback counters only.
// No server correction, booking or permission acceptance is claimed.
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TimePicker} from '/src/components/ui/TimePicker.tsx';
import {ReservationCorrectionForm} from '/src/features/data-rights/ReservationCorrectionForm.tsx';
import '/src/styles.css';
const params=new URLSearchParams(location.search);
window.timeChanges=[];window.timeSubmissions=[];
const reservation={reservationId:'reservation',propertyId:'property',version:7,detailsRevision:3,primaryGuestName:'Draft guest',guestCount:2,email:'guest@example.invalid',phone:null,notes:'Retained notes',expectedArrivalTime:'16:45:00',expectedDepartureTime:'10:00:00'};
const execution={executionId:'execution',caseId:'case',approvalRevision:1,subject:{recordVersion:7}};
function Fixture(){const [disabled,setDisabled]=useState(false),[value,setValue]=useState('16:45');window.setTimeDisabled=setDisabled;
return <main className='p-6'>{params.has('correction')?<ReservationCorrectionForm reservation={reservation} execution={execution} disabled={disabled} pending={disabled} error={null} onSubmit={body=>window.timeSubmissions.push(body)}/>
:<form onSubmit={event=>{event.preventDefault();window.timeSubmissions.push('submitted');}}><TimePicker value={value} onChange={next=>{window.timeChanges.push(next);setValue(next);}} ariaLabel='Stay time' name='stayTime' required={params.has('required')} disabled={disabled}/><output data-value>{value}</output></form>}</main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
let server: ViteDevServer, browser: Browser, origin: string;
const errors: string[] = [];
beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__time_lock_fixture.tsx");
  server = await createServer({ configFile: false, root: process.cwd(), logLevel: "error", cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-time-lock-native-")),
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "lucide-react", "@radix-ui/react-popover"] },
    plugins: [react(), tailwindcss(), {
      name: "time-lock-fixture",
      resolveId: id => id === entry || id === "/__time_lock_fixture.tsx" ? entry : undefined,
      load: id => id === entry ? fixture : undefined,
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__time-lock")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__time_lock_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(errors).toEqual([]); });

describe("native time picker lock boundary", () => {
  it.each(["en-GB", "en-US"].flatMap(locale => [false, true].map(required => ({ locale, required }))))("closes a $locale picker on disabled (required:$required) without applying its local draft", async ({ locale, required }) => {
    const page = await browser.newPage({ locale, viewport: { width: 390, height: 844 } }); page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(origin + "__time-lock" + (required ? "?required" : ""));
      const trigger = page.getByRole("button", { name: "Stay time", exact: true }), popup = page.getByRole("dialog", { name: "Stay time picker", exact: true });
      await trigger.click(); await page.getByRole("textbox", { name: "Stay time minute", exact: true }).fill("12");
      await page.evaluate(() => (window as unknown as { setTimeDisabled(value: boolean): void }).setTimeDisabled(true));
      await expect.poll(() => trigger.isDisabled()).toBe(true); await expect.poll(() => popup.isVisible()).toBe(false);
      expect(await page.locator("[data-value]").textContent()).toBe("16:45");
      expect(await page.evaluate(() => (window as unknown as { timeChanges: string[] }).timeChanges)).toEqual([]);
      expect(await page.locator("form").evaluate(form => new FormData(form as HTMLFormElement).has("stayTime"))).toBe(false);
      await page.evaluate(() => (window as unknown as { setTimeDisabled(value: boolean): void }).setTimeDisabled(false));
      await trigger.click(); expect(await page.getByRole("textbox", { name: "Stay time minute", exact: true }).inputValue()).toBe("45");
      await page.getByRole("textbox", { name: "Stay time minute", exact: true }).fill("30"); await page.keyboard.press("Enter");
      await expect.poll(() => popup.isVisible()).toBe(false); expect(await page.locator("[data-value]").textContent()).toBe("16:30");
      expect(await page.evaluate(() => (window as unknown as { timeSubmissions: unknown[] }).timeSubmissions)).toEqual([]);
    } finally { await page.close(); }
  }, 20000);

  it.each(["en-GB", "en-US"])("keeps normal %s apply and optional clear behavior", async locale => {
    const page = await browser.newPage({ locale }); page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(origin + "__time-lock"); await page.getByRole("button", { name: "Stay time", exact: true }).click();
      expect(await page.getByRole("textbox", { name: "Stay time hour", exact: true }).inputValue()).toBe(locale === "en-US" ? "04" : "16");
      await page.getByRole("textbox", { name: "Stay time minute", exact: true }).fill("25"); await page.getByRole("button", { name: "Apply", exact: true }).click();
      expect(await page.locator("[data-value]").textContent()).toBe("16:25");
      await page.getByRole("button", { name: "Clear stay time", exact: true }).click();
      expect(await page.locator("[data-value]").textContent()).toBe("");
      expect(await page.evaluate(() => (window as unknown as { timeChanges: string[] }).timeChanges)).toEqual(["16:25", ""]);
    } finally { await page.close(); }
  }, 20000);

  it.each(["Expected arrival time", "Expected departure time"])("closes the correction %s picker without changing the approved form draft", async label => {
    const page = await browser.newPage({ locale: "en-GB" }); page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(origin + "__time-lock?correction");
      const trigger = page.getByRole("button", { name: label, exact: true }), popup = page.getByRole("dialog", { name: label + " picker", exact: true });
      const saved = await trigger.innerText(); await trigger.click(); await page.getByRole("textbox", { name: label + " minute", exact: true }).fill("22");
      await page.evaluate(() => (window as unknown as { setTimeDisabled(value: boolean): void }).setTimeDisabled(true));
      await expect.poll(() => trigger.isDisabled()).toBe(true); await expect.poll(() => popup.isVisible()).toBe(false);
      expect(await trigger.innerText()).toBe(saved);
      expect(await page.evaluate(() => (window as unknown as { timeSubmissions: unknown[] }).timeSubmissions)).toEqual([]);
      await page.evaluate(() => (window as unknown as { setTimeDisabled(value: boolean): void }).setTimeDisabled(false));
      await trigger.click(); expect(await page.getByRole("textbox", { name: label + " minute", exact: true }).inputValue()).toBe(label.includes("arrival") ? "45" : "00");
      await page.getByRole("textbox", { name: label + " minute", exact: true }).fill("35"); await page.getByRole("button", { name: "Apply", exact: true }).click();
      expect(await trigger.innerText()).not.toBe(saved); expect(await page.getByRole("textbox", { name: "Primary guest", exact: true }).inputValue()).toBe("Draft guest");
      expect(await page.evaluate(() => (window as unknown as { timeSubmissions: unknown[] }).timeSubmissions)).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
});
