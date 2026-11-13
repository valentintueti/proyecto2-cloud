import { Briefcase, Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { employeesApi } from '../../api/employees';
import type { Department, Position } from '../../api/types';
import { useSession } from '../../auth/AuthContext';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Alert } from '../../components/ui/Feedback';
import { Field, FormGrid, Input, Select } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { Card, PageHeader, Tabs, Toolbar } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../hooks/useAsync';
import { formatDate, formatMoney } from '../../utils/format';
import { hasErrors, money, required, type Errors } from '../../utils/validation';
import { useOrgData } from './useOrgData';

type Tab = 'departments' | 'positions';

export function OrganizationPage() {
  const { can } = useSession();
  const toast = useToast();
  const org = useOrgData();
  const [tab, setTab] = useState<Tab>('departments');
  const [filterDept, setFilterDept] = useState('');
  const [modal, setModal] = useState<Tab | null>(null);

  const departments = org.data?.departments ?? [];
  const positions = org.data?.positions ?? [];
  const countByDept = positions.reduce<Record<string, number>>((acc, p) => {
    acc[p.departmentId] = (acc[p.departmentId] ?? 0) + 1;
    return acc;
  }, {});

  const deptColumns: Column<Department>[] = [
    {
      key: 'name',
      header: 'Departamento',
      render: (d) => (
        <div className="cell-main">
          <span className="stat-icon" style={{ width: 34, height: 34, background: 'var(--primary-50)', color: 'var(--primary)' }}>
            <Building2 size={16} />
          </span>
          <strong>{d.name}</strong>
        </div>
      ),
    },
    { key: 'positions', header: 'Puestos', render: (d) => <Badge tone="blue">{countByDept[d.id] ?? 0}</Badge> },
    { key: 'created', header: 'Creado', hideOnMobile: true, render: (d) => formatDate(d.createdAt) },
  ];

  const posColumns: Column<Position>[] = [
    { key: 'title', header: 'Puesto', render: (p) => <strong>{p.title}</strong> },
    { key: 'dept', header: 'Departamento', render: (p) => p.departmentName },
    {
      key: 'range',
      header: 'Rango salarial',
      render: (p) =>
        p.minSalary === null && p.maxSalary === null ? (
          <span className="muted">No definido</span>
        ) : (
          <span className="nowrap">
            {formatMoney(p.minSalary)} – {formatMoney(p.maxSalary)}
          </span>
        ),
    },
  ];

  const visiblePositions = positions.filter((p) => !filterDept || p.departmentId === filterDept);

  return (
    <>
      <PageHeader
        title="Departamentos y puestos"
        description="Estructura organizacional de la empresa."
        actions={
          can('org.create') && (
            <>
              <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setModal('departments')}>
                Departamento
              </Button>
              <Button icon={<Plus size={16} />} onClick={() => setModal('positions')} disabled={departments.length === 0}>
                Puesto
              </Button>
            </>
          )
        }
      />
      <div className="stack">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'departments', label: 'Departamentos', count: departments.length },
            { value: 'positions', label: 'Puestos', count: positions.length },
          ]}
        />
        <Card padded={false}>
          {tab === 'departments' ? (
            <DataTable
              columns={deptColumns}
              rows={departments}
              rowKey={(d) => d.id}
              loading={org.loading}
              error={org.error}
              onRetry={org.reload}
              onRowClick={(d) => {
                setFilterDept(d.id);
                setTab('positions');
              }}
              empty={{
                title: 'Sin departamentos',
                description: can('org.create') ? 'Crea el primer departamento.' : 'RR. HH. aún no ha creado departamentos.',
                icon: <Building2 size={26} />,
              }}
            />
          ) : (
            <>
              <Toolbar>
                <Field label="Departamento">
                  <Select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                    <option value="">Todos</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </Toolbar>
              <DataTable
                columns={posColumns}
                rows={visiblePositions}
                rowKey={(p) => p.id}
                loading={org.loading}
                error={org.error}
                onRetry={org.reload}
                empty={{ title: 'Sin puestos', description: 'No hay puestos para este filtro.', icon: <Briefcase size={26} /> }}
              />
            </>
          )}
        </Card>
      </div>

      {modal === 'departments' && (
        <DepartmentModal
          onClose={() => setModal(null)}
          onSaved={(d) => {
            org.setData((prev) => ({ departments: [...(prev?.departments ?? []), d].sort((a, b) => a.name.localeCompare(b.name)), positions: prev?.positions ?? [] }));
            toast.success('Departamento creado', d.name);
            setModal(null);
            setTab('departments');
          }}
        />
      )}
      {modal === 'positions' && (
        <PositionModal
          departments={departments}
          defaultDepartment={filterDept}
          onClose={() => setModal(null)}
          onSaved={(p) => {
            org.setData((prev) => ({ departments: prev?.departments ?? [], positions: [...(prev?.positions ?? []), p] }));
            toast.success('Puesto creado', p.title);
            setModal(null);
            setTab('positions');
          }}
        />
      )}
    </>
  );
}

function DepartmentModal({ onClose, onSaved }: { onClose: () => void; onSaved: (d: Department) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const found = required(name, 'El nombre', 100);
    setError(found);
    if (found) return;
    setSaving(true);
    setSubmitError(null);
    try {
      onSaved(await employeesApi.createDepartment(name.trim()));
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      size="sm"
      title="Nuevo departamento"
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Crear
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      <Field label="Nombre" error={error} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="ej. Tecnología" />
      </Field>
    </Modal>
  );
}

interface PositionForm {
  title: string;
  departmentId: string;
  minSalary: string;
  maxSalary: string;
}

function PositionModal({
  departments,
  defaultDepartment,
  onClose,
  onSaved,
}: {
  departments: Department[];
  defaultDepartment: string;
  onClose: () => void;
  onSaved: (p: Position) => void;
}) {
  const [form, setForm] = useState<PositionForm>({ title: '', departmentId: defaultDepartment, minSalary: '', maxSalary: '' });
  const [errors, setErrors] = useState<Errors<PositionForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof PositionForm, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const found: Errors<PositionForm> = {
      title: required(form.title, 'El título', 100),
      departmentId: form.departmentId ? undefined : 'Selecciona un departamento.',
      minSalary: money(form.minSalary, 'El mínimo', { optional: true }),
      maxSalary: money(form.maxSalary, 'El máximo', { optional: true }),
    };
    if (!found.minSalary && !found.maxSalary && form.minSalary && form.maxSalary && Number(form.minSalary) > Number(form.maxSalary)) {
      found.maxSalary = 'El máximo debe ser mayor o igual al mínimo.';
    }
    setErrors(found);
    if (hasErrors(found)) return;
    setSaving(true);
    setSubmitError(null);
    try {
      onSaved(
        await employeesApi.createPosition({
          title: form.title.trim(),
          departmentId: form.departmentId,
          minSalary: form.minSalary ? Number(form.minSalary) : null,
          maxSalary: form.maxSalary ? Number(form.maxSalary) : null,
        }),
      );
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Nuevo puesto"
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Crear
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      <FormGrid>
        <Field label="Título del puesto" error={errors.title} required className="span-2">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={100} />
        </Field>
        <Field label="Departamento" error={errors.departmentId} required className="span-2">
          <Select value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
            <option value="">Selecciona…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Salario mínimo (S/)" error={errors.minSalary}>
          <Input type="number" min={0} step="0.01" value={form.minSalary} onChange={(e) => set('minSalary', e.target.value)} />
        </Field>
        <Field label="Salario máximo (S/)" error={errors.maxSalary}>
          <Input type="number" min={0} step="0.01" value={form.maxSalary} onChange={(e) => set('maxSalary', e.target.value)} />
        </Field>
      </FormGrid>
    </Modal>
  );
}
