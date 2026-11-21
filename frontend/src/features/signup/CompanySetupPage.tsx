import { CheckCircle2, Clock, RefreshCw, Settings2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { employeesApi } from '../../api/employees';
import { payrollApi } from '../../api/payroll';
import type { ServiceName } from '../../config/env';
import { SERVICE_LABEL } from '../../config/env';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Feedback';
import { Card, PageHeader } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../hooks/useAsync';
import { SETUP_MAX_RETRIES, SETUP_RETRY_INTERVAL_MS, isCompanySetupError, retryWhileConfiguring } from '../../utils/retry503';

type CheckState =
  | { status: 'checking' }
  | { status: 'waiting'; attempt: number; message: string }
  | { status: 'ready' }
  | { status: 'exhausted'; message: string }
  | { status: 'error'; message: string };

/** Consultas idempotentes (GET) que confirman que la empresa ya está lista en cada servicio. */
const CHECKS: { service: ServiceName; run: (signal?: AbortSignal) => Promise<unknown> }[] = [
  { service: 'employees', run: (signal) => employeesApi.listDepartments(signal) },
  { service: 'payroll', run: (signal) => payrollApi.myPayslips({ limit: 1 }, signal) },
];

/**
 * Pantalla "Empresa en preparación". Tras el registro, employees y payroll responden 503
 * unos segundos. Se reintenta cada 3 s, máximo 5 veces, solo con GET. Al desmontar se cancelan
 * las esperas y peticiones pendientes.
 */
export function CompanySetupPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [states, setStates] = useState<Record<string, CheckState>>({});
  const [round, setRound] = useState(0);
  const navigated = useRef(false);

  const runChecks = useCallback((signal: AbortSignal) => {
    setStates(Object.fromEntries(CHECKS.map((c) => [c.service, { status: 'checking' } as CheckState])));
    return Promise.all(
      CHECKS.map(async ({ service, run }) => {
        const set = (state: CheckState) => !signal.aborted && setStates((s) => ({ ...s, [service]: state }));
        try {
          await retryWhileConfiguring(run, {
            signal,
            onRetry: (attempt, message) => set({ status: 'waiting', attempt, message }),
          });
          set({ status: 'ready' });
          return true;
        } catch (error) {
          if (signal.aborted) return false;
          set(isCompanySetupError(error) ? { status: 'exhausted', message: error.message } : { status: 'error', message: errorMessage(error) });
          return false;
        }
      }),
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    runChecks(controller.signal).then((results) => {
      if (controller.signal.aborted || navigated.current) return;
      if (results.every(Boolean)) {
        navigated.current = true;
        toast.success('Tu empresa está lista', 'Ya puedes usar todos los módulos.');
        navigate('/', { replace: true });
      }
    });
    return () => controller.abort();
  }, [round, runChecks, navigate, toast]);

  const values = Object.values(states);
  const finished = values.length === CHECKS.length && values.every((s) => s.status === 'ready' || s.status === 'exhausted' || s.status === 'error');
  const exhausted = values.some((s) => s.status === 'exhausted');

  return (
    <>
      <PageHeader title="Preparando tu empresa" description="Estamos creando el espacio de tu empresa en cada servicio. Esto suele tardar unos segundos." />
      <Card>
        <ul className="setup-checks">
          {CHECKS.map(({ service }) => {
            const state = states[service] ?? { status: 'checking' };
            return (
              <li key={service} className={`setup-check is-${state.status}`}>
                <span className="setup-check-icon">
                  {state.status === 'ready' ? (
                    <CheckCircle2 size={18} />
                  ) : state.status === 'exhausted' || state.status === 'error' ? (
                    <XCircle size={18} />
                  ) : state.status === 'waiting' ? (
                    <Clock size={18} />
                  ) : (
                    <Spinner size={16} />
                  )}
                </span>
                <div>
                  <strong>{SERVICE_LABEL[service]}</strong>
                  <span>
                    {state.status === 'checking' && 'Verificando…'}
                    {state.status === 'waiting' &&
                      `${state.message} Reintento automático ${state.attempt} de ${SETUP_MAX_RETRIES} en ${SETUP_RETRY_INTERVAL_MS / 1000} s.`}
                    {state.status === 'ready' && 'Listo'}
                    {state.status === 'exhausted' && `${state.message} Se agotaron los ${SETUP_MAX_RETRIES} reintentos automáticos.`}
                    {state.status === 'error' && state.message}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {finished && (
          <div className="setup-actions">
            <p className="muted">
              {exhausted
                ? 'La configuración está tardando más de lo normal. Puedes volver a intentarlo ahora o entrar y revisar más tarde.'
                : 'Algún servicio respondió con un error. Puedes reintentar o entrar igualmente.'}
            </p>
            <div className="row">
              <Button icon={<RefreshCw size={16} />} onClick={() => setRound((r) => r + 1)}>
                Intentar de nuevo
              </Button>
              <Button variant="secondary" icon={<Settings2 size={16} />} onClick={() => navigate('/', { replace: true })}>
                Entrar de todas formas
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
