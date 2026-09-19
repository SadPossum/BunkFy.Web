import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reservationLeaseAdmissionAllowed, useRouteNavigationLease } from "../src/app/routeNavigationLease";
import type { SpacesEditorNavigationState } from "../src/features/spaces/spacesSectionRoute";

// Execute the real local guard through hook-state/effect transitions. Router and
// DOM events are deterministic doubles, not native browser history/focus proof.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[],
  cleanups: new Map<number, () => void>(), params: new URLSearchParams(), locationKey: "entry-d", pathname: "/spaces", setParams: vi.fn(),
}));
vi.mock("react", async (load) => ({ ...await load<typeof import("react")>(),
  useRef: (initial: unknown) => { const i = hooks.cursor++; return hooks.slots[i] ?? (hooks.slots[i] = { current: initial }); },
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = typeof value === "function" ? value(hooks.slots[i]) : value; }];
  },
  useCallback: (callback: unknown) => callback,
  useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const i = hooks.cursor++, prior = hooks.slots[i] as unknown[] | undefined;
    if (prior && deps.length === prior.length && deps.every((item, index) => Object.is(item, prior[index]))) return;
    hooks.slots[i] = deps;
    hooks.effects.push(() => { hooks.cleanups.get(i)?.(); hooks.cleanups.delete(i); const cleanup = effect(); if (cleanup) hooks.cleanups.set(i, cleanup); });
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const i = hooks.cursor++, prior = hooks.slots[i] as unknown[] | undefined;
    if (prior && deps.length === prior.length && deps.every((item, index) => Object.is(item, prior[index]))) return;
    hooks.slots[i] = deps;
    hooks.effects.push(() => { hooks.cleanups.get(i)?.(); hooks.cleanups.delete(i); const cleanup = effect(); if (cleanup) hooks.cleanups.set(i, cleanup); });
  },
}));
vi.mock("react-router", async (load) => ({ ...await load<typeof import("react-router")>(),
  useLocation: () => ({ pathname: hooks.pathname, key: hooks.locationKey, search: "?" + hooks.params, hash: "", state: null }),
  useNavigate: () => hooks.setParams,
}));
const owner: SpacesEditorNavigationState = { engaged: true, pending: false, label: "104-D", authorityLost: false };
const idle = { ...owner, engaged: false };
const original = "section=layout&property=p&room=r&bed=d&unit=u-d&arrival=2026-09-07&departure=2026-09-09&q=Dorm&history=all";
const requested = original.replace("bed=d&unit=u-d", "bed=e&unit=u-e");
const listeners = new Set<(event: BeforeUnloadEvent) => void>();
function render(actor = "actor-a", property = "p") {
  hooks.cursor = 0; hooks.effects = [];
  const value = useRouteNavigationLease(actor, property);
  hooks.effects.forEach((effect) => effect()); return value;
}
function raw(search: string, key = "entry-e") { hooks.params = new URLSearchParams(search); hooks.locationKey = key; }
function engage(input = owner) { const value = render(); value.reportOwner(input); return render(); }
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.cleanups.clear(); listeners.clear();
  raw(original, "entry-d"); hooks.setParams.mockReset();
  hooks.pathname = "/spaces";
  vi.stubGlobal("window", {
    addEventListener: (_name: string, listener: (event: BeforeUnloadEvent) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: BeforeUnloadEvent) => void) => listeners.delete(listener),
  });
});
afterEach(() => { hooks.cleanups.forEach((cleanup) => cleanup()); vi.unstubAllGlobals(); });

describe("selected reservation uses the same route lease", () => {
  const booking = "property=p&reservation=booking-1&section=guest&origin=calendar&originDate=2026-09-07";
  const detailsOwner = { ...owner, label: "booking details" };
  it.each(["/calendar", "/reservations", "/spaces"])("holds exact selected reservation before a dirty exit to %s and Cancel replaces once", pathname => {
    hooks.pathname = "/reservations"; raw(booking, "booking"); const initial = engage(detailsOwner);
    hooks.pathname = pathname; raw("property=p&reservation=booking-2", "requested"); let value = render();
    expect(value.effectiveLocation.pathname).toBe("/reservations"); expect(value.params.toString()).toBe(booking); expect(value.editorKey).toBe(initial.editorKey);
    value.stay(); value = render(); expect(value.paused).toBe(true); expect(value.expanded).toBe(false); expect(hooks.setParams).not.toHaveBeenCalled();
    value.reportOwner({ ...detailsOwner, engaged: false });
    expect(hooks.setParams).toHaveBeenCalledExactlyOnceWith({ pathname: "/reservations", search: "?" + booking, hash: "" }, { replace: true, state: null });
  });
  it("pristine edit does not acquire a lease; pending cannot discard; dirty discard adopts raw destination without history writes", () => {
    hooks.pathname = "/reservations"; raw(booking); engage({ ...detailsOwner, engaged: false }); expect(render().engaged).toBe(false);
    engage({ ...detailsOwner, pending: true }); hooks.pathname = "/calendar"; raw("property=p&date=2026-09-08");
    expect(render().discard()).toBe(false); render().reportOwner(detailsOwner); expect(render().discard()).toBe(true);
    expect(render().effectiveLocation.pathname).toBe("/calendar"); expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it("authoritative denial and actor/property changes fence the held reservation and late callbacks", () => {
    hooks.pathname = "/reservations"; raw(booking); const captured = engage({ ...detailsOwner, pending: true });
    hooks.pathname = "/calendar"; raw("property=p"); render().reportOwner({ ...detailsOwner, authorityLost: true });
    expect(render().engaged).toBe(false); captured.reportOwner(detailsOwner); expect(render().engaged).toBe(false);
    expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it.each(["reservation=", "reservation=a&reservation=b", "reservation=bad%2Fid", "reservation=a&property=other", "reservation=a&new=1", "reservation=a&property=p&property=p"])("rejects malformed first admission %s", params => {
    expect(reservationLeaseAdmissionAllowed("actor", new URLSearchParams(params), "p")).toBe(false);
  });
  it("allows legacy exact reservation without explicit property, never without actual authority", () => {
    expect(reservationLeaseAdmissionAllowed("actor", new URLSearchParams("reservation=a&section=guest"), "p")).toBe(true);
    expect(reservationLeaseAdmissionAllowed("", new URLSearchParams("reservation=a"), "p")).toBe(false);
  });
});

describe("Spaces route hold — deterministic ownership, not rendered aftergate", () => {
  it("leaves normal unopened/completed navigation alone", () => {
    const before = render(); before.reportOwner(idle); raw(requested);
    const after = render(); expect(after.params.toString()).toBe(requested); expect(after.paused).toBe(false);
    expect(after.editorKey).toBe(before.editorKey); expect(listeners.size).toBe(0); expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it("holds exact target/dates/filter/history before consumers see the first Back", () => {
    const before = engage(); raw(requested); const after = render();
    expect(after.params.toString()).toBe(original); expect(after.rawParams.toString()).toBe(requested);
    expect(after.editorKey).toBe(before.editorKey); expect(after.paused).toBe(true); expect(after.expanded).toBe(true);
    expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it("Stay has zero writes, remains visibly paused, and repeated Back/Forward updates only the request", () => {
    engage(); raw(requested); render().stay(); let value = render();
    expect(value.expanded).toBe(false); expect(value.paused).toBe(true); expect(value.params.toString()).toBe(original);
    raw(original, "entry-d"); value = render(); expect(value.paused).toBe(false);
    raw("section=property&property=p", "entry-property"); value = render();
    expect(value.paused).toBe(true); expect(value.expanded).toBe(true); expect(value.params.toString()).toBe(original);
    expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it("Discard adopts the current raw destination once with no router write and invalidates captured callbacks", () => {
    engage(); raw(requested); const paused = render(), key = paused.editorKey;
    expect(paused.discard()).toBe(true); expect(paused.discard()).toBe(false);
    const after = render(); expect(after.editorKey).not.toBe(key); expect(after.params.toString()).toBe(requested);
    paused.setParams((params) => { params.set("bed", "late-d"); return params; }); paused.reportOwner(owner); paused.review();
    expect(render().engaged).toBe(false); expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it.each(["topology", "hold", "selling", "property", "time zone", "processing", "topology retirement", "property retirement"])("keeps the %s pending owner through rejected Discard and its controlled failure", (label) => {
    engage({ ...owner, label, pending: true }); raw(requested);
    const pending = render(); expect(pending.discard()).toBe(false); pending.stay();
    pending.reportOwner({ ...owner, label, pending: false }); const failed = render();
    expect(failed.params.toString()).toBe(original); expect(failed.editorKey).toBe(pending.editorKey); expect(failed.engaged).toBe(true);
    expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it("explicit Cancel canonicalizes the captured route with one guarded replace, never a push", () => {
    engage(); raw(requested); const paused = render(); paused.reportOwner(idle); paused.reportOwner(idle);
    expect(hooks.setParams).toHaveBeenCalledTimes(1);
    const [location, options] = hooks.setParams.mock.calls[0]; expect(location.search).toBe("?" + original); expect(options).toEqual({ replace: true, state: null });
    expect(render().params.toString()).toBe(original); // even before router observes replacement
    raw(location.search, "canonical"); expect(render().engaged).toBe(false);
  });
  it("binds a confirmed owner callback to captured coordinates before one canonical replace", () => {
    engage({ ...owner, pending: true }); raw(requested); const paused = render();
    paused.setParams((params) => { expect(params.toString()).toBe(original); params.set("blockGroup", "confirmed-d"); return params; });
    paused.reportOwner(idle);
    expect(hooks.setParams).toHaveBeenCalledTimes(1);
    const [location, options] = hooks.setParams.mock.calls[0], params = new URLSearchParams(location.search);
    expect(params.get("bed")).toBe("d"); expect(params.get("blockGroup")).toBe("confirmed-d"); expect(options).toEqual({ replace: true, state: null });
  });
  it.each(["actor", "session", "workspace", "property"])("does not retain or resurrect an old editor across %s authority", (kind) => {
    const captured = engage({ ...owner, pending: true });
    const actor = kind === "property" ? "actor-a" : "actor-a-with-new-" + kind;
    raw(requested);
    const reset = render(actor, kind === "property" ? "other" : "p"); expect(reset.editorKey).not.toBe(captured.editorKey); expect(reset.engaged).toBe(false);
    reset.reportOwner(idle); captured.setParams(original); captured.reportOwner(owner);
    raw(original); expect(render().engaged).toBe(false); expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it.each([false, true])("keeps foreign and malformed raw history pending for an admitted owner (pending %s)", (pending) => {
    const captured = engage({ ...owner, pending });
    for (const search of [requested.replace("property=p", "property=other"), requested + "&property=other", requested.replace("room=r", "room=bad%2Froom")]) {
      raw(search, "requested-" + search); const paused = render();
      expect(paused.editorKey).toBe(captured.editorKey); expect(paused.engaged).toBe(true); expect(paused.params.toString()).toBe(original);
      expect(paused.rawParams.toString()).toBe(search); expect(paused.paused).toBe(true); expect(paused.pending).toBe(pending);
      paused.stay(); expect(render().params.toString()).toBe(original);
      if (pending) expect(paused.discard()).toBe(false);
    }
    expect(hooks.setParams).not.toHaveBeenCalled();
    const paused = render(); paused.reportOwner(owner); expect(render().discard()).toBe(true);
    expect(render().params.toString()).toBe(hooks.params.toString());
    captured.setParams(original); captured.reportOwner(owner); expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it.each(["property=other&room=r", "property=p&property=other", "property=p&room=bad%2Froom"])("does not initially acquire an invalid/unadmitted Spaces request %s", (search) => {
    raw(search); render().reportOwner(owner); expect(render().engaged).toBe(false); expect(listeners.size).toBe(0);
  });
  it("uncertain polling retains ownership but confirmed authority loss scrubs and fences an old completion", () => {
    engage(); raw(requested); const paused = render(); paused.reportOwner(owner);
    expect(render().params.toString()).toBe(original);
    paused.reportOwner({ ...owner, authorityLost: true }); const denied = render();
    expect(denied.engaged).toBe(false); expect(denied.editorKey).not.toBe(paused.editorKey);
    paused.setParams(original); paused.reportOwner(owner); expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it("does not invent navigation for equivalent reordered query parameters", () => {
    engage(); const reordered = new URLSearchParams(original); reordered.sort(); raw(reordered.toString());
    const value = render(); expect(value.paused).toBe(false); value.reportOwner(idle);
    expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it.each(["/calendar", "/"])("keeps the Spaces location through first-entry Back to %s, Stay and Cancel", (pathname) => {
    const before = engage(); hooks.pathname = pathname; raw("property=p&date=2026-09-07", "origin");
    let paused = render(); expect(paused.rawLocation.pathname).toBe(pathname); expect(paused.effectiveLocation.pathname).toBe("/spaces");
    expect(paused.editorKey).toBe(before.editorKey); paused.stay(); paused = render(); expect(paused.expanded).toBe(false);
    expect(hooks.setParams).not.toHaveBeenCalled(); paused.reportOwner(idle);
    expect(render().effectiveLocation.pathname).toBe("/spaces"); // no intermediate Calendar/Today mount
    expect(hooks.setParams).toHaveBeenCalledExactlyOnceWith({ pathname: "/spaces", search: "?" + original, hash: "" }, { replace: true, state: null });
  });
  it("adopts a current cross-path request only on non-pending Discard, never on a late owner callback", () => {
    engage({ ...owner, pending: true }); hooks.pathname = "/calendar"; raw("property=p&date=2026-09-07", "calendar");
    const pending = render(); expect(pending.discard()).toBe(false); pending.reportOwner(owner);
    const failed = render(); expect(failed.effectiveLocation.pathname).toBe("/spaces"); expect(failed.discard()).toBe(true);
    expect(render().effectiveLocation.pathname).toBe("/calendar"); pending.setParams(original); pending.reportOwner(owner);
    expect(hooks.setParams).not.toHaveBeenCalled(); expect(render().engaged).toBe(false);
  });
  it("a real property selector change invalidates even an explicit old-property URL", () => {
    const originalOwner = engage(); const other = render("actor-a", "other");
    expect(other.engaged).toBe(false); expect(other.editorKey).not.toBe(originalOwner.editorKey);
    originalOwner.setParams(original); expect(hooks.setParams).not.toHaveBeenCalled();
    expect(render().engaged).toBe(false);
  });
  it("registers real beforeunload prevention while engaged and cleans up on release", () => {
    engage(); expect(listeners.size).toBe(1);
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    listeners.forEach((handler) => handler(event as unknown as BeforeUnloadEvent));
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.returnValue).toBe("");
    render().reportOwner(idle); render(); expect(listeners.size).toBe(0);
  });
  it("ignores a captured completion after the route owner itself unmounts", () => {
    const captured = engage({ ...owner, pending: true }); raw(requested); render();
    hooks.cleanups.forEach((cleanup) => cleanup()); hooks.cleanups.clear();
    captured.setParams(original); captured.reportOwner(idle); captured.discard();
    expect(hooks.setParams).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
  });
  it("keeps route-input-only retirement seams and processing pending reporting without shared owner rewrites", () => {
    const read = (path: string) => readFileSync("src/features/" + path, "utf8");
    for (const file of ["properties/useTopologyRetirementEditor.ts", "properties/usePropertyRetirementEditor.ts"]) {
      const source = read(file); expect(source).toContain("routeInput ?? { params: routerParams, setParams: setRouterParams }");
      expect(source.match(/useSearchParams\(\)/g)).toHaveLength(1);
    }
    const page = read("spaces/SpacesPage.tsx");
    expect(page.indexOf("params: searchParams")).toBeLessThan(page.indexOf("queryKey:"));
    expect(page).toContain("routeInput: { params: searchParams, setParams: setSearchParams }");
    expect(page).toContain("routeInput={{ params: searchParams, setParams: setSearchParams }}");
    expect(page).toContain("onSuccess: (notice) => setSearchParams((current) => spacesBlockSuccessParams(current, notice))");
    expect(read("spaces/SpacesPropertySection.tsx")).toContain("onPendingChange={setProcessingPending}");
    expect(read("properties/PropertyProcessingPanel.tsx")).toContain("onPendingChange?.(activation.isPending || suspension.isPending)");
  });
});
