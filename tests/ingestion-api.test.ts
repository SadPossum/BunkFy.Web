import { describe, expect, it } from "vitest";
import type { AdapterConnectionListResponse } from "../src/api/types";
import { loadAllAdapterConnections } from "../src/features/integrations/ingestionApi";

describe("ingestion API pagination", () => {
  it("loads every connection page while continuation is reported", async () => {
    const paths: string[] = [];
    const responses = [
      connectionPage("A", true),
      connectionPage("B", false),
    ];
    const request = async <T>(path: string): Promise<T> => {
      paths.push(path);
      return responses.shift() as T;
    };

    const result = await loadAllAdapterConnections(request, "property-a");

    expect(result.connections.map((item) => item.connectionId)).toEqual([
      "connection-A",
      "connection-B",
    ]);
    expect(paths).toHaveLength(2);
    expect(paths[1]).toContain("page=2");
  });
});

function connectionPage(
  id: string,
  hasMore: boolean,
): AdapterConnectionListResponse {
  return {
    connections: [{
      connectionId: `connection-${id}`,
      adapterType: "test-adapter",
      executionMode: "polling",
      pollingIntervalSeconds: 300,
      conflictPolicy: "suggestionsOnly",
      status: "enabled",
    }],
    page: 1,
    pageSize: 100,
    hasMore,
  };
}
