import { describe, expect, it } from "vitest";
import type {
  BedListResponse,
  PropertyListResponse,
  PropertyProcessingState,
  PropertyTimeZoneCatalogPage,
  RoomListResponse,
} from "../src/api/types";
import {
  bedListMatchesContext,
  loadAllBeds,
  loadAllProperties,
  loadAllPropertyTimeZones,
  loadAllRooms,
  loadPropertyProcessingState,
  propertyProcessingStateMatchesProperty,
  roomListMatchesProperty,
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

  it("loads the canonical time-zone catalogue through opaque cursors", async () => {
    const paths: string[] = [];
    const responses = [
      timeZonePage("Etc/UTC", true, "catalog-next"),
      timeZonePage("Europe/Paris", false, null),
    ];

    const result = await loadAllPropertyTimeZones(async <T>(path: string): Promise<T> => {
      paths.push(path);
      return responses.shift() as T;
    }, "property-a");

    expect(result.timeZones.map((item) => item.timeZoneId)).toEqual([
      "Etc/UTC",
      "Europe/Paris",
    ]);
    expect(paths).toEqual([
      "/api/properties/property-a/time-zones/catalog?pageSize=100",
      "/api/properties/property-a/time-zones/catalog?pageSize=100&cursor=catalog-next",
    ]);
    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("rejects a time-zone catalogue continuation that cannot advance", async () => {
    const responses = [
      timeZonePage("Etc/UTC", true, "repeat"),
      timeZonePage("Europe/Paris", true, "repeat"),
    ];

    await expect(loadAllPropertyTimeZones(async <T>(): Promise<T> => (
      responses.shift() as T
    ))).rejects.toThrow("invalid continuation");
  });

  it("loads only the selected processing state with the caller abort signal", async () => {
    const controller = new AbortController();
    let observedPath = "";
    let observedSignal: AbortSignal | null | undefined;
    await loadPropertyProcessingState(async <T>(path: string, options?: RequestInit): Promise<T> => {
      observedPath = path;
      observedSignal = options?.signal;
      return {} as T;
    }, "property-a", controller.signal);

    expect(observedPath).toBe("/api/properties/property-a/processing");
    expect(observedSignal).toBe(controller.signal);
  });

  it("binds a processing response to the selected property", () => {
    const state: PropertyProcessingState = {
      propertyId: "property-a",
      configuredStatus: "enabled",
      effectiveStatus: "enabled",
      reasonCode: "configured",
      governancePolicy: null,
      propertyVersion: 1,
      evaluatedAtUtc: "2026-09-01T10:00:00Z",
    };
    expect(propertyProcessingStateMatchesProperty(state, "property-a")).toBe(true);
    expect(propertyProcessingStateMatchesProperty(state, "property-b")).toBe(false);
  });

  it("binds room and bed responses to the exact owner context", () => {
    const rooms = roomPage("101", false).rooms;
    const beds = bedPage("1", false).beds;
    expect(roomListMatchesProperty(rooms, "property-a")).toBe(true);
    expect(bedListMatchesContext(beds, "property-a", "room-a")).toBe(true);

    rooms[0]!.propertyId = "property-b";
    beds[0]!.roomId = "room-b";
    expect(roomListMatchesProperty(rooms, "property-a")).toBe(false);
    expect(bedListMatchesContext(beds, "property-a", "room-a")).toBe(false);
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

function timeZonePage(
  timeZoneId: string,
  hasMore: boolean,
  nextCursor: string | null,
): PropertyTimeZoneCatalogPage {
  return {
    catalogVersion: "TZDB: 2026c",
    observedAtUtc: "2026-08-25T00:00:00Z",
    timeZones: [{
      timeZoneId,
      countries: timeZoneId === "Europe/Paris" ? [{ code: "FR", name: "France" }] : [],
      comment: null,
      utcOffsetMinutes: timeZoneId === "Europe/Paris" ? 120 : 0,
      runtimeAvailable: true,
    }],
    nextCursor,
    hasMore,
  };
}
