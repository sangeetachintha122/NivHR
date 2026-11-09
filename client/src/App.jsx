import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell.jsx';
import { LoadingScreen } from './components/common/Ui.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { RequireAuth, RequireRole } from './routes/ProtectedRoute.jsx';

const LoginPage = lazy(() => import('./pages/auth/LoginPage.jsx'));
const DashboardPage = lazy(() => import('./pages/shared/DashboardPage.jsx'));
const EmployeesPage = lazy(() => import('./pages/hr/EmployeesPage.jsx'));
const EmployeeDetailPage = lazy(() => import('./pages/hr/EmployeeDetailPage.jsx'));
const LeavesPage = lazy(() => import('./pages/shared/LeavesPage.jsx'));
const LeaveReviewPage = lazy(() => import('./pages/hr/LeaveReviewPage.jsx'));
const PolicyPage = lazy(() => import('./pages/shared/PolicyPage.jsx'));
const ProfilePage = lazy(() => import('./pages/shared/ProfilePage.jsx'));
const AttendancePage = lazy(() => import('./pages/shared/AttendancePage.jsx'));
const AnalyticsPage = lazy(() => import('./pages/hr/AnalyticsPage.jsx'));
const DepartmentCapacityPage = lazy(() => import('./pages/hr/DepartmentCapacityPage.jsx'));

function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'hr' ? '/dashboard' : '/dashboard'} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<RoleHome />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="leaves" element={<LeavesPage />} />
          <Route path="policy" element={<PolicyPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route element={<RequireRole role="hr" />}>
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="employees/:id" element={<EmployeeDetailPage />} />
            <Route path="department-capacity" element={<DepartmentCapacityPage />} />
            <Route path="ai-leave-review" element={<LeaveReviewPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<RoleHome />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<LoadingScreen label="Opening your workspace" />}>
          <AppRoutes />
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
