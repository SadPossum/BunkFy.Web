import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { GuestListItem } from "../src/api/types";
import { CompositeSourceNotice } from "../src/components/ui/CompositeSourceNotice";
import { ErrorState } from "../src/components/ui/primitives";
import { GuestRecordPicker } from "../src/features/reservations/GuestRecordPicker";

const state = vi.hoisted(() => ({ search: "QA", query: 0, data: undefined as unknown, error: null as unknown, fetching: false,
  retries: [vi.fn(), vi.fn()], enabled: [] as boolean[] }));
vi.mock("react", async load => ({ ...await load<typeof import("react")>(), useState: () => [state.search, vi.fn()], useDeferredValue: (value: string) => value, useEffect: (effect: () => void) => effect() }));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ enabled }: { enabled: boolean }) => {
  const index = state.query++; state.enabled.push(enabled); return { data: state.data, error: state.error, isFetching: state.fetching, isLoading: false, refetch: state.retries[index] };
} }));
type Element = ReactElement<{ children?: unknown; retry?: () => void; disabled?: boolean }>;
function nodes(value: unknown): Element[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object") return []; const element = value as Element; return [element, ...nodes(element.props?.children)]; }
const selected = { guestId: "g", displayName: "Selected QA", status: 1, lastChangedAtUtc: "2026-09-07T00:00:00Z" } as GuestListItem;
const authority = vi.fn(), select = vi.fn();
function render(guest: GuestListItem | null = null) { state.query = 0; state.enabled = []; return nodes(GuestRecordPicker({ propertyId: "p", selectedGuest: guest, onSelect: select, onSelectionAuthorityChange: authority })); }
beforeEach(() => { state.search = "QA"; state.data = undefined; state.error = null; state.fetching = false; vi.clearAllMocks(); });

describe("one unavailable optional Guest Record notice owner", () => {
  it.each([503, 403])("unavailable search%s has one status-specific error/retry, no duplicate delayed notice or empty claim", status => {
    state.error = new ApiError("Unavailable", status); const tree = render();
    const errors = tree.filter(node => node.type === ErrorState); expect(errors).toHaveLength(1); expect(tree.some(node => node.type === CompositeSourceNotice)).toBe(false);
    errors[0].props.retry!(); expect(state.retries[0]).toHaveBeenCalledOnce(); expect(state.retries[1]).not.toHaveBeenCalled();
    expect(tree.some(node => node.props.children === "No active Guest Records match.")).toBe(false); expect(authority).toHaveBeenLastCalledWith(false);
  });
  it("failed selected-profile confirmation retries only the exact profile and retains selection without authorizing it", () => {
    state.error = new ApiError("Temporary", 503); const tree = render(selected);
    expect(state.enabled).toEqual([false, true]); const errors = tree.filter(node => node.type === ErrorState); expect(errors).toHaveLength(1);
    errors[0].props.retry!(); expect(state.retries[1]).toHaveBeenCalledOnce(); expect(state.retries[0]).not.toHaveBeenCalled();
    expect(authority).toHaveBeenLastCalledWith(false); expect(select).not.toHaveBeenCalled(); expect(tree.some(node => node.props.children === selected.displayName)).toBe(true);
  });
  it("retained results use the existing stale warning and disabled selection, then real ready empty can be stated", () => {
    state.data = { guests: [selected] }; state.error = new ApiError("Temporary", 503); let tree = render();
    expect(tree.filter(node => node.type === CompositeSourceNotice)).toHaveLength(1); expect(tree.some(node => node.type === ErrorState)).toBe(false);
    expect(tree.filter(node => node.type === "button").every(node => node.props.disabled)).toBe(true);
    state.error = null; state.data = { guests: [] }; tree = render(); expect(tree.some(node => node.props.children === "No active Guest Records match.")).toBe(true);
  });
  it("untouched search does not start a directory request or expose an irrelevant cached failure", () => {
    state.search = ""; state.error = new ApiError("Old error", 503); const tree = render(); expect(state.enabled).toEqual([false, false]);
    expect(tree.some(node => node.type === ErrorState || node.type === CompositeSourceNotice)).toBe(false);
  });
});
