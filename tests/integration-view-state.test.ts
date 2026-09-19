import { describe, expect, it } from "vitest";
import {
  activityConnectionSearchParams,
  activityPageSearchParams,
  clearIntegrationViewSearchParams,
  connectionFilterSearchParams,
  connectionPageSearchParams,
  ingestionActivityTabSearchParams,
  integrationPrimaryTabSearchParams,
  integrationSelectionSearchParams,
  integrationViewState,
  proposalFilterSearchParams,
  proposalPageSearchParams,
} from "../src/features/integrations/integrationViewState";

describe("integration view state", () => {
  it("uses stable defaults and rejects malformed filter and page values", () => {
    expect(integrationViewState(new URLSearchParams())).toMatchObject({
      tab: "connections",
      connectionStatus: "all",
      connectionPage: 1,
      proposalStatus: "pending",
      proposalPage: 1,
      activityTab: "runs",
      activityPage: 1,
    });
    expect(integrationViewState(new URLSearchParams(
      "tab=nope&status=nope&page=-1&proposalStatus=nope&proposalPage=0&activity=nope&activityPage=NaN",
    ))).toMatchObject({
      tab: "connections",
      connectionStatus: "all",
      connectionPage: 1,
      proposalStatus: "pending",
      proposalPage: 1,
      activityTab: "runs",
      activityPage: 1,
    });
  });

  it("restores independent connection, review, and activity context", () => {
    expect(integrationViewState(new URLSearchParams("status=disabled&page=3"))).toMatchObject({
      tab: "connections",
      connectionStatus: "disabled",
      connectionPage: 3,
    });
    expect(integrationViewState(new URLSearchParams(
      "tab=review&proposalStatus=superseded&proposalPage=2",
    ))).toMatchObject({
      tab: "review",
      proposalStatus: "superseded",
      proposalPage: 2,
    });
    expect(integrationViewState(new URLSearchParams(
      "tab=activity&activity=receipts&source=connection-a&activityPage=4",
    ))).toMatchObject({
      tab: "activity",
      activityTab: "receipts",
      activityConnectionId: "connection-a",
      activityPage: 4,
    });
  });

  it("lets an exact detail choose its owning primary and activity tab", () => {
    expect(integrationViewState(new URLSearchParams("tab=activity&connection=connection-a")).tab)
      .toBe("connections");
    expect(integrationViewState(new URLSearchParams("proposal=proposal-a")).tab)
      .toBe("review");
    expect(integrationViewState(new URLSearchParams("receipt=receipt-a"))).toMatchObject({
      tab: "activity",
      activityTab: "receipts",
      selectedReceiptId: "receipt-a",
    });
  });

  it("persists primary filters and bounded pages while clearing incompatible detail", () => {
    const current = new URLSearchParams("tab=review&proposal=proposal-a&verify=1");
    expect(integrationPrimaryTabSearchParams(current, "connections").toString()).toBe("verify=1");

    const connections = new URLSearchParams("status=enabled&page=4&connection=connection-a");
    expect(connectionFilterSearchParams(connections, "disabled").toString()).toBe("status=disabled");
    expect(connectionPageSearchParams(connections, 2).toString()).toBe("status=enabled&page=2");

    const proposals = new URLSearchParams("tab=review&proposalStatus=failed&proposalPage=3&proposal=proposal-a");
    expect(proposalFilterSearchParams(proposals, "pending").toString()).toBe("tab=review");
    expect(proposalPageSearchParams(proposals, 1).toString()).toBe("tab=review&proposalStatus=failed");
  });

  it("persists activity investigation context and exact selection", () => {
    const current = new URLSearchParams("tab=activity&activity=receipts&source=connection-a&activityPage=3&receipt=receipt-a");
    expect(ingestionActivityTabSearchParams(current, "reprocessing").toString())
      .toBe("tab=activity&activity=reprocessing&source=connection-a");
    expect(activityConnectionSearchParams(current, null).toString())
      .toBe("tab=activity&activity=receipts");
    expect(activityPageSearchParams(current, 2).toString())
      .toBe("tab=activity&activity=receipts&source=connection-a&activityPage=2");
    expect(integrationSelectionSearchParams(current, "run", "run-a").toString())
      .toBe("tab=activity&activity=receipts&source=connection-a&activityPage=3&run=run-a");
  });

  it("clears every property-bound integration parameter on a scope change", () => {
    const current = new URLSearchParams(
      "tab=activity&status=enabled&page=2&proposalStatus=all&proposalPage=3&activity=receipts&source=a&activityPage=4&receipt=r&property=p&verify=1",
    );
    expect(clearIntegrationViewSearchParams(current).toString()).toBe("property=p&verify=1");
  });
});
