import { Bell, Blocks, Building2, Cable, CalendarDays, Gauge, LogOut, Menu, Settings2, UserRoundCog, UsersRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { permissions, tenantAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { useNotifications } from "../../features/notifications/notifications";
import { BrandMark } from "../ui/BrandMark";
import { InitialAvatar } from "../ui/primitives";
import { SelectPicker } from "../ui/SelectPicker";

const navigation = [
  { to: "/", label: "Overview", icon: Gauge, required: [permissions.propertiesRead, permissions.inventoryRead, permissions.reservationsRead] },
  { to: "/reservations", label: "Reservations", icon: CalendarDays, required: [permissions.reservationsRead] },
  { to: "/guests", label: "Guests", icon: UsersRound, required: [permissions.guestsRead] },
  { to: "/staff", label: "Staff", icon: UserRoundCog, required: [permissions.staffRead] },
  { to: "/inventory", label: "Inventory", icon: Blocks, required: [permissions.inventoryRead] },
  { to: "/integrations", label: "Integrations", icon: Cable, required: [permissions.ingestionRead] },
  { to: "/properties", label: "Properties", icon: Building2, required: [permissions.propertiesRead] },
  { to: "/workspace", label: "Workspace settings", icon: Settings2, required: [] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { session, logout } = useSession();
  const {
    properties,
    selectedPropertyId,
    setSelectedPropertyId,
    selectedWorkspace,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    workspaces,
  } = useWorkspace();
  const tenantScope = selectedWorkspaceId ? tenantAccessScope(selectedWorkspaceId) : "";
  const navigationAccess = usePermissions(tenantScope ? [
    ...new Set(navigation.flatMap((item) => item.required)),
  ].map((permission) => ({ permission, scope: tenantScope })) : []);
  const visibleNavigation = navigation.filter((item) =>
    item.required.every((permission) => navigationAccess.allows(permission, tenantScope)),
  );
  const { unreadCount } = useNotifications();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-hidden bg-base-200">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-base-300 bg-base-100 transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-20 items-center justify-between px-6">
          <NavLink to="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <BrandMark variant="simple-white-bold" height={48} framed className="shadow-sm" />
            <div><p className="font-display text-xl font-semibold leading-none">BunkFy</p><p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-base-content/35">Hostel operations</p></div>
          </NavLink>
          <button className="btn btn-circle btn-ghost btn-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>

        <div className="border-y border-base-300 px-4 py-4 lg:hidden">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-base-content/45">Current workspace</span>
            <SelectPicker
              className="w-full"
              value={selectedWorkspaceId}
              onValueChange={(value) => {
                if (value === "__new") {
                  setMobileOpen(false);
                  navigate("/workspace/new");
                  return;
                }
                setSelectedWorkspaceId(value);
              }}
              ariaLabel="Current workspace"
              size="sm"
              options={[
                ...workspaces.map((item) => ({
                  value: item.organization.organizationId,
                  label: item.organization.name,
                })),
                { value: "__new", label: "Create workspace" },
              ]}
            />
          </label>
        </div>

        <nav className="mt-5 flex-1 space-y-1 px-4" aria-label="Main navigation">
          <p className="mb-3 px-3 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-base-content/35">Workspace</p>
          {visibleNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={() => setMobileOpen(false)} className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${isActive ? "bg-primary text-primary-content shadow-sm" : "text-base-content/60 hover:bg-base-200 hover:text-base-content"}`}>
              <Icon size={19} strokeWidth={1.8} />{label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-base-300 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-base-200 p-3">
            <NavLink to="/account" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => setMobileOpen(false)}>
              <InitialAvatar name={session?.username} size="sm" variant="solid" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{session?.username}</span><span className="block truncate text-xs text-base-content/45">{selectedWorkspace?.organization.name}</span></span>
            </NavLink>
            <button className="btn btn-circle btn-ghost btn-sm" onClick={() => void logout()} aria-label="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      {mobileOpen && <button className="fixed inset-0 z-30 bg-neutral/30 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-base-300 bg-base-200/90 px-4 backdrop-blur-xl sm:px-8">
          <button className="btn btn-circle btn-ghost lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="hidden items-center gap-8 lg:flex">
            <div>
              <p className="text-xs font-medium text-base-content/40">Workspace</p>
              <SelectPicker
                className="mt-1 max-w-52"
                variant="plain"
                size="sm"
                value={selectedWorkspaceId}
                onValueChange={(value) => value === "__new" ? navigate("/workspace/new") : setSelectedWorkspaceId(value)}
                ariaLabel="Current workspace"
                options={[
                  ...workspaces.map((item) => ({ value: item.organization.organizationId, label: item.organization.name })),
                  { value: "__new", label: "Create workspace" },
                ]}
              />
            </div>
            <div>
              <p className="text-xs font-medium text-base-content/40">Current property</p>
              <SelectPicker
                className="mt-1 max-w-52"
                variant="plain"
                size="sm"
                value={selectedPropertyId}
                onValueChange={setSelectedPropertyId}
                ariaLabel="Current property"
                placeholder="No property yet"
                options={properties.map((property) => ({ value: property.propertyId, label: property.name }))}
              />
            </div>
          </div>
          <div className="lg:hidden">
            <SelectPicker
              className="w-40"
              size="sm"
              value={selectedPropertyId}
              onValueChange={setSelectedPropertyId}
              ariaLabel="Current property"
              placeholder="No property"
              options={properties.map((property) => ({ value: property.propertyId, label: property.name }))}
            />
          </div>
          <div className="flex items-center gap-2"><NavLink to="/notifications" className="btn btn-circle btn-ghost btn-sm relative" aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}><Bell size={18} />{unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.6rem] font-bold leading-4 text-primary-content">{unreadCount > 99 ? "99+" : unreadCount}</span>}</NavLink><div className="flex items-center gap-2" role="status" aria-label="Workspace connected"><span className="hidden text-xs font-semibold text-base-content/45 sm:inline">Live workspace</span><span className="status-dot" aria-hidden="true" /></div></div>
        </header>
        <main className="mx-auto max-w-[1480px] p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
