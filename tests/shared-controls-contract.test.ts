import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DatePicker } from "../src/components/ui/DatePicker";
import { SelectPicker } from "../src/components/ui/SelectPicker";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

// DOM geometry, Radix interactions and actual CSS cascade are separately checked
// in the seeded browser. These checks protect the rendered/control wiring only.
describe("shared compact and form control contracts", () => {
  it("renders an untruncated single-line selected date and the full accessible date", () => {
    const html = renderToStaticMarkup(createElement(DatePicker, {
      value: "2026-09-12", onChange: () => undefined, ariaLabel: "Choose calendar date", size: "sm",
    }));
    expect(html).toContain("whitespace-nowrap font-medium tabular-nums");
    expect(html).toContain("h-9 text-sm");
    expect(html).toContain('aria-label="Choose calendar date:');
    expect(html).toContain("2026");
    expect(html).not.toContain("min-w-0 truncate font-medium");
  });
  it("retains 48px readable form pickers and existing disabled semantics", () => {
    const date = renderToStaticMarkup(createElement(DatePicker, {
      value: "2026-09-12", onChange: () => undefined, ariaLabel: "Arrival date", disabled: true,
    }));
    expect(date).toContain("h-12 text-base"); expect(date).toContain('disabled=""');
    const select = renderToStaticMarkup(createElement(SelectPicker, {
      value: "Europe/London", onValueChange: () => undefined, ariaLabel: "Property time zone", searchable: true,
      options: [{ value: "Europe/London", label: "Europe / London" }],
    }));
    expect(select).toContain("h-12 text-base"); expect(select).toContain('aria-haspopup="dialog"');
    expect(source("components/ui/TimePicker.tsx")).toContain("text-left text-base");
    const picker = source("components/ui/DatePicker.tsx");
    expect(picker).toContain('aria-label={`${ariaLabel} month`}');
    expect(picker).toContain('aria-label={`${ariaLabel} year`}');
    expect(picker).not.toContain('grid-cols-[minmax(0,1fr)_5.5rem]');
    expect(picker).toContain('aria-label={`${ariaLabel} choose year`}');
    expect(picker).toContain('month_caption: "sr-only"');
    expect(picker).toContain('if (yearView) { event.preventDefault(); closeYears(); }');
    expect(picker).toContain('max-w-[calc(100vw-1.5rem)]');
    expect(picker).toContain('onEscapeKeyDown={(event) => { event.stopPropagation();');
  });
  it("gives the searchable opener complete portal ownership and keeps the combobox linked to its listbox", () => {
    const select = source("components/ui/SelectPicker.tsx");
    expect(select).toContain("aria-controls={contentId}");
    expect(select).toContain("id={contentId}");
    expect(select).toContain('aria-label={`${ariaLabel} picker`}');
    expect(select).toContain('role="combobox"');
    expect(select).toContain("aria-controls={listboxId}");
    expect(select).toContain('id={listboxId} role="listbox"');
  });
  it("lets compact date/search groups wrap without overriding component typography", () => {
    const styles = source("styles.css");
    expect(styles).not.toMatch(/button,\s*select,\s*input,\s*textarea\s*\{\s*font:\s*inherit/);
    expect(styles).toContain("--size: 2.25rem;"); expect(styles).toContain("--fontsize: 0.875rem;");
    expect(source("features/calendar/CalendarPage.tsx")).toContain('className="min-w-0 sm:w-48"');
    const spaces = source("features/spaces/SpacesRoomWorkspace.tsx");
    expect(spaces).toContain('form className="spaces-room-dates min-w-0"');
    const toolbar = spaces.slice(spaces.indexOf('className="spaces-room-toolbar'), spaces.indexOf("{sourceNotice}"));
    expect(toolbar).toContain('type="search" aria-label="Find a room or bed"');
    expect(toolbar).toContain('aria-label="Night availability dates"');
    expect(styles).toContain('.spaces-room-dates { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; }');
    expect(styles).toContain('@container spaces-frame (width >= 34rem)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto');
    expect(styles).toContain('.spaces-room-date > button,');
    expect(styles).toContain('.spaces-room-filter { height: 2.75rem; min-height: 2.75rem; font-size: 0.875rem; }');
    expect(styles).toMatch(/\.spaces-room-heading \.btn,\s*\.spaces-room-frame \.btn \{\s*--size: 2.75rem;/);
    expect(styles).toContain('white-space: normal;');
    expect(spaces.indexOf('ariaLabel="Arrival date"')).toBeLessThan(spaces.indexOf('aria-label="Rooms and beds navigator"'));
  });
});
