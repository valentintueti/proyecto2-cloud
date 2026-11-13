import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { configureHttp } from '../api/http';
import { identityApi } from '../api/identity';
import type { Role, User } from '../api/types';
import { can, type Permission } from './permissions';
import { sessionStore, type LogoutReason, type Session } from './sessionStore';

// El cliente HTTP lee el token del store y cierra la sesión ante cualquier 401.
configureHttp({
  getToken: () => sessionStore.getValidToken(),
  onUnauthorized: (reason) => sessionStore.clear(reason),
});

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: Role | null;
  tenantId: string | null;
  lastLogout: LogoutReason | null;
  login: (tenantId: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  can: (permission: Permission) => boolean;
  acknowledgeLogout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { session, lastLogout } = useSyncExternalStore(sessionStore.subscribe, sessionStore.getState);

  // Cierra la sesión exactamente cuando vence el token.
  useEffect(() => {
    if (!session) return;
    const msLeft = session.claims.exp * 1000 - Date.now();
    const timer = window.setTimeout(() => sessionStore.clear('expired'), Math.max(0, msLeft));
    return () => window.clearTimeout(timer);
  }, [session]);

  const login = useCallback(async (tenantId: string, email: string, password: string) => {
    const response = await identityApi.login({
      tenantId: tenantId.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      password,
    });
    sessionStore.start(response.token, response.user);
  }, []);

  const logout = useCallback(() => sessionStore.clear('manual'), []);

  const refreshProfile = useCallback(async () => {
    const user = await identityApi.me();
    sessionStore.updateUser(user);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const role = session?.claims.role ?? null;
    return {
      session,
      user: session?.user ?? null,
      role,
      tenantId: session?.claims.tenantId ?? null,
      lastLogout,
      login,
      logout,
      refreshProfile,
      can: (permission) => can(role, permission),
      acknowledgeLogout: sessionStore.acknowledgeLogout,
    };
  }, [session, lastLogout, login, logout, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}

/** Igual que useAuth pero garantiza sesión (usar solo dentro de rutas protegidas). */
export function useSession() {
  const auth = useAuth();
  if (!auth.session || !auth.role || !auth.tenantId || !auth.user) {
    throw new Error('useSession requiere una sesión activa');
  }
  return { ...auth, session: auth.session, role: auth.role, tenantId: auth.tenantId, user: auth.user };
}
