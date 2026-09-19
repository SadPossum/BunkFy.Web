export type CalendarIntervalKind = "reservation" | "block" | "request" | "history";

export type CalendarIntervalInput = {
  key: string;
  kind: CalendarIntervalKind;
  arrival: string;
  departure: string;
};

export type CalendarIntervalLayout<T extends CalendarIntervalInput = CalendarIntervalInput> = T & {
  startColumn: number;
  columnSpan: number;
  lane: number;
  startsBeforeWindow: boolean;
  endsAfterWindow: boolean;
  showsArrival: boolean;
  showsDeparture: boolean;
  conflict: boolean;
  conflictWith: string[];
};

export type CalendarDepartureMarker<T extends CalendarIntervalInput = CalendarIntervalInput> = T & {
  column: 0;
  lane: number;
};

export type CalendarIntervalTimeline<T extends CalendarIntervalInput = CalendarIntervalInput> = {
  intervals: CalendarIntervalLayout<T>[];
  departureMarkers: CalendarDepartureMarker<T>[];
  laneCount: number;
  sourceIssues: Array<{ key: string; reason: "invalid-date" | "invalid-interval" | "invalid-window" }>;
};

/**
 * Places half-open inventory intervals into the lowest available visual lane.
 * Adjacent [arrival, departure) intervals share a lane; genuine overlap does not.
 */
export function layoutCalendarIntervals<T extends CalendarIntervalInput>(
  input: T[],
  windowFrom: string,
  windowTo: string,
): CalendarIntervalTimeline<T> {
  const windowStart = dateDayNumber(windowFrom);
  const windowEnd = dateDayNumber(windowTo);
  if (windowStart === null || windowEnd === null || windowEnd <= windowStart) {
    return {
      intervals: [],
      departureMarkers: [],
      laneCount: 1,
      sourceIssues: [{ key: "calendar-window", reason: "invalid-window" }],
    };
  }

  const sourceIssues: CalendarIntervalTimeline["sourceIssues"] = [];

  const candidates = input.flatMap((item) => {
    const arrival = dateDayNumber(item.arrival);
    const departure = dateDayNumber(item.departure);
    if (arrival === null || departure === null) {
      sourceIssues.push({ key: item.key, reason: "invalid-date" });
      return [];
    }
    if (departure <= arrival) {
      sourceIssues.push({ key: item.key, reason: "invalid-interval" });
      return [];
    }

    const clippedStart = Math.max(arrival, windowStart);
    const clippedEnd = Math.min(departure, windowEnd);
    if (clippedEnd <= clippedStart) return [];

    return [{
      ...item,
      startColumn: clippedStart - windowStart,
      columnSpan: clippedEnd - clippedStart,
      lane: 0,
      startsBeforeWindow: arrival < windowStart,
      endsAfterWindow: departure > windowEnd,
      showsArrival: arrival >= windowStart && arrival < windowEnd,
      showsDeparture: departure > windowStart && departure <= windowEnd,
      conflict: false,
      conflictWith: [] as string[],
      _endColumn: clippedEnd - windowStart,
    }];
  }).sort(compareIntervals);

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]!;
      if (right.startColumn >= left._endColumn) break;
      if (left.kind !== "history" && right.kind !== "history"
        && left.startColumn < right._endColumn && right.startColumn < left._endColumn) {
        left.conflict = true;
        right.conflict = true;
        left.conflictWith.push(right.key);
        right.conflictWith.push(left.key);
      }
    }
  }

  const laneEnds: number[] = [];
  candidates.forEach((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startColumn);
    if (lane < 0) lane = laneEnds.length;
    item.lane = lane;
    laneEnds[lane] = item._endColumn;
  });

  const departureOnly = input
    .filter((item) => item.kind !== "block" && item.kind !== "history"
      && item.departure === windowFrom
      && (dateDayNumber(item.arrival) ?? Number.POSITIVE_INFINITY) < windowStart)
    .sort((left, right) => left.key.localeCompare(right.key));
  const occupiedAtStart = new Set(candidates
    .filter((item) => item.startColumn === 0)
    .map((item) => item.lane));
  const markerLanes = new Set<number>();
  const departureMarkers = departureOnly.map((item) => {
    let lane = 0;
    while (occupiedAtStart.has(lane) || markerLanes.has(lane)) lane += 1;
    markerLanes.add(lane);
    return { ...item, column: 0 as const, lane };
  });

  const laneCount = Math.max(
    1,
    laneEnds.length,
    ...departureMarkers.map((marker) => marker.lane + 1),
  );

  return {
    intervals: candidates.map((item) => {
      const { _endColumn: _ignored, ...layout } = item;
      return layout as CalendarIntervalLayout<T>;
    }),
    departureMarkers,
    laneCount,
    sourceIssues,
  };
}

function compareIntervals(
  left: CalendarIntervalLayout & { _endColumn: number },
  right: CalendarIntervalLayout & { _endColumn: number },
) {
  return left.startColumn - right.startColumn
    || right._endColumn - left._endColumn
    || intervalKindOrder(left.kind) - intervalKindOrder(right.kind)
    || left.key.localeCompare(right.key);
}

function intervalKindOrder(kind: CalendarIntervalKind) {
  if (kind === "reservation") return 0;
  if (kind === "block") return 1;
  return 2;
}

function dateDayNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const valueUtc = Date.UTC(year, month - 1, day);
  const parsed = new Date(valueUtc);
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) return null;
  return Math.floor(valueUtc / 86_400_000);
}
