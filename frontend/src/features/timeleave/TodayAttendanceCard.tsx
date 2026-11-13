import { LogIn, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { timeLeaveApi } from '../../api/timeLeave';
import type { AttendanceRecord } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { Card } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { errorMessage, useAsync } from '../../hooks/useAsync';
import { BUSINESS_TZ, capitalize, formatMinutes, formatTime, todayISO } from '../../utils/format';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Marcación del día (hora de Lima, igual que el backend). */
export function TodayAttendanceCard({ onChange }: { onChange?: (record: AttendanceRecord) => void }) {
  const toast = useToast();
  const now = useClock();
  const today = todayISO(now);
  const record = useAsync(
    (signal) => timeLeaveApi.myAttendance({ from: today, to: today }, signal).then((r) => r.items[0] ?? null),
    [today],
  );
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);

  const mark = async (kind: 'in' | 'out') => {
    setBusy(kind);
    try {
      const saved = kind === 'in' ? await timeLeaveApi.checkIn() : await timeLeaveApi.checkOut();
      record.setData(saved);
      onChange?.(saved);
      toast.success(kind === 'in' ? 'Entrada registrada' : 'Salida registrada', `${formatTime(kind === 'in' ? saved.checkIn : saved.checkOut)} (hora de Lima)`);
    } catch (error) {
      toast.error(kind === 'in' ? 'No se pudo marcar la entrada' : 'No se pudo marcar la salida', errorMessage(error));
      record.reload();
    } finally {
      setBusy(null);
    }
  };

  const r = record.data;
  const status = !r ? (
    <Badge tone="gray" dot>
      Sin marcar
    </Badge>
  ) : r.checkOut ? (
    <Badge tone="green" dot>
      Jornada completa
    </Badge>
  ) : (
    <Badge tone="blue" dot>
      En jornada
    </Badge>
  );

  const clock = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: BUSINESS_TZ }).format(now);
  const dateLabel = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: BUSINESS_TZ }).format(now);

  return (
    <Card title="Mi jornada de hoy" subtitle={capitalize(dateLabel)} actions={status}>
      {record.loading && record.data === undefined ? (
        <LoadingBlock />
      ) : record.error && record.data === undefined ? (
        <ErrorState message={record.error} onRetry={record.reload} />
      ) : (
        <div className="clock-card">
          <div className="clock-time" aria-live="off">
            {clock}
          </div>
          <div className="clock-steps">
            <div className="clock-step">
              <small>Entrada</small>
              <strong>{formatTime(r?.checkIn)}</strong>
            </div>
            <div className="clock-step">
              <small>Salida</small>
              <strong>{formatTime(r?.checkOut)}</strong>
            </div>
          </div>
          {r?.workedMinutes !== undefined && (
            <span className="muted">Tiempo trabajado: {formatMinutes(r.workedMinutes)}</span>
          )}
          <div className="row">
            <Button icon={<LogIn size={16} />} onClick={() => mark('in')} loading={busy === 'in'} disabled={!!r || busy !== null}>
              Marcar entrada
            </Button>
            <Button
              variant="secondary"
              icon={<LogOut size={16} />}
              onClick={() => mark('out')}
              loading={busy === 'out'}
              disabled={!r || !!r.checkOut || busy !== null}
            >
              Marcar salida
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
