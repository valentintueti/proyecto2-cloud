import { request } from './http';
import type {
  CreatePayrollRunResponse,
  OffsetPage,
  PayrollRun,
  PayrollRunStatus,
  Payslip,
  PayslipDocumentUrlResponse,
} from './types';

const enc = encodeURIComponent;

/** Estados en los que el cálculo sigue en segundo plano y hay que consultar el detalle. */
export const ACTIVE_RUN_STATUSES: PayrollRunStatus[] = ['PENDING', 'PROCESSING'];
export const RUN_POLL_INTERVAL_MS = 5000;

export function isRunActive(status: PayrollRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

/**
 * Una consulta del seguimiento de una corrida (para usePolling/createPoller):
 * pide el detalle, avisa el avance y devuelve false cuando llega a COMPLETED o FAILED.
 */
export function runPollTask(
  fetchRun: (signal: AbortSignal) => Promise<PayrollRun>,
  handlers: { onUpdate: (run: PayrollRun) => void; onFinish?: (run: PayrollRun) => void },
): (signal: AbortSignal) => Promise<boolean> {
  return async (signal) => {
    const run = await fetchRun(signal);
    if (signal.aborted) return false;
    handlers.onUpdate(run);
    if (isRunActive(run.status)) return true;
    handlers.onFinish?.(run);
    return false;
  };
}

/** Pensión + licencias, redondeado a céntimos. */
export function totalDeductions(p: Pick<Payslip, 'pensionDeduction' | 'leaveDeduction'>): number {
  return Math.round((Number(p.pensionDeduction) + Number(p.leaveDeduction)) * 100) / 100;
}

interface OffsetParams {
  limit?: number;
  offset?: number;
}

/** services/payroll (handlers payroll_runs.py y payslips.py). */
export const payrollApi = {
  listRuns: (params: OffsetParams, signal?: AbortSignal) =>
    request<OffsetPage<PayrollRun>>('payroll', '/payroll-runs', {
      query: { limit: params.limit, offset: params.offset },
      signal,
    }),

  /**
   * 202 Accepted: la corrida queda en PENDING y se calcula en segundo plano.
   * Reintento de una corrida FAILED = volver a llamar con el mismo periodo.
   * 409 si el periodo ya tiene una corrida PROCESSING o COMPLETED.
   */
  createRun: (period: string) =>
    request<CreatePayrollRunResponse>('payroll', '/payroll-runs', { method: 'POST', body: { period } }),

  getRun: (runId: string, signal?: AbortSignal) => request<PayrollRun>('payroll', `/payroll-runs/${enc(runId)}`, { signal }),

  listRunPayslips: (runId: string, params: OffsetParams & { q?: string }, signal?: AbortSignal) =>
    request<OffsetPage<Payslip>>('payroll', `/payroll-runs/${enc(runId)}/payslips`, {
      query: { limit: params.limit, offset: params.offset, q: params.q?.trim() },
      signal,
    }),

  myPayslips: (params: OffsetParams, signal?: AbortSignal) =>
    request<OffsetPage<Payslip>>('payroll', '/payslips/me', {
      query: { limit: params.limit, offset: params.offset },
      signal,
    }),

  /** URL prefirmada (5 min). Pedirla recién al hacer clic en Descargar. */
  payslipDocumentUrl: (payslipId: string) =>
    request<PayslipDocumentUrlResponse>('payroll', `/payslips/${enc(payslipId)}/document-url`),
};
