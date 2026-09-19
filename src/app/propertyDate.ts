export type StayDateRange = {
  arrival: string;
  departure: string;
};

export function propertyDateKey(
  timeZoneId: string,
  instant: Date = new Date(),
): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZoneId,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const year = partValue(parts, "year");
    const month = partValue(parts, "month");
    const day = partValue(parts, "day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

export function defaultPropertyStayRange(
  timeZoneId: string,
  instant: Date = new Date(),
): StayDateRange | null {
  const localDate = propertyDateKey(timeZoneId, instant);
  if (!localDate) return null;

  return {
    arrival: shiftDateKey(localDate, 1),
    departure: shiftDateKey(localDate, 3),
  };
}

export function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function validStayDateRange(
  range: StayDateRange | null | undefined,
): range is StayDateRange {
  return Boolean(
    range &&
    validDateKey(range.arrival) &&
    validDateKey(range.departure) &&
    range.arrival < range.departure,
  );
}

export function validDateKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string | undefined {
  return parts.find((part) => part.type === type)?.value;
}
