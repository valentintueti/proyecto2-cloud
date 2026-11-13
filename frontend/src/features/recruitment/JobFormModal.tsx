import { useState } from 'react';
import { recruitmentApi } from '../../api/recruitment';
import type { Department, Job, JobInput, JobStatus } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Field, FormGrid, Input, Select, Textarea } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { errorMessage } from '../../hooks/useAsync';
import { hasErrors, maxLength, required, type Errors } from '../../utils/validation';

interface Form {
  title: string;
  description: string;
  location: string;
  openings: string;
  status: JobStatus;
  departmentId: string;
}

export function JobFormModal({
  job,
  departments,
  onClose,
  onSaved,
}: {
  job: Job | null;
  departments: Department[];
  onClose: () => void;
  onSaved: (job: Job) => void;
}) {
  const creating = !job;
  const [form, setForm] = useState<Form>({
    title: job?.title ?? '',
    description: job?.description ?? '',
    location: job?.location ?? '',
    openings: String(job?.openings ?? 1),
    status: job?.status ?? 'OPEN',
    departmentId: job?.departmentId ?? '',
  });
  const [errors, setErrors] = useState<Errors<Form>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const openings = Number(form.openings);
    const found: Errors<Form> = {
      title: required(form.title, 'El título', 150),
      description: maxLength(form.description, 'La descripción', 5000),
      location: maxLength(form.location, 'La ubicación', 100),
      openings: !Number.isInteger(openings) || openings < 1 || openings > 1000 ? 'Debe ser un entero entre 1 y 1000.' : undefined,
    };
    setErrors(found);
    if (hasErrors(found)) return;

    const input: JobInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      openings,
      status: form.status,
    };
    setSaving(true);
    setSubmitError(null);
    try {
      if (creating) {
        if (form.departmentId) input.departmentId = form.departmentId;
        onSaved(await recruitmentApi.createJob(input));
      } else {
        const changes: Partial<JobInput> = {};
        (['title', 'description', 'location', 'openings', 'status'] as const).forEach((key) => {
          if (input[key] !== job[key]) (changes as Record<string, unknown>)[key] = input[key];
        });
        if ((form.departmentId || null) !== (job.departmentId || null)) changes.departmentId = form.departmentId || null;
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        onSaved(await recruitmentApi.updateJob(job.jobId, changes));
      }
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={creating ? 'Nueva vacante' : 'Editar vacante'}
      description={creating ? 'Publica una posición para empezar a registrar postulantes.' : job.title}
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            {creating ? 'Crear vacante' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      <FormGrid>
        <Field label="Título" error={errors.title} required className="span-2">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={150} placeholder="ej. Desarrollador Frontend Senior" />
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
        <Field label="Ubicación" error={errors.location}>
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={100} placeholder="ej. Lima (híbrido)" />
        </Field>
        <Field label="Puestos disponibles" error={errors.openings} required>
          <Input type="number" min={1} max={1000} step={1} value={form.openings} onChange={(e) => set('openings', e.target.value)} />
        </Field>
        <Field label="Estado">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as JobStatus)}>
            <option value="OPEN">Abierta</option>
            <option value="CLOSED">Cerrada</option>
          </Select>
        </Field>
        <Field label="Descripción" error={errors.description} className="span-2" hint={`${form.description.length}/5000`}>
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} rows={6} />
        </Field>
      </FormGrid>
    </Modal>
  );
}
