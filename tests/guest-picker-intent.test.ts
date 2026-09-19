import type { ComponentProps, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuestListItem } from "../src/api/types";
import { GuestRecordPicker } from "../src/features/reservations/GuestRecordPicker";

const hooks = vi.hoisted(() => ({ search: "", deferred: null as string | null, queries: [] as { enabled: boolean; queryFn: (context: { signal: AbortSignal }) => Promise<unknown> }[], request: vi.fn(), selected: null as unknown, error: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(), useState: () => [hooks.search, (value: string) => { hooks.search = value; }],
  useDeferredValue: (value: string) => hooks.deferred ?? value, useEffect: (effect: () => void) => effect(),
}));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: hooks.request }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: (typeof hooks.queries)[number]) => {
  hooks.queries.push(options);
  return { data: hooks.queries.length === 1 ? { guests: [guest] } : hooks.selected,
    error: hooks.error, isLoading: false, isFetching: false, isPaused: false, refetch: vi.fn() };
} }));
const guest = { guestId: "guest-exact", displayName: "Synthetic operator test", status: 1, lastChangedAtUtc: "2026-09-06T10:00:00Z" } as GuestListItem;
type Element = ReactElement<{ children?: unknown; disabled?: boolean; onClick?: () => void }>;
function nodes(value: unknown): Element[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  const element = value as Element; return [element, ...nodes(element.props?.children)];
}
const authority = vi.fn(); const select = vi.fn();
function render(overrides: Partial<ComponentProps<typeof GuestRecordPicker>> = {}) {
  hooks.queries = [];
  return GuestRecordPicker({ propertyId: "property-exact", selectedGuest: null, onSelect: select, onSelectionAuthorityChange: authority, ...overrides });
}
beforeEach(() => { hooks.search = ""; hooks.deferred = null; hooks.error = null; hooks.selected = null; hooks.request.mockReset(); authority.mockClear(); select.mockClear(); });

describe("intentional optional Guest Record discovery", () => {
  it.each(["", "   "])("does not fetch or render a default result list for %j", (query) => {
    hooks.search = query; const tree = render();
    expect(hooks.queries.map((query) => query.enabled)).toEqual([false, false]);
    expect(nodes(tree).filter((node) => node.type === "button")).toHaveLength(0);
    expect(nodes(tree).some((node) => node.props?.children === "No active Guest Records match.")).toBe(false);
  });
  it("only makes settled typed-query results selectable, and clear restores compact search", () => {
    hooks.search = "New query"; hooks.deferred = "Old query";
    let tree = render(); expect(hooks.queries[0].enabled).toBe(false); expect(nodes(tree).filter((node) => node.type === "button")).toHaveLength(0);
    hooks.deferred = null; tree = render(); expect(hooks.queries[0].enabled).toBe(true);
    const result = nodes(tree).find((node) => node.type === "button")!; expect(result.props.disabled).toBe(false); result.props.onClick!(); expect(select).toHaveBeenCalledWith(guest);
    hooks.search = ""; tree = render(); expect(hooks.queries[0].enabled).toBe(false); expect(nodes(tree).filter((node) => node.type === "button")).toHaveLength(0);
  });
  it("keeps selected-profile validation exact and independent of the first eight directory results", async () => {
    hooks.selected = guest; render({ selectedGuest: guest });
    expect(hooks.queries.map((query) => query.enabled)).toEqual([false, true]); expect(authority).toHaveBeenLastCalledWith(true);
    const signal = new AbortController().signal; hooks.request.mockResolvedValue(guest);
    await hooks.queries[1].queryFn({ signal });
    expect(hooks.request).toHaveBeenCalledWith("/api/guests/properties/property-exact/guest-exact", { signal });
    hooks.request.mockResolvedValue({ ...guest, guestId: "wrong" }); await expect(hooks.queries[1].queryFn({ signal })).rejects.toThrow("could not be confirmed");
  });
  it("denied, failed and changed selected-profile evidence cannot authorize a link", () => {
    hooks.selected = guest; render({ selectedGuest: guest, disabled: true }); expect(hooks.queries.map((query) => query.enabled)).toEqual([false, false]); expect(authority).toHaveBeenLastCalledWith(false);
    hooks.error = new Error("503"); render({ selectedGuest: guest }); expect(authority).toHaveBeenLastCalledWith(false);
    hooks.error = null; hooks.selected = { ...guest, lastChangedAtUtc: "2026-09-06T11:00:00Z" }; render({ selectedGuest: guest }); expect(authority).toHaveBeenLastCalledWith(false);
  });
});
