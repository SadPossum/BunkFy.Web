import { launchNativeChromium } from "./support/nativeChromium";
import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Production modal, SessionProvider and HTTP transport. Only server responses
// and inventory are synthetic; no backend mutation or real Auth claim.
const propertyId = "10000000-0000-4000-8000-000000000001";
const roomId = "20000000-0000-4000-8000-000000000001";
const unitId = "30000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
const subjectId = "60000000-0000-4000-8000-000000000001";
const sessionId = "70000000-0000-4000-8000-000000000001";
const fixture = `
import React,{useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {SessionProvider,useSession} from "/src/app/session.tsx";
import {ManualBlockGroupWorkflowModal} from "/src/features/inventory/ManualBlockGroupWorkflowModal.tsx";
import "/src/styles.css";
const rooms=[{propertyId:"${propertyId}",roomId:"${roomId}",roomName:"Garden",buildingLabel:null,floorLabel:null,salesMode:3,version:1,
 units:[{propertyId:"${propertyId}",roomId:"${roomId}",inventoryUnitId:"${unitId}",bedId:"${unitId}",kind:2,label:"A",isSellable:true,isTopologyActive:true}]}];
const group={blockGroupId:"${groupId}",version:7,target:{kind:4,buildingLabel:null,floorLabel:null,roomId:"${roomId}",inventoryUnitId:null},arrival:"2026-11-12",departure:"2026-11-14",reason:"Existing maintenance"};
function Fixture(){const auth=useSession(),attempt=useRef(null),[open,setOpen]=useState(true),[completed,setCompleted]=useState(0);
 return <main><output data-session>{auth.session?"ready":"restoring"}</output><output data-completed>{completed}</output>{auth.session&&open&&<ManualBlockGroupWorkflowModal
  workflow={location.search.includes("replace")?{kind:"replace",group}:{kind:"create"}} propertyId="${propertyId}" propertyName="Synthetic property" propertyTimeZoneId="UTC" rooms={rooms} attemptRef={attempt}
  authorityCurrent={true} onCompleted={()=>setCompleted(n=>n+1)} onRefreshRequired={()=>{}} onClose={()=>setOpen(false)}/>}</main>;}
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><SessionProvider><Fixture/></SessionProvider></QueryClientProvider>);
`;
let server: ViteDevServer, browser: Browser, origin: string;
const runtimeErrors: string[] = [];
beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__block_group_preview_fixture.tsx");
  server = await createServer({
    configFile: false, root: process.cwd(), logLevel: "error",
    cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-block-group-preview-")),
    define: { "import.meta.env.VITE_BUNKFY_API_BASE_URL": "window.location.origin" },
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "@tanstack/react-query", "lucide-react", "@radix-ui/react-popover", "@radix-ui/react-select", "@daypicker/react"] },
    plugins: [react(), tailwindcss(), {
      name: "block-group-preview-fixture",
      resolveId: id => id === entry || id === "/__block_group_preview_fixture.tsx" ? entry : undefined,
      load: id => id === entry ? fixture : undefined,
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/__block-group-preview")) return next();
          void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__block_group_preview_fixture.tsx"></script></body></html>')
            .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
        });
      },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(runtimeErrors).toEqual([]); });

async function open(mode: string, statuses: number[] = []) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  await context.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), { tenantId: "synthetic-workspace", username: "fixture@example.test", subjectId, sessionId, generation: "fixture" });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on("pageerror", error => runtimeErrors.push(error.message));
  const previews: { body: Record<string, unknown>; raw: string; release: () => void }[] = [];
  const commands: Record<string, unknown>[] = [];
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/auth/browser/refresh") return route.fulfill({ json: { accessToken: `e30.${Buffer.from(JSON.stringify({ sub: subjectId, sid: sessionId })).toString("base64url")}.synthetic` } });
    const body = request.postDataJSON() as Record<string, unknown>;
    if (path.endsWith("/preview")) {
      const index = previews.length;
      await new Promise<void>(resolve => previews.push({ body, raw: request.postData()!, release: resolve }));
      if (statuses[index] && statuses[index] !== 200) return route.fulfill({ status: statuses[index], json: { title: "Synthetic preview unavailable", status: statuses[index] } });
      return route.fulfill({ json: { ...body, propertyId, status: 1, maximumAffectedBlockCount: 500, affectedBlockCount: 1, atLeastAffectedBlockCount: 1,
        exceedsMaximumAffectedBlockCount: false, selectionDigest: (index === 0 ? "a" : "b").repeat(64), membershipDigest: "c".repeat(64), membershipDigestVersion: 1,
        hasManualBlockConflict: false, hasActiveAllocationConflict: false, members: [], hasMoreMembers: false, blockGroupVersion: mode === "replace" ? 7 : null, isNoOpReplacement: false } });
    }
    commands.push(body);
    return route.fulfill({ json: { blockGroupId: groupId, propertyId, affectedBlockCount: 1, status: 1, version: 1, previousBlockGroupId: mode === "replace" ? groupId : null,
      resultBlockGroupId: groupId, releasedNowBlockCount: mode === "replace" ? 1 : 0, createdNowBlockCount: 1 } });
  });
  await page.goto(origin + "__block-group-preview?" + mode);
  await page.locator("[data-session]").filter({ hasText: "ready" }).waitFor();
  await page.locator("textarea").fill("First definition");
  async function release(index: number) {
    const pending = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/preview") && response.request().postData() === previews[index].raw);
    previews[index].release(); const response = await pending; await response.finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  return { page, previews, commands, release, close: async () => { for (const p of previews) p.release(); await context.close(); } };
}
const confirmName = (mode: string) => mode === "replace" ? "Confirm replacement" : "Confirm block";

describe("block-group preview ownership in the production modal", () => {
  it.each(["create", "replace"].flatMap(mode => ["reason", "date", "target"].map(edit => ({ mode, edit }))))("keeps the $mode draft editable after an obsolete preview succeeds following a $edit edit", async ({ mode, edit }) => {
    const cell = await open(mode), { page, previews, commands } = cell;
    try {
      await page.getByRole("button", { name: "Preview impact", exact: true }).click();
      await expect.poll(() => previews.length).toBe(1);
      if (edit === "reason") await page.locator("textarea").fill("Revised definition");
      else if (edit === "date") {
        await page.getByRole("button", { name: /^Until:/ }).click();
        await page.getByRole("dialog", { name: "Until calendar", exact: true }).getByRole("gridcell").getByRole("button").filter({ hasText: /^20$/ }).click();
      } else {
        await page.getByRole("button", { name: "Bed / unit", exact: true }).click();
        await page.getByRole("radio").first().check();
      }
      const retainedReason = await page.locator("textarea").inputValue();
      await cell.release(0);
      await expect.poll(() => page.getByRole("button", { name: "Preview impact", exact: true }).isVisible()).toBe(true);
      expect(await page.locator("textarea").inputValue()).toBe(retainedReason);
      expect(await page.getByRole("button", { name: confirmName(mode), exact: true }).count()).toBe(0);
      expect(commands).toEqual([]);
      await page.getByRole("button", { name: "Preview impact", exact: true }).click();
      await expect.poll(() => previews.length).toBe(2);
      expect(previews[1].body).not.toEqual(previews[0].body);
      await cell.release(1);
      await page.getByRole("button", { name: confirmName(mode), exact: true }).waitFor();
      expect(commands).toEqual([]);
    } finally { await cell.close(); }
  }, 30000);

  it.each(["create", "replace"])("confirms the newer %s preview even when the older preview completes last", async mode => {
    const cell = await open(mode), { page, previews, commands } = cell;
    try {
      await page.getByRole("button", { name: "Preview impact", exact: true }).click(); await expect.poll(() => previews.length).toBe(1);
      await page.locator("textarea").fill("New winning definition");
      await page.getByRole("button", { name: "Preview impact", exact: true }).click(); await expect.poll(() => previews.length).toBe(2);
      await cell.release(1); await page.getByRole("button", { name: confirmName(mode), exact: true }).waitFor();
      await cell.release(0);
      await page.getByRole("button", { name: confirmName(mode), exact: true }).click();
      await expect.poll(() => commands.length).toBe(1);
      expect(commands[0]).toMatchObject({ reason: "New winning definition", expectedSelectionDigest: "b".repeat(64), confirmed: true });
      await expect.poll(() => page.locator("[data-completed]").textContent()).toBe("1");
    } finally { await cell.close(); }
  }, 30000);

  it.each(["create", "replace"])("retries a current %s preview failure and still requires explicit confirmation", async mode => {
    const cell = await open(mode, [503, 200]), { page, previews, commands } = cell;
    try {
      await page.getByRole("button", { name: "Preview impact", exact: true }).click(); await expect.poll(() => previews.length).toBe(1); await cell.release(0);
      await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect.poll(() => previews.length).toBe(2); await cell.release(1);
      await page.getByRole("button", { name: confirmName(mode), exact: true }).waitFor(); expect(commands).toEqual([]);
      await page.getByRole("button", { name: confirmName(mode), exact: true }).click(); await expect.poll(() => commands.length).toBe(1);
      expect(commands[0]).toMatchObject({ reason: "First definition", expectedSelectionDigest: "b".repeat(64), confirmed: true });
      await expect.poll(() => page.locator("[data-completed]").textContent()).toBe("1");
    } finally { await cell.close(); }
  }, 30000);
});
