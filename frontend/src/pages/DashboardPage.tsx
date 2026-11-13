import {
  Briefcase,
  Building,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  Clock,
  IdCard,
  Palmtree,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { employeesApi } from '../api/employees';
import { recruitmentApi } from '../api/recruitment';
import { timeLeaveApi } from '../api/timeLeave';
import { useSession } from '../auth/AuthContext';
import type { Permission } from '../auth/permissions';
import { ROLE_LABEL } from '../auth/permissions';
import { LEAVE_TYPE_LABEL } from '../components/ui/Badge';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../components/ui/Feedback';
import { Card, StatCard } from '../components/ui/Page';
import { useAsync } from '../hooks/useAsync';
import { BUSINESS_TZ, capitalize, formatDate } from '../utils/format';
import { TodayAttendanceCard } from '../features/timeleave/TodayAttendanceCard';

type Tone = 'indigo' | 'green' | 'amber' | 'rose' | 'sky';

/** Tarjeta de métrica que carga su propio dato: si un servicio falla, el resto del dashboard sigue funcionando. */
function MetricCard<T>({
  label,
  icon,
  tone,
  load,
  render,
  hint,
}: {
  label: string;
  icon: ReactNode;
  tone?: Tone;
  load: (signal: AbortSignal) => Promise<T>;
  render: (data: T) => ReactNode;
  hint?: (data: T) => ReactNode;
}) {
  const state = useAsync(load, []);
  const value = state.loading ? <span className="skeleton" style={{ width: 48, height: 22, display: 'inline-block' }} /> : state.error ? '—' : render(state.data as T);
  const sub = state.error ? <span title={state.error}>No disponible</span> : state.data !== undefined && hint ? hint(state.data) : undefined;
  return <StatCard label={label} icon={icon} tone={tone} value={value} hint={sub} />;
}

interface QuickAction {
  to: string;
  title: string;
  text: string;
  icon: LucideIcon;
  permission: Permission;
}

const QUICK_ACTIONS: QuickAction[] = [
  { to: '/leave', title: 'Solicitar días libres', text: 'Vacaciones o permisos', icon: CalendarPlus, permission: 'leave.self' },
  { to: '/attendance', title: 'Mi asistencia', text: 'Historial de marcaciones', icon: Clock, permission: 'attendance.self' },
  { to: '/employees/me', title: 'Mi ficha', text: 'Datos laborales', icon: IdCard, permission: 'employees.view' },
  { to: '/approvals', title: 'Aprobar solicitudes', text: 'Bandeja de pendientes', icon: ClipboardCheck, permission: 'leave.approve' },
  { to: '/employees', title: 'Empleados', text: 'Directorio y fichas', icon: Users, permission: 'employees.list' },
  { to: '/jobs', title: 'Vacantes', text: 'Procesos de selección', icon: Briefcase, permission: 'jobs.list' },
  { to: '/users', title: 'Usuarios y roles', text: 'Accesos a la plataforma', icon: ShieldCheck, permission: 'users.list' },
];

export function DashboardPage() {
  const { user, role, tenantId, can } = useSession();
  const location = useLocation();
  const denied = (location.state as { denied?: boolean } | null)?.denied;
  const firstName = user.name.split(' ')[0] || user.name;
  const today = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: BUSINESS_TZ }).format(new Date());
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: BUSINESS_TZ }).format(new Date()));
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <>
      {denied && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warning">No tienes permiso para acceder a esa sección con tu rol actual.</Alert>
        </div>
      )}
      <section className="welcome">
        <div>
          <h1>
            {greeting}, {firstName}
          </h1>
          <p>{capitalize(today)}</p>
        </div>
        <div className="welcome-meta">
          <span className="welcome-chip">
            <Building size={14} /> {tenantId}
          </span>
          <span className="welcome-chip">
            <ShieldCheck size={14} /> {ROLE_LABEL[role]}
          </span>
        </div>
      </section>

      <div className="stack">
        <div className="grid grid-4">
          <MetricCard
            label="Vacaciones disponibles"
            icon={<Palmtree size={20} />}
            tone="green"
            load={(signal) => timeLeaveApi.myBalance(signal)}
            render={(b) => `${b.availableDays} días`}
            hint={(b) => `${b.usedDays} usados de ${b.vacationDays} (${b.year})`}
          />
          <MetricCard
            label="Mis solicitudes pendientes"
            icon={<CalendarDays size={20} />}
            tone="amber"
            load={(signal) => timeLeaveApi.myLeaves({ limit: 50 }, signal)}
            render={(page) => page.items.filter((l) => l.status === 'PENDING').length}
            hint={() => 'Esperando aprobación'}
          />
          {can('leave.approve') ? (
            <MetricCard
              label="Por aprobar"
              icon={<ClipboardCheck size={20} />}
              tone="rose"
              load={(signal) => timeLeaveApi.pendingLeaves({ limit: 50 }, signal)}
              render={(page) => `${page.items.length}${page.nextCursor ? '+' : ''}`}
              hint={() => 'Solicitudes de tu equipo'}
            />
          ) : (
            <MetricCard
              label="Vacantes abiertas"
              icon={<Briefcase size={20} />}
              tone="sky"
              load={(signal) => recruitmentApi.listJobs({ status: 'OPEN', limit: 50 }, signal)}
              render={(page) => `${page.items.length}${page.nextCursor ? '+' : ''}`}
              hint={() => 'En la empresa'}
            />
          )}
          {can('employees.list') ? (
            <MetricCard
              label={role === 'MANAGER' ? 'Mi equipo' : 'Empleados activos'}
              icon={<Users size={20} />}
              load={(signal) => employeesApi.list({ status: 'ACTIVE', limit: 1, offset: 0 }, signal)}
              render={(page) => page.total}
              hint={() => (role === 'MANAGER' ? 'Reportes directos activos' : 'En la empresa')}
            />
          ) : (
            <MetricCard
              label="Días trabajados (mes)"
              icon={<Clock size={20} />}
              load={(signal) => {
                const now = new Date();
                const first = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit' }).format(now) + '-01';
                return timeLeaveApi.myAttendance({ from: first }, signal);
              }}
              render={(r) => r.items.length}
              hint={() => 'Desde el 1 del mes'}
            />
          )}
        </div>

        <div className="grid grid-main-side" style={{ alignItems: 'start' }}>
          <div className="stack">
            <Card title="Accesos rápidos">
              <div className="quick-actions">
                {QUICK_ACTIONS.filter((a) => can(a.permission)).map(({ to, title, text, icon: Icon }) => (
                  <Link key={to} to={to} className="quick-action">
                    <span className="qa-icon">
                      <Icon size={18} />
                    </span>
                    <span>
                      <strong>{title}</strong>
                      <span>{text}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
            {can('leave.approve') ? <PendingPreview /> : <OpenJobsPreview />}
          </div>
          <TodayAttendanceCard />
        </div>
      </div>
    </>
  );
}

function PendingPreview() {
  const { user } = useSession();
  const pending = useAsync((signal) => timeLeaveApi.pendingLeaves({ limit: 5 }, signal), []);
  return (
    <Card title="Solicitudes por aprobar" actions={<Link to="/approvals">Ver bandeja</Link>} padded={false}>
      {pending.loading ? (
        <LoadingBlock />
      ) : pending.error ? (
        <ErrorState message={pending.error} onRetry={pending.reload} />
      ) : pending.data!.items.length === 0 ? (
        <EmptyState icon={<ClipboardCheck size={26} />} title="Bandeja al día" description="No hay solicitudes pendientes." />
      ) : (
        <div className="mini-list">
          {pending.data!.items.map((l) => (
            <div key={l.requestId} className="mini-item">
              <div className="cell-main">
                <div>
                  <strong style={{ wordBreak: 'break-all' }}>
                    {l.email}
                    {l.email === user.email && <span className="muted"> (tú)</span>}
                  </strong>
                  <span>
                    {LEAVE_TYPE_LABEL[l.type]} · {formatDate(l.startDate)} – {formatDate(l.endDate)}
                  </span>
                </div>
              </div>
              <strong className="nowrap">{l.days} días</strong>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function OpenJobsPreview() {
  const jobs = useAsync((signal) => recruitmentApi.listJobs({ status: 'OPEN', limit: 5 }, signal), []);
  return (
    <Card title="Vacantes abiertas" actions={<Link to="/jobs">Ver todas</Link>} padded={false}>
      {jobs.loading ? (
        <LoadingBlock />
      ) : jobs.error ? (
        <ErrorState message={jobs.error} onRetry={jobs.reload} />
      ) : jobs.data!.items.length === 0 ? (
        <EmptyState icon={<UserPlus size={26} />} title="Sin vacantes abiertas" description="Vuelve más tarde para ver nuevas posiciones." />
      ) : (
        <div className="mini-list">
          {jobs.data!.items.map((j) => (
            <Link key={j.jobId} to={`/jobs/${j.jobId}`} className="mini-item" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="cell-main">
                <div>
                  <strong>{j.title}</strong>
                  <span>{j.location || 'Ubicación no indicada'}</span>
                </div>
              </div>
              <span className="muted nowrap">{j.openings} {j.openings === 1 ? 'puesto' : 'puestos'}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
