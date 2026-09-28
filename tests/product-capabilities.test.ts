import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProductCapabilities } from "../src/app/productCapabilities";

afterEach(() => vi.unstubAllGlobals());

describe("runtime product capabilities", () => {
  it("uses the composed API capability instead of a build-time image flag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ emailVerificationEnabled: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProductCapabilities()).resolves.toEqual({
      emailVerificationEnabled: true,
      staffPinEnabled: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/product-capabilities");
  });

  it("fails closed when the runtime capability cannot be obtained", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(loadProductCapabilities()).resolves.toEqual({
      emailVerificationEnabled: false,
      staffPinEnabled: false,
    });
  });

  it("fails closed when the runtime capability has an invalid shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ emailVerificationEnabled: "true" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(loadProductCapabilities()).resolves.toEqual({
      emailVerificationEnabled: false,
      staffPinEnabled: false,
    });
  });

  it("enables staff PIN only from the composed API boolean", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ emailVerificationEnabled: false, staffPinEnabled: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    await expect(loadProductCapabilities()).resolves.toEqual({
      emailVerificationEnabled: false,
      staffPinEnabled: true,
    });
  });

  it.each(["true", 1, null, false])("does not enable staff PIN for %j", async (staffPinEnabled) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ emailVerificationEnabled: true, staffPinEnabled }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    await expect(loadProductCapabilities()).resolves.toEqual({
      emailVerificationEnabled: true,
      staffPinEnabled: false,
    });
  });
});
