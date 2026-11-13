/**
 * Estado de sesión fuera de React, para que el cliente HTTP pueda leer el token y cerrar
 * la sesión ante un 401 sin depender del árbol de componentes.
 */
import type { User } from '../api/types';
import { decodeToken, isExpired, type TokenClaims } from './jwt';

export interface Session {
  token: string;
  claims: TokenClaims;
  user: User;
}

export type LogoutReason = 'manual' | 'expired' | 'unauthorized';

export interface SessionState {
  session: Session | null;
  /** Motivo del último cierre de sesión, para mostrarlo en el login. */
  lastLogout: LogoutReason | null;
  /** Tenant y usuario de la última sesión cerrada (para no reutilizar su URL con otra identidad). */
  previous: { tenantId: string; sub: string } | null;
}

const STORAGE_KEY = 'talentcloud.session';

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function restore(): Session | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; user?: User };
    if (!parsed.token || !parsed.user) return null;
    const claims = decodeToken(parsed.token);
    if (!claims || isExpired(claims)) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return { token: parsed.token, claims, user: parsed.user };
  } catch {
    return null;
  }
}

let state: SessionState = { session: restore(), lastLogout: null, previous: null };
const listeners = new Set<() => void>();

function emit(next: SessionState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export const sessionStore = {
  getState: (): SessionState => state,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Token vigente o null (un token vencido equivale a no tener sesión). */
  getValidToken(): string | null {
    const session = state.session;
    if (!session) return null;
    if (isExpired(session.claims)) {
      sessionStore.clear('expired');
      return null;
    }
    return session.token;
  },

  start(token: string, user: User): Session {
    const claims = decodeToken(token);
    if (!claims) throw new Error('El servidor devolvió un token con un formato inesperado.');
    if (isExpired(claims)) throw new Error('El servidor devolvió un token ya vencido.');
    const session: Session = { token, claims, user };
    try {
      safeStorage()?.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    } catch {
      /* sin almacenamiento: la sesión vive solo en memoria */
    }
    emit({ session, lastLogout: null, previous: state.previous });
    return session;
  },

  updateUser(user: User): void {
    if (!state.session) return;
    const session = { ...state.session, user };
    try {
      safeStorage()?.setItem(STORAGE_KEY, JSON.stringify({ token: session.token, user }));
    } catch {
      /* ignorar */
    }
    emit({ ...state, session });
  },

  clear(reason: LogoutReason): void {
    try {
      safeStorage()?.removeItem(STORAGE_KEY);
    } catch {
      /* ignorar */
    }
    if (!state.session) return;
    const { tenantId, sub } = state.session.claims;
    emit({ session: null, lastLogout: reason, previous: { tenantId, sub } });
  },

  acknowledgeLogout(): void {
    if (state.lastLogout) emit({ ...state, lastLogout: null });
  },
};
