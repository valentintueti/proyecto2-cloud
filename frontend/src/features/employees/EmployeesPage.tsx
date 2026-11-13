import { Plus, Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { employeesApi } from '../../api/employees';
import type { Employee, EmployeeStatus } from '../../api/types';
import { useSession } from '../../auth/AuthContext';
import { EmployeeStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Alert } from '../../components/ui/Feedback';
import { Field, Input, Select } from '../../components/ui/Form';
import { Avatar, Card, OffsetPagination, PageHeader, Toolbar } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { formatDate, fullName } from '../../utils/format';
import { EmployeeFormModal } from './EmployeeFormModal';
import { useOrgData } from './useOrgData';

const PAGE_SIZE = 20;

export function EmployeesPage() {
  const { can, role } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const org = useOrgData();
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState<EmployeeStatus | ''>('ACTIVE');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const search = useDebounced(q);

  useEffect(() => setOffset(0), [search, departmentId, status]);

  const page = useAsync(
    (signal) => employeesApi.list({ limit: PAGE_SIZE, offset, q: search, departmentId, status }, signal),
    [offset, search, departmentId, status],
  );

  const columns: Column<Employee>[] = [
    {
      key: 'name',
      header: 'Empleado',
      render: (e) => (
        <div className="cell-main">
          <Avatar name={fullName(e)} size={34} />
          <div>
            <strong>{fullName(e)}</strong>
            <span>{e.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'position',
      header: 'Puesto',
      render: (e) => (
        <div className="cell-main">
          <div>
            <strong style={{ fontWeight: 500 }}>{e.positionTitle ?? '—'}</strong>
            <span>{e.departmentName ?? 'Sin departamento'}</span>
          </div>
        </div>
      ),
    },
    { key: 'hire', header: 'Ingreso', hideOnMobile: true, render: (e) => <span className="nowrap">{formatDate(e.hireDate)}</span> },
    { key: 'status', header: 'Estado', render: (e) => <EmployeeStatusBadge status={e.status} /> },
  ];

  const filtersActive = !!(search || departmentId || status !== 'ACTIVE');

  return (
    <>
      <PageHeader
        title="Empleados"
        description={role === 'MANAGER' ? 'Las personas de tu equipo (tus reportes directos).' : 'Directorio de empleados de la empresa.'}
        actions={
          can('employees.create') && (
            <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Nuevo empleado
            </Button>
          )
        }
      />
      {org.error && <Alert tone="warning">No se pudieron cargar los departamentos: {org.error}</Alert>}
      <Card padded={false}>
        <Toolbar>
          <Field label="Buscar" className="grow">
            <div className="input-icon">
              <Search size={16} />
              <Input
                type="search"
                placeholder="Nombre, apellido o email"
                value={q}
                maxLength={100}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </Field>
          <Field label="Departamento">
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Todos</option>
              {org.data?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={status} onChange={(e) => setStatus(e.target.value as EmployeeStatus | '')}>
              <option value="">Todos</option>
              <option value="ACTIVE">Activos</option>
              <option value="TERMINATED">De baja</option>
            </Select>
          </Field>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={page.data?.items ?? []}
          rowKey={(e) => e.id}
          loading={page.loading}
          error={page.error}
          onRetry={page.reload}
          onRowClick={(e) => navigate(`/employees/${e.id}`)}
          empty={{
            title: filtersActive ? 'Sin coincidencias' : 'Aún no hay empleados',
            description: filtersActive
              ? 'Prueba con otra búsqueda o cambia los filtros.'
              : role === 'MANAGER'
                ? 'No tienes reportes directos asignados.'
                : 'Registra al primer empleado de la empresa.',
            icon: <Users size={26} />,
          }}
          footer={
            page.data && (
              <OffsetPagination
                total={page.data.total}
                limit={page.data.limit}
                offset={page.data.offset}
                onChange={setOffset}
                disabled={page.loading}
              />
            )
          }
        />
      </Card>
      {creating && (
        <EmployeeFormModal
          employee={null}
          departments={org.data?.departments ?? []}
          positions={org.data?.positions ?? []}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            toast.success('Empleado registrado', fullName(saved));
            navigate(`/employees/${saved.id}`);
          }}
        />
      )}
    </>
  );
}
