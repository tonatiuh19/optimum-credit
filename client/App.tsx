import "./global.css";

import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Provider } from "react-redux";
import { store } from "./store";
import Layout from "./components/Layout";
import ClientLayout from "./components/layouts/ClientLayout";
import AdminLayout from "./components/layouts/AdminLayout";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Register from "./pages/Register";

import ClientLogin from "./pages/auth/ClientLogin";
import AdminLogin from "./pages/auth/AdminLogin";

import Dashboard from "./pages/client/Dashboard";
import Documents from "./pages/client/Documents";
import Onboarding from "./pages/client/Onboarding";
import Contract from "./pages/client/Contract";
import Reports from "./pages/client/Reports";
import Optibot from "./pages/client/Optibot";
import Support from "./pages/client/Support";
import Profile from "./pages/client/Profile";
import Videos from "./pages/client/Videos";

import AdminDashboard from "./pages/admin/Dashboard";
import AdminClients from "./pages/admin/Clients";
import AdminClientDetail from "./pages/admin/ClientDetail";
import AdminPipeline from "./pages/admin/Pipeline";
import AdminDocuments from "./pages/admin/Documents";
import AdminConversations from "./pages/admin/Conversations";
import AdminTickets from "./pages/admin/Tickets";
import AdminTemplates from "./pages/admin/Templates";
import AdminVideos from "./pages/admin/Videos";
import AdminReports from "./pages/admin/Reports";
import AdminSettings from "./pages/admin/Settings";
import AdminPeople from "./pages/admin/People";
import AdminReminderFlows from "./pages/admin/ReminderFlows";
import AdminPayments from "./pages/admin/Payments";
import {
  RequireAdmin,
  RequireClient,
  NoAuthAdmin,
  NoAuthClient,
  RequireSuperAdmin,
} from "./components/guards";

const queryClient = new QueryClient();

const wrap = (Layoutish: any, Page: any) => (
  <Layoutish>
    <Page />
  </Layoutish>
);

const App = () => (
  <HelmetProvider>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              {/* Marketing site */}
              <Route path="/" element={wrap(Layout, Index)} />
              <Route path="/register" element={<Register />} />

              {/* Auth */}
              <Route
                path="/portal/login"
                element={
                  <NoAuthClient>
                    <ClientLogin />
                  </NoAuthClient>
                }
              />
              <Route
                path="/admin/login"
                element={
                  <NoAuthAdmin>
                    <AdminLogin />
                  </NoAuthAdmin>
                }
              />

              {/* Magic link onboarding (from welcome email) */}
              <Route
                path="/portal/onboarding/:token"
                element={<Onboarding />}
              />

              {/* Client portal */}
              <Route
                path="/portal"
                element={
                  <RequireClient>{wrap(ClientLayout, Dashboard)}</RequireClient>
                }
              />
              <Route
                path="/portal/documents"
                element={
                  <RequireClient>{wrap(ClientLayout, Documents)}</RequireClient>
                }
              />
              <Route
                path="/portal/contract"
                element={
                  <RequireClient>{wrap(ClientLayout, Contract)}</RequireClient>
                }
              />
              <Route
                path="/portal/reports"
                element={
                  <RequireClient>{wrap(ClientLayout, Reports)}</RequireClient>
                }
              />
              <Route
                path="/portal/optibot"
                element={
                  <RequireClient>{wrap(ClientLayout, Optibot)}</RequireClient>
                }
              />
              <Route
                path="/portal/support"
                element={
                  <RequireClient>{wrap(ClientLayout, Support)}</RequireClient>
                }
              />
              <Route
                path="/portal/videos"
                element={
                  <RequireClient>{wrap(ClientLayout, Videos)}</RequireClient>
                }
              />
              <Route
                path="/portal/profile"
                element={
                  <RequireClient>{wrap(ClientLayout, Profile)}</RequireClient>
                }
              />

              {/* Admin */}
              <Route
                path="/admin"
                element={
                  <RequireAdmin>
                    {wrap(AdminLayout, AdminDashboard)}
                  </RequireAdmin>
                }
              />
              <Route
                path="/admin/clients"
                element={
                  <RequireAdmin>{wrap(AdminLayout, AdminClients)}</RequireAdmin>
                }
              />
              <Route
                path="/admin/clients/:id"
                element={
                  <RequireAdmin>
                    {wrap(AdminLayout, AdminClientDetail)}
                  </RequireAdmin>
                }
              />
              <Route
                path="/admin/pipeline"
                element={
                  <RequireAdmin>
                    {wrap(AdminLayout, AdminPipeline)}
                  </RequireAdmin>
                }
              />
              <Route
                path="/admin/documents"
                element={
                  <RequireAdmin>
                    {wrap(AdminLayout, AdminDocuments)}
                  </RequireAdmin>
                }
              />
              <Route
                path="/admin/conversations"
                element={
                  <RequireAdmin>
                    {wrap(AdminLayout, AdminConversations)}
                  </RequireAdmin>
                }
              />
              <Route
                path="/admin/tickets"
                element={
                  <RequireAdmin>{wrap(AdminLayout, AdminTickets)}</RequireAdmin>
                }
              />
              <Route
                path="/admin/templates"
                element={
                  <RequireAdmin>
                    {wrap(AdminLayout, AdminTemplates)}
                  </RequireAdmin>
                }
              />
              <Route
                path="/admin/videos"
                element={
                  <RequireAdmin>{wrap(AdminLayout, AdminVideos)}</RequireAdmin>
                }
              />
              <Route
                path="/admin/reports"
                element={
                  <RequireSuperAdmin>
                    {wrap(AdminLayout, AdminReports)}
                  </RequireSuperAdmin>
                }
              />
              <Route
                path="/admin/settings"
                element={
                  <RequireSuperAdmin>
                    {wrap(AdminLayout, AdminSettings)}
                  </RequireSuperAdmin>
                }
              />
              <Route
                path="/admin/people"
                element={
                  <RequireSuperAdmin>
                    {wrap(AdminLayout, AdminPeople)}
                  </RequireSuperAdmin>
                }
              />
              <Route
                path="/admin/reminder-flows"
                element={
                  <RequireAdmin>
                    {wrap(AdminLayout, AdminReminderFlows)}
                  </RequireAdmin>
                }
              />
              <Route
                path="/admin/payments"
                element={
                  <RequireAdmin>
                    {wrap(AdminLayout, AdminPayments)}
                  </RequireAdmin>
                }
              />

              {/* Catch-all */}
              <Route path="*" element={wrap(Layout, NotFound)} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </Provider>
  </HelmetProvider>
);

export default App;
