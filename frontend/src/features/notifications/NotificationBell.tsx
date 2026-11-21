import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { UNREAD_POLL_INTERVAL_MS, notificationsApi } from '../../api/notifications';
import type { AppNotification } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../hooks/useAsync';
import { usePolling } from '../../hooks/usePolling';
import { formatDateTime } from '../../utils/format';
import { safeInternalPath } from '../../utils/links';
import { EMPTY_NOTIFICATIONS, appendPage, applyMarkAllRead, applyMarkRead, formatBadgeCount, type NotificationsState } from './notificationState';

const PAGE_SIZE = 10;

/** Un fallo de render en la campana nunca debe tumbar el encabezado ni el resto de la app. */
class Isolate extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[notifications] componente desactivado por un error', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Se monta solo si notificationsEnabled() (ver AppLayout): con la variable vacía no hay campana ni peticiones. */
export function NotificationBell() {
  return (
    <Isolate>
      <BellPanel />
    </Isolate>
  );
}

function BellPanel() {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NotificationsState>(EMPTY_NOTIFICATIONS);
  const [countError, setCountError] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Contador de no leídas: al montar y luego cada 60 s. Los errores se quedan en la campana.
  usePolling(
    async (signal) => {
      const count = await notificationsApi.unreadCount(signal);
      if (!signal.aborted) {
        setState((s) => ({ ...s, unread: count }));
        setCountError(false);
      }
      return true;
    },
    { intervalMs: UNREAD_POLL_INTERVAL_MS, enabled: true, immediate: true, onError: () => setCountError(true) },
    [],
  );

  const loadPage = async (cursor: string | null) => {
    setLoading(true);
    setListError(null);
    try {
      const page = await notificationsApi.list({ limit: PAGE_SIZE, cursor });
      setState((s) => (cursor ? appendPage(s, page.items, page.nextCursor) : { ...s, items: page.items, nextCursor: page.nextCursor }));
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadPage(null);
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openNotification = async (n: AppNotification) => {
    if (!n.read) {
      try {
        await notificationsApi.markRead(n.notificationId);
        setState((s) => applyMarkRead(s, n.notificationId));
      } catch (error) {
        toast.error('No se pudo marcar como leída', errorMessage(error));
      }
    }
    const target = safeInternalPath(n.link, window.location.origin);
    if (target) {
      setOpen(false);
      navigate(target);
    } else if (n.link) {
      toast.info('Enlace no disponible', 'La notificación apunta a un destino externo no verificado y no se abrirá.');
    }
  };

  const markAll = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await notificationsApi.markAllRead();
      setState((s) => applyMarkAllRead(s));
    } catch (error) {
      toast.error('No se pudieron marcar como leídas', errorMessage(error));
    } finally {
      setMarkingAll(false);
    }
  };

  const badge = formatBadgeCount(state.unread);
  return (
    <div className="notif" ref={rootRef}>
      <button
        type="button"
        className="notif-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={state.unread ? `Notificaciones: ${state.unread} sin leer` : 'Notificaciones'}
        title={countError ? 'No se pudo actualizar el contador de notificaciones' : 'Notificaciones'}
      >
        <Bell size={18} />
        {badge && <span className="notif-count" data-testid="unread-count">{badge}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notificaciones">
          <div className="notif-head">
            <strong>Notificaciones</strong>
            <Button size="sm" variant="ghost" icon={<CheckCheck size={15} />} loading={markingAll} disabled={state.unread === 0} onClick={markAll}>
              Marcar todas como leídas
            </Button>
          </div>
          <div className="notif-list">
            {listError && <p className="notif-empty error">{listError}</p>}
            {!listError && !loading && state.items.length === 0 && <p className="notif-empty">No tienes notificaciones.</p>}
            {state.items.map((n) => {
              const internal = safeInternalPath(n.link, window.location.origin);
              return (
                <button key={n.notificationId} type="button" className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => openNotification(n)}>
                  {!n.read && <span className="notif-dot" aria-label="Sin leer" />}
                  <span className="notif-text">
                    <strong>{n.title}</strong>
                    {n.message && <span>{n.message}</span>}
                    <small>
                      {formatDateTime(n.createdAt)}
                      {n.link && !internal && (
                        <>
                          {' '}
                          · <ExternalLink size={11} /> enlace externo bloqueado
                        </>
                      )}
                    </small>
                  </span>
                </button>
              );
            })}
            {loading && (
              <div className="notif-empty">
                <Spinner size={16} />
              </div>
            )}
          </div>
          {state.nextCursor && !loading && (
            <div className="notif-foot">
              <Button size="sm" variant="secondary" onClick={() => loadPage(state.nextCursor)}>
                Cargar más
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
