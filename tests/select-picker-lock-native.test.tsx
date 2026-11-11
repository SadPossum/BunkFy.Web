import { launchNativeChromium } from "./support/nativeChromium";
import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Real widgets and role wrapper; local callback counters, no access grants.
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SelectPicker} from '/src/components/ui/SelectPicker.tsx';
import {AccessProfilePicker} from '/src/features/workspaces/WorkspaceAccessControls.tsx';
import '/src/styles.css';
const params=new URLSearchParams(location.search);
const options=[{value:'alpha',label:'Front desk'},{value:'unavailable',label:'Unavailable',disabled:true},{value:'beta',label:'Housekeeping'}];
window.selectChanges=[];window.selectSubmits=[];
function Fixture(){const [disabled,setDisabled]=useState(false),[value,setValue]=useState('alpha');window.setSelectDisabled=setDisabled;
const change=next=>{window.selectChanges.push(next);setValue(next);};
return <main className='p-6'><form onSubmit={event=>{event.preventDefault();window.selectSubmits.push('submitted');}}>
{params.has('role')?<AccessProfilePicker profiles={options.filter(x=>!x.disabled).map(x=>({profileId:x.value,displayName:x.label,description:'A workspace role'}))} value={value} onValueChange={change} disabled={disabled}/>
:<SelectPicker value={value} onValueChange={change} options={options} ariaLabel='Team role' searchable={params.has('searchable')} disabled={disabled}/>}
<output data-value>{value}</output></form></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
let server: ViteDevServer, browser: Browser, origin: string;
const errors: string[] = [];
beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__select_lock_fixture.tsx");
  server = await createServer({ configFile: false, root: process.cwd(), logLevel: "error", cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-select-lock-native-")),
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "lucide-react", "@radix-ui/react-popover", "@radix-ui/react-select"] },
    plugins: [react(), tailwindcss(), {
      name: "select-lock-fixture",
      resolveId: id => id === entry || id === "/__select_lock_fixture.tsx" ? entry : undefined,
      load: id => id === entry ? fixture : undefined,
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__select-lock")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__select_lock_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(errors).toEqual([]); });

describe("native select picker disabled transition", () => {
  it.each([390, 1440].flatMap(width => ["basic", "searchable", "role"].map(kind => ({ width, kind }))))("$width: closes an open $kind picker when disabled and preserves selection through recovery", async ({ width, kind }) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(origin + "__select-lock" + (kind === "basic" ? "" : "?" + kind));
      // Radix's modal listbox hides the outside trigger from the accessibility tree.
      const trigger = kind === "searchable" ? page.getByRole("button", { name: "Team role", exact: true }) : page.getByRole("combobox", { name: kind === "role" ? "Role" : "Team role", exact: true, includeHidden: true });
      const popup = kind === "searchable" ? page.getByRole("dialog", { name: "Team role picker", exact: true }) : page.getByRole("listbox");
      await trigger.click(); await popup.waitFor();
      if (kind === "searchable") await page.getByRole("combobox", { name: "Search team role", exact: true }).fill("House");
      await page.evaluate(() => (window as unknown as { setSelectDisabled(value: boolean): void }).setSelectDisabled(true));
      await expect.poll(() => trigger.isDisabled()).toBe(true); await expect.poll(() => popup.isVisible()).toBe(false);
      expect(await page.locator("[data-value]").textContent()).toBe("alpha");
      expect(await page.evaluate(() => (window as unknown as { selectChanges: string[] }).selectChanges)).toEqual([]);
      await page.evaluate(() => (window as unknown as { setSelectDisabled(value: boolean): void }).setSelectDisabled(false));
      await trigger.click(); await popup.waitFor();
      if (kind === "searchable") expect(await page.getByRole("combobox", { name: "Search team role", exact: true }).inputValue()).toBe("");
      await page.getByRole("option", { name: kind === "role" ? /Housekeeping/ : "Housekeeping", exact: kind !== "role" }).click();
      await expect.poll(() => popup.isVisible()).toBe(false);
      expect(await page.locator("[data-value]").textContent()).toBe("beta");
      expect(await page.evaluate(() => (window as unknown as { selectChanges: string[] }).selectChanges)).toEqual(["beta"]);
      expect(await page.evaluate(() => (window as unknown as { selectSubmits: unknown[] }).selectSubmits)).toEqual([]);
    } finally { await page.close(); }
  }, 20000);

  it.each(["basic", "searchable"])("preserves ordinary %s keyboard selection and excludes unavailable options", async kind => {
    const page = await browser.newPage(); page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(origin + "__select-lock" + (kind === "searchable" ? "?searchable" : ""));
      const trigger = kind === "searchable" ? page.getByRole("button", { name: "Team role", exact: true }) : page.getByRole("combobox", { name: "Team role", exact: true });
      await trigger.focus(); await page.keyboard.press(kind === "basic" ? "ArrowDown" : "Enter");
      await page.getByRole("option", { name: "Unavailable", exact: true }).waitFor();
      expect(await page.getByRole("option", { name: "Unavailable", exact: true }).getAttribute("aria-disabled")).toBe("true");
      if (kind === "searchable") await page.getByRole("combobox", { name: "Search team role", exact: true }).fill("House");
      else await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect.poll(() => page.locator("[data-value]").textContent()).toBe("beta");
      expect(await page.evaluate(() => (window as unknown as { selectSubmits: unknown[] }).selectSubmits)).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
});
