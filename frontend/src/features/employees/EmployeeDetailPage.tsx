import { ArrowLeft, Briefcase, Building2, CalendarDays, IdCard, Mail, Pencil, Phone, UserMinus, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { employeesApi } from '../../api/employees';
import { identityApi } from '../../api/identity';
import { useSession } from '../../auth/AuthContext';
import { sessionStore } from '../../auth/sessionStore';
import { EmployeeStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { Field, Input } from '../../components/ui/Form';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Avatar, Card, DescriptionList, PageHeader } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { errorMessage, useAsync } from '../../hooks/useAsync';
import { formatDate, formatMoney, fullName, todayISO } from '../../utils/format';
import { isDate } from '../../utils/validation';
import { EmployeeFormModal } from './EmployeeFormModal';
import { useOrgData } from './useOrgData';

/** /employees/me → ficha propia, usando el employeeId del usuario (GET /me). */
export function MyEmployeeRedirect() {
  const { user } = useSession();
  const profile = useAsync(async (signal) => {
    if (user.employeeId) return user;
    const me = await identityApi.me(signal);
    sessionStore.updateUser(me);
    return me;
  }, []);

  if (user.employeeId) return <Navigate to={`/employees/${user.employeeId}`} replace />;
  if (profile.loading) return <LoadingBlock label="Buscando tu ficha…" />;
  if (profile.error) return <ErrorState message={profile.error} onRetry={profile.reload} />;
  if (profile.data?.employeeId) return <Navigate to={`/employees/${profile.data.employeeId}`} replace />;
  return (
    <EmptyState
      icon={<IdCard size={26} />}
      title="Tu usuario no tiene una ficha de empleado vinculada"
      description="Cuando RR. HH. registre tu ficha en Employees, aparecerá aquí automáticamente."
    />
  );
}

export function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const { role, user, can } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [terminationDate, setTerminationDate] = useState(todayISO());
  const [terminateError, setTerminateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // EMPLOYEE solo puede ver su propia ficha: cualquier otra URL redirige al inicio.
  const forbiddenForEmployee = role === 'EMPLOYEE' && user.employeeId !== id;

  const employee = useAsync((signal) => employeesApi.get(id, signal), [id]);
  const org = useOrgData();
  const manager = useAsync(
    async (signal) => {
      const managerId = employee.data?.managerId;
      if (!managerId) return null;
      try {
        return await employeesApi.get(managerId, signal);
      } catch {
        return null; // sin permiso para ver la ficha del jefe: se muestra solo el id
      }
    },
    [employee.data?.managerId],
  );

  useEffect(() => {
    setTerminateError(null);
  }, [terminating]);

  if (forbiddenForEmployee) return <Navigate to="/" replace />;

  const back = can('employees.list') ? (
    <Link to="/employees" className="back-link">
      <ArrowLeft size={14} /> Empleados
    </Link>
  ) : undefined;

  if (employee.loading && !employee.data) return <LoadingBlock label="Cargando ficha…" />;
  if (employee.error || !employee.data) {
    return (
      <>
        <PageHeader title="Ficha de empleado" back={back} />
        <ErrorState message={employee.error ?? 'Empleado no encontrado'} onRetry={employee.status === 403 ? undefined : employee.reload} />
      </>
    );
  }

  const e = employee.data;
  const isActive = e.status === 'ACTIVE';
  const isSelf = e.email === user.email;

  const terminate = async () => {
    if (!isDate(terminationDate)) {
      setTerminateError('Ingresa una fecha válida.');
      return;
    }
    if (terminationDate < e.hireDate.slice(0, 10)) {
      setTerminateError('La fecha de baja no puede ser anterior a la fecha de ingreso.');
      return;
    }
    setBusy(true);
    setTerminateError(null);
    try {
      const updated = await employeesApi.terminate(e.id, terminationDate);
      employee.setData(updated);
      setTerminating(false);
      toast.success('Empleado dado de baja', fullName(updated));
    } catch (error) {
      setTerminateError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="row" style={{ gap: 14 }}>
            <Avatar name={fullName(e)} size={48} />
            <span>
              {fullName(e)}
              {isSelf && <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}> (tú)</span>}
            </span>
          </span>
        }
        description={
          <span className="row" style={{ marginTop: 6 }}>
            <EmployeeStatusBadge status={e.status} />
            <span>
              {e.positionTitle ?? 'Sin puesto'} · {e.departmentName ?? 'Sin departamento'}
            </span>
          </span>
        }
        actions={
          isActive && (
            <>
              {can('employees.update') && (
                <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditing(true)}>
                  Editar
                </Button>
              )}
              {can('employees.terminate') && !isSelf && (
                <Button variant="danger" icon={<UserMinus size={16} />} onClick={() => setTerminating(true)}>
                  Dar de baja
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid grid-main-side">
        <Card title="Información laboral">
          <DescriptionList
            items={[
              { label: 'Puesto', value: e.positionTitle ?? '—' },
              { label: 'Departamento', value: e.departmentName ?? '—' },
              { label: 'Fecha de ingreso', value: formatDate(e.hireDate) },
              { label: 'Fecha de baja', value: e.terminationDate ? formatDate(e.terminationDate) : '—' },
              { label: 'Salario mensual', value: formatMoney(e.salary) },
              {
                label: 'Jefe directo',
                value: !e.managerId
                  ? '—'
                  : manager.data
                    ? can('employees.list') || manager.data.email === user.email
                      ? <Link to={`/employees/${manager.data.id}`}>{fullName(manager.data)}</Link>
                      : fullName(manager.data)
                    : manager.loading
                      ? 'Cargando…'
                      : 'Asignado',
              },
            ]}
          />
        </Card>
        <Card title="Contacto">
          <div className="mini-list">
            <div className="info-row">
              <span className="row">
                <Mail size={15} /> Email
              </span>
              <strong style={{ wordBreak: 'break-all' }}>{e.email}</strong>
            </div>
            <div className="info-row">
              <span className="row">
                <Phone size={15} /> Teléfono
              </span>
              <strong>{e.phone ?? '—'}</strong>
            </div>
            <div className="info-row">
              <span className="row">
                <IdCard size={15} /> Documento
              </span>
              <strong>{e.documentNumber}</strong>
            </div>
            <div className="info-row">
              <span className="row">
                <Building2 size={15} /> Departamento
              </span>
              <strong>{e.departmentName ?? '—'}</strong>
            </div>
            <div className="info-row">
              <span className="row">
                <Briefcase size={15} /> Puesto
              </span>
              <strong>{e.positionTitle ?? '—'}</strong>
            </div>
            <div className="info-row">
              <span className="row">
                <CalendarDays size={15} /> Antigüedad
              </span>
              <strong>{seniority(e.hireDate, e.terminationDate)}</strong>
            </div>
            <div className="info-row">
              <span className="row">
                <Wallet size={15} /> Salario
              </span>
              <strong>{formatMoney(e.salary)}</strong>
            </div>
          </div>
        </Card>
      </div>

      {editing && (
        <EmployeeFormModal
          employee={e}
          departments={org.data?.departments ?? []}
          positions={org.data?.positions ?? []}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            employee.setData(saved);
            setEditing(false);
            toast.success('Ficha actualizada', fullName(saved));
          }}
        />
      )}
      <ConfirmDialog
        open={terminating}
        title="Dar de baja al empleado"
        tone="danger"
        confirmLabel="Dar de baja"
        busy={busy}
        error={terminateError}
        onCancel={() => setTerminating(false)}
        onConfirm={terminate}
        message={
          <>
            <strong>{fullName(e)}</strong> quedará como <strong>de baja</strong> y su usuario se desactivará. Esta acción no se
            puede deshacer desde la plataforma.
          </>
        }
      >
        <Field label="Fecha de baja" required>
          <Input type="date" value={terminationDate} min={e.hireDate.slice(0, 10)} onChange={(ev) => setTerminationDate(ev.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function seniority(hireDate: string, endDate: string | null): string {
  const start = new Date(hireDate.slice(0, 10) + 'T00:00:00Z');
  const end = new Date((endDate ?? todayISO()).slice(0, 10) + 'T00:00:00Z');
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  if (months < 0) return '—';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} ${rest === 1 ? 'mes' : 'meses'}`;
  return `${years} ${years === 1 ? 'año' : 'años'}${rest ? ` y ${rest} ${rest === 1 ? 'mes' : 'meses'}` : ''}`;
}
