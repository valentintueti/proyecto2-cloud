import { Fragment } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { signupEnabled } from './config/env';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import { AppLayout } from './components/layout/AppLayout';
import { ToastProvider } from './components/ui/Toast';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProfilePage } from './features/identity/ProfilePage';
import { UsersPage } from './features/identity/UsersPage';
import { EmployeesPage } from './features/employees/EmployeesPage';
import { EmployeeDetailPage, MyEmployeeRedirect } from './features/employees/EmployeeDetailPage';
import { OrganizationPage } from './features/employees/OrganizationPage';
import { JobsPage } from './features/recruitment/JobsPage';
import { JobDetailPage } from './features/recruitment/JobDetailPage';
import { AttendancePage } from './features/timeleave/AttendancePage';
import { LeavePage } from './features/timeleave/LeavePage';
import { ApprovalsPage } from './features/timeleave/ApprovalsPage';
import { PayrollRunsPage } from './features/payroll/PayrollRunsPage';
import { PayrollRunDetailPage } from './features/payroll/PayrollRunDetailPage';
import { MyPayslipsPage } from './features/payroll/MyPayslipsPage';
import { SignupPage } from './features/signup/SignupPage';
import { CompanySetupPage } from './features/signup/CompanySetupPage';
import { sessionKey } from './auth/sessionStore';

/**
 * Aislamiento entre tenants: todo el árbol autenticado se vuelve a montar (key) al cambiar
 * de tenant o de usuario, así no sobrevive ningún estado ni dato cargado de la sesión anterior.
 */
function SessionBoundary() {
  const { session } = useAuth();
  const key = sessionKey(session);
  return (
    <Fragment key={key}>
      <AppLayout />
    </Fragment>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={signupEnabled() ? <SignupPage /> : <Navigate to="/login" replace />} />
            <Route element={<RequireAuth />}>
              <Route element={<SessionBoundary />}>
                <Route index element={<DashboardPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route element={<RequirePermission permission="users.list" />}>
                  <Route path="users" element={<UsersPage />} />
                </Route>

                <Route path="employees/me" element={<MyEmployeeRedirect />} />
                <Route element={<RequirePermission permission="employees.list" />}>
                  <Route path="employees" element={<EmployeesPage />} />
                </Route>
                <Route path="employees/:id" element={<EmployeeDetailPage />} />
                <Route element={<RequirePermission permission="org.view" />}>
                  <Route path="organization" element={<OrganizationPage />} />
                </Route>

                <Route element={<RequirePermission permission="jobs.list" />}>
                  <Route path="jobs" element={<JobsPage />} />
                  <Route path="jobs/:jobId" element={<JobDetailPage />} />
                </Route>

                <Route path="attendance" element={<AttendancePage />} />
                <Route path="leave" element={<LeavePage />} />
                <Route element={<RequirePermission permission="leave.approve" />}>
                  <Route path="approvals" element={<ApprovalsPage />} />
                </Route>

                <Route element={<RequirePermission permission="payroll.manage" />}>
                  <Route path="payroll" element={<PayrollRunsPage />} />
                  <Route path="payroll/:runId" element={<PayrollRunDetailPage />} />
                </Route>
                <Route element={<RequirePermission permission="payslips.self" />}>
                  <Route path="payslips" element={<MyPayslipsPage />} />
                </Route>
                <Route path="setup" element={<CompanySetupPage />} />

                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
