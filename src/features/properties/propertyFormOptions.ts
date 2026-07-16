export function supportedTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const values = intl.supportedValuesOf?.("timeZone") ?? [];
  const unique = new Set(["UTC", browserTimeZone, ...values].filter(Boolean));

  return [...unique].sort((left, right) => {
    if (left === "UTC") return -1;
    if (right === "UTC") return 1;
    return left.localeCompare(right);
  });
}

export function timeZoneLabel(timeZoneId: string): string {
  return timeZoneId.replaceAll("_", " ").replaceAll("/", " / ");
}

const timeZoneSearchAliases: Record<string, string> = {
  "America/Godthab": "Nuuk, Greenland",
  "Asia/Calcutta": "Kolkata, India",
  "Asia/Katmandu": "Kathmandu, Nepal",
  "Asia/Rangoon": "Yangon, Myanmar",
  "Asia/Saigon": "Ho Chi Minh City, Vietnam",
  "Europe/Kiev": "Kyiv, Ukraine",
};

export function timeZoneDescription(timeZoneId: string): string | undefined {
  return timeZoneSearchAliases[timeZoneId];
}

export function createDefaultBedLabels(
  count: number,
  existingLabels: string[],
  currentLabels: string[] = [],
): string[] {
  const targetCount = Math.max(1, Math.min(50, Math.trunc(count) || 1));
  const labels = currentLabels.slice(0, targetCount);
  const reserved = new Set([...existingLabels, ...labels].map((label) => label.trim()));
  let candidate = 1;

  while (labels.length < targetCount) {
    while (reserved.has(String(candidate))) candidate += 1;
    const label = String(candidate);
    labels.push(label);
    reserved.add(label);
    candidate += 1;
  }

  return labels;
}

export function duplicateBedLabel(labels: string[]): string | null {
  const seen = new Set<string>();
  for (const rawLabel of labels) {
    const label = rawLabel.trim();
    if (seen.has(label)) return label;
    seen.add(label);
  }
  return null;
}
