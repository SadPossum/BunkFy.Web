import { describe, expect, it } from "vitest";
import {
  addGuestLanguage, guestLanguageIdentity, guestLanguagePayload,
  guestLanguageSelection, guestLanguageSelectionKey, guestLanguageValidation,
  removeGuestLanguage,
} from "../src/features/guests/guestLanguageSelection";

describe("Guest language selection preserves old records", () => {
  it("uses the scalar only for an older response without a collection", () => {
    expect(guestLanguageSelection({ preferredLanguageTag: "EN-gB" })).toEqual(["EN-gB"]);
    expect(guestLanguageSelection({ preferredLanguageTag: "EN-gB", languageTags: null })).toEqual(["EN-gB"]);
    expect(guestLanguageSelection({ preferredLanguageTag: "EN-gB", languageTags: [] })).toEqual([]);
    expect(guestLanguageSelection({})).toEqual([]);
  });
  it("retains region, script and unknown saved values without registry substitution", () => {
    const saved = ["EN-gB", "sr-Latn", "sr-Cyrl", "legacy-١", "iw"];
    const selected = guestLanguageSelection({ languageTags: saved, preferredLanguageTag: "EN-gB" });
    expect(selected).toEqual(saved);
    selected.push("fr");
    expect(saved).toHaveLength(5);
    expect(guestLanguagePayload(saved, "EN-gB")).toEqual({
      ok: true, languageTags: ["EN-gB", "iw", "legacy-١", "sr-Cyrl", "sr-Latn"], preferredLanguageTag: "EN-gB",
    });
  });
  it("preserves scalar bytes while selected, clears it on removal and never promotes another value", () => {
    expect(guestLanguagePayload(["en-gb", "fr"], "EN-gB")).toMatchObject({ preferredLanguageTag: "EN-gB" });
    expect(guestLanguagePayload(["fr"], "EN-gB")).toMatchObject({ preferredLanguageTag: null });
    expect(guestLanguagePayload(["fr", "en"])).toMatchObject({ preferredLanguageTag: null });
    expect(guestLanguagePayload([], "EN-gB")).toEqual({ ok: true, languageTags: [], preferredLanguageTag: null });
  });
  it("new tags are normalized without changing existing representatives", () => {
    const saved = ["EN-gB", "legacy-١"];
    expect(addGuestLanguage(saved, " FR ")).toEqual({ ok: true, languageTags: ["EN-gB", "legacy-١", "fr"] });
    expect(saved).toEqual(["EN-gB", "legacy-١"]);
    expect(removeGuestLanguage(saved, "en-GB")).toEqual(["legacy-١"]);
  });
  it("deduplicates semantic wire values retaining the first representative", () => {
    expect(guestLanguagePayload(["fr", "EN-gB", "en-gb", "FR"])).toEqual({
      ok: true, languageTags: ["EN-gB", "fr"], preferredLanguageTag: null,
    });
    expect(addGuestLanguage(["EN-gB"], " en-GB ")).toEqual({ ok: false, error: "That language is already selected." });
  });
});

describe("Guest language validation mirrors the existing backend vocabulary", () => {
  it.each(["en", "en-GB", "unknown-١", "ab-９", "-", "z".repeat(35), "\u0085EN\u0085"])("accepts %s without an invented registry allowlist", value => {
    expect(guestLanguageValidation([value])).toBeNull();
  });
  it.each(["", "   ", "x".repeat(36), "en_GB", "français", "en/GB", "EN\uFEFF", "en-𝟙", "en\nGB", "en\u0000"])("rejects %s atomically", value => {
    expect(guestLanguageValidation(["fr", value])).not.toBeNull();
    expect(guestLanguagePayload(["fr", value]).ok).toBe(false);
  });
  it("rejects null entries instead of silently dropping them", () => {
    expect(guestLanguageValidation([null] as unknown as string[])).not.toBeNull();
  });
  it("bounds raw submissions as well as unique selections", () => {
    const dozen = Array.from({ length: 12 }, (_, index) => `x-${index}`);
    expect(guestLanguageValidation(dozen)).toBeNull();
    expect(addGuestLanguage(dozen, "fr")).toEqual({ ok: false, error: "Choose up to 12 languages." });
    expect(guestLanguageValidation(Array(13).fill("en"))).toBe("Choose up to 12 languages.");
    expect(dozen).toHaveLength(12);
  });
  it("uses ASCII case folding and the backend whitespace boundaries", () => {
    expect(guestLanguageIdentity("\u0085EN-gB\u2000")).toBe("en-gb");
    expect(guestLanguageIdentity("EN\uFEFF")).toBe("en\uFEFF");
    expect(guestLanguageIdentity("İ")).toBe("İ");
  });
});

describe("Guest language semantic retry identity", () => {
  it("ignores token ordering/casing but retains membership and explicit presence", () => {
    for (const operation of ["create", "update"] as const) {
      expect(guestLanguageSelectionKey(operation, { languageTags: ["EN-gB", "fr", "fr"] }))
        .toBe(guestLanguageSelectionKey(operation, { languageTags: ["FR", "en-GB"] }));
      expect(guestLanguageSelectionKey(operation, { languageTags: ["en", "fr"] }))
        .not.toBe(guestLanguageSelectionKey(operation, { languageTags: ["en"] }));
    }
    expect(guestLanguageSelectionKey("update", { languageTags: null }))
      .toBe(guestLanguageSelectionKey("update", {}));
    expect(guestLanguageSelectionKey("update", { languageTags: [] }))
      .not.toBe(guestLanguageSelectionKey("update", {}));
  });
  it("resolves absent create collections without introducing update-style presence", () => {
    const empty = guestLanguageSelectionKey("create", { languageTags: [] });
    expect(guestLanguageSelectionKey("create", {})).toBe(empty);
    expect(guestLanguageSelectionKey("create", { languageTags: null, preferredLanguageTag: null })).toBe(empty);
    const singleton = guestLanguageSelectionKey("create", { languageTags: ["en-gb"] });
    expect(guestLanguageSelectionKey("create", { preferredLanguageTag: "EN-gB" })).toBe(singleton);
    expect(guestLanguageSelectionKey("create", { preferredLanguageTag: "EN-gB", languageTags: null })).toBe(singleton);
    expect(singleton).not.toBe(empty);
  });
  it("keeps update collection intent independent of the separately fingerprinted scalar", () => {
    expect(guestLanguageSelectionKey("update", { preferredLanguageTag: "EN-gB" })).toBe("omitted");
    expect(guestLanguageSelectionKey("update", { preferredLanguageTag: null, languageTags: [] })).toBe("[]");
  });
  it("does not mutate caller arrays or assign an operation identity to invalid values", () => {
    const selected = Object.freeze(["FR", "EN-gB"]);
    expect(guestLanguageSelectionKey("update", { languageTags: selected })).toBe('["en-gb","fr"]');
    expect(selected).toEqual(["FR", "EN-gB"]);
    expect(() => guestLanguageSelectionKey("update", { languageTags: [""] })).toThrow(RangeError);
    expect(() => guestLanguageSelectionKey("create", { preferredLanguageTag: "".padEnd(36, "x") })).toThrow(RangeError);
  });
});
