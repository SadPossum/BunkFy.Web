export type AccountSection = "overview" | "profile" | "security" | "sessions";

const accountSections = new Set<AccountSection>([
  "overview",
  "profile",
  "security",
  "sessions",
]);

export function accountSection(value: string | null, hasWorkspace: boolean): AccountSection {
  if (!value || !accountSections.has(value as AccountSection)) return "overview";
  if (value === "profile" && !hasWorkspace) return "overview";
  return value as AccountSection;
}

export function accountSectionSearchParams(
  current: URLSearchParams,
  section: AccountSection,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (section === "overview") next.delete("section");
  else next.set("section", section);
  next.delete("focus");
  return next;
}
