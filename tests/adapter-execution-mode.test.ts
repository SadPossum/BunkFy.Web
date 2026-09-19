import { describe, expect, it } from "vitest";
import {
  adapterExecutionModeKey,
  adapterExecutionModeSupportsIngressCredentials,
} from "../src/api/labels";

describe("adapter execution modes", () => {
  it.each([
    [1, "polling"],
    [2, "continuous"],
    [3, "push"],
    [4, "remotePolling"],
    ["push", "push"],
    ["remotePolling", "remotePolling"],
  ] as const)("normalizes %s", (mode, expected) => {
    expect(adapterExecutionModeKey(mode)).toBe(expected);
  });

  it.each([
    [1, false],
    ["continuous", false],
    [3, true],
    ["remotePolling", true],
  ] as const)("reports credential support for %s", (mode, expected) => {
    expect(adapterExecutionModeSupportsIngressCredentials(mode)).toBe(expected);
  });
});
