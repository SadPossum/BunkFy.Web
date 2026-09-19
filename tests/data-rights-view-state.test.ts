import { describe, expect, it } from "vitest";
import {
  clearDataRightsOperatorContextSearchParams,
  clearDataRightsScopeContextSearchParams,
  dataRightsCaseSearchParams,
  dataRightsPageSearchParams,
  dataRightsScopeSearchParams,
  dataRightsStatusSearchParams,
  dataRightsViewState,
} from "../src/features/data-rights/dataRightsViewState";

describe("data-rights view state", () => {
  it("uses the supplied scope default and rejects malformed filters and pages", () => {
    expect(dataRightsViewState(new URLSearchParams(), "guest")).toEqual({
      scope: "guest",
      status: "all",
      page: 1,
      selectedCaseId: null,
    });
    expect(dataRightsViewState(
      new URLSearchParams("scope=nope&status=10&page=-1&case=%20"),
      "staff",
    )).toEqual({
      scope: "staff",
      status: "all",
      page: 1,
      selectedCaseId: null,
    });
  });

  it("restores exact queue and case context", () => {
    expect(dataRightsViewState(
      new URLSearchParams("scope=staff&status=8&page=3&case=case-a"),
      "guest",
    )).toEqual({
      scope: "staff",
      status: "8",
      page: 3,
      selectedCaseId: "case-a",
    });
  });

  it("changes scope and filters without retaining incompatible queue context", () => {
    const current = new URLSearchParams(
      "scope=guest&status=8&page=3&case=case-a&focus=case-a&property=property-a&verify=1",
    );
    expect(dataRightsScopeSearchParams(current, "staff").toString())
      .toBe("scope=staff&property=property-a&verify=1");
    expect(dataRightsStatusSearchParams(current, "5").toString())
      .toBe("scope=guest&status=5&property=property-a&verify=1");
    expect(dataRightsStatusSearchParams(current, "all").toString())
      .toBe("scope=guest&property=property-a&verify=1");
  });

  it("changes bounded pages and exact cases independently", () => {
    const current = new URLSearchParams("scope=guest&status=2&page=4&case=case-a&verify=1");
    expect(dataRightsPageSearchParams(current, 2).toString())
      .toBe("scope=guest&status=2&page=2&verify=1");
    expect(dataRightsPageSearchParams(current, 1).toString())
      .toBe("scope=guest&status=2&verify=1");
    expect(dataRightsCaseSearchParams(current, "case-b").toString())
      .toBe("scope=guest&status=2&page=4&case=case-b&verify=1");
  });

  it("clears scope- and operator-bound state while preserving unrelated URL context", () => {
    const current = new URLSearchParams(
      "scope=guest&status=8&page=3&case=case-a&focus=case-a&property=property-a&verify=1",
    );
    expect(clearDataRightsScopeContextSearchParams(current).toString())
      .toBe("scope=guest&status=8&property=property-a&verify=1");
    expect(clearDataRightsOperatorContextSearchParams(current).toString())
      .toBe("scope=guest&property=property-a&verify=1");
  });
});
