import { guestLanguageIdentity } from "./guestLanguageSelection";

export type GuestLanguageOption = { value: string; label: string; search: string[] };
export type GuestLanguageCatalog = readonly (readonly string[])[];
export type GuestLanguageIndex = { options: GuestLanguageOption[]; byCode: Map<string, GuestLanguageOption> };

let catalogRequest: Promise<GuestLanguageCatalog> | undefined;
/** The registry is a local build asset, requested once on opening, never an admission allowlist. */
export function loadGuestLanguageCatalog(): Promise<GuestLanguageCatalog> {
  return catalogRequest ??= import("./guestLanguageCatalog.json").then(module => module.default).catch(error => {
    catalogRequest = undefined;
    throw error;
  });
}

const formatters = new Map<string, Intl.DisplayNames | null>();
function formatter(locale: string): Intl.DisplayNames | null {
  if (!formatters.has(locale)) {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([locale, "en"], { type: "language", fallback: "none" }); }
    catch { try { names = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }); } catch { /* Raw tags remain usable. */ } }
    if (formatters.size >= 4) formatters.clear();
    formatters.set(locale, names);
  }
  return formatters.get(locale) ?? null;
}

export function guestLanguageName(tag: string, locale = "en", fallback?: string): string {
  try { return formatter(locale)?.of(tag) || fallback || tag; }
  catch { return fallback || tag; }
}

export function normalizeGuestLanguageSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function indexGuestLanguages(catalog: GuestLanguageCatalog, locale = "en"): GuestLanguageIndex {
  let collator: Intl.Collator;
  try { collator = new Intl.Collator(locale); } catch { collator = new Intl.Collator("en"); }
  const options = catalog.map(([value, ...descriptions]) => {
    // Localize the small two-letter core once, not all 8,000+ registry records on open.
    const label = value.length === 2 ? guestLanguageName(value, locale, descriptions[0]) : descriptions[0] || value;
    return { value, label, search: [...new Set([value, label, ...descriptions].map(normalizeGuestLanguageSearch))] };
  }).sort((left, right) => collator.compare(left.label, right.label));
  return { options, byCode: new Map(options.map(option => [option.value, option])) };
}

export function searchGuestLanguages(
  index: GuestLanguageIndex,
  query: string,
  selected: readonly string[],
  locale = "en",
  limit = 40,
): { options: GuestLanguageOption[]; total: number } {
  const search = normalizeGuestLanguageSearch(query), tokens = search.split(" ").filter(Boolean);
  const seen = new Set<string>();
  const saved = selected.flatMap(value => {
    const key = guestLanguageIdentity(value);
    if (seen.has(key)) return [];
    seen.add(key);
    const known = index.byCode.get(key);
    const label = guestLanguageName(value, locale, known?.label);
    return [{ value, label, search: [key, normalizeGuestLanguageSearch(label), ...(known?.search ?? [])] }];
  });
  const options = [...saved, ...index.options.filter(option => !seen.has(option.value))];
  const ranked = options.flatMap((option, order) => {
    const text = option.search.join(" ");
    if (!tokens.every(token => text.includes(token))) return [];
    const rank = !search ? (seen.has(guestLanguageIdentity(option.value)) ? 0 : option.value.length === 2 ? 1 : 2)
      : guestLanguageIdentity(option.value) === search ? 0 : option.search.includes(search) ? 1
        : option.search.some(field => field.startsWith(search)) ? 2 : 3;
    return [{ option, rank, order }];
  }).sort((left, right) => left.rank - right.rank || left.order - right.order);
  return { options: ranked.slice(0, Math.max(0, Math.min(100, limit))).map(({ option }) => option), total: ranked.length };
}
