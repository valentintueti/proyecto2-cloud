import { useMemo, useState } from 'react';
import { employeesApi } from '../../api/employees';
import type { Department, Employee, EmployeeChanges, EmployeeInput, Position } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Field, FormGrid, Input, Select } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { errorMessage, useAsync } from '../../hooks/useAsync';
import { formatMoney, fullName, todayISO } from '../../utils/format';
import { hasErrors, isDate, isEmail, maxLength, money, required, type Errors } from '../../utils/validation';

interface Form {
  firstName: string;
  lastName: string;
  email: string;
  documentNumber: string;
  phone: string;
  hireDate: string;
  salary: string;
  departmentId: string;
  positionId: string;
  managerId: string;
}

function toForm(e: Employee | null): Form {
  return {
    firstName: e?.firstName ?? '',
    lastName: e?.lastName ?? '',
    email: e?.email ?? '',
    documentNumber: e?.documentNumber ?? '',
    phone: e?.phone ?? '',
    hireDate: e?.hireDate?.slice(0, 10) ?? todayISO(),
    salary: e ? String(e.salary) : '',
    departmentId: e?.departmentId ?? '',
    positionId: e?.positionId ?? '',
    managerId: e?.managerId ?? '',
  };
}

function toInput(f: Form): EmployeeInput {
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    email: f.email.trim().toLowerCase(),
    documentNumber: f.documentNumber.trim(),
    phone: f.phone.trim() || null,
    hireDate: f.hireDate,
    salary: Number(f.salary),
    departmentId: f.departmentId || null,
    positionId: f.positionId || null,
    managerId: f.managerId || null,
  };
}

export function EmployeeFormModal({
  employee,
  departments,
  positions,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  departments: Department[];
  positions: Position[];
  onClose: () => void;
  onSaved: (employee: Employee) => void;
}) {
  const creating = !employee;
  const initial = useMemo(() => toForm(employee), [employee]);
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Errors<Form>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Posibles jefes: empleados activos (la API limita a 100 por página).
  const managers = useAsync(
    (signal) => employeesApi.list({ status: 'ACTIVE', limit: 100, offset: 0 }, signal).then((p) => p.items),
    [],
  );

  const deptPositions = positions.filter((p) => !form.departmentId || p.departmentId === form.departmentId);
  const selectedPosition = positions.find((p) => p.id === form.positionId);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Si cambia el departamento y el puesto no pertenece a él, se limpia.
      if (key === 'departmentId' && next.positionId) {
        const pos = positions.find((p) => p.id === next.positionId);
        if (pos && value && pos.departmentId !== value) next.positionId = '';
      }
      if (key === 'positionId' && value) {
        const pos = positions.find((p) => p.id === value);
        if (pos && !next.departmentId) next.departmentId = pos.departmentId;
      }
      return next;
    });
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = (): Errors<Form> => {
    const e: Errors<Form> = {
      firstName: required(form.firstName, 'El nombre', 80),
      lastName: required(form.lastName, 'El apellido', 80),
      documentNumber: required(form.documentNumber, 'El documento', 20),
      phone: maxLength(form.phone, 'El teléfono', 30),
      salary: money(form.salary, 'El salario'),
    };
    if (creating) {
      if (!form.email.trim()) e.email = 'El email es obligatorio.';
      else if (!isEmail(form.email)) e.email = 'Ingresa un email válido.';
    }
    if (!isDate(form.hireDate)) e.hireDate = 'Ingresa una fecha válida.';
    if (employee && form.managerId === employee.id) e.managerId = 'Un empleado no puede ser su propio jefe.';
    return e;
  };

  const submit = async () => {
    const found = validate();
    setErrors(found);
    if (hasErrors(found)) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const input = toInput(form);
      if (creating) {
        onSaved(await employeesApi.create(input));
      } else {
        // PATCH solo con los campos que cambiaron (email no es editable).
        const before = toInput(initial);
        const changes: EmployeeChanges = {};
        (Object.keys(input) as (keyof EmployeeInput)[]).forEach((key) => {
          if (key === 'email') return;
          if (input[key] !== before[key]) (changes as Record<string, unknown>)[key] = input[key];
        });
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        onSaved(await employeesApi.update(employee.id, changes));
      }
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const managerOptions = (managers.data ?? []).filter((m) => m.id !== employee?.id);
  const currentManagerMissing = form.managerId && !managerOptions.some((m) => m.id === form.managerId);

  return (
    <Modal
      open
      size="lg"
      title={creating ? 'Nuevo empleado' : 'Editar empleado'}
      description={creating ? 'Completa la ficha del nuevo integrante.' : fullName(employee)}
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            {creating ? 'Registrar empleado' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      <FormGrid>
        <Field label="Nombres" error={errors.firstName} required>
          <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} maxLength={80} />
        </Field>
        <Field label="Apellidos" error={errors.lastName} required>
          <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} maxLength={80} />
        </Field>
        <Field
          label="Email corporativo"
          error={errors.email}
          required={creating}
          hint={creating ? 'Será su usuario de acceso.' : 'El email no se puede modificar.'}
        >
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={!creating} />
        </Field>
        <Field label="Documento de identidad" error={errors.documentNumber} required>
          <Input value={form.documentNumber} onChange={(e) => set('documentNumber', e.target.value)} maxLength={20} />
        </Field>
        <Field label="Teléfono" error={errors.phone}>
          <Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} />
        </Field>
        <Field label="Fecha de ingreso" error={errors.hireDate} required>
          <Input type="date" value={form.hireDate} onChange={(e) => set('hireDate', e.target.value)} />
        </Field>
        <Field label="Departamento">
          <Select value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
            <option value="">Sin departamento</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Puesto">
          <Select value={form.positionId} onChange={(e) => set('positionId', e.target.value)}>
            <option value="">Sin puesto</option>
            {deptPositions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {!form.departmentId ? ` · ${p.departmentName}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Salario mensual (S/)"
          error={errors.salary}
          required
          hint={
            selectedPosition && (selectedPosition.minSalary !== null || selectedPosition.maxSalary !== null)
              ? `Rango del puesto: ${formatMoney(selectedPosition.minSalary)} – ${formatMoney(selectedPosition.maxSalary)}`
              : undefined
          }
        >
          <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.salary} onChange={(e) => set('salary', e.target.value)} />
        </Field>
        <Field label="Jefe directo" error={errors.managerId} hint={managers.error ? 'No se pudo cargar la lista de empleados.' : undefined}>
          <Select value={form.managerId} onChange={(e) => set('managerId', e.target.value)} disabled={managers.loading}>
            <option value="">{managers.loading ? 'Cargando…' : 'Sin jefe directo'}</option>
            {currentManagerMissing && <option value={form.managerId}>Jefe actual</option>}
            {managerOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {fullName(m)} · {m.email}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>
    </Modal>
  );
}
