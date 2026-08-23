import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RenderErrorBoundary,
  deriveRenderErrorBoundaryReset,
  type RenderErrorBoundaryState,
} from "../src/app/RenderErrorBoundary";

describe("render error recovery", () => {
  it("enters the fallback state when React captures a render failure", () => {
    expect(RenderErrorBoundary.getDerivedStateFromError()).toEqual({
      failed: true,
    });
  });

  it("resets a failed route only after its navigation identity changes", () => {
    const failed: RenderErrorBoundaryState = {
      failed: true,
      resetKey: "route-a",
    };

    expect(deriveRenderErrorBoundaryReset(failed, "route-a")).toBeNull();
    expect(deriveRenderErrorBoundaryReset(failed, "route-b")).toEqual({
      failed: false,
      resetKey: "route-b",
    });
  });

  it("contains route failures inside the shell and provider failures outside it", () => {
    const app = readFileSync(join(process.cwd(), "src", "app", "App.tsx"), "utf8");
    const main = readFileSync(join(process.cwd(), "src", "main.tsx"), "utf8");
    const boundary = readFileSync(
      join(process.cwd(), "src", "app", "RenderErrorBoundary.tsx"),
      "utf8",
    );

    expect(app).toContain("<AppShell>");
    expect(app).toContain("fallback={<RouteRenderFailure />}");
    expect(app.indexOf("<AppShell>")).toBeLessThan(
      app.indexOf("fallback={<RouteRenderFailure />}")
    );
    expect(main).toContain("fallback={<ApplicationRenderFailure />}");
    expect(main).toContain("<ProductCapabilitiesProvider");
    expect(main.indexOf("fallback={<ApplicationRenderFailure />}")).toBeLessThan(
      main.indexOf("<ProductCapabilitiesProvider")
    );
    expect(boundary).not.toContain("error.message");
    expect(boundary).not.toContain("error.stack");
  });
});
