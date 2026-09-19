import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Bed, Property, Room } from "../src/api/types";
import { ApiError } from "../src/api/client";
import { topologyAttemptCurrent, topologyInputRejected, topologyReceiptMatches, topologyTargetAllowed, topologyVersionConflict, type TopologyEditorEvidence, type TopologyEditorTarget } from "../src/features/properties/topologyEditorModel";
import { resolveRoomMutationAttempt } from "../src/features/properties/roomMutationAttempt";
import { resolveBedMutationAttempt } from "../src/features/properties/bedMutationAttempt";
import { createCompositeSource, type CompositeSource } from "../src/app/compositeSourceState";
import { CompositeSourceNotice } from "../src/components/ui/CompositeSourceNotice";
import { TopologyMutationNotice } from "../src/features/properties/TopologyEditorForm";

const property = { propertyId: "693a6fc9-71e0-4987-b27c-790eaf4f3cef", version: 3, status: "active" } as Property;
const room = { propertyId: property.propertyId, roomId: "234f6d3f-59ad-456f-8eee-50bd4a640e07", version: 4, status: "active" } as Room;
const bed = { propertyId: property.propertyId, roomId: room.roomId, bedId: "f069d803-3816-463b-acf8-b5b6d5800433", version: 2, roomVersion: 4, status: "active" } as Bed;
const evidence: TopologyEditorEvidence = { property, rooms: [room], beds: [bed], permissionsCurrent: true, propertyCurrent: true, roomsCurrent: true, bedsCurrent: true, mayManageRooms: true, mayManageBeds: true };
const targets: TopologyEditorTarget[] = [{ kind: "room", property }, { kind: "room", property, room }, { kind: "bed", property, room }, { kind: "bed", property, room, bed }];

describe("shared room/bed editor authority and exact receipts", () => {
  it("keeps room and bed permissions independent", () => {
    for (const target of targets) {
      expect(topologyTargetAllowed(target, evidence)).toBe(true);
      expect(topologyTargetAllowed(target, { ...evidence, permissionsCurrent: false })).toBe(false);
      expect(topologyTargetAllowed(target, { ...evidence, mayManageRooms: false })).toBe(target.kind === "bed");
      expect(topologyTargetAllowed(target, { ...evidence, mayManageBeds: false })).toBe(target.kind === "room");
    }
  });
  it("refuses delayed sources, retired scope and missing exact targets even for replay", () => {
    expect(topologyTargetAllowed(targets[0], { ...evidence, propertyCurrent: false })).toBe(false);
    for (const target of targets.slice(1)) expect(topologyTargetAllowed(target, { ...evidence, roomsCurrent: false }, true)).toBe(false);
    for (const target of targets.slice(2)) expect(topologyTargetAllowed(target, { ...evidence, bedsCurrent: false }, true)).toBe(false);
    for (const target of targets) expect(topologyTargetAllowed(target, { ...evidence, property: { ...property, status: "retired" } }, true)).toBe(false);
    expect(topologyTargetAllowed(targets[3], { ...evidence, beds: [] }, true)).toBe(false);
    expect(topologyTargetAllowed(targets[1], { ...evidence, rooms: [{ ...room, propertyId: "other" }] }, true)).toBe(false);
  });
  it("allows exact unknown-outcome journal replay after its own revision advances, not a fresh write", () => {
    const advanced = { ...evidence, property: { ...property, version: 4 }, rooms: [{ ...room, version: 5 }], beds: [{ ...bed, version: 3, roomVersion: 5 }] };
    for (const target of targets) {
      expect(topologyTargetAllowed(target, advanced)).toBe(false);
      expect(topologyTargetAllowed(target, advanced, true)).toBe(true);
    }
    const input = { propertyId: property.propertyId, roomId: room.roomId, expectedVersion: 4, name: "Room 402", buildingLabel: "A", floorLabel: "4" };
    const first = resolveRoomMutationAttempt(null, input, () => "operation-a");
    expect(resolveRoomMutationAttempt(first, { ...input, expectedVersion: 5 })).toBe(first);
    expect(resolveRoomMutationAttempt(null, { ...input, expectedVersion: 5 }, () => "operation-b")).toMatchObject({ operationId: "operation-b", expectedVersion: 5 });
    const batch = { propertyId: property.propertyId, roomId: room.roomId, expectedRoomVersion: 4, labels: ["Window", "Door"] };
    const attempt = resolveBedMutationAttempt(null, batch, () => "batch-a");
    expect(resolveBedMutationAttempt(attempt, { ...batch, expectedRoomVersion: 5 })).toBe(attempt);
  });
  it("fences actor, property, selected bed and newer editor instances", () => {
    const attempt = { context: "actor:property:room|bed-a|unit-a", instance: 4 };
    expect(topologyAttemptCurrent(attempt, { ...attempt })).toBe(true);
    expect(topologyAttemptCurrent(attempt, { ...attempt, instance: 5 })).toBe(false);
    for (const context of ["actor-b:property:room|bed-a|unit-a", "actor:other:room|bed-a|unit-a", "actor:property:room|bed-b|unit-b"]) expect(topologyAttemptCurrent(attempt, { ...attempt, context })).toBe(false);
  });
  it("validates exact room and bed identities, positive revisions and complete batch count", () => {
    const receipt = { propertyId: property.propertyId, roomId: room.roomId, version: 5 };
    expect(topologyReceiptMatches(receipt, targets[0])).toBe(true);
    expect(topologyReceiptMatches(receipt, targets[1])).toBe(true);
    for (const invalid of [null, {}, { ...receipt, roomId: "" }, { ...receipt, roomId: "not-a-uuid" }, { ...receipt, propertyId: "other" }, { ...receipt, version: 0 }, { ...receipt, version: 1.5 }]) expect(topologyReceiptMatches(invalid, targets[0])).toBe(false);
    const batch = { propertyId: property.propertyId, roomId: room.roomId, roomVersion: 5, affectedBedCount: 2 };
    expect(topologyReceiptMatches(batch, targets[2], 2)).toBe(true);
    for (const count of [0, 1, 3, 101, 1.5, undefined]) expect(topologyReceiptMatches(batch, targets[2], count)).toBe(false);
    expect(topologyReceiptMatches({ ...batch, roomId: property.propertyId }, targets[2], 2)).toBe(false);
    const single = { ...receipt, bedId: bed.bedId, roomVersion: 5 };
    expect(topologyReceiptMatches(single, targets[3])).toBe(true);
    expect(topologyReceiptMatches({ ...single, bedId: property.propertyId }, targets[3])).toBe(false);
    expect(topologyReceiptMatches({ ...single, roomVersion: 0 }, targets[3])).toBe(false);
  });
  it("distinguishes known input rejection, actual revision conflicts and unknown outcomes", () => {
    expect(topologyVersionConflict(new ApiError("Changed", 409, "Properties.VersionConflict"))).toBe(true);
    expect(topologyInputRejected(new ApiError("Invalid", 400, "Validation"))).toBe(true);
    for (const code of ["Properties.RoomAlreadyExists", "Properties.BedAlreadyExists"]) expect(topologyInputRejected(new ApiError("Duplicate", 409, code))).toBe(true);
    for (const error of [new ApiError("Changed", 409, "Properties.VersionConflict"), new ApiError("Unavailable", 503), new Error("Network error"), new ApiError("Confirm", 403, "Security.InsufficientAuthentication")]) expect(topologyInputRejected(error)).toBe(false);
  });
  it("wires both surfaces to one mutation owner, preserving drafts and separate readback", () => {
    const read = (file: string) => readFileSync(`src/features/${file}`, "utf8");
    const controller = read("properties/useTopologyEditor.ts"), form = read("properties/TopologyEditorForm.tsx");
    for (const file of ["properties/PropertiesPage.tsx", "spaces/SpacesPage.tsx"]) {
      expect(read(file)).toContain("useTopologyEditor({");
      expect(read(file)).toContain("<TopologyEditorForm");
      expect(read(file)).not.toContain("resolveRoomMutationAttempt");
      expect(read(file)).not.toContain("resolveBedMutationAttempt");
    }
    expect(controller).toContain("refresh(input.target.property.propertyId)");
    expect(controller).toContain("topologyReceiptMatches(receipt, selected");
    expect(controller).toContain("mutation.mutate({ ...mutation.variables, replay: true })");
    expect(controller).toContain("mutation.reset(); setReviewed(false); setTarget(reviewTarget)");
    expect(controller).toContain("setNotice(message)");
    expect(controller).not.toContain("Current details could not be refreshed");
    expect(controller).not.toContain("const readbackCurrent");
    expect(controller).toContain('useEffect(() => { reset(); }, [context])');
    expect(controller).toContain('[sessionIdentityKey(session), property?.propertyId]');
    expect(controller).toContain("formDraft.current = null");
    expect(form).toContain("editor.formDraft.current?.roomDraft");
    expect(form).toContain("editor.formDraft.current?.labels");
    expect(form).toContain("document.activeElement === document.body");
    expect(form).toContain("Use current version and keep draft");
    expect(form).toContain("Edit draft");
    expect(form).toContain("onFocusCapture={inline");
    expect(form).toContain("maxLength={128}");
    const spaces = read("spaces/SpacesPage.tsx");
    expect(spaces).toContain('bedEvidence === "current" ? physicalBeds.length : "Unconfirmed"');
    expect(spaces).toContain("Whole-room inventory is separate from the physical bed count.");
    expect(spaces).toContain("Whole room not offered separately");
    expect(spaces).not.toContain("Manage topology");
    expect(spaces).toContain("useTopologyRetirementEditor({");
    expect(spaces).toContain("<TopologyRetirementPanel");
    expect(spaces).toContain('sources={detailSources} title="Physical bed details are not current"');
    expect(spaces).toContain("requestedBedId ?? \"\", requestedUnitId ?? \"\"");
    expect(spaces).toContain('if (topologyEditor.target?.kind === "room" && !topologyEditor.target.room) return;');
    const legacy = read("properties/PropertiesPage.tsx");
    expect(legacy.indexOf("const topologyEditor = useTopologyEditor")).toBeLessThan(legacy.indexOf('if (targetEdit !== "room"'));
    expect(legacy).toContain('`${topologyEditor.context}:${targetEdit}:${targetId}`');
  });
});

describe("confirmed topology receipt and live readback feedback", () => {
  const source = (label: string, error: unknown = null, hasData = true, isFetching = false) => createCompositeSource({
    label, error, hasData, isFetching, isLoading: false, refetch: async () => {},
  });
  const renderFeedback = (sources: CompositeSource[]) => renderToStaticMarkup(createElement(Fragment, null,
    createElement(TopologyMutationNotice, { notice: "Bed label saved." }),
    createElement(CompositeSourceNotice, { sources, title: "Some room details are delayed" }),
  ));

  it.each([true, false])("retains the confirmed save and one scoped retry while required bed readback fails (cached %s)", (hasData) => {
    const html = renderFeedback([source("Physical beds", new Error("503"), hasData)]);
    expect(html).toContain("Bed label saved.");
    expect(html).toContain(hasData ? "Physical beds is showing its last confirmed snapshot" : "Physical beds could not be confirmed");
    expect(html.match(/>Try again</g)).toHaveLength(1);
    expect(html).not.toContain("Current details could not be refreshed");
  });

  it("removes failed-read guidance on same-target recovery without losing the save confirmation", () => {
    // Same selected room/bed and confirmed receipt; only this live source changes.
    const label = `Physical beds for ${room.roomId}`;
    for (const isFetching of [false, true]) {
      const html = renderFeedback([source(label, new Error("503"), true, isFetching)]);
      expect(html).toContain("Bed label saved.");
      expect(html).toContain("last confirmed snapshot");
      expect(html.match(/>Try again</g)).toHaveLength(1);
      expect(html.includes('disabled=""')).toBe(isFetching);
    }
    const recovered = renderFeedback([source(label)]);
    expect(recovered).toContain("Bed label saved.");
    expect(recovered).not.toContain("Some room details are delayed");
    expect(recovered).not.toContain("snapshot");
    expect(recovered).not.toContain("Try again");
    expect(recovered).not.toContain("source warning");
  });

  it("keeps unrelated source failure scoped instead of qualifying the confirmed bed receipt", () => {
    const html = renderFeedback([source("Physical beds"), source("Inventory", new Error("503"))]);
    expect(html).toMatch(/>Bed label saved\.<\/p>/);
    expect(html).toContain("Inventory is showing its last confirmed snapshot");
    expect(html).not.toContain("Physical beds is showing");
    expect(html).not.toContain("Physical beds could not");
    expect(html.match(/>Try again</g)).toHaveLength(1);
    expect(html).not.toContain("Current details could not be refreshed");
  });
});
