import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BedDouble, CalendarSearch, ChevronDown, DoorOpen, Search } from "lucide-react";
import type { StayDateRange } from "../../app/propertyDate";
import { validStayDateRange } from "../../app/propertyDate";
import { DatePicker, formatCompactDate, parseDateKey } from "../../components/ui/DatePicker";
import type { SpacesAvailabilityModel } from "./spacesAvailability";
import type { SpacesRoom, SpacesUnit } from "./spacesLayout";
import { spacesOverviewUnits, spacesRoomSummary, spacesUnitAvailability } from "./spacesWorkspace";

export function SpacesRoomWorkspace({ rooms, selectedRoom, selectedUnit, selectedUnits, physicalBedCount, availability, inventoryCurrent,
  mayReadInventory, range, timeZoneId, locked, onRangeChange, onSelectRoom, onSelectUnit, inspector, sourceNotice, filter, onFilterChange, focusedResourceId,
  requestedTarget = Boolean(selectedRoom), selectionKey = selectedUnit?.key ?? selectedRoom?.roomId ?? "", visible = true,
}: {
  rooms: SpacesRoom[]; selectedRoom: SpacesRoom | null; selectedUnit: SpacesUnit | null; selectedUnits: SpacesUnit[];
  physicalBedCount?: number; availability: SpacesAvailabilityModel; inventoryCurrent: boolean; mayReadInventory: boolean;
  range: StayDateRange; timeZoneId: string; locked: boolean; onRangeChange: (range: StayDateRange) => void;
  onSelectRoom: (id: string) => void; onSelectUnit: (unit: SpacesUnit) => void; inspector: ReactNode;
  sourceNotice: ReactNode; filter: string; onFilterChange: (value: string) => void;
  focusedResourceId?: string | null; requestedTarget?: boolean; selectionKey?: string; visible?: boolean;
}) {
  const [draft, setDraft] = useState(range);
  // Neutral follows the route. A real browse/inspector interaction takes
  // precedence, including when the selected room was only a desktop default.
  const [navigatorOpen, setNavigatorOpen] = useState<boolean | null>(null);
  const showNavigator = navigatorOpen ?? !requestedTarget;
  // Selection opens an untouched branch, but must not override an operator's
  // explicit disclosure choice. Search reveals matches without changing it.
  const [roomDisclosure, setRoomDisclosure] = useState<Record<string, boolean>>({});
  const [comparisonWide, setComparisonWide] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [toolsFocused, setToolsFocused] = useState(false);
  const [toolsToggleFocused, setToolsToggleFocused] = useState(false);
  const toolsElement = useRef<HTMLDivElement>(null);
  const workspaceElement = useRef<HTMLDivElement>(null);
  const navigatorElement = useRef<HTMLElement>(null);
  const navigatorStatus = useRef<HTMLDivElement>(null);
  const inspectorElement = useRef<HTMLElement>(null);
  const selectionOpener = useRef<HTMLButtonElement | null>(null);
  const revealedSelection = useRef<string | null>(null);
  const pointerIntent = useRef<{ owner: string; button: HTMLButtonElement; pointerId: number; open: boolean; cancel: () => void } | null>(null);
  useEffect(() => setDraft(range), [range.arrival, range.departure]);
  useEffect(() => setNavigatorOpen(null), [selectionKey]);
  const valid = validStayDateRange(draft);
  const visibleRooms = rooms.filter((room) => [room.name, room.location, ...room.inventoryUnits.map((unit) => unit.label),
    ...(room.roomId === selectedRoom?.roomId ? selectedUnits.map((unit) => unit.label) : [])]
    .join(" ").toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const selectedVisible = visibleRooms.some((room) => room.roomId === selectedRoom?.roomId);
  const selectedInNavigator = selectedVisible && (!selectedUnit || spacesOverviewUnits(selectedRoom!, selectedUnits).some((unit) => unit.key === selectedUnit.key));
  const selectedLabel = selectedUnit?.label ?? selectedRoom?.name;
  const exactKey = selectedUnit ? selectedUnit.key : selectedRoom ? "room:" + selectedRoom.roomId : null;
  function wideComparison() {
    return workspaceElement.current && getComputedStyle(workspaceElement.current).getPropertyValue("--spaces-comparison-mode").trim() === "wide";
  }
  const toolsCollapsible = !comparisonWide && !showNavigator;
  const toolsOpen = !toolsCollapsible || toolsExpanded || toolsFocused;
  const pointerOwner = JSON.stringify([selectionKey, requestedTarget, showNavigator, visible, locked, comparisonWide]);
  useLayoutEffect(() => {
    if (pointerIntent.current?.owner !== pointerOwner) pointerIntent.current?.cancel();
  }, [pointerOwner]);
  useLayoutEffect(() => () => pointerIntent.current?.cancel(), []);
  const appliedDates = validStayDateRange(range)
    ? `Applied: ${formatCompactDate(parseDateKey(range.arrival)!)} – ${formatCompactDate(parseDateKey(range.departure)!)}`
    : "Dates need checking";
  function toolsOwnNode(node: EventTarget | null) {
    const tools = toolsElement.current;
    if (!tools || !(node instanceof Node)) return false;
    if (tools.contains(node)) return true;
    // A DatePicker's Radix portal is outside this DOM subtree but remains
    // owned by its trigger. Moving focus inside it must not collapse its owner.
    return Array.from(tools.querySelectorAll('[aria-haspopup="dialog"][aria-controls]'))
      .some(trigger => document.getElementById(trigger.getAttribute("aria-controls")!)?.contains(node));
  }
  useLayoutEffect(() => {
    const measure = () => setComparisonWide(Boolean(wideComparison()));
    measure();
    window.addEventListener("resize", measure);
    const frame = workspaceElement.current?.closest(".spaces-room-frame");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (frame) observer?.observe(frame);
    return () => { window.removeEventListener("resize", measure); observer?.disconnect(); };
  }, [visible]);
  useLayoutEffect(() => {
    const revealSelection = () => {
      const navigator = navigatorElement.current;
      if (!visible || !navigator || !exactKey || revealedSelection.current === exactKey || !wideComparison()) return;
      const target = Array.from(navigator.querySelectorAll<HTMLElement>("[data-space-selection]"))
        .find((candidate) => candidate.dataset.spaceSelection === exactKey && candidate.getClientRects().length);
      if (!target) return;
      const row = target.getBoundingClientRect(), viewport = navigator.getBoundingClientRect();
      const top = navigator.querySelector(".spaces-room-search")?.getBoundingClientRect().bottom ?? viewport.top;
      if (row.top < top + 8) navigator.scrollTop += row.top - top - 8;
      else if (row.bottom > viewport.bottom - 8) navigator.scrollTop += row.bottom - viewport.bottom + 8;
      revealedSelection.current = exactKey;
    };
    revealSelection();
    window.addEventListener("resize", revealSelection);
    return () => window.removeEventListener("resize", revealSelection);
  }, [exactKey, selectedInNavigator, navigatorOpen, visible]);
  useLayoutEffect(() => {
    let frame: number | null = null;
    let mounted = true;
    const cancel = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; };
    const revealFocusedEditor = () => {
      cancel();
      const pane = inspectorElement.current;
      if (!visible || !pane) return;
      const node = document.activeElement as HTMLElement | null;
      const editor = node?.closest<HTMLElement>("[data-topology-editor]");
      const available = (target: HTMLElement) => target.isConnected && target.getClientRects().length > 0
        && !target.matches(":disabled") && !target.closest('[inert], [hidden], [aria-hidden="true"]')
        && !["hidden", "collapse"].includes(getComputedStyle(target).visibility);
      if (!node || !editor || node === editor || !pane.contains(editor) || !available(node)) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!mounted || inspectorElement.current !== pane || document.activeElement !== node
          || node.closest("[data-topology-editor]") !== editor || !pane.contains(editor)
          || !available(editor) || !available(node)) return;
        let top = 0, bottom = window.innerHeight;
        const header = document.querySelector<HTMLElement>(".app-topbar");
        const footer = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
        if (header?.getClientRects().length) top = Math.max(top, header.getBoundingClientRect().bottom);
        if (footer?.getClientRects().length) bottom = Math.min(bottom, footer.getBoundingClientRect().top);
        if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(pane).overflowY)) {
          const clip = pane.getBoundingClientRect();
          top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
        }
        const bounds = node.getBoundingClientRect();
        if (bounds.top < top + 12 || bounds.bottom > bottom - 12)
          node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      });
    };
    window.addEventListener("resize", revealFocusedEditor);
    return () => { mounted = false; cancel(); window.removeEventListener("resize", revealFocusedEditor); };
  }, [selectionKey, visible, inspector]);
  function focusInspector() {
    const inspector = inspectorElement.current;
    const heading = inspector?.querySelector<HTMLElement>("[data-inspector-heading]") ?? inspector;
    if (wideComparison()) {
      if (inspector) inspector.scrollTop = 0;
      heading?.focus({ preventScroll: true });
    } else {
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "nearest" });
    }
    // Only close after the existing selection handoff has actually succeeded.
    if (inspector?.contains(document.activeElement)) setToolsExpanded(false);
  }
  function inspect(trigger: HTMLButtonElement, select: () => void) {
    if (locked) return;
    selectionOpener.current = trigger;
    setNavigatorOpen(false);
    select();
    requestAnimationFrame(focusInspector);
  }
  function returnToSelection() {
    if (locked) return;
    setNavigatorOpen(true);
    requestAnimationFrame(() => {
      const comparison = navigatorElement.current;
      const opener = selectionOpener.current;
      const exact = comparison && Array.from(comparison.querySelectorAll<HTMLButtonElement>("[data-space-selection]"))
        .find((candidate) => candidate.dataset.spaceSelection === exactKey);
      const trigger = opener?.isConnected && opener.dataset.spaceSelection === exactKey ? opener : exact;
      if (!trigger) {
        navigatorStatus.current?.focus({ preventScroll: true });
        navigatorStatus.current?.scrollIntoView({ block: "nearest" });
        return;
      }
      trigger.focus({ preventScroll: true });
      if (!comparison || !wideComparison()) { trigger.scrollIntoView({ block: "nearest" }); return; }
      const viewport = comparison.getBoundingClientRect();
      const row = trigger.getBoundingClientRect();
      const searchBottom = comparison.querySelector(".spaces-room-search")?.getBoundingClientRect().bottom ?? viewport.top;
      if (row.top < searchBottom + 8) comparison.scrollTop += row.top - searchBottom - 8;
      else if (row.bottom > viewport.bottom - 8) comparison.scrollTop += row.bottom - viewport.bottom + 8;
    });
  }
  return <>
    <div className="spaces-room-tools border-b border-base-300">
      <button type="button" className="spaces-room-tools-toggle" hidden={!toolsCollapsible && !toolsToggleFocused}
        aria-expanded={toolsOpen} aria-controls="spaces-room-tools-controls" aria-disabled={!toolsCollapsible || undefined}
        onFocus={() => setToolsToggleFocused(true)} onBlur={() => setToolsToggleFocused(false)}
        onPointerDown={(event) => {
          pointerIntent.current?.cancel();
          if (!event.isPrimary || event.button !== 0 || !toolsCollapsible) return;
          const button = event.currentTarget;
          const cancel = () => {
            document.removeEventListener("pointerdown", cancel, true);
            document.removeEventListener("pointercancel", cancel, true);
            document.removeEventListener("click", clickedElsewhere, true);
            pointerIntent.current = null;
          };
          const clickedElsewhere = (event: MouseEvent) => {
            if (!(event.target instanceof Node) || !button.contains(event.target)) cancel();
          };
          // Focus/blur may collapse a focus-retained toolbar before click. Keep
          // only this primary pointer's visible activation intent, not a new
          // persistent expansion preference or a stale next-click boolean.
          pointerIntent.current = { owner: pointerOwner, button, pointerId: event.pointerId, open: toolsOpen, cancel };
          document.addEventListener("pointerdown", cancel, true);
          document.addEventListener("pointercancel", cancel, true);
          document.addEventListener("click", clickedElsewhere, true);
        }}
        onClick={(event) => {
          const intent = pointerIntent.current;
          const pointerId = (event.nativeEvent as MouseEvent & { pointerId?: number }).pointerId;
          const wasOpen = event.detail > 0 && intent?.button === event.currentTarget && intent.owner === pointerOwner
            && (pointerId === undefined || pointerId === intent.pointerId) ? intent.open : toolsOpen;
          intent?.cancel();
          if (!toolsCollapsible) return;
          event.currentTarget.focus({ preventScroll: true });
          setToolsExpanded(!wasOpen);
        }}>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{mayReadInventory ? "Find another room or check dates" : "Find another room or bed"}</span>
          {mayReadInventory && <span className="mt-0.5 block text-[0.8125rem] leading-5 text-base-content/65">{appliedDates}</span>}
        </span>
        <ChevronDown size={16} aria-hidden="true" className={"shrink-0 " + (toolsOpen ? "rotate-180" : "")} />
      </button>
    <div ref={toolsElement} id="spaces-room-tools-controls" className="spaces-room-toolbar" hidden={!toolsOpen}
      onFocusCapture={() => setToolsFocused(true)} onBlurCapture={(event) => setToolsFocused(toolsOwnNode(event.relatedTarget))}>
      <label className="block min-w-0 text-sm font-semibold">
        <span className="mb-1 block">Find a room or bed</span>
        <span className="input input-bordered spaces-room-filter flex w-full items-center gap-2"><Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Find a room or bed" placeholder="Room, bed or location" className="min-w-0 grow font-normal" value={filter} disabled={locked} onChange={(event) => { onFilterChange(event.target.value); setNavigatorOpen(true); }} />
        </span>
      </label>
      {mayReadInventory && <form className="spaces-room-dates min-w-0" aria-label="Night availability dates" onSubmit={(event) => {
        event.preventDefault(); if (valid && !locked) onRangeChange(draft);
      }}>
        <div className="min-w-0"><span className="mb-1 block text-sm font-semibold">From</span><DatePicker value={draft.arrival} onChange={(arrival) => setDraft((value) => ({ ...value, arrival }))} ariaLabel="Arrival date" size="sm" className="spaces-room-date w-full" required disabled={locked} /></div>
        <div className="min-w-0"><span className="mb-1 block text-sm font-semibold">Until</span><DatePicker value={draft.departure} onChange={(departure) => setDraft((value) => ({ ...value, departure }))} ariaLabel="Departure date" min={draft.arrival} size="sm" className="spaces-room-date w-full" required disabled={locked} /></div>
        <button className="btn btn-secondary btn-sm self-end text-white" disabled={!valid || locked}><CalendarSearch size={16} />Check dates</button>
        {!valid && <p className="col-span-full text-sm text-error" role="alert">Until must be after From. No availability request is sent for this range.</p>}
        <p className="col-span-full text-[0.8125rem] leading-5 text-base-content/65">Night availability · {timeZoneId} · The Until date is not included.</p>
      </form>}
    </div>
    </div>
    {sourceNotice}
    <div ref={workspaceElement} role="region" aria-label="Rooms and beds comparison" className="spaces-room-workspace min-w-0" data-spaces-view={showNavigator ? "navigator" : "selection"}>
      <nav ref={navigatorElement} aria-label="Rooms and beds navigator" className="spaces-room-navigator min-w-0" onFocusCapture={(event) => {
        const target = event.target;
        requestAnimationFrame(() => {
          const navigator = navigatorElement.current;
          const search = navigator?.querySelector(".spaces-room-search");
          if (!navigator || !wideComparison() || search?.contains(target) || !target.isConnected || document.activeElement !== target) return;
          const row = target.getBoundingClientRect(), viewport = navigator.getBoundingClientRect();
          const top = search?.getBoundingClientRect().bottom ?? viewport.top;
          if (row.top < top + 8) navigator.scrollTop += row.top - top - 8;
          else if (row.bottom > viewport.bottom - 8) navigator.scrollTop += row.bottom - viewport.bottom + 8;
        });
      }}>
        <div className="spaces-room-search border-b border-base-300 bg-base-100 p-3">
          <div ref={navigatorStatus} tabIndex={-1} className="text-[0.8125rem] leading-5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary" role="status">
            {selectedRoom && !selectedInNavigator ? <>
              <p>{selectedLabel} {selectedVisible ? "is a separate whole-room option." : "is outside this search. Your selection is kept."}</p>
              <button type="button" data-space-selection={exactKey ?? undefined} className="btn btn-ghost btn-sm mt-1 h-auto min-h-11 whitespace-normal text-left" disabled={locked}
                onClick={(event) => inspect(event.currentTarget, () => {})}>Open selected {selectedLabel}</button>
            </> : !selectedRoom && requestedTarget ? <p>The exact requested space is not confirmed in this navigator. No other space is selected.</p> : <p>{visibleRooms.length} {visibleRooms.length === 1 ? "room" : "rooms"} shown</p>}
            {filter && <button type="button" className="btn btn-ghost btn-sm mt-1 min-h-11" disabled={locked} onClick={() => onFilterChange("")}>Clear search</button>}
          </div>
        </div>
        {rooms.length > 0 && !visibleRooms.length && <p className="px-3 py-4 text-sm" role="status">No matching rooms or beds</p>}
        {visibleRooms.map((room) => {
          const selected = room.roomId === selectedRoom?.roomId;
          const units = spacesOverviewUnits(room, selected ? selectedUnits : undefined);
          const expanded = Boolean(filter.trim()) || (roomDisclosure[room.roomId] ?? selected);
          const childrenId = `spaces-room-children-${room.roomId}`;
          return <section key={room.roomId} className="spaces-room-group min-w-0 border-b border-base-300" aria-label={room.name}>
            <div className={"flex items-start gap-1 " + (selected ? "bg-primary/8" : "bg-base-200/45")}>
            <h3 className="min-w-0 flex-1"><button type="button" data-space-selection={"room:" + room.roomId} aria-pressed={selected && !selectedUnit} aria-controls="spaces-selection-inspector" disabled={locked} onClick={(event) => inspect(event.currentTarget, () => onSelectRoom(room.roomId))}
              className="flex min-h-11 w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-base-200 focus-visible:bg-primary/12 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
              <DoorOpen size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block break-words font-semibold">{room.name}</span>
                <span className="mt-0.5 block break-words text-[0.8125rem] font-normal leading-5 text-base-content/65">{spacesRoomSummary(room, selected ? physicalBedCount : undefined, inventoryCurrent)}</span>
              </span>{room.physicalStatus?.toLowerCase() === "retired" && <span className="text-[0.8125rem]">Retired</span>}
            </button></h3>
            <button type="button" className="btn btn-ghost btn-sm mr-1 mt-1 w-11 shrink-0 px-0" aria-label={`${expanded ? "Hide" : "Show"} spaces in ${room.name}`}
              aria-expanded={expanded} aria-controls={childrenId} disabled={locked || Boolean(filter.trim())}
              title={filter.trim() ? "Search results stay expanded" : undefined}
              onClick={() => setRoomDisclosure((current) => ({ ...current, [room.roomId]: !expanded }))}>
              <ChevronDown size={16} className={expanded ? "rotate-180" : ""} aria-hidden="true" />
            </button>
            </div>
            <div id={childrenId} hidden={!expanded}>
            {units.length > 0 ? <table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">{room.name}: rooms and beds for the selected dates</caption>
              <thead className="sr-only"><tr><th scope="col">Space</th><th scope="col">Availability</th></tr></thead>
              <tbody>{units.map((unit) => {
                const chosen = selected && unit.key === selectedUnit?.key;
                const status = spacesUnitAvailability(unit, availability.rows, inventoryCurrent);
                return <tr key={unit.key} className={chosen ? "bg-primary/8" : "hover:bg-base-200/35"}>
                  <th scope="row" className="w-[48%] py-0 pl-3 font-normal"><button type="button" data-space-selection={unit.key} aria-pressed={chosen} aria-controls="spaces-selection-inspector" disabled={locked}
                    className="flex min-h-11 w-full items-center gap-2 rounded-sm py-2 text-left focus-visible:outline-2 focus-visible:outline-primary" onClick={(event) => inspect(event.currentTarget, () => onSelectUnit(unit))}>
                    {unit.kind === "bed" ? <BedDouble size={15} className="shrink-0 text-base-content/50" aria-hidden="true" /> : <DoorOpen size={15} className="shrink-0 text-base-content/50" aria-hidden="true" />}
                    <span className="break-words font-medium">{unit.label}</span></button></th>
                  <td className={"break-words px-3 py-2 text-[0.8125rem] font-medium leading-5 " + status.tone}>{mayReadInventory ? status.label : "Inventory access not assigned"}</td>
                </tr>;
              })}</tbody>
            </table> : <p className="px-3 py-3 text-sm text-base-content/65">{room.inventoryState === "present" ? "No spaces offered here. Select the room for selling setup." : "Select the room to inspect its physical beds."}</p>}
            </div>
          </section>;
        })}
      </nav>
      <aside ref={inspectorElement} id="spaces-selection-inspector" tabIndex={-1} aria-label="Selected room and space"
        onFocusCapture={() => setNavigatorOpen(false)}
        className={"spaces-room-inspector min-w-0 bg-base-100 outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-primary " + (focusedResourceId && selectedUnit?.inventoryUnitId === focusedResourceId ? "resource-focus" : "")}>
        <button type="button" className="spaces-room-back btn btn-ghost btn-sm mx-3 mt-2 min-h-11" disabled={locked} onClick={returnToSelection}><ArrowLeft size={15} />Back to rooms &amp; beds</button>
        {inspector}
      </aside>
    </div>
  </>;
}
