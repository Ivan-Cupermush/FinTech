import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './app/Shell';
import { LoginPage } from './features/auth/LoginPage';
import { GoalNewPage } from './features/goals/GoalTemplates';
import { GoalPage } from './features/goals/GoalPage';
import { GoalsPage } from './features/goals/GoalsPage';
import { LandingPage } from './features/landing/LandingPage';
import { MetricsPage } from './features/metrics/MetricsPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { OrgPage } from './features/org/OrgPage';
import { PulsePage } from './features/pulse/PulsePage';
import { ReportPage } from './features/report/ReportPage';
import { TasksPage } from './features/tasks/TasksPage';
import { ApiError } from './lib/api';
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
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
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
        <Route path="metrics" element={<MetricsPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="org" element={<OrgPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
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
