import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { Permission } from './permissions';

/** Sin sesión (o con token vencido) → login, recordando a dónde quería ir. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children ? <>{children}</> : <Outlet />;
}

/** Ruta sin permiso para el rol → inicio. */
export function RequirePermission({ permission, children }: { permission: Permission; children?: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return <Navigate to="/" replace state={{ denied: true }} />;
  return children ? <>{children}</> : <Outlet />;
}
