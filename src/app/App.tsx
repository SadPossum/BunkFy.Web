import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { AppShell } from "../components/layout/AppShell";
import { AuthPage } from "../features/auth/AuthPage";
import { AuthCompletionPage } from "../features/auth/AuthCompletionPage";
import { SessionRecoveryPage } from "../features/auth/SessionRecoveryPage";
import { NotificationsProvider } from "../features/notifications/notifications";
import { useSession } from "./session";
import { WorkspaceProvider } from "./workspace";
import { WorkspaceGate } from "../features/workspaces/WorkspaceGate";
import { preserveWorkspaceJoinSecret } from "../features/workspaces/workspaceJoin";
import {
  RenderErrorBoundary,
  RouteRenderFailure,
} from "./RenderErrorBoundary";
import { LoadingState } from "../components/ui/primitives";
import { AccessAuthorityProvider } from "./accessAuthority";
import { OperationalPreviewHost } from "../features/operational-preview/OperationalPreviewHost";
import { OperationalPreviewProvider } from "../features/operational-preview/OperationalPreviewProvider";
import { RouteNavigationLeaseProvider, useCurrentRouteNavigationLease } from "./routeNavigationLease";

const AccountPage = lazy(() =>
  import("../features/account/AccountPage").then((module) => ({
    default: module.AccountPage,
  })),
);
const DashboardPage = lazy(() =>
  import("../features/dashboard/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const CalendarPage = lazy(() =>
  import("../features/calendar/CalendarPage").then((module) => ({
    default: module.CalendarPage,
  })),
);
const GuestsPage = lazy(() =>
  import("../features/guests/GuestsPage").then((module) => ({
    default: module.GuestsPage,
  })),
);
const InventoryPage = lazy(() =>
  import("../features/inventory/InventoryPage").then((module) => ({
    default: module.InventoryPage,
  })),
);
const IntegrationsPage = lazy(() =>
  import("../features/integrations/IntegrationsPage").then((module) => ({
    default: module.IntegrationsPage,
  })),
);
const NotificationsPage = lazy(() =>
  import("../features/notifications/NotificationsPage").then((module) => ({
    default: module.NotificationsPage,
  })),
);
const PropertiesPage = lazy(() =>
  import("../features/properties/PropertiesPage").then((module) => ({
    default: module.PropertiesPage,
  })),
);
const PrivacyRequestsPage = lazy(() =>
  import("../features/data-rights/PrivacyRequestsPage").then((module) => ({
    default: module.PrivacyRequestsPage,
  })),
);
const ReservationsPage = lazy(() =>
  import("../features/reservations/ReservationsPage").then((module) => ({
    default: module.ReservationsPage,
  })),
);
const StaffPage = lazy(() =>
  import("../features/staff/StaffPage").then((module) => ({
    default: module.StaffPage,
  })),
);
const SpacesPage = lazy(() =>
  import("../features/spaces/SpacesPage").then((module) => ({
    default: module.SpacesPage,
  })),
);
const WorkspaceSettingsPage = lazy(() =>
  import("../features/workspaces/WorkspaceSettingsPage").then((module) => ({
    default: module.WorkspaceSettingsPage,
  })),
);

export function App() {
  const location = useLocation();
  const {
    abandonSessionRestore,
    isRestoring,
    restorationError,
    restoringIdentity,
    retrySessionRestore,
    session,
  } = useSession();
  useEffect(() => {
    if (location.pathname !== "/join" || !preserveWorkspaceJoinSecret(location.hash)) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${location.pathname}${location.search}`,
    );
  }, [location.hash, location.pathname, location.search]);

  if (location.pathname === "/auth/complete") {
    return <AuthCompletionPage />;
  }
  if (restoringIdentity && (isRestoring || restorationError)) {
    return <SessionRecoveryPage
      error={restorationError}
      identity={restoringIdentity}
      isRestoring={isRestoring}
      onRetry={() => void retrySessionRestore()}
      onUseAnotherAccount={abandonSessionRestore}
    />;
  }
  if (!session) return <AuthPage invitation={location.pathname === "/join"} />;

  return (
    <WorkspaceProvider>
      <AccessAuthorityProvider>
        <WorkspaceGate>
          <NotificationsProvider>
            <RouteNavigationLeaseProvider>
              <LeasedApplicationRoutes />
            </RouteNavigationLeaseProvider>
          </NotificationsProvider>
        </WorkspaceGate>
      </AccessAuthorityProvider>
    </WorkspaceProvider>
  );
}

function LeasedApplicationRoutes() {
  const { effectiveLocation } = useCurrentRouteNavigationLease();
  return <Routes location={effectiveLocation}>
    <Route element={<ApplicationRouteLayout />}>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/calendar" element={<CalendarPage />} />
      <Route path="/spaces" element={<SpacesPage />} />
      <Route path="/properties" element={<PropertiesPage />} />
      <Route path="/privacy-requests" element={<PrivacyRequestsPage />} />
      <Route path="/inventory" element={<InventoryPage />} />
      <Route path="/integrations" element={<IntegrationsPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/workspace" element={<WorkspaceSettingsPage />} />
      <Route path="/reservations" element={<ReservationsPage />} />
      <Route path="/guests" element={<GuestsPage />} />
      <Route path="/staff" element={<StaffPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>;
}

function ApplicationRouteLayout() {
  const location = useLocation();
  return <OperationalPreviewProvider>
    <AppShell>
      <RenderErrorBoundary fallback={<RouteRenderFailure />} resetKey={location.key}>
        <Suspense fallback={<LoadingState label="Opening page" />}>
          <RouteViewportReset pathname={location.pathname} />
          <Outlet />
        </Suspense>
      </RenderErrorBoundary>
    </AppShell>
    <OperationalPreviewHost />
  </OperationalPreviewProvider>;
}

function RouteViewportReset({ pathname }: { pathname: string }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
