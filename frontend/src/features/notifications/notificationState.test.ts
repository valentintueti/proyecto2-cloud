import { describe, expect, it } from 'vitest';
import type { AppNotification } from '../../api/types';
import { appendPage, applyMarkAllRead, applyMarkRead, formatBadgeCount, type NotificationsState } from './notificationState';

const n = (id: string, read = false): AppNotification => ({ notificationId: id, title: id, read, createdAt: '2026-11-01T00:00:00Z', link: null });

describe('13. estado de notificaciones (contador y listado sin recargar)', () => {
  const base: NotificationsState = { items: [n('a'), n('b'), n('c', true)], nextCursor: 'cur', unread: 2 };

  it('marcar una como leída descuenta el contador una sola vez', () => {
    const once = applyMarkRead(base, 'a', '2026-11-02T00:00:00Z');
    expect(once.unread).toBe(1);
    expect(once.items.find((x) => x.notificationId === 'a')).toMatchObject({ read: true, readAt: '2026-11-02T00:00:00Z' });
    expect(applyMarkRead(once, 'a')).toBe(once); // ya leída: sin cambios
    expect(applyMarkRead(once, 'c')).toBe(once);
    expect(applyMarkRead({ ...base, unread: 0 }, 'a').unread).toBe(0); // nunca negativo
  });

  it('marcar todas deja el contador en 0', () => {
    const all = applyMarkAllRead(base);
    expect(all.unread).toBe(0);
    expect(all.items.every((x) => x.read)).toBe(true);
  });

  it('paginación por cursor sin duplicados', () => {
    const next = appendPage(base, [n('c', true), n('d')], null);
    expect(next.items.map((x) => x.notificationId)).toEqual(['a', 'b', 'c', 'd']);
    expect(next.nextCursor).toBeNull();
  });

  it('formato del contador', () => {
    expect(formatBadgeCount(0)).toBe('');
    expect(formatBadgeCount(5)).toBe('5');
    expect(formatBadgeCount(150)).toBe('99+');
  });
});
