import { describe, expect, it } from "vitest";
import type {
  BedListResponse,
  PropertyListResponse,
  RoomListResponse,
} from "../src/api/types";
import {
  loadAllBeds,
  loadAllProperties,
  loadAllRooms,
} from "../src/features/properties/propertiesApi";

describe("properties API pagination", () => {
  it("loads every property page while continuation is reported", async () => {
    const paths: string[] = [];
    const responses = [
      propertyPage("A", true),
      propertyPage("B", false),
    ];
    const request = async <T>(path: string): Promise<T> => {
      paths.push(path);
      return responses.shift() as T;
    };

    const result = await loadAllProperties(request);

    expect(result.properties.map((item) => item.name)).toEqual(["A", "B"]);
    expect(paths[1]).toContain("page=2");
  });

  it("loads room and bed pages without probing past HasMore", async () => {
    const roomPaths: string[] = [];
    const bedPaths: string[] = [];
    const roomResponses = [roomPage("101", true), roomPage("102", false)];
    const bedResponses = [bedPage("1", true), bedPage("2", false)];

    const rooms = await loadAllRooms(async <T>(path: string): Promise<T> => {
      roomPaths.push(path);
      return roomResponses.shift() as T;
    }, "property-a");
    const beds = await loadAllBeds(async <T>(path: string): Promise<T> => {
      bedPaths.push(path);
      return bedResponses.shift() as T;
    }, "property-a", "room-a");

    expect(rooms.rooms.map((item) => item.name)).toEqual(["101", "102"]);
    expect(beds.beds.map((item) => item.label)).toEqual(["1", "2"]);
    expect(roomPaths).toHaveLength(2);
    expect(bedPaths).toHaveLength(2);
  });
});

function propertyPage(name: string, hasMore: boolean): PropertyListResponse {
  return {
    properties: [{
      propertyId: `property-${name}`,
      name,
      code: name.toLowerCase(),
      timeZoneId: "Etc/UTC",
      timeZoneStatus: "canonical",
      canonicalTimeZoneId: "Etc/UTC",
      timeZoneCatalogVersion: "TZDB: 2026c (mapping: 48.2)",
      timeZoneObservedAtUtc: "2026-08-15T00:00:00Z",
      timeZoneCorrectionAllowed: false,
      status: "active",
      processingStatus: "unconfigured",
      version: 1,
    }],
    page: 1,
    pageSize: 100,
    hasMore,
  };
}

function roomPage(name: string, hasMore: boolean): RoomListResponse {
  return {
    rooms: [{
      propertyId: "property-a",
      roomId: `room-${name}`,
      name,
      buildingLabel: null,
      floorLabel: null,
      status: "active",
      version: 1,
    }],
    page: 1,
    pageSize: 100,
    hasMore,
  };
}

function bedPage(label: string, hasMore: boolean): BedListResponse {
  return {
    beds: [{
      propertyId: "property-a",
      roomId: "room-a",
      bedId: `bed-${label}`,
      label,
      status: "active",
      version: 1,
      roomVersion: 1,
    }],
    page: 1,
    pageSize: 100,
    hasMore,
  };
}
