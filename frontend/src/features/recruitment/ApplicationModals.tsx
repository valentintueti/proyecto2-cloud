import { ArrowRight, FileUp, FileText } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { CV_CONTENT_TYPE, allowedTransitions, recruitmentApi } from '../../api/recruitment';
import type { Application, Stage, StageChangeRequest } from '../../api/types';
import { STAGE_LABEL, StageBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Field, FormGrid, Input, Textarea } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { errorMessage } from '../../hooks/useAsync';
import { fullName, todayISO } from '../../utils/format';
import { hasErrors, isDate, isEmail, isPhone, maxLength, money, required, type Errors } from '../../utils/validation';

export const MAX_CV_BYTES = 10 * 1024 * 1024;

interface ApplicantForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
}

export function ApplicationFormModal({
  jobId,
  onClose,
  onSaved,
}: {
  jobId: string;
  onClose: () => void;
  onSaved: (app: Application, cv: File | null) => void;
}) {
  const [form, setForm] = useState<ApplicantForm>({ firstName: '', lastName: '', email: '', phone: '', notes: '' });
  const [cv, setCv] = useState<File | null>(null);
  const [cvError, setCvError] = useState<string>();
  const [errors, setErrors] = useState<Errors<ApplicantForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof ApplicantForm, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const found: Errors<ApplicantForm> = {
      firstName: required(form.firstName, 'El nombre', 100),
      lastName: required(form.lastName, 'El apellido', 100),
      email: !form.email.trim() ? 'El email es obligatorio.' : !isEmail(form.email) ? 'Ingresa un email válido.' : undefined,
      phone: form.phone.trim() && !isPhone(form.phone) ? 'Teléfono inválido (6 a 20 dígitos, puede iniciar con +).' : undefined,
      notes: maxLength(form.notes, 'Las notas', 2000),
    };
    setErrors(found);
    if (hasErrors(found) || cvError) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const app = await recruitmentApi.createApplication(jobId, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      onSaved(app, cv);
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
      title="Registrar postulante"
      description="El postulante entra en la etapa “Postulado”."
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Registrar
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      <FormGrid>
        <Field label="Nombres" error={errors.firstName} required>
          <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} maxLength={100} />
        </Field>
        <Field label="Apellidos" error={errors.lastName} required>
          <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} maxLength={100} />
        </Field>
        <Field label="Email" error={errors.email} required>
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Teléfono" error={errors.phone}>
          <Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={20} placeholder="+51 987 654 321" />
        </Field>
        <Field label="Notas" error={errors.notes} className="span-2">
          <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} rows={3} />
        </Field>
        <div className="span-2">
          <CvPicker file={cv} error={cvError} onChange={(file, err) => {
            setCv(file);
            setCvError(err);
          }} />
        </div>
      </FormGrid>
    </Modal>
  );
}

function validateCv(file: File): string | undefined {
  const isPdf = file.type === CV_CONTENT_TYPE || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'Solo se aceptan archivos PDF.';
  if (file.size > MAX_CV_BYTES) return 'El archivo supera los 10 MB.';
  if (file.size === 0) return 'El archivo está vacío.';
  return undefined;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CvPicker({
  file,
  error,
  onChange,
  label = 'CV (PDF, opcional)',
}: {
  file: File | null;
  error?: string;
  onChange: (file: File | null, error?: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = (selected?: File | null) => {
    if (!selected) return;
    onChange(selected, validateCv(selected));
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files?.[0]);
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div
        className={`file-drop${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {file ? <FileText size={22} /> : <FileUp size={22} />}
        <strong>{file ? file.name : 'Arrastra el PDF aquí o haz clic para elegirlo'}</strong>
        <span className="muted">{file ? formatSize(file.size) : 'Máximo 10 MB'}</span>
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function CvUploadModal({
  application,
  onClose,
  onUploaded,
}: {
  application: Application;
  onClose: () => void;
  onUploaded: (cvKey: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const submit = async () => {
    if (!file) {
      setError('Selecciona un archivo PDF.');
      return;
    }
    if (error) return;
    setUploading(true);
    setSubmitError(null);
    try {
      onUploaded(await recruitmentApi.uploadCv(application.jobId, application.applicationId, file));
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open
      title={application.cvKey ? 'Reemplazar CV' : 'Subir CV'}
      description={`${fullName(application)} · ${application.email}`}
      onClose={onClose}
      onSubmit={submit}
      busy={uploading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            Cancelar
          </Button>
          <Button type="submit" loading={uploading} icon={<FileUp size={16} />}>
            Subir PDF
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      {application.cvKey && <Alert tone="info">El postulante ya tiene un CV; el nuevo archivo lo reemplazará.</Alert>}
      <CvPicker
        label="Archivo PDF"
        file={file}
        error={error}
        onChange={(f, err) => {
          setFile(f);
          setError(err);
        }}
      />
      <p className="muted" style={{ fontSize: 12.5 }}>
        El archivo se sube directo a S3 con una URL temporal firmada por el servicio de Recruitment.
      </p>
    </Modal>
  );
}

export function StageModal({
  application,
  onClose,
  onChanged,
}: {
  application: Application;
  onClose: () => void;
  onChanged: (app: Application) => void;
}) {
  const options = allowedTransitions(application.stage);
  const [target, setTarget] = useState<Stage | ''>(options[0] ?? '');
  const [notes, setNotes] = useState(application.notes ?? '');
  const [startDate, setStartDate] = useState(todayISO());
  const [salary, setSalary] = useState('');
  const [errors, setErrors] = useState<{ notes?: string; startDate?: string; salary?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!target) return;
    const found = {
      notes: maxLength(notes, 'Las notas', 2000),
      startDate: target === 'HIRED' && !isDate(startDate) ? 'Ingresa una fecha válida.' : undefined,
      salary: target === 'HIRED' ? money(salary, 'El salario', { optional: true }) : undefined,
    };
    setErrors(found);
    if (found.notes || found.startDate || found.salary) return;
    const body: StageChangeRequest = { stage: target };
    if (notes.trim() !== (application.notes ?? '').trim()) body.notes = notes.trim();
    if (target === 'HIRED') {
      body.startDate = startDate;
      if (salary.trim()) body.salary = Number(salary);
    }
    setSaving(true);
    setSubmitError(null);
    try {
      onChanged(await recruitmentApi.changeStage(application.jobId, application.applicationId, body));
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Mover de etapa"
      description={`${fullName(application)} · ${application.email}`}
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={!target}
            variant={target === 'REJECTED' ? 'danger' : target === 'HIRED' ? 'success' : 'primary'}
          >
            {target ? `Mover a ${STAGE_LABEL[target]}` : 'Mover'}
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      {options.length === 0 ? (
        <Alert tone="info">La postulación está en una etapa final ({STAGE_LABEL[application.stage]}).</Alert>
      ) : (
        <>
          <div className="row">
            <span className="muted">Etapa actual:</span> <StageBadge stage={application.stage} />
          </div>
          <div className="option-cards" role="radiogroup" aria-label="Nueva etapa">
            {options.map((stage) => (
              <label key={stage} className="option-card">
                <input type="radio" name="stage" value={stage} checked={target === stage} onChange={() => setTarget(stage)} />
                <ArrowRight size={16} className="muted" />
                <StageBadge stage={stage} />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {stage === 'REJECTED'
                    ? 'Descarta al postulante (etapa final).'
                    : stage === 'HIRED'
                      ? 'Contrata y descuenta un puesto de la vacante.'
                      : 'Avanza a la siguiente etapa del proceso.'}
                </span>
              </label>
            ))}
          </div>
          {target === 'HIRED' && (
            <>
              <Alert tone="success">
                Al contratar se crea automáticamente la ficha del empleado (evento CandidateHired) y la vacante descuenta un puesto.
              </Alert>
              <FormGrid>
                <Field label="Fecha de inicio" error={errors.startDate} required>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label="Salario ofrecido (S/)" error={errors.salary} hint="Opcional">
                  <Input type="number" min={0} step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} />
                </Field>
              </FormGrid>
            </>
          )}
          <Field label="Notas" error={errors.notes}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
          </Field>
        </>
      )}
    </Modal>
  );
}
