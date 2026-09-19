import type { GuestListItem, GuestProfile } from "../../api/types";
import { guestLanguageSelection } from "./guestLanguageSelection";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

type GuestIdentity = Pick<
  GuestListItem | GuestProfile,
  "nationalityCountryCode" | "preferredLanguageTag" | "languageTags"
>;

export function guestCountryLabel(countryCode: string | null | undefined): string | null {
  const normalized = countryCode?.trim().toUpperCase();
  if (!normalized) return null;

  try {
    const name = countryNames.of(normalized);
    return name && name !== normalized ? `${name} (${normalized})` : normalized;
  } catch {
    return normalized;
  }
}

export function guestLanguageLabel(languageTag: string | null | undefined): string | null {
  const value = languageTag?.trim();
  if (!value) return null;

  try {
    const locale = new Intl.Locale(value);
    const language = languageNames.of(locale.language) ?? locale.language;
    const region = locale.region ? countryNames.of(locale.region) : null;
    const qualification = region && region !== locale.region ? ` (${region})` : "";
    return `${language}${qualification} (${value})`;
  } catch {
    return value;
  }
}

export function guestIdentitySummary(guest: GuestIdentity): string[] {
  return [
    guestCountryLabel(guest.nationalityCountryCode),
    ...guestLanguageLabels(guest),
  ].filter((value): value is string => Boolean(value));
}

export function guestLanguageLabels(guest: Pick<GuestIdentity, "preferredLanguageTag" | "languageTags">): string[] {
  return guestLanguageSelection(guest).map(guestLanguageLabel).filter((value): value is string => Boolean(value));
}
