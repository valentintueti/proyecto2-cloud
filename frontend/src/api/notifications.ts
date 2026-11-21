import { request } from './http';
import type { AppNotification, CursorPage, MarkAllReadResponse } from './types';

const enc = encodeURIComponent;
export const UNREAD_POLL_INTERVAL_MS = 60_000;

/**
 * Contrato de services/notifications/src/handlers/notifications.py (PR #16):
 * - GET  /notifications/me/unread-count → {unread}
 * - GET  /notifications/me?limit=&cursor=&unread= → {items, nextCursor}
 * - PATCH /notifications/{id}/read → la notificación actualizada
 * - POST /notifications/read-all → {updated}
 * Las rutas HTTP salen del Issue #15: el servicio aún no tiene serverless.yml en main.
 * Por robustez el contador también acepta {count}, y `read` se deduce de `readAt` si falta.
 */
function toCount(body: unknown): number {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['unread', 'count', 'unreadCount']) {
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
    email: typeof raw.email === 'string' ? raw.email : undefined,
    sourceEventId: typeof raw.sourceEventId === 'string' ? raw.sourceEventId : undefined,
  };
}

/**
 * Destino al pulsar una notificación. PAYSLIP_READY trae link "/payroll" (pantalla solo para
 * ADMIN_RRHH); como avisa de la boleta propia, se lleva siempre a "Mis boletas".
 */
export function notificationLink(n: Pick<AppNotification, 'type' | 'link'>): string | null {
  if (n.type === 'PAYSLIP_READY') return '/payslips';
  return n.link ?? null;
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

  /** Responde la notificación actualizada; el frontend no depende del cuerpo (tolera 204). */
  markRead: (notificationId: string) =>
    request<unknown>('notifications', `/notifications/${enc(notificationId)}/read`, { method: 'PATCH', isolated: true }),

  markAllRead: () => request<MarkAllReadResponse | undefined>('notifications', '/notifications/read-all', { method: 'POST', isolated: true }),
};
