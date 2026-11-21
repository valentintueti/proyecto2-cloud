import type { AppNotification } from '../../api/types';

export interface NotificationsState {
  items: AppNotification[];
  nextCursor: string | null;
  unread: number;
}

export const EMPTY_NOTIFICATIONS: NotificationsState = { items: [], nextCursor: null, unread: 0 };

/** Marca una como leída en el listado y descuenta el contador (sin bajar de 0 ni descontar dos veces). */
export function applyMarkRead(state: NotificationsState, notificationId: string, now = new Date().toISOString()): NotificationsState {
  const target = state.items.find((n) => n.notificationId === notificationId);
  if (!target || target.read) return state;
  return {
    ...state,
    items: state.items.map((n) => (n.notificationId === notificationId ? { ...n, read: true, readAt: n.readAt ?? now } : n)),
    unread: Math.max(0, state.unread - 1),
  };
}

export function applyMarkAllRead(state: NotificationsState, now = new Date().toISOString()): NotificationsState {
  return { ...state, items: state.items.map((n) => (n.read ? n : { ...n, read: true, readAt: n.readAt ?? now })), unread: 0 };
}

/** Agrega una página (paginación por cursor) sin duplicar notificaciones. */
export function appendPage(state: NotificationsState, items: AppNotification[], nextCursor: string | null): NotificationsState {
  const seen = new Set(state.items.map((n) => n.notificationId));
  return { ...state, items: [...state.items, ...items.filter((n) => !seen.has(n.notificationId))], nextCursor };
}

/** "99+" a partir de 100 para que el contador no rompa el encabezado. */
export function formatBadgeCount(count: number): string {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}
