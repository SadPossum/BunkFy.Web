import { createServer, normalizePath, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeChromium } from "./support/nativeChromium";
import { warmNativeFixture } from "./support/warmNativeFixture";

// Actual secret/link panels, synthetic one-time values and authentication only.
// The fixture exposes two private render functions without changing product exports.
const fixture = `
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router";
import {IssuedToken} from "/src/features/integrations/ConnectionDetail.tsx";
import {IssuedJoinLinkModal} from "/src/features/workspaces/WorkspaceInvitesSettings.tsx";
import {MultiFactorPanel} from "/src/features/account/AccountSecurityPanels.tsx";
import "/src/styles.css";
const params=new URLSearchParams(location.search),screen=params.get("screen")||"token";
window.clipboardMode=params.get("mode")||"deny";window.clipboardWrites=[];window.fixtureWrites=[];
Object.defineProperty(navigator,"clipboard",{configurable:true,value:window.clipboardMode==="missing"?undefined:{writeText:async value=>{
 window.clipboardWrites.push(value);
 if(window.clipboardMode==="deny")throw new DOMException("Synthetic clipboard permission denial","NotAllowedError");
 if(window.clipboardMode==="pending")await new Promise((resolve,reject)=>{window.finishCopy=resolve;window.rejectCopy=()=>reject(new Error("Synthetic clipboard failure"));});
}}});
window.copyFixtureSession={
 request:async path=>{window.fixtureWrites.push(path);return {secret:"JBSWY3DPEHPK3PXP",provisioningUri:"otpauth://totp/BunkFy:synthetic?secret=JBSWY3DPEHPK3PXP",expiresAtUtc:"2099-01-01T00:00:00Z"};},
 activateTotp:async()=>{window.fixtureWrites.push("activate");return ["synthetic-code-one","synthetic-code-two"];},disableTotp:async()=>{}
};
function App(){
 const [open,setOpen]=useState(true),[version,setVersion]=useState("a");
 return <main className="p-4"><button onClick={()=>setVersion("b")}>Replace displayed value</button><button onClick={()=>setOpen(false)}>Leave copy screen</button>{open?<>
 {screen==="token"?<IssuedToken result={{outcome:1,token:"synthetic-token-"+version,credential:{credentialId:"credential-"+version,label:"Synthetic worker"}}} onDone={()=>setOpen(false)}/>:null}
 {screen==="link"?<IssuedJoinLinkModal issued={{kind:"invitation",token:"synthetic-invitation-"+version,lifetimeHours:1}} onClose={()=>setOpen(false)}/>:null}
 {screen==="codes"?<MultiFactorPanel status={{providerAvailable:true,isActive:false,unusedRecoveryCodeCount:0}} sourceState="ready" canMutate/>:null}
 </>:<p>Copy screen closed</p>}</main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><App/></MemoryRouter></QueryClientProvider>);
`;

let server: ViteDevServer;
let browser: Browser;
let origin: string;
const runtimeErrors: string[] = [];
beforeAll(async () => {
  const root = process.cwd();
  const entry = normalizePath(root + "/__clipboard_copy_fixture.tsx");
  server = await createServer({ configFile: false, root,
    cacheDir: mkdtempSync(join(tmpdir(), "bunkfy-clipboard-copy-")), logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-router", "@tanstack/react-query", "lucide-react", "qrcode.react", "@radix-ui/react-popover", "@radix-ui/react-select", "@daypicker/react"] },
    plugins: [react(), tailwindcss(), {
      name: "clipboard-copy-fixture",
      resolveId: id => id === "/__clipboard_copy_fixture.tsx" || id === entry ? entry : undefined,
      load(id) {
        if (id === entry) return fixture;
        if (id === normalizePath(root + "/src/app/session.tsx")) return "export function useSession(){return window.copyFixtureSession;}";
        const exports = new Map([
          [normalizePath(root + "/src/features/integrations/ConnectionDetail.tsx"), "IssuedToken"],
          [normalizePath(root + "/src/features/workspaces/WorkspaceInvitesSettings.tsx"), "IssuedJoinLinkModal"],
        ]);
        const name = exports.get(id);
        if (name) return readFileSync(id, "utf8") + `\nexport { ${name} };\n`;
      },
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__clipboard-copy")) return next();
        void vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__clipboard_copy_fixture.tsx"></script></body></html>')
          .then(html => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      }); },
    }], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls!.local[0]; browser = await launchNativeChromium();
  await warmNativeFixture(browser, new URL("/__clipboard-copy", origin).href);
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); expect(runtimeErrors).toEqual([]); });

const cases = [
  { screen: "token", button: "Copy token", field: "Credential token for manual copying" },
  { screen: "link", button: "Copy link", field: "Invitation link for manual copying" },
  { screen: "codes", button: "Copy codes", field: "Recovery codes for manual copying" },
];

async function open(screen: string, mode: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => runtimeErrors.push(error.message));
  await page.goto(new URL(`/__clipboard-copy?screen=${screen}&mode=${mode}`, origin).href);
  if (screen === "codes") {
    await page.getByRole("button", { name: "Set up MFA", exact: true }).click();
    await page.getByLabel("Six-digit code", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Enable MFA", exact: true }).click();
  }
  return page;
}

it.each(cases)("offers selectable manual recovery after $screen clipboard permission denial", async ({ screen, button, field }) => {
  const page = await open(screen, "deny");
  try {
    const before = await page.evaluate(() => (window as unknown as { fixtureWrites: string[] }).fixtureWrites.length);
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Copy failed" }).waitFor();
    const manual = page.getByRole("textbox", { name: field, exact: true });
    await manual.waitFor();
    const copied = await page.evaluate(() => (window as unknown as { clipboardWrites: string[] }).clipboardWrites);
    expect(await manual.inputValue()).toBe(copied[0]);
    expect(await manual.evaluate((element: HTMLTextAreaElement) => ({ focused: element === document.activeElement, start: element.selectionStart, end: element.selectionEnd, length: element.value.length })))
      .toEqual({ focused: true, start: 0, end: copied[0].length, length: copied[0].length });
    expect(await page.getByRole("button", { name: "Copied", exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.evaluate(() => { (window as unknown as { clipboardMode: string }).clipboardMode = "success"; });
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    expect(await manual.count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { fixtureWrites: string[] }).fixtureWrites.length)).toBe(before);
  } finally { await page.close(); }
}, 30000);

it.each(cases)("reports a successful $screen copy without issuing new values", async ({ screen, button, field }) => {
  const page = await open(screen, "success");
  try {
    const before = await page.evaluate(() => (window as unknown as { fixtureWrites: string[] }).fixtureWrites.length);
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    expect(await page.getByRole("textbox", { name: field, exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { clipboardWrites: string[] }).clipboardWrites.length)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { fixtureWrites: string[] }).fixtureWrites.length)).toBe(before);
  } finally { await page.close(); }
}, 30000);

it("still offers the token when the clipboard API is unavailable", async () => {
  const page = await open("token", "missing");
  try {
    await page.getByRole("button", { name: "Copy token", exact: true }).click();
    expect(await page.getByRole("textbox", { name: "Credential token for manual copying", exact: true }).inputValue()).toBe("synthetic-token-a");
  } finally { await page.close(); }
}, 30000);

it("selects the manual value again after a repeated unsupported clipboard attempt", async () => {
  const page = await open("token", "missing");
  try {
    const button = page.getByRole("button", { name: "Copy token", exact: true });
    const manual = page.getByRole("textbox", { name: "Credential token for manual copying", exact: true });
    await button.click();
    await manual.waitFor();
    await button.click();
    await page.waitForFunction(() => document.activeElement instanceof HTMLTextAreaElement && document.activeElement.value === "synthetic-token-a");
    expect(await manual.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([0, "synthetic-token-a".length]);
  } finally { await page.close(); }
}, 30000);

it("does not label a replacement token copied when an older write completes", async () => {
  const page = await open("token", "pending");
  try {
    await page.getByRole("button", { name: "Copy token", exact: true }).click();
    await page.getByRole("button", { name: "Replace displayed value", exact: true }).click();
    await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
    await page.getByRole("button", { name: "Copy token", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Copied", exact: true }).count()).toBe(0);
    await page.evaluate(() => { (window as unknown as { clipboardMode: string }).clipboardMode = "success"; });
    await page.getByRole("button", { name: "Copy token", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { clipboardWrites: string[] }).clipboardWrites)).toEqual(["synthetic-token-a", "synthetic-token-b"]);
  } finally { await page.close(); }
}, 30000);

it("keeps copying pending until the clipboard confirms success", async () => {
  const page = await open("token", "pending");
  try {
    const button = page.getByRole("button", { name: "Copy token", exact: true });
    await button.click();
    expect(await button.isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Copied", exact: true }).count()).toBe(0);
    await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  } finally { await page.close(); }
}, 30000);

it("does not reveal an older token's fallback after the displayed value changes", async () => {
  const page = await open("token", "pending");
  try {
    await page.getByRole("button", { name: "Copy token", exact: true }).click();
    await page.getByRole("button", { name: "Replace displayed value", exact: true }).click();
    await page.evaluate(() => (window as unknown as { rejectCopy: () => void }).rejectCopy());
    expect(await page.getByRole("textbox", { name: "Credential token", exact: true }).inputValue()).toBe("synthetic-token-b");
    expect(await page.getByRole("textbox", { name: "Credential token for manual copying", exact: true }).count()).toBe(0);
    expect(await page.getByRole("status").count()).toBe(0);
  } finally { await page.close(); }
}, 30000);

it("ignores a rejected clipboard request after leaving its screen", async () => {
  const page = await open("token", "pending");
  try {
    await page.getByRole("button", { name: "Copy token", exact: true }).click();
    await page.getByRole("button", { name: "Leave copy screen", exact: true }).click();
    await page.evaluate(() => (window as unknown as { rejectCopy: () => void }).rejectCopy());
    await page.getByText("Copy screen closed", { exact: true }).waitFor();
    expect(await page.getByRole("textbox").count()).toBe(0);
    expect(await page.getByRole("status").count()).toBe(0);
  } finally { await page.close(); }
}, 30000);
