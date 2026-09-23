// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailColumns, FormGrid, FormSection, FormSpan } from "../src/components/ui/FormLayout";

describe("explicit form layout composition", () => {
  it("uses real labeled sections and the caller's heading level without adding controls", () => {
    const parsed = new DOMParser().parseFromString(renderToStaticMarkup(
      <FormSection title="Identity" description="Names used by staff." icon={<span>Icon</span>} headingLevel={2}>
        <label>Guest name<input name="name" /></label>
      </FormSection>,
    ), "text/html");
    const section = parsed.querySelector("section")!, heading = section.querySelector("h2")!;
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.textContent).toBe("IconIdentity");
    expect(heading.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(section.querySelectorAll("input, button")).toHaveLength(1);
    expect(section.textContent).toContain("Names used by staff.");
  });

  it("omits unused heading/description containers", () => {
    const parsed = new DOMParser().parseFromString(renderToStaticMarkup(<FormSection><p>Content only</p></FormSection>), "text/html");
    const section = parsed.querySelector("section")!;
    expect(section.hasAttribute("aria-labelledby")).toBe(false);
    expect(section.children).toHaveLength(1);
    expect(section.firstElementChild?.tagName).toBe("P");
  });

  it("allows a description without inventing a heading or a broken label reference", () => {
    const parsed = new DOMParser().parseFromString(renderToStaticMarkup(<FormSection description="Applies to this property."><p>Content</p></FormSection>), "text/html");
    expect(parsed.querySelector("section")!.hasAttribute("aria-labelledby")).toBe(false);
    expect(parsed.querySelector("h2, h3, h4")).toBeNull();
    expect(parsed.body.textContent).toContain("Applies to this property.");
  });

  it.each(["balanced", "primaryCompact"] as const)("keeps DOM order and full-row notices in the %s recipe", layout => {
    const parsed = new DOMParser().parseFromString(renderToStaticMarkup(
      <FormGrid layout={layout}>
        <label>Guest<input name="guest" /></label>
        <label>Count<input name="count" /></label>
        <FormSpan><p role="alert">A long validation message stays with its form.</p></FormSpan>
      </FormGrid>,
    ), "text/html");
    const grid = parsed.body.firstElementChild!;
    expect([...grid.querySelectorAll("input")].map(input => input.name)).toEqual(["guest", "count"]);
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("[&>*]:min-w-0");
    expect(grid.lastElementChild?.className).toContain("col-span-full");
    expect(grid.querySelectorAll("button, [tabindex]")).toHaveLength(0);
    if (layout === "primaryCompact") expect(grid.className).toContain("minmax(0,10rem)");
    else expect(grid.className).toContain("sm:grid-cols-2");
  });

  it("keeps independent detail groups in narrow reading order", () => {
    const parsed = new DOMParser().parseFromString(renderToStaticMarkup(
      <DetailColumns><section>Identity</section><section>Stay history</section></DetailColumns>,
    ), "text/html");
    expect([...parsed.querySelectorAll("section")].map(section => section.textContent)).toEqual(["Identity", "Stay history"]);
    expect(parsed.body.firstElementChild?.className).toContain("minmax(0,0.9fr)");
    expect(parsed.querySelector("[style], [tabindex]")).toBeNull();
  });

  it("forwards the existing error-focus heading ref without a tab stop", () => {
    const container = document.createElement("div"), root = createRoot(container), ref = createRef<HTMLHeadingElement>();
    document.body.append(container);
    try {
      act(() => root.render(<FormSection title="Additional details" headingRef={ref}><p>Fields</p></FormSection>));
      expect(ref.current?.tagName).toBe("H3");
      expect(ref.current?.tabIndex).toBe(-1);
      ref.current?.focus();
      expect(document.activeElement).toBe(ref.current);
    } finally { act(() => root.unmount()); container.remove(); }
  });
});
