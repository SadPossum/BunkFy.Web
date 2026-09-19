/** Guest-owned wire semantics. Suggestions are not a language-tag allowlist. */
export const guestLanguageLimit = 12;
export const guestLanguageTagLimit = 35;

export type GuestLanguageValues = {
  languageTags?: readonly string[] | null;
  preferredLanguageTag?: string | null;
};

export type LanguageSelectionResult =
  | { ok: true; languageTags: string[]; preferredLanguageTag: string | null }
  | { ok: false; error: string };

// Match .NET String.Trim: JS trim also removes FEFF and does not remove NEL.
const separator = /^\p{Z}$/u;
const decimalDigit = /^\p{Nd}$/u;
function isBoundaryWhitespace(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 9 && code <= 13) || code === 0x85 || separator.test(character);
}
function trimTag(value: string): string {
  let start = 0, end = value.length;
  while (start < end && isBoundaryWhitespace(value[start])) start++;
  while (end > start && isBoundaryWhitespace(value[end - 1])) end--;
  return value.slice(start, end);
}

export function guestLanguageIdentity(value: string): string {
  return trimTag(value).replace(/[A-Z]/g, letter => letter.toLowerCase());
}

export function guestLanguageSelection(values: GuestLanguageValues): string[] {
  // An explicit empty collection is different from an older response with no collection.
  if (values.languageTags != null) return [...values.languageTags];
  return values.preferredLanguageTag ? [values.preferredLanguageTag] : [];
}

export function guestLanguageValidation(values: readonly string[]): string | null {
  if (values.length > guestLanguageLimit) return `Choose up to ${guestLanguageLimit} languages.`;
  for (const value of values) {
    if (typeof value !== "string") return "Choose a language or enter a language tag.";
    const tag = trimTag(value);
    if (!tag.length) return "Choose a language or enter a language tag.";
    if (tag.length > guestLanguageTagLimit) return `Language tags must be ${guestLanguageTagLimit} characters or fewer.`;
    // .NET char.IsDigit examines UTF-16 code units, not supplementary code points.
    for (let index = 0; index < tag.length; index++) {
      const character = tag[index];
      if (!/[A-Za-z-]/.test(character) && !decimalDigit.test(character)) {
        return "Use letters, numbers and hyphens for a language tag.";
      }
    }
  }
  return null;
}

function uniqueSorted(values: readonly string[]): string[] {
  const retained = new Map<string, string>();
  for (const value of values) {
    const identity = guestLanguageIdentity(value);
    if (!retained.has(identity)) retained.set(identity, trimTag(value));
  }
  return [...retained.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, value]) => value);
}

export function guestLanguagePayload(
  selected: readonly string[],
  previousPreferredLanguageTag: string | null | undefined = null,
): LanguageSelectionResult {
  const error = guestLanguageValidation(selected);
  if (error) return { ok: false, error };
  const languageTags = uniqueSorted(selected);
  const previous = previousPreferredLanguageTag ?? null;
  // Keep old preference metadata only while that exact identity remains selected.
  // A new selection never becomes a preferred language implicitly.
  const preferredLanguageTag = previous && languageTags.some(
    tag => guestLanguageIdentity(tag) === guestLanguageIdentity(previous),
  ) ? previous : null;
  return { ok: true, languageTags, preferredLanguageTag };
}

export function addGuestLanguage(selected: readonly string[], input: string):
  { ok: true; languageTags: string[] } | { ok: false; error: string } {
  const error = guestLanguageValidation([input]);
  if (error) return { ok: false, error };
  const identity = guestLanguageIdentity(input);
  if (selected.some(tag => guestLanguageIdentity(tag) === identity)) {
    return { ok: false, error: "That language is already selected." };
  }
  const next = [...selected, identity];
  const selectionError = guestLanguageValidation(next);
  return selectionError ? { ok: false, error: selectionError } : { ok: true, languageTags: next };
}

export function removeGuestLanguage(selected: readonly string[], tag: string): string[] {
  const identity = guestLanguageIdentity(tag);
  return selected.filter(value => guestLanguageIdentity(value) !== identity);
}

/** Collection identity only; the outer retry fingerprint must still include scalar fields.
 * Use after form validation. Create resolves legacy defaults; update preserves omission.
 */
export function guestLanguageSelectionKey(
  operation: "create" | "update",
  values: GuestLanguageValues,
): string {
  if (operation === "update" && values.languageTags == null) return "omitted";
  const selected = operation === "create" ? guestLanguageSelection(values) : values.languageTags!;
  const error = guestLanguageValidation(selected);
  if (error) throw new RangeError(error);
  return JSON.stringify(uniqueSorted(selected).map(guestLanguageIdentity));
}
