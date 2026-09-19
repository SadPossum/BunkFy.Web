import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(
  join(process.cwd(), "src", "components", "layout", "AppShell.tsx"),
  "utf8",
).replaceAll("\r\n", "\n");
const propertySwitchRoute = readFileSync(
  join(process.cwd(), "src", "components", "layout", "propertySwitchRoute.ts"),
  "utf8",
).replaceAll("\r\n", "\n");

describe("application shell accessibility", () => {
  it("treats the compact navigation as a keyboard-contained drawer", () => {
    expect(shell).toContain("const mobileDrawerRef = useRef<HTMLElement>(null)");
    expect(shell).toContain('role={mobileOpen ? "dialog" : undefined}');
    expect(shell).toContain('aria-label="Application navigation"');
    expect(shell).toContain('if (event.key === "Escape")');
    expect(shell).toContain('if (event.key !== "Tab") return;');
    expect(shell).toContain("useLayoutEffect(() => {");
    expect(shell).toContain("const mobileWasOpenRef = useRef(false)");
    expect(shell).toContain("window.requestAnimationFrame");
    expect(shell).toContain("mobileCloseButtonRef.current?.focus()");
    expect(shell).toContain("mobileReturnFocusRef.current?.focus()");
    expect(shell).toContain("mobileReturnFocusRef.current = event.currentTarget");
    expect(shell).toContain("document.body.style.overflow = \"hidden\"");
    expect(shell).toContain("onClick={openMobileNavigation}");
    expect(shell).not.toContain("onClick={() => setMobileOpen(true)}");
  });

  it("changes owner-page property URLs without retaining cross-property origin state", () => {
    expect(shell).toContain("propertySwitchSearchParams(location.pathname, current, value)");
    expect(shell).toContain("propertySwitchUpdatesRoute(location.pathname, current)");
    expect(propertySwitchRoute).toContain("withoutOperationalPreviewRoute(current)");
    expect(propertySwitchRoute).toContain("withoutOperationalReturnRoute(next)");
    expect(propertySwitchRoute).toContain("withoutSpacesReturnRoute(next)");
    expect(propertySwitchRoute).toContain('next.set("property", propertyId)');
  });
});
