import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader, StatusBadge } from "../src/components/ui/primitives";

describe("status evidence presentation", () => {
  it("renders Unconfirmed as neutral rather than matching confirmed by substring", () => {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status: "Unconfirmed" }));
    expect(html).toContain("unconfirmed");
    expect(html).toContain("bg-base-200");
    expect(html).not.toContain("success");
  });
  it.each(["Confirmed", "Available", "Checked in"])("preserves the existing %s current-state presentation", (status) => {
    expect(renderToStaticMarkup(createElement(StatusBadge, { status }))).toContain("bg-success/10");
  });
  it("contains multiword status text without allowing the badge to shrink beneath its label", () => {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status: "CheckedOut" }));
    expect(html).toContain("checked out");
    for (const contract of ["h-auto", "min-h-5", "shrink-0", "whitespace-nowrap"]) expect(html).toContain(contract);
  });
  it("keeps visible full property context and a consistent heading/action contract", () => {
    const html = renderToStaticMarkup(createElement(PageHeader, {
      eyebrow: "BunkFy Demo · Riverside Hostel", title: "Reservations", description: "Current stays",
      action: createElement("button", { className: "btn" }, "New reservation"),
    }));
    expect(html).toContain("BunkFy Demo · Riverside Hostel");
    expect(html).toContain("Reservations</h1>");
    expect(html).toContain("Current stays");
    expect(html).toContain("New reservation");
    for (const contract of ["text-2xl", "leading-[30px]", "text-[13px]", "[&amp;_.btn]:min-h-11"]) expect(html).toContain(contract);
    expect(html).not.toContain("uppercase");
    expect(html).not.toContain("truncate");
  });
});
