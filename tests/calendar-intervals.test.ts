import { describe, expect, it } from "vitest";
import {
  layoutCalendarIntervals,
  type CalendarIntervalInput,
} from "../src/features/calendar/calendarIntervals";

describe("calendar interval layout", () => {
  it("uses one coherent lane for long reservation/block spans across two 21-day boundaries", () => {
    const result = layoutCalendarIntervals([
      interval("stay", "reservation", "2026-08-25", "2026-10-15"),
      interval("hold", "block", "2026-08-28", "2026-10-10"),
      interval("departure", "reservation", "2026-08-20", "2026-08-31"),
    ], "2026-08-31", "2026-11-02");
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals.find((item) => item.key === "stay")).toMatchObject({ startColumn: 0, columnSpan: 45, startsBeforeWindow: true });
    expect(result.intervals.find((item) => item.key === "hold")).toMatchObject({ startColumn: 0, columnSpan: 40, startsBeforeWindow: true });
    expect(result.departureMarkers).toHaveLength(1);
    expect(result.departureMarkers[0].key).toBe("departure");
  });
  it("clips half-open stays and exposes only true visible endpoints", () => {
    const timeline = layoutCalendarIntervals([
      interval("long", "reservation", "2026-08-30", "2026-09-10"),
      interval("sunday", "reservation", "2026-09-06", "2026-09-07"),
    ], "2026-08-31", "2026-09-07");

    expect(timeline.intervals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "long",
        startColumn: 0,
        columnSpan: 7,
        startsBeforeWindow: true,
        endsAfterWindow: true,
        showsArrival: false,
        showsDeparture: false,
      }),
      expect.objectContaining({
        key: "sunday",
        startColumn: 6,
        columnSpan: 1,
        showsArrival: true,
        showsDeparture: true,
      }),
    ]));
  });

  it("lets adjacent checkout and check-in intervals share a lane without a conflict", () => {
    const timeline = layoutCalendarIntervals([
      interval("first", "reservation", "2026-08-31", "2026-09-03"),
      interval("second", "reservation", "2026-09-03", "2026-09-06"),
    ], "2026-08-31", "2026-09-07");

    expect(timeline.intervals.map((item) => ({ key: item.key, lane: item.lane, conflict: item.conflict })))
      .toEqual([
        { key: "first", lane: 0, conflict: false },
        { key: "second", lane: 0, conflict: false },
      ]);
  });

  it("marks every true overlap and assigns deterministic lowest lanes", () => {
    const input = [
      interval("block", "block", "2026-09-02", "2026-09-05"),
      interval("stay-b", "reservation", "2026-09-03", "2026-09-06"),
      interval("stay-a", "reservation", "2026-08-31", "2026-09-04"),
    ];
    const timeline = layoutCalendarIntervals(input, "2026-08-31", "2026-09-07");
    const reverse = layoutCalendarIntervals([...input].reverse(), "2026-08-31", "2026-09-07");

    expect(timeline.intervals.map((item) => [item.key, item.lane, item.conflict]))
      .toEqual([
        ["stay-a", 0, true],
        ["block", 1, true],
        ["stay-b", 2, true],
      ]);
    expect(reverse.intervals).toEqual(timeline.intervals);
    expect(timeline.intervals.find((item) => item.key === "block")?.conflictWith.sort())
      .toEqual(["stay-a", "stay-b"]);
  });

  it("gives blocks and reservations the same date geometry", () => {
    const timeline = layoutCalendarIntervals([
      interval("reservation", "reservation", "2026-09-01", "2026-09-04"),
      interval("block", "block", "2026-09-01", "2026-09-04"),
    ], "2026-08-31", "2026-09-07");

    expect(timeline.intervals.map(({ kind, startColumn, columnSpan }) => ({ kind, startColumn, columnSpan })))
      .toEqual([
        { kind: "reservation", startColumn: 1, columnSpan: 3 },
        { kind: "block", startColumn: 1, columnSpan: 3 },
      ]);
  });

  it("keeps a first-day scheduled checkout visible without occupying Monday", () => {
    const timeline = layoutCalendarIntervals([
      interval("departing", "reservation", "2026-08-29", "2026-08-31"),
      interval("arriving", "reservation", "2026-08-31", "2026-09-02"),
      interval("old-block", "block", "2026-08-29", "2026-08-31"),
    ], "2026-08-31", "2026-09-07");

    expect(timeline.intervals.map((item) => item.key)).toEqual(["arriving"]);
    expect(timeline.departureMarkers).toEqual([
      expect.objectContaining({ key: "departing", column: 0, lane: 1 }),
    ]);
    expect(timeline.laneCount).toBe(2);
  });

  it("fails closed instead of emitting invalid grid geometry", () => {
    const timeline = layoutCalendarIntervals([
      interval("impossible", "reservation", "2026-02-30", "2026-03-02"),
      interval("junk", "block", "not-a-date", "2026-09-03"),
      interval("reversed", "reservation", "2026-09-05", "2026-09-04"),
      interval("zero", "reservation", "2026-09-04", "2026-09-04"),
    ], "2026-08-31", "2026-09-07");

    expect(timeline.intervals).toEqual([]);
    expect(timeline.departureMarkers).toEqual([]);
    expect(timeline.sourceIssues).toEqual([
      { key: "impossible", reason: "invalid-date" },
      { key: "junk", reason: "invalid-date" },
      { key: "reversed", reason: "invalid-interval" },
      { key: "zero", reason: "invalid-interval" },
    ]);
    expect(layoutCalendarIntervals([], "2026-09-07", "2026-08-31").sourceIssues)
      .toEqual([{ key: "calendar-window", reason: "invalid-window" }]);
  });
});

function interval(
  key: string,
  kind: CalendarIntervalInput["kind"],
  arrival: string,
  departure: string,
): CalendarIntervalInput {
  return { key, kind, arrival, departure };
}
