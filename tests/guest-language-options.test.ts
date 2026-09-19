import { describe, expect, it } from "vitest";
import catalog from "../src/features/guests/guestLanguageCatalog.json";
import { guestLanguageName, indexGuestLanguages, searchGuestLanguages } from "../src/features/guests/guestLanguageOptions";

const english = indexGuestLanguages(catalog);
describe("reviewed language suggestions, not a tag allowlist", () => {
  it("retains all current exact language descriptions with no generated range or deprecated suggestions", () => {
    expect(catalog).toHaveLength(8043);
    expect(new Set(catalog.map(([tag]) => tag)).size).toBe(8043);
    expect(catalog.every(([tag, name]) => /^[a-z]{2,8}$/.test(tag) && name.length)).toBe(true);
    expect(english.byCode.has("bh")).toBe(false);
    expect(english.byCode.has("bih")).toBe(true);
  });
  it.each([["English", "en"], ["Castilian", "es"], ["Bangla", "bn"], ["Kölsch", "ksh"], ["kolsch", "ksh"], ["en", "en"], ["KSH", "ksh"]])("finds %s by current name, alias or exact code", (query, tag) => {
    expect(searchGuestLanguages(english, query, []).options[0]?.value).toBe(tag);
  });
  it("keeps core localized labels and English aliases searchable together", () => {
    const german = indexGuestLanguages(catalog, "de");
    expect(searchGuestLanguages(german, "Französisch", [], "de").options[0]).toMatchObject({ value: "fr", label: "Französisch" });
    expect(searchGuestLanguages(german, "French", [], "de").options[0]?.value).toBe("fr");
    expect(searchGuestLanguages(german, "franzosisch", [], "de").options[0]?.value).toBe("fr");
  });
  it("keeps saved region/script/legacy values distinct and searchable without changing their representatives", () => {
    const saved = Object.freeze(["EN-gB", "sr-Latn", "sr-Cyrl", "iw", "unknown-١"]);
    for (const value of saved) expect(searchGuestLanguages(english, value, saved).options[0]?.value).toBe(value);
    expect(searchGuestLanguages(english, "", saved).options.slice(0, 5).map(option => option.value)).toEqual(saved);
    expect(guestLanguageName("sr-Latn")).not.toBe(guestLanguageName("sr-Cyrl"));
    expect(guestLanguageName("unknown-١")).toBe("unknown-١");
  });
  it("bounds rendered matches and retains exact-code priority", () => {
    expect(searchGuestLanguages(english, "", []).options).toHaveLength(40);
    expect(searchGuestLanguages(english, "", []).total).toBe(8043);
    expect(searchGuestLanguages(english, "", [], "en", 10000).options).toHaveLength(100);
    expect(searchGuestLanguages(english, "not a language name", []).options).toEqual([]);
    expect(searchGuestLanguages(english, "en", []).options[0]?.value).toBe("en");
  });
  it("handles an invalid browser locale without losing tag or English search", () => {
    const invalid = indexGuestLanguages(catalog, "invalid_locale");
    expect(searchGuestLanguages(invalid, "English", [], "invalid_locale").options[0]?.value).toBe("en");
    expect(guestLanguageName("en", "invalid_locale")).toBe("English");
  });
});
