import { launchNativeChromium } from "./support/nativeChromium";
import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { type Browser, type BrowserContext, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Real SessionProvider, real same-origin pages, and real BroadcastChannel. The
// API remains a controlled route so the test can hold the old refresh response
// while another page publishes a newer actor.
const fixture = `
import React,{useEffect} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider,useQueryClient} from "@tanstack/react-query";
import {SessionProvider,useSession} from "/src/app/session.tsx";
import {MemoryRouter} from "react-router";
import {WorkspaceProvider} from "/src/app/workspace.tsx";
import {JoinWorkspacePage} from "/src/features/workspaces/JoinWorkspacePage.tsx";
import {saveInviteStaffDraft} from "/src/features/workspaces/staffOnboarding.ts";
const privateDraft={displayName:"Synthetic A",legalName:"Synthetic Legal Person A",workEmail:"synthetic-a@example.invalid",workPhone:"",jobTitle:"Synthetic role",department:""};
let capturedRequests, capturePreviousRender;
import "/src/styles.css";
function Capture(){
 const auth=useSession(),query=useQueryClient();
 useEffect(()=>{window.sessionHarness={
  registerWithDraft:()=>auth.register({username:"registered@example.invalid",password:"synthetic-password"},subjectId=>saveInviteStaffDraft(privateDraft,subjectId)),
  adoptBrowserAccount:auth.adoptBrowserAccount,conceal:auth.concealForAccountTransition,
  retryRestore:auth.retrySessionRestore,
  readResource:async()=>{try{await auth.request("/api/synthetic-read");return "accepted";}catch(error){return error.name;}},
  transfer:async(kind)=>{try{if(kind==="request")await auth.request("/api/synthetic-transfer",{method:"POST",body:JSON.stringify({operationId:"66666666-6666-4666-8666-666666666666",value:"initiating-actor-command"})});else if(kind==="download")await auth.download("/api/synthetic-transfer");else{const result=await auth.stream("/api/synthetic-transfer",new AbortController().signal);await result.body?.cancel();}return "accepted";}catch(error){return error.name;}},
  captureRequests:()=>{capturedRequests=auth.captureRequestContext();capturePreviousRender=auth.captureRequestContext;},
  sendCaptured:async()=>{try{await capturedRequests.request("/api/synthetic-mutation",{method:"POST"});return "sent";}catch{return "rejected";}},
  captureStaleRender:()=>{try{capturePreviousRender();return "captured";}catch{return "rejected";}},
  selectCaptured:workspaceId=>{try{capturedRequests=capturedRequests.selectWorkspace(workspaceId);return "selected";}catch{return "rejected";}},
  selectWorkspace:auth.selectWorkspace,signOut:auth.logout,
  revokeAll:()=>{window.signOutAllOutcome="pending";void auth.logoutAll().then(()=>{window.signOutAllOutcome="accepted";}).catch(error=>{window.signOutAllOutcome=error.name;});},
  confirmCredential:(operation)=>{window.stepUpOutcome="pending";const pending=operation==="password"?auth.stepUpWithPassword("synthetic-password"):operation==="mfa-step-up"?auth.stepUpWithMultiFactor("synthetic-password","totp","123456"):operation==="activate-totp"?auth.activateTotp("123456"):auth.disableTotp("totp","123456");void pending.then(value=>{window.stepUpResult=value;window.stepUpOutcome="accepted";}).catch(error=>{window.stepUpOutcome=error.name;});},
  setPrivate:(value="old-actor")=>query.setQueryData(["private"],value),hasPrivate:()=>query.getQueryData(["private"])??null};},[auth,query]);
 return <main><output data-session>{auth.session?.username??"Signed out"}</output><output data-session-id>{auth.session?.sessionId??""}</output><output data-tenant>{auth.session?.tenantId??""}</output><output data-restoring>{auth.isRestoring?"restoring":"ready"}</output><output data-restore-subject>{auth.restoringIdentity?.subjectId??""}</output><output data-restore-error>{auth.restorationError?String(auth.restorationError.status??auth.restorationError.name):"none"}</output><output data-subject>{auth.session?.subjectId??""}</output>{auth.session&&location.search.includes("join-probe")&&<MemoryRouter initialEntries={["/join"]}><WorkspaceProvider><JoinWorkspacePage/></WorkspaceProvider></MemoryRouter>}</main>;
}
const query=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
if(location.search.includes("join-probe"))sessionStorage.setItem("bunkfy.join.context.v2",JSON.stringify({kind:"invitation",contextId:"77777777-7777-4777-8777-777777777777"}));
createRoot(document.getElementById("root")).render(<QueryClientProvider client={query}><SessionProvider restoreOnMount={!location.search.includes("no-restore")}><Capture/></SessionProvider></QueryClientProvider>);
`;

const subjectA = "11111111-1111-4111-8111-111111111111";
const sessionA = "22222222-2222-4222-8222-222222222222";
const subjectB = "33333333-3333-4333-8333-333333333333";
const sessionB = "44444444-4444-4444-8444-444444444444";
const identityA = { tenantId: "synthetic-workspace", username: "owner-a@example.test", subjectId: subjectA, sessionId: sessionA, generation: "generation-a" };
const identityB = { tenantId: "synthetic-workspace", username: "staff-b@example.test", subjectId: subjectB, sessionId: sessionB, generation: "generation-b" };
const token = (subjectId: string, sessionId: string) => `e30.${Buffer.from(JSON.stringify({ sub: subjectId, sid: sessionId })).toString("base64url")}.synthetic`;
const response = (accessToken: string) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ accessToken }) });

let server: ViteDevServer;
let browser: Browser;
let context: BrowserContext;
let origin: string;
const runtimeErrors: string[] = [];

beforeAll(async () => {
  const entry = normalizePath(process.cwd() + "/__session_boundary_native_fixture.tsx");
  const cacheDir = mkdtempSync(join(tmpdir(), "bunkfy-session-boundary-native-"));
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@tanstack/react-query"] },
    plugins: [react(), {
      name: "session-boundary-native-fixture",
      resolveId: id => id === entry || id === "/__session_boundary_native_fixture.tsx" ? entry : undefined,
      load: id => id === entry ? fixture : undefined,
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/__session-boundary-native")) return next();
          void vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="root"></div><script type="module" src="/__session_boundary_native_fixture.tsx"></script></body></html>')
            .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
        });
      },
    }],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!;
  browser = await launchNativeChromium();
  context = await browser.newContext();
  await context.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
}, 60000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await server?.close();
  expect(runtimeErrors).toEqual([]);
});

describe("native cross-tab remembered-session boundary", () => {
  it("rejects a prepared mutation after scope or actor changes and allows the explicitly guarded onboarding transition", async () => {
    const page = await context.newPage();
    const writes: { tenant: string | undefined; authorization: string | undefined }[] = [];
    page.on("pageerror", error => runtimeErrors.push(error.message));
    await page.route("**/api/synthetic-mutation", async route => {
      const headers = route.request().headers();
      writes.push({ tenant: headers["x-tenant-id"], authorization: headers.authorization });
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    try {
      await page.goto(origin + "__session-boundary-native?no-restore=1");
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      await page.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityA, accessToken: token(subjectA, sessionA) });
      await expect.poll(() => page.locator("[data-subject]").textContent()).toBe(subjectA);
      await page.evaluate(() => (window as unknown as { sessionHarness: { captureRequests(): void } }).sessionHarness.captureRequests());
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { sendCaptured(): Promise<string> } }).sessionHarness.sendCaptured())).toBe("sent");

      // A local operation that awaited hashing must not send into the newly
      // selected tenant through the stable request function.
      await page.evaluate(() => (window as unknown as { sessionHarness: { selectWorkspace(id: string): void } }).sessionHarness.selectWorkspace("different-workspace"));
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { sendCaptured(): Promise<string> } }).sessionHarness.sendCaptured())).toBe("rejected");
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { captureStaleRender(): string } }).sessionHarness.captureStaleRender())).toBe("rejected");
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { selectCaptured(id: string): string } }).sessionHarness.selectCaptured("synthetic-workspace"))).toBe("rejected");
      expect(writes).toHaveLength(1);

      // Creation intentionally enters its acknowledged workspace. The guarded
      // switch is synchronous; its returned context is the only valid one.
      await page.evaluate(() => (window as unknown as { sessionHarness: { captureRequests(): void } }).sessionHarness.captureRequests());
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { selectCaptured(id: string): string } }).sessionHarness.selectCaptured("newly-created-workspace"))).toBe("selected");
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { sendCaptured(): Promise<string> } }).sessionHarness.sendCaptured())).toBe("sent");
      expect(writes.map(write => write.tenant)).toEqual(["synthetic-workspace", "newly-created-workspace"]);
      expect(writes.every(write => write.authorization === `Bearer ${token(subjectA, sessionA)}`)).toBe(true);

      await page.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityB, tenantId: "newly-created-workspace", accessToken: token(subjectB, sessionB) });
      await expect.poll(() => page.locator("[data-subject]").textContent()).toBe(subjectB);
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { sendCaptured(): Promise<string> } }).sessionHarness.sendCaptured())).toBe("rejected");
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { selectCaptured(id: string): string } }).sessionHarness.selectCaptured("newly-created-workspace"))).toBe("rejected");
      expect(writes).toHaveLength(2);
    } finally { await page.close(); }
  }, 30000);

  it("binds a registration draft before the real join form renders and isolates an account with the same display label", async () => {
    const page = await context.newPage();
    page.on("pageerror", error => runtimeErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") runtimeErrors.push(message.text()); });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/auth/browser/register") return route.fulfill(response(token(subjectA, sessionA)));
      if (path === "/api/workspace-join/77777777-7777-4777-8777-777777777777/preview") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invitationId: "55555555-5555-4555-8555-555555555555", organizationId: "66666666-6666-4666-8666-666666666666", organizationName: "Synthetic workspace", organizationSlug: "synthetic", recipientBound: false, expiresAtUtc: "2030-01-01T00:00:00Z", status: "pending" }) });
      if (path === "/api/organizations") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], hasMore: false, totalCount: 0 }) });
      throw new Error("Unexpected owned draft fixture request: " + path);
    });
    try {
      await page.goto(origin + "__session-boundary-native?no-restore=1&join-probe=1");
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      await page.evaluate(() => (window as unknown as { sessionHarness: { registerWithDraft(): Promise<void> } }).sessionHarness.registerWithDraft());
      const legalName = page.getByLabel("Legal name (optional)");
      await expect.poll(() => legalName.inputValue()).toBe("Synthetic Legal Person A");
      await legalName.fill("Edited private draft A");
      await page.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityA, tenantId: "global", username: "GitHub account", accessToken: token(subjectA, sessionA) });
      await expect.poll(() => legalName.inputValue()).toBe("Edited private draft A");
      await page.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityB, tenantId: "global", username: "GitHub account", accessToken: token(subjectB, sessionB) });
      await expect.poll(() => page.locator("[data-subject]").textContent()).toBe(subjectB);
      await expect.poll(() => legalName.inputValue()).toBe("");
      await legalName.fill("Private draft B");
      await page.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityA, tenantId: "global", username: "GitHub account", generation: "return-to-a", accessToken: token(subjectA, sessionA) });
      await expect.poll(() => legalName.inputValue()).toBe("Edited private draft A");
    } finally { await page.close(); }
  }, 30000);

  it("does not hand off a private draft when the registration token lacks a valid session identity", async () => {
    const page = await context.newPage();
    const malformed = `e30.${Buffer.from(JSON.stringify({ sub: subjectA })).toString("base64url")}.synthetic`;
    await page.route("**/api/auth/browser/register", route => route.fulfill(response(malformed)));
    try {
      await page.goto(origin + "__session-boundary-native?no-restore=1");
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      const failed = await page.evaluate(async () => {
        try { await (window as unknown as { sessionHarness: { registerWithDraft(): Promise<void> } }).sessionHarness.registerWithDraft(); return false; }
        catch { return true; }
      });
      expect(failed).toBe(true);
      expect(await page.locator("[data-session]").textContent()).toBe("Signed out");
      expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("bunkfy.invite.staff-profile.v3:")))).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it.each([200, 401].flatMap(status => [false, true].map(sameActor => ({ status, sameActor }))))("preserves a replacement actor after an old refresh returns $status (same actor: $sameActor)", async ({ status, sameActor }) => {
    const replacement = sameActor ? { ...identityA, sessionId: sessionB, generation: "replacement-session" } : identityB;
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const pageA = await ownedContext.newPage();
    const pageB = await ownedContext.newPage();
    const oldRefreshStarted = new Promise<void>(resolve => {
      let first = true;
      void pageA.route("**/api/auth/browser/refresh", async route => {
        if (first) {
          first = false; resolve();
          await new Promise<void>(release => { (pageA as Page & { releaseOldRefresh?: () => void }).releaseOldRefresh = release; });
          await route.fulfill(status === 200 ? response(token(subjectA, sessionA)) : { status: 401 });
          return;
        }
        await route.fulfill(response(token(replacement.subjectId, replacement.sessionId)));
      });
    });
    await pageB.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(subjectA, sessionA))));
    for (const page of [pageA, pageB]) {
      page.on("pageerror", error => runtimeErrors.push(error.message));
      page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource: the server responded with a status of 401")) runtimeErrors.push(message.text()); });
    }

    try {
      await pageA.goto(origin + "__session-boundary-native");
      await oldRefreshStarted;
      await expect.poll(() => pageA.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      await pageA.evaluate(() => (window as unknown as { sessionHarness: { setPrivate(): void } }).sessionHarness.setPrivate());
      await pageB.goto(origin + "__session-boundary-native?no-restore=1");
      await expect.poll(() => pageB.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      await pageB.evaluate(account => {
        const harness = (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness;
        harness.adoptBrowserAccount(account);
      }, { ...replacement, accessToken: token(replacement.subjectId, replacement.sessionId) });

      // A current actor change is a privacy boundary even before the delayed
      // old response is released; the query cache must not retain old data.
      await expect.poll(() => pageA.evaluate(() => (window as unknown as { sessionHarness: { hasPrivate(): unknown } }).sessionHarness.hasPrivate())).toBeNull();

      const release = (pageA as Page & { releaseOldRefresh?: () => void }).releaseOldRefresh;
      expect(release).toBeTypeOf("function"); release!();
      await expect.poll(() => pageA.locator("[data-session]").textContent()).toBe(replacement.username);
      expect(await pageA.locator("[data-session-id]").textContent()).toBe(replacement.sessionId);
      expect(await pageB.locator("[data-session-id]").textContent()).toBe(replacement.sessionId);
      expect(await pageA.locator("[data-restoring]").textContent()).toBe("ready");
      expect(await pageA.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"))).toContain(sessionB);
    } finally {
      await pageA.close();
      await pageB.close();
      await ownedContext.close();
    }
  }, 30000);

  it.each([200, 401])("keeps a newer restoration pending and retryable after an old refresh returns %s", async oldStatus => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const pageA = await ownedContext.newPage(), pageB = await ownedContext.newPage();
    let refreshes = 0, releaseOld: (() => void) | undefined, releaseNew: (() => void) | undefined;
    for (const page of [pageA, pageB]) page.on("pageerror", error => runtimeErrors.push(error.message));
    await pageA.route("**/api/auth/browser/refresh", async route => {
      refreshes++;
      if (refreshes === 1) {
        await new Promise<void>(resolve => { releaseOld = resolve; });
        await route.fulfill(oldStatus === 200 ? response(token(subjectA, sessionA)) : { status: 401 });
      } else if (refreshes === 2) {
        await new Promise<void>(resolve => { releaseNew = resolve; });
        await route.fulfill({ status: 503 });
      } else await route.fulfill(response(token(subjectB, sessionB)));
    });
    try {
      await pageA.goto(origin + "__session-boundary-native");
      await expect.poll(() => Boolean(releaseOld)).toBe(true);
      await pageB.goto(origin + "__session-boundary-native?no-restore=1");
      await expect.poll(() => pageB.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      await pageB.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityB, accessToken: token(subjectB, sessionB) });
      await expect.poll(() => pageA.locator("[data-restore-subject]").textContent()).toBe(subjectB);
      releaseOld!();
      await expect.poll(() => Boolean(releaseNew), { timeout: 3000 }).toBe(true);
      expect(await pageA.locator("[data-restoring]").textContent()).toBe("restoring");
      expect(await pageA.locator("[data-restore-error]").textContent()).toBe("none");
      releaseNew!();
      await expect.poll(() => pageA.locator("[data-restore-error]").textContent()).toBe("503");
      expect(await pageA.locator("[data-restore-subject]").textContent()).toBe(subjectB);
      await pageA.evaluate(() => (window as unknown as { sessionHarness: { retryRestore(): Promise<void> } }).sessionHarness.retryRestore());
      expect(refreshes).toBe(3);
      expect(await pageA.locator("[data-session-id]").textContent()).toBe(sessionB);
      expect(await pageA.locator("[data-restoring]").textContent()).toBe("ready");
      expect(await pageA.locator("[data-restore-error]").textContent()).toBe("none");
      expect(await pageA.locator("[data-restore-subject]").textContent()).toBe("");
    } finally {
      releaseOld?.(); releaseNew?.();
      await pageA.evaluate(() => navigator.locks.request("bunkfy.browser-session.cookies", () => {})).catch(() => {});
      await ownedContext.close();
    }
  }, 30000);

  it("preserves an unnotified persisted replacement after an old refresh is rejected", async () => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    let refreshes = 0, release: (() => void) | undefined;
    page.on("pageerror", error => runtimeErrors.push(error.message));
    await page.route("**/api/auth/browser/refresh", async route => {
      refreshes++;
      if (refreshes === 1) { await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ status: 401 }); }
      else await route.fulfill(response(token(subjectB, sessionB)));
    });
    try {
      await page.goto(origin + "__session-boundary-native");
      await expect.poll(() => Boolean(release)).toBe(true);
      // Model persistence reaching this document before its cross-tab event.
      await page.evaluate(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityB);
      release!();
      await expect.poll(() => page.locator("[data-restoring]").textContent()).toBe("ready");
      expect(await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"))).toContain(sessionB);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect.poll(() => page.locator("[data-session-id]").textContent()).toBe(sessionB);
      expect(refreshes).toBe(2);
    } finally { release?.(); await ownedContext.close(); }
  }, 30000);

  it.each(["initial", "current"])("still invalidates an %s rejected session refresh", async phase => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    let refreshes = 0;
    page.on("pageerror", error => runtimeErrors.push(error.message));
    await page.route("**/api/auth/browser/refresh", async route => { refreshes++; await route.fulfill({ status: 401 }); });
    await page.route("**/api/synthetic-read", route => route.fulfill({ status: 401 }));
    try {
      await page.goto(origin + "__session-boundary-native" + (phase === "current" ? "?no-restore=1" : ""));
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      if (phase === "current") {
        await page.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityA, accessToken: token(subjectA, sessionA) });
        await page.evaluate(() => (window as unknown as { sessionHarness: { setPrivate(): void } }).sessionHarness.setPrivate());
        expect(await page.evaluate(() => (window as unknown as { sessionHarness: { readResource(): Promise<string> } }).sessionHarness.readResource())).toBe("ApiError");
      }
      await expect.poll(() => refreshes).toBe(1);
      await expect.poll(() => page.locator("[data-restoring]").textContent()).toBe("ready");
      expect(await page.locator("[data-session]").textContent()).toBe("Signed out");
      expect(await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"))).toBeNull();
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { hasPrivate(): unknown } }).sessionHarness.hasPrivate())).toBeNull();
    } finally { await ownedContext.close(); }
  }, 30000);

  it.each(["request", "download", "stream"].flatMap(kind => ["unchanged", "actor", "workspace"].map(replacement => ({ kind, replacement }))))("guards the $kind retry after refresh (replacement: $replacement)", async ({ kind, replacement }) => {
    const replaced = replacement !== "unchanged";
    const nextIdentity = replacement === "workspace" ? { ...identityA, tenantId: "replacement-workspace", generation: "replacement-workspace-generation" } : identityB;
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    const requests: { authorization: string | undefined; tenant: string | undefined; method: string; body: string | null }[] = [];
    const refreshedToken = replaced ? token(nextIdentity.subjectId, nextIdentity.sessionId) : token(subjectA, sessionA) + "-renewed";
    let refreshes = 0;
    page.on("pageerror", error => runtimeErrors.push(error.message));
    await page.route("**/api/auth/browser/refresh", async route => { refreshes++; await route.fulfill(response(refreshedToken)); });
    await page.route("**/api/synthetic-transfer", async route => {
      requests.push({ authorization: route.request().headers().authorization, tenant: route.request().headers()["x-tenant-id"], method: route.request().method(), body: route.request().postData() });
      if (requests.length === 1) {
        // A different page's confirmed identity can reach shared storage before
        // this tab receives its notification. An old operation must stop
        // before refresh or retry; the later event restores the new identity.
        if (replaced) await page.evaluate(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), nextIdentity);
        await route.fulfill({ status: 401 });
      } else await route.fulfill({ status: 200, contentType: kind === "stream" ? "text/event-stream" : kind === "download" ? "application/octet-stream" : "application/json", body: kind === "stream" ? "data: synthetic\n\n" : kind === "download" ? "synthetic-file" : "{}" });
    });
    try {
      await page.goto(origin + "__session-boundary-native?no-restore=1");
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      await page.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityA, accessToken: token(subjectA, sessionA) });
      expect(await page.evaluate(value => (window as unknown as { sessionHarness: { transfer(kind: string): Promise<string> } }).sessionHarness.transfer(value), kind)).toBe(replaced ? "SessionBoundarySupersededError" : "accepted");
      expect(refreshes).toBe(replaced ? 0 : 1);
      expect(requests).toHaveLength(replaced ? 1 : 2);
      expect(requests[0].authorization).toBe("Bearer " + token(subjectA, sessionA));
      if (!replaced) {
        expect(requests[1].authorization).toBe("Bearer " + refreshedToken);
        expect(requests[1].body).toBe(requests[0].body);
        expect(requests[1].method).toBe(requests[0].method);
      } else {
        expect(JSON.parse((await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2")))!)).toEqual(nextIdentity);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await expect.poll(() => page.locator("[data-tenant]").textContent()).toBe(nextIdentity.tenantId);
        await expect.poll(() => page.locator("[data-session-id]").textContent()).toBe(nextIdentity.sessionId);
        expect(refreshes).toBe(1);
        expect(requests).toHaveLength(1);
      }
      expect(await page.locator("[data-session-id]").textContent()).toBe(replaced ? nextIdentity.sessionId : sessionA);
      expect(await page.locator("[data-tenant]").textContent()).toBe(replaced ? nextIdentity.tenantId : identityA.tenantId);
    } finally { await ownedContext.close(); }
  }, 30000);

  it("keeps a memory-only workspace usable when durable storage rejects writes", async () => {
    const ownedContext = await browser.newContext();
    const page = await ownedContext.newPage();
    const requests: { tenant: string | undefined; body: string | null }[] = [];
    let refreshes = 0;
    page.on("pageerror", error => runtimeErrors.push(error.message));
    await page.route("**/api/auth/browser/refresh", async route => { refreshes++; await route.fulfill(response(token(subjectA, sessionA))); });
    await page.route("**/api/synthetic-transfer", async route => {
      requests.push({ tenant: route.request().headers()["x-tenant-id"], body: route.request().postData() });
      await route.fulfill(requests.length === 1 ? { status: 401 } : { status: 200, contentType: "application/json", body: "{}" });
    });
    try {
      await page.goto(origin + "__session-boundary-native?no-restore=1");
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      await page.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityA, accessToken: token(subjectA, sessionA) });
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "bunkfy.session.identity.v2") throw new DOMException("Synthetic quota failure", "QuotaExceededError");
          return original.call(this, key, value);
        };
        (window as unknown as { sessionHarness: { selectWorkspace(value: string): void } }).sessionHarness.selectWorkspace("memory-only-workspace");
      });
      expect(await page.locator("[data-tenant]").textContent()).toBe("memory-only-workspace");
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2")))!).tenantId).toBe(identityA.tenantId);
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { transfer(kind: string): Promise<string> } }).sessionHarness.transfer("request"))).toBe("accepted");
      expect(refreshes).toBe(1);
      expect(requests).toHaveLength(2);
      expect(requests.map(request => request.tenant)).toEqual(["memory-only-workspace", "memory-only-workspace"]);
      expect(requests[1].body).toBe(requests[0].body);
      expect(await page.locator("[data-tenant]").textContent()).toBe("memory-only-workspace");
    } finally { await ownedContext.close(); }
  }, 30000);

  it.each(["password", "mfa-step-up", "activate-totp", "disable-totp"].flatMap(operation => ["replacement actor", "concealed session"].map(boundary => ({ operation, boundary }))))("rejects a late $operation completion after a $boundary boundary", async ({ operation, boundary }) => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const pageA = await ownedContext.newPage();
    const pageB = await ownedContext.newPage();
    let release: (() => void) | undefined;
    let started = false;
    const heldResponse = new Promise<void>(resolve => { release = resolve; });
    await pageA.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(started ? subjectB : subjectA, started ? sessionB : sessionA))));
    await pageB.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(subjectA, sessionA))));
    const endpoint = operation === "password" ? "step-up/password" : operation === "mfa-step-up" ? "step-up/mfa" : operation === "activate-totp" ? "mfa/totp/activate" : "mfa/totp/disable";
    await pageA.route("**/api/auth/browser/" + endpoint, async route => {
      started = true;
      await heldResponse;
      await route.fulfill(response(token(subjectA, sessionA)));
    });
    for (const page of [pageA, pageB]) {
      page.on("pageerror", error => runtimeErrors.push(error.message));
      page.on("console", message => { if (message.type() === "error") runtimeErrors.push(message.text()); });
    }
    try {
      await pageA.goto(origin + "__session-boundary-native");
      await expect.poll(() => pageA.locator("[data-session]").textContent()).toBe(identityA.username);
      await pageA.evaluate(value => (window as unknown as { sessionHarness: { confirmCredential(operation: string): void } }).sessionHarness.confirmCredential(value), operation);
      await expect.poll(() => started).toBe(true);
      if (boundary === "replacement actor") {
        await pageB.goto(origin + "__session-boundary-native?no-restore=1");
        await expect.poll(() => pageB.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
        await pageB.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...identityB, accessToken: token(subjectB, sessionB) });
        // Privacy changes immediately; the new actor's cookie refresh waits
        // for the old credential operation to release the shared browser lock.
        await expect.poll(() => pageA.locator("[data-session]").textContent()).not.toBe(identityA.username);
      } else {
        await pageA.evaluate(() => (window as unknown as { sessionHarness: { conceal(): void } }).sessionHarness.conceal());
        await expect.poll(() => pageA.locator("[data-session]").textContent()).toBe("Signed out");
      }
      release!();
      await expect.poll(() => pageA.evaluate(() => (window as unknown as { stepUpOutcome?: string }).stepUpOutcome)).toBe("SessionBoundarySupersededError");
      await expect.poll(() => pageA.locator("[data-session]").textContent()).toBe(boundary === "replacement actor" ? identityB.username : "Signed out");
      const stored = await pageA.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"));
      if (boundary === "replacement actor") expect(stored).toContain(sessionB);
      else expect(stored).toBeNull();
    } finally {
      release?.();
      await ownedContext.close();
    }
  }, 30000);


  it.each(["password", "mfa-step-up", "activate-totp", "disable-totp"])("preserves the successful %s request and session result", async operation => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    const endpoint = operation === "password" ? "step-up/password" : operation === "mfa-step-up" ? "step-up/mfa" : operation === "activate-totp" ? "mfa/totp/activate" : "mfa/totp/disable";
    const writes: unknown[] = [];
    await page.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(subjectA, sessionA))));
    await page.route("**/api/auth/browser/" + endpoint, async route => {
      writes.push({ method: route.request().method(), body: route.request().postDataJSON() });
      if (operation === "disable-totp") await route.fulfill({ status: 204 });
      else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accessToken: token(subjectA, sessionA), recoveryCodes: ["synthetic-recovery-code"] }) });
    });
    page.on("pageerror", error => runtimeErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") runtimeErrors.push(message.text()); });
    try {
      await page.goto(origin + "__session-boundary-native");
      await expect.poll(() => page.locator("[data-session]").textContent()).toBe(identityA.username);
      await page.evaluate(value => (window as unknown as { sessionHarness: { confirmCredential(operation: string): void } }).sessionHarness.confirmCredential(value), operation);
      await expect.poll(() => page.evaluate(() => (window as unknown as { stepUpOutcome?: string }).stepUpOutcome)).toBe("accepted");
      expect(writes).toEqual([{ method: "POST", body: operation === "password" ? { password: "synthetic-password" } : operation === "mfa-step-up" ? { password: "synthetic-password", codeType: "totp", code: "123456" } : operation === "activate-totp" ? { code: "123456" } : { codeType: "totp", code: "123456" } }]);
      expect(await page.locator("[data-session]").textContent()).toBe(operation === "disable-totp" ? "Signed out" : identityA.username);
      if (operation === "activate-totp") expect(await page.evaluate(() => (window as unknown as { stepUpResult?: unknown }).stepUpResult)).toEqual(["synthetic-recovery-code"]);
    } finally { await ownedContext.close(); }
  }, 30000);

  it.each(["password", "mfa-step-up", "activate-totp", "disable-totp"])("does not dispatch a queued %s operation after concealment", async operation => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    let writes = 0;
    await page.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(subjectA, sessionA))));
    const endpoint = operation === "password" ? "step-up/password" : operation === "mfa-step-up" ? "step-up/mfa" : operation === "activate-totp" ? "mfa/totp/activate" : "mfa/totp/disable";
    await page.route("**/api/auth/browser/" + endpoint, async route => { writes++; await route.fulfill(response(token(subjectA, sessionA))); });
    page.on("pageerror", error => runtimeErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") runtimeErrors.push(message.text()); });
    try {
      await page.goto(origin + "__session-boundary-native");
      await expect.poll(() => page.locator("[data-session]").textContent()).toBe(identityA.username);
      await page.evaluate(() => {
        void navigator.locks.request("bunkfy.browser-session.cookies", async () => {
          await new Promise<void>(resolve => { (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock = resolve; });
        });
      });
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { releaseAuthLock?: unknown }).releaseAuthLock))).toBe(true);
      await page.evaluate(value => (window as unknown as { sessionHarness: { confirmCredential(operation: string): void } }).sessionHarness.confirmCredential(value), operation);
      await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending?.length ?? 0)).toBeGreaterThan(0);
      await page.evaluate(() => (window as unknown as { sessionHarness: { conceal(): void } }).sessionHarness.conceal());
      await page.evaluate(() => (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock?.());
      await expect.poll(() => page.evaluate(() => (window as unknown as { stepUpOutcome?: string }).stepUpOutcome)).toBe("SessionBoundarySupersededError");
      expect(writes).toBe(0);
      expect(await page.locator("[data-session]").textContent()).toBe("Signed out");
    } finally {
      await page.evaluate(() => (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock?.()).catch(() => {});
      await ownedContext.close();
    }
  }, 30000);
  it.each([204, 503].flatMap(status => ["replacement account", "cross-tab account", "same account new session"].map(boundary => ({ status, boundary }))))("preserves a $boundary after delayed global sign-out returns $status", async ({ status, boundary }) => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    let started = false;
    let cookieSignOuts = 0;
    let replacementPublished = false;
    let release!: () => void;
    const heldResponse = new Promise<void>(resolve => { release = resolve; });
    const replacement = boundary === "same account new session" ? { ...identityA, sessionId: sessionB, generation: "new-sign-in" } : identityB;
    const globalWrites: string[] = [];
    await page.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(replacementPublished ? replacement.subjectId : subjectA, replacementPublished ? sessionB : sessionA))));
    await page.route("**/api/auth/sign-out-all", async route => {
      globalWrites.push(route.request().headers().authorization);
      started = true;
      await heldResponse;
      await route.fulfill(status === 204 ? { status } : { status, contentType: "application/json", body: JSON.stringify({ title: "Temporarily unavailable" }) });
    });
    await page.route("**/api/auth/browser/sign-out", async route => { cookieSignOuts++; await route.fulfill({ status: 204 }); });
    page.on("pageerror", error => runtimeErrors.push(error.message));
    try {
      await page.goto(origin + "__session-boundary-native");
      await expect.poll(() => page.locator("[data-session-id]").textContent()).toBe(sessionA);
      await page.evaluate(() => (window as unknown as { sessionHarness: { revokeAll(): void } }).sessionHarness.revokeAll());
      await expect.poll(() => started).toBe(true);
      replacementPublished = true;
      const publisher = boundary === "cross-tab account" ? await ownedContext.newPage() : page;
      if (publisher !== page) {
        await publisher.goto(origin + "__session-boundary-native?no-restore=1");
        await expect.poll(() => publisher.evaluate(() => Boolean((window as unknown as { sessionHarness?: unknown }).sessionHarness))).toBe(true);
      }
      await publisher.evaluate(account => (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void } }).sessionHarness.adoptBrowserAccount(account), { ...replacement, accessToken: token(replacement.subjectId, replacement.sessionId) });
      await expect.poll(() => page.locator("[data-session-id]").textContent()).toBe(sessionB);
      await page.evaluate(() => (window as unknown as { sessionHarness: { setPrivate(value: string): void } }).sessionHarness.setPrivate("new-actor-private-data"));
      release();
      await expect.poll(() => page.evaluate(() => (window as unknown as { signOutAllOutcome?: string }).signOutAllOutcome)).toBe(status === 204 ? "accepted" : "ApiError");
      expect(await page.locator("[data-session-id]").textContent()).toBe(sessionB);
      expect(await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"))).toContain(sessionB);
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { hasPrivate(): unknown } }).sessionHarness.hasPrivate())).toBe("new-actor-private-data");
      expect(cookieSignOuts).toBe(0);
      expect(globalWrites).toEqual([`Bearer ${token(subjectA, sessionA)}`]);
    } finally {
      release();
      await ownedContext.close();
    }
  }, 30000);

  it.each(["queued cookie cleanup", "in-flight cookie cleanup", "persisted replacement"])("preserves replacement identity during %s", async boundary => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    let globalStarted = false;
    let cookieSignOuts = 0;
    let releaseGlobal!: () => void;
    let releaseCookie!: () => void;
    const heldGlobal = new Promise<void>(resolve => { releaseGlobal = resolve; });
    const heldCookie = new Promise<void>(resolve => { releaseCookie = resolve; });
    await page.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(subjectA, sessionA))));
    await page.route("**/api/auth/sign-out-all", async route => { globalStarted = true; await heldGlobal; await route.fulfill({ status: 204 }); });
    await page.route("**/api/auth/browser/sign-out", async route => { cookieSignOuts++; await heldCookie; await route.fulfill({ status: 204 }); });
    page.on("pageerror", error => runtimeErrors.push(error.message));
    try {
      await page.goto(origin + "__session-boundary-native");
      await expect.poll(() => page.locator("[data-session-id]").textContent()).toBe(sessionA);
      if (boundary === "queued cookie cleanup") {
        await page.evaluate(() => {
          void navigator.locks.request("bunkfy.browser-session.cookies", async () => {
            await new Promise<void>(resolve => { (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock = resolve; });
          });
        });
        await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { releaseAuthLock?: unknown }).releaseAuthLock))).toBe(true);
      }
      await page.evaluate(() => (window as unknown as { sessionHarness: { revokeAll(): void } }).sessionHarness.revokeAll());
      await expect.poll(() => globalStarted).toBe(true);
      if (boundary === "persisted replacement") {
        // Storage can advance before the corresponding cross-tab event runs.
        await page.evaluate(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityB);
      } else if (boundary === "queued cookie cleanup") {
        releaseGlobal();
        await expect.poll(async () => cookieSignOuts > 0 || await page.evaluate(async () => (await navigator.locks.query()).pending?.length ?? 0) > 0).toBe(true);
        expect(cookieSignOuts).toBe(0);
      } else if (boundary === "in-flight cookie cleanup") {
        releaseGlobal();
        await expect.poll(() => cookieSignOuts).toBe(1);
      }
      if (boundary !== "persisted replacement") {
        await page.evaluate(account => {
          const harness = (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void; setPrivate(value: string): void } }).sessionHarness;
          harness.adoptBrowserAccount(account); harness.setPrivate("replacement-private-data");
        }, { ...identityB, accessToken: token(subjectB, sessionB) });
      }
      releaseGlobal();
      await page.evaluate(() => (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock?.());
      releaseCookie();
      await expect.poll(() => page.evaluate(() => (window as unknown as { signOutAllOutcome?: string }).signOutAllOutcome)).toBe("accepted");
      expect(await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"))).toContain(sessionB);
      expect(cookieSignOuts).toBe(boundary === "in-flight cookie cleanup" ? 1 : 0);
      if (boundary !== "persisted replacement") {
        expect(await page.locator("[data-session-id]").textContent()).toBe(sessionB);
        expect(await page.evaluate(() => (window as unknown as { sessionHarness: { hasPrivate(): unknown } }).sessionHarness.hasPrivate())).toBe("replacement-private-data");
      }
    } finally {
      releaseGlobal(); releaseCookie();
      await page.evaluate(() => (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock?.()).catch(() => {});
      await ownedContext.close();
    }
  }, 30000);

  it.each([204, 503].flatMap(status => ["replacement account", "persisted replacement", "replacement during cleanup", "unchanged browser", "same session workspace change", "restored initiating session"].map(boundary => ({ status, boundary }))))("preserves immediate local sign-out with queued cleanup $status and $boundary", async ({ status, boundary }) => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    const cookieWrites: string[] = [];
    let releaseCookie!: () => void;
    const heldCookie = new Promise<void>(resolve => { releaseCookie = resolve; });
    await page.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(subjectA, sessionA))));
    await page.route("**/api/auth/browser/sign-out", async route => {
      cookieWrites.push(route.request().headers().authorization);
      if (boundary === "replacement during cleanup") await heldCookie;
      await route.fulfill(status === 204 ? { status } : { status, contentType: "application/json", body: JSON.stringify({ title: "Temporarily unavailable" }) });
    });
    page.on("pageerror", error => runtimeErrors.push(error.message));
    try {
      await page.goto(origin + "__session-boundary-native");
      await expect.poll(() => page.locator("[data-session-id]").textContent()).toBe(sessionA);
      await page.evaluate(() => {
        void navigator.locks.request("bunkfy.browser-session.cookies", async () => {
          await new Promise<void>(resolve => { (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock = resolve; });
        });
      });
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { releaseAuthLock?: unknown }).releaseAuthLock))).toBe(true);
      await page.evaluate(() => {
        const harness = (window as unknown as { sessionHarness: { setPrivate(): void; signOut(): void } }).sessionHarness;
        harness.setPrivate(); harness.signOut();
      });
      await expect.poll(() => page.locator("[data-session]").textContent()).toBe("Signed out");
      expect(await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"))).toBeNull();
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { hasPrivate(): unknown } }).sessionHarness.hasPrivate())).toBeNull();
      expect(cookieWrites).toEqual([]);
      await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending?.length ?? 0)).toBeGreaterThan(0);
      if (boundary === "replacement during cleanup") {
        await page.evaluate(() => (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock?.());
        await expect.poll(() => cookieWrites.length).toBe(1);
      }
      if (boundary === "replacement account" || boundary === "replacement during cleanup") {
        await page.evaluate(account => {
          const harness = (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void; setPrivate(value: string): void } }).sessionHarness;
          harness.adoptBrowserAccount(account); harness.setPrivate("replacement-private-data");
        }, { ...identityB, accessToken: token(subjectB, sessionB) });
      } else if (boundary === "persisted replacement") {
        await page.evaluate(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityB);
      } else if (boundary === "same session workspace change") {
        await page.evaluate(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), { ...identityA, tenantId: "another-workspace", generation: "workspace-change" });
      } else if (boundary === "restored initiating session") {
        await page.evaluate(account => {
          const harness = (window as unknown as { sessionHarness: { adoptBrowserAccount(value: unknown): void; setPrivate(): void } }).sessionHarness;
          harness.adoptBrowserAccount(account); harness.setPrivate();
        }, { ...identityA, tenantId: "another-workspace", generation: "workspace-change", accessToken: token(subjectA, sessionA) });
      }
      releaseCookie();
      await page.evaluate(async () => {
        (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock?.();
        await navigator.locks.request("bunkfy.browser-session.cookies", () => {});
      });
      const replacement = boundary === "replacement account" || boundary === "persisted replacement" || boundary === "replacement during cleanup";
      expect(cookieWrites).toEqual(replacement && boundary !== "replacement during cleanup" ? [] : [`Bearer ${token(subjectA, sessionA)}`]);
      const stored = await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"));
      if (replacement) expect(stored).toContain(sessionB);
      else expect(stored).toBeNull();
      if (boundary === "replacement account" || boundary === "replacement during cleanup") {
        expect(await page.locator("[data-session-id]").textContent()).toBe(sessionB);
        expect(await page.evaluate(() => (window as unknown as { sessionHarness: { hasPrivate(): unknown } }).sessionHarness.hasPrivate())).toBe("replacement-private-data");
      } else {
        expect(await page.locator("[data-session]").textContent()).toBe("Signed out");
        expect(await page.evaluate(() => (window as unknown as { sessionHarness: { hasPrivate(): unknown } }).sessionHarness.hasPrivate())).toBeNull();
      }
    } finally {
      releaseCookie();
      await page.evaluate(() => (window as unknown as { releaseAuthLock?: () => void }).releaseAuthLock?.()).catch(() => {});
      await ownedContext.close();
    }
  }, 30000);

  it.each([204, 503].flatMap(status => [false, true].map(changeWorkspace => ({ status, changeWorkspace }))))("still clears the initiating session after global sign-out $status (workspace changed: $changeWorkspace)", async ({ status, changeWorkspace }) => {
    const ownedContext = await browser.newContext();
    await ownedContext.addInitScript(identity => localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity)), identityA);
    const page = await ownedContext.newPage();
    let started = false;
    let cookieSignOuts = 0;
    let release!: () => void;
    const heldResponse = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/auth/browser/refresh", route => route.fulfill(response(token(subjectA, sessionA))));
    await page.route("**/api/auth/sign-out-all", async route => {
      started = true;
      await heldResponse;
      await route.fulfill(status === 204 ? { status } : { status, contentType: "application/json", body: JSON.stringify({ title: "Temporarily unavailable" }) });
    });
    await page.route("**/api/auth/browser/sign-out", async route => { cookieSignOuts++; await route.fulfill({ status: 204 }); });
    page.on("pageerror", error => runtimeErrors.push(error.message));
    try {
      await page.goto(origin + "__session-boundary-native");
      await expect.poll(() => page.locator("[data-session-id]").textContent()).toBe(sessionA);
      await page.evaluate(() => {
        const harness = (window as unknown as { sessionHarness: { setPrivate(): void; revokeAll(): void } }).sessionHarness;
        harness.setPrivate(); harness.revokeAll();
      });
      await expect.poll(() => started).toBe(true);
      if (changeWorkspace) {
        await page.evaluate(() => (window as unknown as { sessionHarness: { selectWorkspace(value: string): void } }).sessionHarness.selectWorkspace("another-workspace"));
        await expect.poll(() => page.locator("[data-tenant]").textContent()).toBe("another-workspace");
      }
      release();
      await expect.poll(() => page.evaluate(() => (window as unknown as { signOutAllOutcome?: string }).signOutAllOutcome)).toBe(status === 204 ? "accepted" : "ApiError");
      expect(await page.locator("[data-session]").textContent()).toBe("Signed out");
      expect(await page.evaluate(() => localStorage.getItem("bunkfy.session.identity.v2"))).toBeNull();
      expect(await page.evaluate(() => (window as unknown as { sessionHarness: { hasPrivate(): unknown } }).sessionHarness.hasPrivate())).toBeNull();
      expect(cookieSignOuts).toBe(1);
    } finally { release(); await ownedContext.close(); }
  }, 30000);

});
