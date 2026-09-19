import {
  AlertTriangle,
  Bell,
  BedDouble,
  Building2,
  Cable,
  CalendarRange,
  ClipboardList,
  Gauge,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Settings2,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  compositeSourceNeedsRetry,
  createCompositeSource,
} from "../../app/compositeSourceState";
import {
  permissions,
  propertyAccessScope,
  tenantAccessScope,
  usePermissions,
} from "../../app/permissions";
import { useSession } from "../../app/session";
import { useNetworkStatus } from "../../app/networkStatus";
import { useWorkspace } from "../../app/workspace";
import { useNotifications } from "../../features/notifications/notifications";
import { useWorkspaceCatalogueSource } from "../../features/workspaces/WorkspaceCatalogueNotice";
import { BrandMark } from "../ui/BrandMark";
import { CompositeSourceNotice } from "../ui/CompositeSourceNotice";
import { InitialAvatar } from "../ui/primitives";
import { SelectPicker } from "../ui/SelectPicker";
import {
  navigationItemAllowed,
  navigationScopes,
  type NavigationScopeKind,
} from "./navigationAccess";
import {
  propertySwitchSearchParams,
  propertySwitchUpdatesRoute,
} from "./propertySwitchRoute";

type NavigationItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  scope: NavigationScopeKind;
  required: readonly string[];
};

type NavigationSection = {
  label: string;
  items: readonly NavigationItem[];
};

const navigationSections: readonly NavigationSection[] = [
  {
    label: "Operate",
    items: [
      { to: "/", label: "Today", icon: Gauge, scope: "tenant-or-property", required: [permissions.inventoryRead, permissions.reservationsRead] },
      { to: "/calendar", label: "Calendar", icon: CalendarRange, scope: "tenant-or-property", required: [permissions.reservationsRead, permissions.inventoryRead] },
      { to: "/reservations", label: "Reservations", icon: ClipboardList, scope: "tenant-or-property", required: [permissions.reservationsRead] },
      { to: "/guests", label: "Guest records", icon: UsersRound, scope: "tenant-or-property", required: [permissions.guestsRead] },
      { to: "/spaces?section=layout", label: "Spaces", icon: BedDouble, scope: "tenant-or-property", required: [permissions.propertiesRead] },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/staff", label: "Staff", icon: UserRoundCog, scope: "tenant", required: [permissions.staffRead] },
      { to: "/integrations", label: "Integrations", icon: Cable, scope: "tenant-or-property", required: [permissions.ingestionRead] },
      { to: "/privacy-requests", label: "Privacy requests", icon: ShieldCheck, scope: "tenant-or-property", required: [permissions.dataRightsRead] },
    ],
  },
  {
    label: "Workspace",
    items: [
      { to: "/workspace", label: "Workspace settings", icon: Settings2, scope: "tenant", required: [] },
    ],
  },
] as const;

const navigation: readonly NavigationItem[] = navigationSections.flatMap((section) => section.items);
const mobilePrimaryRoutes = new Set(["/", "/calendar", "/reservations", "/spaces?section=layout"]);
const mobileNavigationLabels: Readonly<Record<string, string>> = {
  "Guest records": "Guests",
  Reservations: "Bookings",
};

const pageLabels: Record<string, string> = {
  "/": "Today",
  "/account": "Account",
  "/calendar": "Calendar",
  "/guests": "Guest records",
  "/integrations": "Integrations",
  "/inventory": "Inventory",
  "/notifications": "Notifications",
  "/privacy-requests": "Privacy requests",
  "/properties": "Properties",
  "/reservations": "Reservations",
  "/spaces": "Spaces",
  "/staff": "Staff",
  "/workspace": "Workspace settings",
  "/workspace/new": "Create workspace",
};

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, logout } = useSession();
  const { isOffline } = useNetworkStatus();
  const {
    properties,
    propertiesLoaded,
    propertiesLoading,
    propertiesFetching,
    propertiesError,
    refetchProperties,
    selectedProperty,
    selectedPropertyId,
    setSelectedPropertyId,
    selectedWorkspace,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    workspaces,
  } = useWorkspace();
  const tenantScope = selectedWorkspaceId ? tenantAccessScope(selectedWorkspaceId) : "";
  const propertyScope = selectedWorkspaceId && selectedPropertyId
    ? propertyAccessScope(selectedWorkspaceId, selectedPropertyId)
    : "";
  const scopesForNavigationItem = (item: NavigationItem) =>
    navigationScopes(item.scope, tenantScope, propertyScope);
  const navigationChecks = [...new Map(
    navigation.flatMap((item) => scopesForNavigationItem(item)
      .filter(Boolean)
      .flatMap((scope) => item.required.map((permission) => [
        `${permission}@${scope}`,
        { permission, scope },
      ] as const))),
  ).values()];
  const navigationAccess = usePermissions(navigationChecks);
  const workspaceSource = useWorkspaceCatalogueSource();
  const scopeReady = Boolean(selectedWorkspaceId && session?.tenantId === selectedWorkspaceId);
  const propertySource = createCompositeSource({
    label: "Property list",
    hasData: propertiesLoaded,
    isLoading: propertiesLoading,
    error: propertiesError,
    isFetching: propertiesFetching,
    refetch: refetchProperties,
  });
  const navigationSource = createCompositeSource({
    label: "Navigation access",
    hasData: navigationAccess.hasData,
    isLoading: navigationAccess.isLoading,
    error: navigationAccess.error,
    isFetching: navigationAccess.isFetching,
    refetch: navigationAccess.refetch,
  });
  const canReadPropertyDirectory = navigationAccess.hasData
    && navigationScopes("tenant-or-property", tenantScope, propertyScope).some(
      (scope) => navigationAccess.allows(permissions.propertiesRead, scope),
    );
  const shellSources = [
    workspaceSource,
    ...(scopeReady ? [navigationSource] : []),
    ...(scopeReady && canReadPropertyDirectory ? [propertySource] : []),
  ];
  const shellDelayed = shellSources.some((source) => compositeSourceNeedsRetry(source.state));
  const shellRefreshing = !shellDelayed && shellSources.some((source) => source.isFetching);
  const shellStatusLabel = isOffline
    ? "Offline - workspace data may be out of date"
    : shellDelayed
      ? "Workspace updates delayed"
      : shellRefreshing
        ? "Refreshing workspace"
        : "Workspace current";
  const visibleNavigationSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => navigationItemAllowed(
        item.required,
        scopesForNavigationItem(item),
        navigationAccess.allows,
      )),
    }))
    .filter((section) => section.items.length > 0);
  const visibleNavigation = visibleNavigationSections.flatMap((section) => section.items);
  const mobilePrimaryNavigation = visibleNavigation.filter((item) => mobilePrimaryRoutes.has(item.to));
  const { unreadCount } = useNotifications();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileReturnFocusRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const returnMobileFocusRef = useRef(true);
  const mobileWasOpenRef = useRef(false);
  const pageLabel = pageLabels[location.pathname] ?? "BunkFy";

  useLayoutEffect(() => {
    if (mobileOpen) {
      mobileWasOpenRef.current = true;
      let focusTimer: number | undefined;
      let attempts = 0;
      const focusDrawer = () => {
        const drawer = mobileDrawerRef.current;
        if (!drawer || drawer.contains(document.activeElement)) return;
        mobileCloseButtonRef.current?.focus();
        attempts += 1;
        if (!drawer.contains(document.activeElement) && attempts < 12) {
          focusTimer = window.setTimeout(focusDrawer, 50);
        }
      };
      focusTimer = window.setTimeout(focusDrawer, 0);
      return () => {
        if (focusTimer !== undefined) window.clearTimeout(focusTimer);
      };
    }
    if (!mobileWasOpenRef.current) return;
    mobileWasOpenRef.current = false;
    if (!returnMobileFocusRef.current) return;
    const frame = window.requestAnimationFrame(() => mobileReturnFocusRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      const drawer = mobileDrawerRef.current;
      if (!drawer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  function openMobileNavigation(event: MouseEvent<HTMLButtonElement>) {
    mobileReturnFocusRef.current = event.currentTarget;
    returnMobileFocusRef.current = true;
    setMobileOpen(true);
  }

  function closeMobileNavigation(returnFocus = true) {
    returnMobileFocusRef.current = returnFocus;
    setMobileOpen(false);
  }

  function chooseWorkspace(value: string) {
    if (value === "__new") {
      closeMobileNavigation(false);
      navigate("/workspace/new");
      return;
    }
    setSelectedWorkspaceId(value);
  }

  function chooseProperty(value: string) {
    const current = new URLSearchParams(location.search);
    const updatesRoute = propertySwitchUpdatesRoute(location.pathname, current);
    if (value === selectedPropertyId && (!updatesRoute || current.get("property") === value)) return;
    if (!updatesRoute) {
      setSelectedPropertyId(value);
      return;
    }
    const next = propertySwitchSearchParams(location.pathname, current, value);
    setSelectedPropertyId(value);
    closeMobileNavigation(false);
    navigate({ pathname: location.pathname, search: `?${next.toString()}` });
  }

  const workspaceOptions = [
    ...workspaces.map((item) => ({
      value: item.organization.organizationId,
      label: item.organization.name,
    })),
    { value: "__new", label: "Create workspace" },
  ];
  const propertyOptions = properties.map((property) => ({
    value: property.propertyId,
    label: property.name,
    description: [property.code, property.timeZoneId].filter(Boolean).join(" · "),
  }));

  return (
    <div className="min-h-screen overflow-x-hidden bg-base-200">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[2000] -translate-y-20 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg focus:translate-y-0 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      >
        Skip to main content
      </a>
      <aside
        ref={mobileDrawerRef}
        id="app-navigation"
        tabIndex={-1}
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? true : undefined}
        aria-label="Application navigation"
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-[17rem] flex-col border-r border-base-300 bg-base-100 transition-transform lg:visible lg:translate-x-0 ${mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"}`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-base-300 px-5">
          <NavLink to="/" className="flex min-w-0 items-center gap-3" onClick={() => closeMobileNavigation(false)}>
            <BrandMark variant="simple-white-bold" height={40} framed />
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold leading-none">BunkFy</p>
              <p className="mt-1 truncate text-[0.65rem] font-semibold uppercase text-base-content/45">Hostel operations</p>
            </div>
          </NavLink>
          <button ref={mobileCloseButtonRef} className="btn btn-circle btn-ghost btn-sm lg:hidden" onClick={() => closeMobileNavigation()} aria-label="Close navigation">
            <X size={19} />
          </button>
        </div>

        <div className="border-b border-base-300 px-4 py-4">
          <p className="mb-2 text-[0.68rem] font-semibold uppercase text-base-content/50">Workspace</p>
          <SelectPicker
            className="w-full"
            value={selectedWorkspaceId}
            onValueChange={chooseWorkspace}
            ariaLabel="Current workspace"
            size="sm"
            options={workspaceOptions}
          />
          {canReadPropertyDirectory && (
            <div className="mt-3 rounded-lg border border-base-300 bg-base-200/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-[0.68rem] font-semibold uppercase text-base-content/50">
                <Building2 size={13} /> Current property
              </div>
              <SelectPicker
                className="w-full"
                variant="plain"
                size="sm"
                value={selectedPropertyId}
                onValueChange={chooseProperty}
                ariaLabel="Current property"
                placeholder="No property yet"
                options={propertyOptions}
              />
              {selectedProperty && (
                <p className="mt-2 truncate text-xs text-base-content/50">
                  {[selectedProperty.code, selectedProperty.timeZoneId].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          {visibleNavigationSections.map((section) => (
            <div key={section.label} className="mb-5 last:mb-0">
              <p className="mb-1.5 px-3 text-[0.68rem] font-semibold uppercase text-base-content/45">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    onClick={() => closeMobileNavigation(false)}
                    className={({ isActive }) => `group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? "bg-primary/10 text-primary shadow-[inset_3px_0_0_var(--color-primary)]" : "text-base-content/65 hover:bg-base-200 hover:text-base-content"}`}
                  >
                    <Icon size={18} strokeWidth={1.8} />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-base-300 p-3">
          <div className="flex items-center gap-2 rounded-lg bg-base-200/75 p-2">
            <NavLink to="/account" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => closeMobileNavigation(false)}>
              <InitialAvatar name={session?.username} size="sm" variant="solid" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{session?.username}</span>
                <span className="block truncate text-xs text-base-content/50">Account & security</span>
              </span>
            </NavLink>
            <button className="btn btn-circle btn-ghost btn-sm" onClick={() => void logout()} aria-label="Sign out">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <button className="fixed inset-0 z-30 bg-neutral/30 backdrop-blur-sm lg:hidden" onClick={() => closeMobileNavigation()} aria-label="Close navigation" />
      )}

      <div className="lg:pl-[17rem]">
        <header className="app-topbar sticky top-0 z-20 flex h-16 items-center justify-between border-b border-base-300 bg-base-100/95 px-3 backdrop-blur-lg sm:px-5 lg:px-7">
          <div className="flex min-w-0 items-center gap-2">
            <button className="btn btn-circle btn-ghost btn-sm lg:hidden" onClick={openMobileNavigation} aria-label="Open navigation">
              <Menu size={20} />
            </button>
            <div className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
              <span className="max-w-48 truncate text-base-content/50">{selectedWorkspace?.organization.name ?? "Workspace"}</span>
              <span className="text-base-content/25">/</span>
              <strong className="truncate font-semibold">{pageLabel}</strong>
            </div>
            {canReadPropertyDirectory && (
              <div className="w-44 min-w-0 lg:hidden">
                <SelectPicker
                  className="w-full"
                  size="sm"
                  value={selectedPropertyId}
                  onValueChange={chooseProperty}
                  ariaLabel="Current property"
                  placeholder="No property"
                  options={propertyOptions}
                />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <NavLink to="/notifications" className="btn btn-circle btn-ghost btn-sm relative" aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}>
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-error px-1 text-[0.6rem] font-bold leading-4 text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </NavLink>
            <div className="flex items-center gap-2 px-1" role="status" aria-label={shellStatusLabel} title={shellStatusLabel}>
              <span className="hidden text-xs font-medium text-base-content/50 xl:inline">{shellStatusLabel}</span>
              {isOffline
                ? <WifiOff className="text-warning-content" size={17} aria-hidden="true" />
                : shellDelayed
                ? <AlertTriangle className="text-warning-content" size={17} aria-hidden="true" />
                : shellRefreshing
                  ? <LoaderCircle className="animate-spin text-primary" size={17} aria-hidden="true" />
                  : <span className="status-dot" aria-hidden="true" />}
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1480px] scroll-pb-[calc(5rem+env(safe-area-inset-bottom))] px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5 outline-none sm:px-6 sm:pt-7 lg:scroll-pb-8 lg:px-8 lg:pb-8"
        >
          {isOffline && (
            <div
              className="mb-4 flex items-start gap-3 rounded-lg border border-info/25 bg-info/10 px-4 py-3.5 text-info-content"
              role="status"
              aria-live="polite"
            >
              <WifiOff className="mt-0.5 shrink-0" size={19} />
              <div>
                <p className="font-semibold">You're offline</p>
                <p className="mt-0.5 text-sm leading-5 opacity-80">
                  Already loaded information may be out of date. BunkFy will not send or queue changes until you reconnect.
                </p>
              </div>
            </div>
          )}
          <CompositeSourceNotice sources={shellSources} title="Some workspace data is delayed" />
          {children}
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-base-300 bg-base-100/98 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(21,48,39,0.08)] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${mobilePrimaryNavigation.length + 1}, minmax(0, 1fr))` }}
        aria-label="Mobile navigation"
      >
        {mobilePrimaryNavigation.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[0.68rem] font-medium ${isActive ? "text-primary" : "text-base-content/55"}`}>
            <Icon size={19} strokeWidth={1.8} />
            <span className="max-w-full truncate">{mobileNavigationLabels[label] ?? label}</span>
          </NavLink>
        ))}
        <button type="button" className={`flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[0.68rem] font-medium ${mobileOpen ? "text-primary" : "text-base-content/55"}`} onClick={openMobileNavigation} aria-expanded={mobileOpen} aria-controls="app-navigation">
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
