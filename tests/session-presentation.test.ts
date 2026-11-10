import { describe, expect, it } from "vitest";
import { sessionActivityDate, sessionDeviceLabel } from "../src/features/account/sessionPresentation";

describe("session recognition", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/143.0 Safari/537.36 Edg/143.0", "Edge on Windows"],
    ["Mozilla/5.0 (Linux; Android 15) Chrome/143.0 Mobile Safari/537.36", "Chrome on Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1", "Safari on iOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Firefox/145.0", "Firefox on macOS"],
    ["Mozilla/5.0 (Linux; Android 15) Chrome/143.0 SamsungBrowser/29.0", "Samsung Internet on Android"],
  ])("identifies a reported client without confusing embedded browser tokens", (agent, label) => {
    expect(sessionDeviceLabel(agent)).toBe(label);
  });

  it("does not invent device information for old or unrecognized sessions", () => {
    expect(sessionDeviceLabel(null)).toBe("Device details not recorded");
    expect(sessionDeviceLabel()).toBe("Device details not recorded");
    expect(sessionDeviceLabel("<script>untrusted</script>")).toBe("Browser details unavailable");
  });

  it("uses recorded activity only and tolerates missing or invalid legacy values", () => {
    expect(sessionActivityDate(undefined)).toBeNull();
    expect(sessionActivityDate("invalid")).toBeNull();
    expect(sessionActivityDate("2026-11-10T18:00:00Z")?.toISOString()).toBe("2026-11-10T18:00:00.000Z");
  });
});
