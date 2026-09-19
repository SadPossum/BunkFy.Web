import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompositeSource } from "../src/app/compositeSourceState";
import { spacesBlockNoticeSources } from "../src/features/spaces/spacesBlocks";
import { spacesLayoutNoticeSources } from "../src/features/spaces/spacesLayout";

function source(path: string) {
  return readFileSync(join(process.cwd(), "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("Spaces recovery presentation contracts", () => {
  it.each(["unavailable", "stale", "ready", "loading"] as const)("retains legacy %s recovery helper and gives the unified table one inventory recovery owner", (state) => {
    const inventory = { ...blockSource(state), label: "Sellability" };
    const permissions = { ...blockSource("unavailable"), label: "Access" };
    const physical = { ...blockSource("stale"), label: "Rooms" };
    const sources = [permissions, physical, inventory];
    expect(spacesLayoutNoticeSources(sources, inventory, true)).toEqual([permissions, physical]);
    expect(spacesLayoutNoticeSources(sources, inventory, false)).toBe(sources);
    const page = source("features/spaces/SpacesPage.tsx");
    expect(page).toContain('if (mayReadInventory && !propertyOpen) primarySources.push(inventorySource)');
    expect(page).toContain('sources={layoutNoticeSources} title="Some Spaces information is delayed"');
    expect(page).not.toContain('detailSources.push(inventorySource)');
  });
  it("gives every desktop room row a focus treatment distinct from selection", () => {
    const page = source("features/spaces/SpacesRoomWorkspace.tsx");

    expect(page).toContain("focus-visible:bg-primary/12");
    expect(page).toContain("focus-visible:ring-2");
    expect(page).toContain("focus-visible:ring-inset");
    expect(page).toContain("focus-visible:ring-primary");
  });

  it("explicitly enables the responsive notice layout for both selected-room and page-owned recovery", () => {
    const page = source("features/spaces/SpacesPage.tsx");
    expect(page).toMatch(/<CompositeSourceNotice\s+className="m-4 flex"\s+sources=\{detailSources\}/);
    expect(page).toContain('<CompositeSourceNotice className="mb-4 flex" sources={layoutNoticeSources}');
  });

  it("uses the terminal Availability fallback as the only retry owner when the primary source is unavailable", () => {
    const section = source("features/spaces/SpacesAvailabilitySection.tsx");

    expect(section).toContain("{compositeSourceUsable(source.state) && (");
    expect(section).toContain('<CompositeSourceNotice className="mx-4 mt-4 sm:mx-5"');
    expect(section).toContain('<CompositeSourceFallback error={sourceError} state={source.state}');
  });

  it("gives only the fallback ownership of a terminal uncached Blocks failure", () => {
    const blocks = blockSource("unavailable");
    const inventory = { ...blockSource("ready"), label: "Inventory" };
    expect(spacesBlockNoticeSources([inventory, blocks], blocks, false)).toEqual([inventory]);
    const section = source("features/spaces/SpacesBlocksSection.tsx");
    expect(section).toContain("spacesBlockNoticeSources(sources, source, contextMismatch)");
    expect(section).toContain('sources={noticeSources} title="Block evidence is not current"');
    expect(section).toContain('<CompositeSourceFallback error={sourceError} state={source.state} label="inventory blocks" retry={() => void source.refetch()}');
  });

  it.each(["loading", "ready", "stale"] as const)("preserves Blocks source notices for %s data", (state) => {
    const blocks = blockSource(state);
    const sources = [blocks];
    expect(spacesBlockNoticeSources(sources, blocks, false)).toBe(sources);
  });

  it("keeps independent access/property/inventory failures when Blocks has no cached data", () => {
    const blocks = blockSource("unavailable");
    const otherSources = ["Access", "Property", "Inventory"].map((label) => ({ ...blockSource("unavailable"), label }));
    expect(spacesBlockNoticeSources([...otherSources, blocks], blocks, false)).toEqual(otherSources);
    const retrying = { ...blocks, isFetching: true };
    expect(spacesBlockNoticeSources([retrying], retrying, false)).toEqual([]);
  });

  it("does not suppress recovery when context mismatch prevents the terminal fallback", () => {
    const blocks = blockSource("unavailable");
    const sources = [blocks];
    expect(spacesBlockNoticeSources(sources, blocks, true)).toBe(sources);
  });
});

function blockSource(state: CompositeSource["state"]): CompositeSource {
  return { label: "Inventory blocks", state, isFetching: false, refetch: async () => undefined };
}
