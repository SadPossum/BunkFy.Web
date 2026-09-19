import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockReleaseForm } from "../src/features/inventory/BlockReleaseForm";
import type { useManualBlockEditor } from "../src/features/inventory/useManualBlockEditor";

function renderRelease(releaseCanSubmit: boolean, releaseTargetCurrent = true, pending = false) {
  const editor = {
    editor: { kind: "release", target: {
      label: "Garden dorm", detail: "Main / 1", unitCount: 2,
      intervals: [{ arrival: "2026-09-05", departure: "2026-09-08" }], reasons: ["Window repair"],
    } },
    releaseMutation: { error: new Error("The result did not arrive."), isPending: pending },
    releaseCanSubmit, releaseTargetCurrent, opener: { current: null },
    close: () => {}, refresh: async () => {}, retryRelease: () => {}, release: () => {},
  } as unknown as ReturnType<typeof useManualBlockEditor>;
  return renderToStaticMarkup(createElement(BlockReleaseForm, { editor }));
}

describe("release feedback yields to current authority", () => {
  it("offers one exact-attempt retry when the group remains current", () => {
    const html = renderRelease(true);
    expect(html).toContain("Try again repeats the same release");
    expect(html).toContain("The result did not arrive.");
    expect(html.match(/>Try again</g)).toHaveLength(1);
    expect(html).not.toContain("data-feedback-focus");
  });

  it.each([true, false])("replaces stale retry guidance with a focusable review notice (target current %s)", (targetCurrent) => {
    const html = renderRelease(false, targetCurrent);
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("The result did not arrive.");
    expect(html).not.toContain("Couldn&#x27;t release");
    expect(html).toContain('role="status" data-feedback-focus');
    expect(html).toContain("Refresh blocks");
    expect(html).toContain("Cancel");
    expect(html).toMatch(/disabled=""[^>]*>Confirm release</);
    expect(html).not.toContain("Block released;");
    expect(html).toContain(targetCurrent
      ? "Current access and inventory are required"
      : "This exact group changed, was released, or is no longer in the current view");
  });

  it("does not render settled review guidance while the request is pending", () => {
    expect(renderRelease(false, false, true)).not.toContain("data-feedback-focus");
  });
});
