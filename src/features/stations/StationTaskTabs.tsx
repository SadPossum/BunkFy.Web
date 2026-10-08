import { LogIn, LogOut } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

export type StationTask = "check-in" | "check-out";

/** Only server-authorized tasks are offered; selecting a tab grants no authority. */
export function StationTaskTabs({ value, checkIn, checkOut, onChange }: {
  value: StationTask; checkIn: boolean; checkOut: boolean; onChange: (task: StationTask) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const tasks: StationTask[] = [...(checkIn ? ["check-in" as const] : []), ...(checkOut ? ["check-out" as const] : [])];
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "Home" ? 0 : event.key === "End" ? tasks.length - 1
      : event.key === "ArrowRight" ? (index + 1) % tasks.length
        : event.key === "ArrowLeft" ? (index - 1 + tasks.length) % tasks.length : null;
    if (next === null) return;
    event.preventDefault(); onChange(tasks[next]); refs.current[next]?.focus();
  }
  return <div role="tablist" aria-label="Shift tasks" className="mb-5 flex gap-1 border-b border-base-300">
    {tasks.map((task, index) => <button key={task} ref={node => { refs.current[index] = node; }}
      id={`station-tab-${task}`} aria-controls={`station-panel-${task}`} role="tab" type="button"
      aria-selected={value === task} tabIndex={value === task ? 0 : -1}
      className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${value === task ? "border-primary text-primary" : "border-transparent text-base-content/65 hover:bg-base-200"}`}
      onClick={() => onChange(task)} onKeyDown={event => move(event, index)}>
      {task === "check-in" ? <LogIn size={17} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
      {task === "check-in" ? "Arrivals" : "Departures"}
    </button>)}
  </div>;
}
