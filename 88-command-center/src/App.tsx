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
import { MazeAdminPanel } from "./components/admin/MazeAdminPanel";
import { NuketownAdminPanel } from "./components/admin/NuketownAdminPanel";
import { OneV1AdminPanel } from "./components/admin/OneV1AdminPanel";
import { ClanAdminPanel } from "./components/admin/ClanAdminPanel";
import { PositionsAdminPanel } from "./components/admin/PositionsAdminPanel";
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
            <Route path="maze" element={<MazeAdminPanel />} />
            <Route path="nuketown" element={<NuketownAdminPanel />} />
            <Route path="onev1" element={<OneV1AdminPanel />} />
            <Route path="clan" element={<ClanAdminPanel />} />
            <Route path="positions" element={<PositionsAdminPanel />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
