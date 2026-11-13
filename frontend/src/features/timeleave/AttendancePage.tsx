import { CalendarCheck, Clock3, Search, Timer, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { timeLeaveApi, type DateRange } from '../../api/timeLeave';
import type { AttendanceRecord } from '../../api/types';
import { useSession } from '../../auth/AuthContext';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Alert } from '../../components/ui/Feedback';
import { Field, Input } from '../../components/ui/Form';
import { Card, PageHeader, StatCard, Toolbar } from '../../components/ui/Page';
import { errorMessage, useAsync } from '../../hooks/useAsync';
import { addDays, formatDate, formatMinutes, formatTime, todayISO } from '../../utils/format';
import { isDate, isEmail } from '../../utils/validation';
import { TodayAttendanceCard } from './TodayAttendanceCard';

const columns: Column<AttendanceRecord>[] = [
  { key: 'date', header: 'Fecha', render: (r) => <strong className="nowrap">{formatDate(r.date)}</strong> },
  { key: 'in', header: 'Entrada', render: (r) => formatTime(r.checkIn) },
  { key: 'out', header: 'Salida', render: (r) => (r.checkOut ? formatTime(r.checkOut) : <Badge tone="blue">En curso</Badge>) },
  { key: 'worked', header: 'Trabajado', align: 'right', render: (r) => formatMinutes(r.workedMinutes) },
];

function sortDesc(items: AttendanceRecord[]) {
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

function rangeError(range: DateRange): string | null {
  if (range.from && !isDate(range.from)) return 'La fecha "desde" no es válida.';
  if (range.to && !isDate(range.to)) return 'La fecha "hasta" no es válida.';
  if (range.from && range.to && range.to < range.from) return 'La fecha "hasta" debe ser mayor o igual a "desde".';
  return null;
}

function RangeFields({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <>
      <Field label="Desde">
        <Input type="date" value={range.from ?? ''} max={range.to} onChange={(e) => onChange({ ...range, from: e.target.value })} />
      </Field>
      <Field label="Hasta">
        <Input type="date" value={range.to ?? ''} min={range.from} onChange={(e) => onChange({ ...range, to: e.target.value })} />
      </Field>
    </>
  );
}

export function AttendancePage() {
  const { can } = useSession();
  const today = todayISO();
  const [range, setRange] = useState<DateRange>({ from: addDays(today, -30), to: today });
  const invalid = rangeError(range);
  const mine = useAsync(
    async (signal) => (invalid ? [] : sortDesc((await timeLeaveApi.myAttendance(range, signal)).items)),
    [range.from, range.to, invalid],
  );

  const records = mine.data ?? [];
  const complete = records.filter((r) => r.workedMinutes !== undefined);
  const totalMinutes = complete.reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0);
  const average = complete.length ? Math.round(totalMinutes / complete.length) : null;

  return (
    <>
      <PageHeader title="Asistencia" description="Marca tu entrada y salida y revisa tu historial. Las horas se registran en hora de Lima." />
      <div className="stack">
        <div className="grid grid-main-side">
          <TodayAttendanceCard onChange={() => mine.reload()} />
          <div className="stack" style={{ gap: 16 }}>
            <StatCard icon={<CalendarCheck size={20} />} label="Días registrados" value={records.length} hint="En el rango seleccionado" />
            <StatCard icon={<Clock3 size={20} />} tone="green" label="Horas trabajadas" value={formatMinutes(totalMinutes)} />
            <StatCard icon={<Timer size={20} />} tone="sky" label="Promedio por día" value={formatMinutes(average)} />
          </div>
        </div>

        <Card title="Mi historial" padded={false}>
          <Toolbar>
            <RangeFields range={range} onChange={setRange} />
          </Toolbar>
          {invalid ? (
            <div className="card-body">
              <Alert tone="warning">{invalid}</Alert>
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={records}
              rowKey={(r) => r.date}
              loading={mine.loading}
              error={mine.error}
              onRetry={mine.reload}
              empty={{ title: 'Sin marcaciones', description: 'No hay registros de asistencia en este rango.', icon: <CalendarCheck size={26} /> }}
            />
          )}
        </Card>

        {can('attendance.others') && <TeamAttendance />}
      </div>
    </>
  );
}

function TeamAttendance() {
  const today = todayISO();
  const [email, setEmail] = useState('');
  const [range, setRange] = useState<DateRange>({ from: addDays(today, -30), to: today });
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [searchedEmail, setSearchedEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    const target = email.trim().toLowerCase();
    if (!isEmail(target)) {
      setFormError('Ingresa el email de un empleado.');
      return;
    }
    const invalid = rangeError(range);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setFormError(null);
    setLoading(true);
    setError(null);
    try {
      const result = await timeLeaveApi.attendanceOf(target, range);
      setRecords(sortDesc(result.items));
      setSearchedEmail(target);
    } catch (err) {
      setRecords([]);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Asistencia de un empleado" subtitle="Consulta las marcaciones de una persona por email." padded={false}>
      <form onSubmit={search} noValidate>
        <Toolbar>
          <Field label="Email del empleado" className="grow" error={formError ?? undefined}>
            <div className="input-icon">
              <Users size={16} />
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
            </div>
          </Field>
          <RangeFields range={range} onChange={setRange} />
          <Button type="submit" icon={<Search size={16} />} loading={loading}>
            Consultar
          </Button>
        </Toolbar>
      </form>
      {records === null && !error ? (
        <div className="card-body muted">Ingresa un email y un rango de fechas para ver su asistencia.</div>
      ) : (
        <>
          {searchedEmail && !error && (
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <span className="muted">
                Resultados para <strong>{searchedEmail}</strong>: {records?.length ?? 0} días
              </span>
            </div>
          )}
          <DataTable
            columns={columns}
            rows={records ?? []}
            rowKey={(r) => r.date}
            loading={loading}
            error={error}
            onRetry={() => search()}
            empty={{ title: 'Sin marcaciones', description: 'Esta persona no tiene registros en el rango elegido.', icon: <CalendarCheck size={26} /> }}
          />
        </>
      )}
    </Card>
  );
}
