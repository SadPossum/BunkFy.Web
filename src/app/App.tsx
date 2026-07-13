import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { AuthPage } from "../features/auth/AuthPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { InventoryPage } from "../features/inventory/InventoryPage";
import { PropertiesPage } from "../features/properties/PropertiesPage";
import { ReservationsPage } from "../features/reservations/ReservationsPage";
import { useSession } from "./session";
import { WorkspaceProvider } from "./workspace";

export function App() {
  const { isRestoring, session } = useSession();
  if (isRestoring) {
    return <main className="grid min-h-screen place-items-center" aria-busy="true">Restoring your session…</main>;
  }
  if (!session) return <AuthPage />;

  return (
    <WorkspaceProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/reservations" element={<ReservationsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </WorkspaceProvider>
  );
}
