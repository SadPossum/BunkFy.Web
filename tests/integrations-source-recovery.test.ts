import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(join(process.cwd(), "src", "features", "integrations", file), "utf8");
}

describe("integrations source recovery", () => {
  it("loads independent directories only on relevant primary tabs", () => {
    const integrations = source("IntegrationsPage.tsx");

    expect(integrations).toContain('enabled: canRead && tab === "connections"');
    expect(integrations).toContain('enabled: canRead && tab === "activity"');
    expect(integrations).toContain("<CompositeSourceNotice");
    expect(integrations).toContain("<CompositeSourceFallback");
    expect(integrations).not.toContain("connections.isLoading || adapterTypes.isLoading");
    expect(integrations).not.toContain("connections.error || adapterTypes.error");
    expect(integrations).not.toContain("allConnections.data?.connections ?? connectionItems");
  });

  it("requires current capability evidence for capability-dependent mutations", () => {
    const integrations = source("IntegrationsPage.tsx");
    const detail = source("ConnectionDetail.tsx");

    expect(integrations).toContain("const capabilitiesCurrent = compositeSourceCurrent(adapterTypeSource)");
    expect(integrations).toContain("disabled={!capabilitiesCurrent}");
    expect(detail).toContain("const capabilityCurrent = compositeSourceCurrent(adapterTypeSource)");
    expect(detail).toContain("capability: AdapterTypeCapability;");
    expect(detail).toContain("canConfigure={canManage && capabilityCurrent}");
    expect(detail).not.toContain('?? ["polling", "continuous", "push", "remotePolling"]');
  });

  it("keeps activity data available when context directories fail", () => {
    const activity = source("IngestionActivity.tsx");

    expect(activity).toContain("connectionSource: CompositeSource");
    expect(activity).toContain("adapterTypeSource: CompositeSource");
    expect(activity).toContain("<CompositeSourceNotice");
    expect(activity).toContain("<CompositeSourceFallback");
  });
});
