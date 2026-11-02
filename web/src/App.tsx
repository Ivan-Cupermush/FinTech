import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './app/Shell';
import { AccountPage } from './features/account/AccountPage';
import { PersonPage } from './features/account/PersonPage';
import { QrConfirmPage } from './features/account/QrConfirmPage';
import { MyNotePage, MyNotesPage } from './features/my-notes/MyNotesPage';
import { LoginPage } from './features/auth/LoginPage';
import { GoalNewPage } from './features/goals/GoalTemplates';
import { NotePage, NotesPage } from './features/notes/NotesPage';
import { AskPage } from './features/knowledge/AskPage';
import { DocPage } from './features/knowledge/Docs';
import { GoalPage } from './features/goals/GoalPage';
import { GoalsPage } from './features/goals/GoalsPage';
import { IntegrationPage, IntegrationsPage } from './features/integrations/IntegrationsPage';
import { LandingPage } from './features/landing/LandingPage';
import { LicensesPage } from './features/credits/LicensesPage';
import { PrivacyPage } from './features/privacy/PrivacyPage';
import { SecurityPage } from './features/security/SecurityPage';
import { ChatsPage } from './features/chats/ChatsPage';
import { MetricsPage } from './features/metrics/MetricsPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { OrgPage } from './features/org/OrgPage';
import { PulsePage } from './features/pulse/PulsePage';
import { ReportPage } from './features/report/ReportPage';
import { SalesEmployeePage, SalesPage } from './features/sales/SalesPage';
import { TasksPage } from './features/tasks/TasksPage';
import { ApiError } from './lib/api';
import { ModuleGate } from './lib/modules';
import { CompanyFunctionsPage } from './features/company/CompanyFunctionsPage';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './ui/Toast';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
        refetchOnWindowFocus: true,
        staleTime: 10_000,
      },
    },
  });
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const { pathname, search } = useLocation();
  // Ссылка из QR-кода профиля открылась без входа — после входа вернёмся к ней.
  const next = pathname === '/app' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return token ? <>{children}</> : <Navigate to={`/login${next}`} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/licenses" element={<LicensesPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/qr/:token" element={<QrConfirmPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<PulsePage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="goals/new" element={<GoalNewPage />} />
        <Route path="goals/:id" element={<GoalPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="chats" element={<ModuleGate module="chats"><ChatsPage /></ModuleGate>} />
        <Route path="chats/:id" element={<ModuleGate module="chats"><ChatsPage /></ModuleGate>} />
        <Route path="metrics" element={<MetricsPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="sales" element={<ModuleGate module="sales"><SalesPage /></ModuleGate>} />
        <Route path="sales/people/:id" element={<ModuleGate module="sales"><SalesEmployeePage /></ModuleGate>} />
        <Route path="org" element={<OrgPage />} />
        <Route path="integrations" element={<ModuleGate module="integrations"><IntegrationsPage /></ModuleGate>} />
        <Route path="integrations/:id" element={<ModuleGate module="integrations"><IntegrationPage /></ModuleGate>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="notes/:id" element={<NotePage />} />
        <Route path="notes/ask" element={<ModuleGate module="knowledge_ai"><AskPage /></ModuleGate>} />
        <Route path="notes/ask/:sid" element={<ModuleGate module="knowledge_ai"><AskPage /></ModuleGate>} />
        <Route path="notes/docs/:id" element={<ModuleGate module="knowledge_ai"><DocPage /></ModuleGate>} />
        <Route path="my-notes" element={<ModuleGate module="my_notes"><MyNotesPage /></ModuleGate>} />
        <Route path="my-notes/:id" element={<ModuleGate module="my_notes"><MyNotePage /></ModuleGate>} />
        <Route path="company" element={<CompanyFunctionsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="profile" element={<AccountPage />} />
        <Route path="people/:id" element={<PersonPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const client = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
