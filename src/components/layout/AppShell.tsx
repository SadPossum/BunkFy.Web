import { Blocks, Building2, CalendarDays, ChevronDown, Gauge, LogOut, Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { BrandMark } from "../ui/BrandMark";
import { InitialAvatar } from "../ui/primitives";

const navigation = [
  { to: "/", label: "Overview", icon: Gauge },
  { to: "/reservations", label: "Reservations", icon: CalendarDays },
  { to: "/inventory", label: "Inventory", icon: Blocks },
  { to: "/properties", label: "Properties", icon: Building2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { session, logout } = useSession();
  const { properties, selectedPropertyId, setSelectedPropertyId } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-base-200">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-base-300 bg-base-100 transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-20 items-center justify-between px-6">
          <NavLink to="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <BrandMark variant="simple-white-bold" height={48} framed className="shadow-sm" />
            <div><p className="font-display text-xl font-semibold leading-none">BunkFy</p><p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-base-content/35">Hostel operations</p></div>
          </NavLink>
          <button className="btn btn-circle btn-ghost btn-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>

        <nav className="mt-5 flex-1 space-y-1 px-4" aria-label="Main navigation">
          <p className="mb-3 px-3 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-base-content/35">Workspace</p>
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={() => setMobileOpen(false)} className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${isActive ? "bg-primary text-primary-content shadow-sm" : "text-base-content/60 hover:bg-base-200 hover:text-base-content"}`}>
              <Icon size={19} strokeWidth={1.8} />{label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-base-300 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-base-200 p-3">
            <InitialAvatar name={session?.username} size="sm" variant="solid" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{session?.username}</p><p className="truncate text-xs text-base-content/45">{session?.tenantId}</p></div>
            <button className="btn btn-circle btn-ghost btn-sm" onClick={() => void logout()} aria-label="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      {mobileOpen && <button className="fixed inset-0 z-30 bg-neutral/30 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-base-300 bg-base-200/90 px-4 backdrop-blur-xl sm:px-8">
          <button className="btn btn-circle btn-ghost lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="hidden lg:block">
            <p className="text-xs font-medium text-base-content/40">Current property</p>
            <div className="relative mt-1">
              <select className="select h-auto min-h-0 appearance-none border-0 bg-transparent py-0 pl-0 pr-7 text-sm font-bold focus:outline-none" value={selectedPropertyId} onChange={(event) => setSelectedPropertyId(event.target.value)} aria-label="Current property">
                {!properties.length && <option value="">No property yet</option>}
                {properties.map((property) => <option key={property.propertyId} value={property.propertyId}>{property.name}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-base-content/45" />
            </div>
          </div>
          <div className="lg:hidden">
            <select className="select select-bordered select-sm max-w-44" value={selectedPropertyId} onChange={(event) => setSelectedPropertyId(event.target.value)} aria-label="Current property">
              {!properties.length && <option value="">No property</option>}
              {properties.map((property) => <option key={property.propertyId} value={property.propertyId}>{property.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2" role="status" aria-label="Workspace connected"><span className="hidden text-xs font-semibold text-base-content/45 sm:inline">Live workspace</span><span className="status-dot" aria-hidden="true" /></div>
        </header>
        <main className="mx-auto max-w-[1480px] p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
