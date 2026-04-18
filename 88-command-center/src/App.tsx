import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Login from "./pages/Login";
import Index from "./pages/Index";
import ServerDetail from "./pages/ServerDetail";
import NotFound from "./pages/NotFound";
import AdminHome from "./pages/AdminHome";
import AdminServerLayout from "./pages/AdminServerLayout";
import { KothAdminPanel } from "./components/admin/KothAdminPanel";
import { SystemPlaceholder } from "./components/admin/SystemPlaceholder";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/lib/auth";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false, staleTime: 30_000 });
  if (isLoading) return <div className="min-h-screen bg-background" />;
  if (!data || !data.ok) return <Navigate to="/login" replace state={loc.pathname} />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <PushNotificationPrompt />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequireAuth><Index /></RequireAuth>} />
          <Route path="/servers/:slug" element={<RequireAuth><ServerDetail /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth><AdminHome /></RequireAuth>} />
          <Route
            path="/admin/server/:serverId"
            element={
              <RequireAuth>
                <AdminServerLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="koth" replace />} />
            <Route path="koth" element={<KothAdminPanel />} />
            <Route
              path="maze"
              element={
                <SystemPlaceholder
                  title="MAZE System"
                  body="Maze setup, start, and end will be added here — mirror `/maze-setup`, `/maze-start`, `/maze-delete`."
                />
              }
            />
            <Route
              path="nuketown"
              element={
                <SystemPlaceholder
                  title="NUKETOWN System"
                  body="Nuketown controls will be added here — mirror `/nuketown-setup`, bracket flow, `/nuketown-delete`."
                />
              }
            />
            <Route
              path="onev1"
              element={
                <SystemPlaceholder
                  title="1V1 System"
                  body="1v1 setup and match removal will be added here — mirror `/onev1-setup` and `/onev1-delete`."
                />
              }
            />
            <Route
              path="clan"
              element={
                <SystemPlaceholder
                  title="Clan System"
                  body="Clan administration will be added here — mirror Discord clan admin flows."
                />
              }
            />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
