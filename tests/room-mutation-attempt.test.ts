import { describe, expect, it } from "vitest";
import { resolveRoomMutationAttempt } from "../src/features/properties/roomMutationAttempt";

describe("room mutation attempts", () => {
  it("keeps the operation and original version for the same normalized intent", () => {
    const first = resolveRoomMutationAttempt(
      null,
      {
        propertyId: "property-a",
        expectedVersion: 3,
        name: " 4A ",
        buildingLabel: " Main ",
        floorLabel: " ",
      },
      () => "operation-a",
    );

    const retry = resolveRoomMutationAttempt(
      first,
      {
        propertyId: "property-a",
        expectedVersion: 4,
        name: "4A",
        buildingLabel: "Main",
        floorLabel: "",
      },
      () => "operation-b",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-a");
    expect(retry.expectedVersion).toBe(3);
  });

  it("starts a new attempt when normalized room values change", () => {
    const first = resolveRoomMutationAttempt(
      null,
      {
        propertyId: "property-a",
        roomId: "room-a",
        expectedVersion: 2,
        name: "4A",
        buildingLabel: "Main",
        floorLabel: "2",
      },
      () => "operation-a",
    );

    const changed = resolveRoomMutationAttempt(
      first,
      {
        propertyId: "property-a",
        roomId: "room-a",
        expectedVersion: 2,
        name: "4A East",
        buildingLabel: "Main",
        floorLabel: "2",
      },
      () => "operation-b",
    );

    expect(changed.operationId).toBe("operation-b");
  });

  it("isolates attempts by action and room target", () => {
    const create = resolveRoomMutationAttempt(
      null,
      {
        propertyId: "property-a",
        expectedVersion: 1,
        name: "4A",
        buildingLabel: "",
        floorLabel: "",
      },
      () => "operation-a",
    );
    const update = resolveRoomMutationAttempt(
      create,
      {
        propertyId: "property-a",
        roomId: "room-a",
        expectedVersion: 1,
        name: "4A",
        buildingLabel: "",
        floorLabel: "",
      },
      () => "operation-b",
    );
    const otherRoom = resolveRoomMutationAttempt(
      update,
      {
        propertyId: "property-a",
        roomId: "room-b",
        expectedVersion: 1,
        name: "4A",
        buildingLabel: "",
        floorLabel: "",
      },
      () => "operation-c",
    );

    expect(update.operationId).toBe("operation-b");
    expect(otherRoom.operationId).toBe("operation-c");
  });
});
