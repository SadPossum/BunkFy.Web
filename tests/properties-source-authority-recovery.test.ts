import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Bed, Property, Room } from "../src/api/types";
import {
  bedRecordIsCurrent,
  propertiesMutationAllowed,
  propertyRecordMatches,
  roomRecordIsCurrent,
} from "../src/features/properties/propertiesMutationAuthority";

const repositoryRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8");
}

describe("properties source authority recovery", () => {
  it("requires only the current evidence consumed by each command", () => {
    const current = {
      permissionsCurrent: true,
      propertyCurrent: true,
      roomsCurrent: true,
      bedsCurrent: true,
      processingCurrent: true,
      policiesCurrent: true,
      retirementCurrent: true,
    };

    for (const action of [
      "create-property",
      "update-property",
      "create-room",
      "update-room",
      "create-bed",
      "update-bed",
      "activate-processing",
      "suspend-processing",
      "control-retirement",
    ] as const) {
      expect(propertiesMutationAllowed(action, current)).toBe(true);
      expect(propertiesMutationAllowed(action, {
        ...current,
        permissionsCurrent: false,
      })).toBe(false);
    }

    expect(propertiesMutationAllowed("create-property", {
      permissionsCurrent: true,
    })).toBe(true);
    expect(propertiesMutationAllowed("update-property", {
      ...current,
      propertyCurrent: false,
    })).toBe(false);
    expect(propertiesMutationAllowed("update-room", {
      ...current,
      roomsCurrent: false,
    })).toBe(false);
    expect(propertiesMutationAllowed("create-bed", {
      ...current,
      bedsCurrent: false,
    })).toBe(false);
    expect(propertiesMutationAllowed("activate-processing", {
      ...current,
      policiesCurrent: false,
    })).toBe(false);
    expect(propertiesMutationAllowed("suspend-processing", {
      ...current,
      policiesCurrent: false,
    })).toBe(true);
    expect(propertiesMutationAllowed("control-retirement", {
      ...current,
      retirementCurrent: false,
    })).toBe(false);
  });

  it("rejects a command record after its source advances", () => {
    const property = { propertyId: "property-a", version: 7 } as Property;
    const room = { roomId: "room-a", version: 4 } as Room;
    const bed = {
      bedId: "bed-a",
      roomId: "room-a",
      version: 2,
      roomVersion: 4,
    } as Bed;

    expect(propertyRecordMatches(property, property)).toBe(true);
    expect(propertyRecordMatches({ ...property, version: 8 }, property)).toBe(false);
    expect(roomRecordIsCurrent([room], room)).toBe(true);
    expect(roomRecordIsCurrent([{ ...room, version: 5 }], room)).toBe(false);
    expect(bedRecordIsCurrent([bed], room, bed)).toBe(true);
    expect(bedRecordIsCurrent([{ ...bed, roomVersion: 5 }], room, bed)).toBe(false);
    expect(bedRecordIsCurrent([bed], { ...room, version: 5 }, bed)).toBe(false);
  });

  it("preserves independent property sources and gates every mutation path", () => {
    const page = source("features/properties/PropertiesPage.tsx");
    const processing = source("features/properties/PropertyProcessingPanel.tsx");
    const retirement = source("features/properties/TopologyRetirementModal.tsx");

    expect(page).toContain("<CompositeSourceNotice");
    expect(page).toContain("<CompositeSourceFallback");
    expect(page).toContain("const permissionsCurrent = compositeSourceCurrent(permissionSource)");
    expect(page).toContain("propertyRecordMatches(selectedProperty, input.property)");
    expect(page).toContain("roomRecordIsCurrent(roomItems, input.room)");
    expect(page).toContain("bedRecordIsCurrent(bedItems, selectedRoom, input.bed)");
    expect(page).not.toContain("if (workspace.propertiesError) return");
    expect(page).not.toContain("rooms.error ?");
    expect(page).not.toContain("beds.error ?");

    expect(processing).toContain("const canActivate = canManage && propertiesMutationAllowed");
    expect(processing).toContain("compositeSourceCurrent(processingSource)");
    expect(processing).toContain("compositeSourceCurrent(policySource)");
    expect(processing).toContain("authorityCurrent={canActivate}");
    expect(retirement).toContain("canConfirm: boolean");
    expect(retirement).toContain("disabled={!canRetry || retryPending}");
    expect(retirement).toContain("disabled={!canCancel || cancellationPending");
  });

  it("reconciles the saved property only after a successful current catalogue read", () => {
    const workspace = source("app/workspace.tsx");

    expect(workspace).toContain("const propertyCatalogueCurrent = Boolean(");
    expect(workspace).toContain("if (!propertyCatalogueCurrent) return");
    expect(workspace).toContain("localStorage.removeItem(propertyStorageKey)");
  });
});
