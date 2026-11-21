import { Download, Loader2, RotateCcw } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { ApiError } from '../../api/http';
import { isRunActive, payrollApi } from '../../api/payroll';
import type { PayrollRun, Payslip } from '../../api/types';
import { RUN_STATUS_LABEL } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Field, Input } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../hooks/useAsync';
import { EXPIRED_LINK_HINT, openFreshDownload } from '../../utils/download';
import { currentPeriod, formatPeriod, validatePeriod } from '../../utils/format';

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Avance real: solo el número de empleados procesados (el backend no expone un total esperado). */
export function RunProgress({ run }: { run: PayrollRun }) {
  if (!isRunActive(run.status)) return null;
  return (
    <div className="run-progress" role="status" aria-live="polite">
      <Loader2 size={16} className="spin" />
      <span>
        {RUN_STATUS_LABEL[run.status]} · <strong>{plural(run.processed, 'empleado procesado', 'empleados procesados')}</strong>
      </span>
      <span className="run-progress-bar" aria-hidden>
        <span />
      </span>
    </div>
  );
}

/**
 * Reintento de una corrida FAILED: POST /payroll-runs con el mismo periodo (el backend continúa
 * desde donde se quedó). Bloquea dobles envíos con un ref además del estado.
 */
export function useRunRetry(onAccepted: (run: Pick<PayrollRun, 'runId' | 'period' | 'status'>) => void) {
  const toast = useToast();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const retry = async (run: PayrollRun) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRetrying(run.runId);
    setError(null);
    try {
      const accepted = await payrollApi.createRun(run.period);
      onAccepted(accepted);
      toast.success('Reintento aceptado', `La planilla de ${formatPeriod(run.period)} se está calculando de nuevo.`);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(err instanceof ApiError && err.status === 409 ? 'La corrida ya existe' : 'No se pudo reintentar', message);
    } finally {
      inFlight.current = false;
      setRetrying(null);
    }
  };

  return { retry, retrying, error, clearError: () => setError(null) };
}

export function RetryButton({ run, busy, onRetry, compact }: { run: PayrollRun; busy: boolean; onRetry: (run: PayrollRun) => void; compact?: boolean }) {
  if (run.status !== 'FAILED') return null;
  return (
    <Button
      size="sm"
      variant={compact ? 'secondary' : 'primary'}
      icon={<RotateCcw size={15} />}
      loading={busy}
      onClick={(event) => {
        event.stopPropagation();
        onRetry(run);
      }}
    >
      Reintentar
    </Button>
  );
}

/** Descargar boleta: la URL prefirmada se pide en cada clic (nunca se guarda). */
export function PayslipDownloadButton({ payslip, withLabel }: { payslip: Payslip; withLabel?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await openFreshDownload(() => payrollApi.payslipDocumentUrl(payslip.payslipId));
    } catch (error) {
      const expired = error instanceof ApiError && (error.status === 403 || error.status === 404);
      toast.error('No se pudo descargar la boleta', `${errorMessage(error)}${expired ? '' : ` ${EXPIRED_LINK_HINT}`}`);
    } finally {
      setBusy(false);
    }
  };

  const label = `Descargar boleta de ${formatPeriod(payslip.period)}`;
  if (withLabel) {
    return (
      <Button size="sm" variant="secondary" icon={<Download size={15} />} loading={busy} onClick={download} aria-label={label}>
        Descargar
      </Button>
    );
  }
  return <IconButton label={label} icon={<Download size={15} />} loading={busy} onClick={download} />;
}

/** Modal para crear una corrida eligiendo el mes. No permite meses futuros (hora de Lima). */
export function CreateRunModal({
  onClose,
  onAccepted,
}: {
  onClose: () => void;
  onAccepted: (run: { runId: string; period: string; status: 'PENDING' }) => void;
}) {
  const maxPeriod = currentPeriod();
  const [period, setPeriod] = useState(maxPeriod);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current) return;
    const invalid = validatePeriod(period);
    setFieldError(invalid);
    setSubmitError(null);
    if (invalid) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const accepted = await payrollApi.createRun(period);
      onAccepted(accepted);
    } catch (error) {
      setSubmitError({ message: errorMessage(error), conflict: error instanceof ApiError && error.status === 409 });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Nueva corrida de planilla"
      description="El cálculo se hace en segundo plano. Podrás seguir su avance en esta pantalla."
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Generar planilla
          </Button>
        </>
      }
    >
      <Field label="Mes de la planilla" error={fieldError} required hint={`Hasta ${formatPeriod(maxPeriod)}. No se permiten meses futuros.`}>
        <Input
          type="month"
          value={period}
          max={maxPeriod}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setPeriod(event.target.value);
            setFieldError(undefined);
          }}
        />
      </Field>
      {submitError && (
        <Alert tone={submitError.conflict ? 'warning' : 'danger'} title={submitError.conflict ? 'Ese periodo ya tiene una corrida' : undefined}>
          {submitError.message}
        </Alert>
      )}
    </Modal>
  );
}
