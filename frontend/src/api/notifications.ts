import { request } from './http';
import type { AppNotification, CursorPage } from './types';

const enc = encodeURIComponent;
export const UNREAD_POLL_INTERVAL_MS = 60_000;

/**
 * El contrato sale del Issue #15: services/notifications todavía no tiene handlers en main.
 * Para no romper si el backend final varía un poco, se normaliza la respuesta:
 * - contador: {count} o {unreadCount}
 * - lista: {items, nextCursor}
 * - leída: `read` (boolean) o `readAt` (fecha)
 */
function toCount(body: unknown): number {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['count', 'unreadCount', 'unread']) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
    }
  }
  return 0;
}

export function normalizeNotification(raw: Record<string, unknown>): AppNotification {
  const readAt = typeof raw.readAt === 'string' ? raw.readAt : null;
  const read = typeof raw.read === 'boolean' ? raw.read : readAt !== null;
  return {
    notificationId: String(raw.notificationId ?? raw.id ?? ''),
    title: String(raw.title ?? raw.subject ?? 'Notificación'),
    message: typeof raw.message === 'string' ? raw.message : typeof raw.body === 'string' ? raw.body : undefined,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    link: typeof raw.link === 'string' ? raw.link : null,
    read,
    readAt,
    createdAt: String(raw.createdAt ?? ''),
  };
}

export const notificationsApi = {
  unreadCount: async (signal?: AbortSignal) =>
    toCount(await request<unknown>('notifications', '/notifications/me/unread-count', { signal, isolated: true })),

  list: async (params: { limit?: number; cursor?: string | null }, signal?: AbortSignal): Promise<CursorPage<AppNotification>> => {
    const page = await request<{ items?: Record<string, unknown>[]; nextCursor?: string | null }>('notifications', '/notifications/me', {
      query: { limit: params.limit, cursor: params.cursor },
      signal,
      isolated: true,
    });
    return {
      items: (page?.items ?? []).map(normalizeNotification).filter((n) => n.notificationId),
      nextCursor: page?.nextCursor ?? null,
    };
  },

  /** Puede responder la notificación actualizada o 204: el frontend no depende del cuerpo. */
  markRead: (notificationId: string) =>
    request<unknown>('notifications', `/notifications/${enc(notificationId)}/read`, { method: 'PATCH', isolated: true }),

  markAllRead: () => request<unknown>('notifications', '/notifications/read-all', { method: 'POST', isolated: true }),
};
