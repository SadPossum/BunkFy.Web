import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { AuthPage } from "../features/auth/AuthPage";
import { AuthCompletionPage } from "../features/auth/AuthCompletionPage";
import { NotificationsProvider } from "../features/notifications/notifications";
import { useSession } from "./session";
import { WorkspaceProvider } from "./workspace";
import { WorkspaceGate } from "../features/workspaces/WorkspaceGate";
import { WorkspaceOnboardingPage } from "../features/workspaces/WorkspaceOnboardingPage";

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
const WorkspaceSettingsPage = lazy(() =>
  import("../features/workspaces/WorkspaceSettingsPage").then((module) => ({
    default: module.WorkspaceSettingsPage,
  })),
);

export function App() {
  const location = useLocation();
  const { isRestoring, session } = useSession();
  if (location.pathname === "/auth/complete") {
    return <AuthCompletionPage />;
  }
  if (isRestoring) {
    return (
      <main className="grid min-h-screen place-items-center" aria-busy="true">
        Restoring your session...
      </main>
    );
  }
  if (!session) return <AuthPage />;

  return (
    <WorkspaceProvider>
      <WorkspaceGate>
        <NotificationsProvider>
          <AppShell>
            <Suspense
              fallback={
                <div
                  className="grid min-h-64 place-items-center"
                  aria-busy="true"
                >
                  <span className="loading loading-spinner loading-md text-primary" />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/properties" element={<PropertiesPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/workspace" element={<WorkspaceSettingsPage />} />
                <Route path="/workspace/new" element={<WorkspaceOnboardingPage />} />
                <Route path="/reservations" element={<ReservationsPage />} />
                <Route path="/guests" element={<GuestsPage />} />
                <Route path="/staff" element={<StaffPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppShell>
        </NotificationsProvider>
      </WorkspaceGate>
    </WorkspaceProvider>
  );
}
