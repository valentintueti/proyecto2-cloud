import { Landmark, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RUN_POLL_INTERVAL_MS, isRunActive, payrollApi } from '../../api/payroll';
import type { OffsetPage, PayrollRun } from '../../api/types';
import { useSession } from '../../auth/AuthContext';
import { RunStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Alert } from '../../components/ui/Feedback';
import { Card, OffsetPagination, PageHeader } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { useAsync } from '../../hooks/useAsync';
import { usePolling } from '../../hooks/usePolling';
import { formatDateTime, formatPeriod, formatSoles } from '../../utils/format';
import { SETUP_MAX_RETRIES, retryWhileConfiguring } from '../../utils/retry503';
import { CreateRunModal, RetryButton, RunProgress, useRunRetry } from './PayrollShared';

const PAGE_SIZE = 10;

/** Corrida provisional mientras llega el primer GET del detalle (la respuesta 202 solo trae runId, period y status). */
function provisionalRun(accepted: { runId: string; period: string; status: 'PENDING' }, createdBy: string): PayrollRun {
  return {
    ...accepted,
    processed: 0,
    totalGross: 0,
    totalNet: 0,
    createdBy,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

function upsertRun(page: OffsetPage<PayrollRun> | undefined, run: PayrollRun): OffsetPage<PayrollRun> {
  const base = page ?? { items: [], total: 0, limit: PAGE_SIZE, offset: 0 };
  const exists = base.items.some((r) => r.runId === run.runId);
  if (exists) return { ...base, items: base.items.map((r) => (r.runId === run.runId ? { ...r, ...run } : r)) };
  const items = [run, ...base.items].sort((a, b) => b.period.localeCompare(a.period)).slice(0, base.limit);
  return { ...base, items, total: base.total + 1 };
}

export function PayrollRunsPage() {
  const { user } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [setupNotice, setSetupNotice] = useState<string | null>(null);

  const runs = useAsync(
    (signal) =>
      retryWhileConfiguring((s) => payrollApi.listRuns({ limit: PAGE_SIZE, offset }, s), {
        signal,
        onRetry: (n, message) => setSetupNotice(`${message} Reintento ${n} de ${SETUP_MAX_RETRIES}…`),
      }).finally(() => setSetupNotice(null)),
    [offset],
  );

  const items = runs.data?.items ?? [];
  const activeIds = items.filter((r) => isRunActive(r.status)).map((r) => r.runId);

  // Seguimiento automático: cada 5 s se consulta el detalle de las corridas en PENDING/PROCESSING.
  usePolling(
    async (signal) => {
      const updated = await Promise.all(activeIds.map((id) => payrollApi.getRun(id, signal)));
      if (signal.aborted) return false;
      runs.setData((page) => updated.reduce((acc, run) => upsertRun(acc, run), page as OffsetPage<PayrollRun>));
      updated
        .filter((run) => !isRunActive(run.status))
        .forEach((run) =>
          run.status === 'COMPLETED'
            ? toast.success('Planilla completada', `${formatPeriod(run.period)} · ${run.processed} boletas generadas`)
            : toast.error('La planilla falló', `${formatPeriod(run.period)}: puedes reintentarla.`),
        );
      return updated.some((run) => isRunActive(run.status));
    },
    { intervalMs: RUN_POLL_INTERVAL_MS, enabled: activeIds.length > 0 },
    [activeIds.join(',')],
  );

  const retry = useRunRetry((accepted) => {
    runs.setData((page) => {
      const current = page?.items.find((r) => r.runId === accepted.runId);
      return upsertRun(page, { ...(current ?? provisionalRun({ ...accepted, status: 'PENDING' }, user.email)), status: accepted.status, completedAt: null });
    });
  });

  const columns: Column<PayrollRun>[] = [
    {
      key: 'period',
      header: 'Periodo',
      render: (r) => (
        <div className="cell-main">
          <div>
            <strong>{formatPeriod(r.period)}</strong>
            <span>{r.period}</span>
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'Estado', render: (r) => <RunStatusBadge status={r.status} /> },
    { key: 'processed', header: 'Procesados', align: 'right', render: (r) => <span className="num">{r.processed}</span> },
    { key: 'gross', header: 'Bruto', align: 'right', render: (r) => <span className="num nowrap">{formatSoles(r.totalGross)}</span> },
    { key: 'net', header: 'Neto', align: 'right', render: (r) => <span className="num nowrap">{formatSoles(r.totalNet)}</span> },
    { key: 'createdBy', header: 'Creada por', hideOnMobile: true, render: (r) => <span className="muted break-all">{r.createdBy}</span> },
    {
      key: 'dates',
      header: 'Fechas',
      hideOnMobile: true,
      render: (r) => (
        <div className="stacked-dates">
          <span>Creada: {formatDateTime(r.createdAt)}</span>
          <span>Terminada: {formatDateTime(r.completedAt)}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (r) => <RetryButton run={r} compact busy={retry.retrying === r.runId} onRetry={retry.retry} />,
    },
  ];

  const active = items.filter((r) => isRunActive(r.status));

  return (
    <>
      <PageHeader
        title="Planillas"
        description="Genera la planilla mensual, sigue su avance y revisa las boletas de cada empleado."
        actions={
          <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            Nueva corrida
          </Button>
        }
      />
      <div className="stack">
        {setupNotice && (
          <Alert tone="warning" title="Empresa en preparación">
            {setupNotice}
          </Alert>
        )}
        {retry.error && <Alert tone="danger" title="No se pudo reintentar la corrida">{retry.error}</Alert>}
        {active.map((run) => (
          <Alert key={run.runId} tone="info" title={`Planilla de ${formatPeriod(run.period)} en curso`}>
            <RunProgress run={run} />
            <span className="muted">Se actualiza automáticamente cada 5 segundos. No necesitas recargar la página.</span>
          </Alert>
        ))}
        <Card padded={false}>
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(r) => r.runId}
            loading={runs.loading}
            error={runs.error}
            onRetry={runs.reload}
            onRowClick={(r) => navigate(`/payroll/${r.runId}`)}
            empty={{
              title: 'Aún no hay planillas',
              description: 'Genera la primera corrida eligiendo el mes.',
              icon: <Landmark size={26} />,
              action: (
                <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                  Nueva corrida
                </Button>
              ),
            }}
            footer={
              runs.data && (
                <OffsetPagination total={runs.data.total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} disabled={runs.loading} />
              )
            }
          />
        </Card>
      </div>

      {creating && (
        <CreateRunModal
          onClose={() => setCreating(false)}
          onAccepted={(accepted) => {
            setCreating(false);
            // 202 = aceptada, no terminada: se agrega en PENDING y el polling muestra el avance.
            if (offset !== 0) setOffset(0);
            runs.setData((page) => upsertRun(page, provisionalRun(accepted, user.email)));
            toast.info('Planilla en proceso', `${formatPeriod(accepted.period)}: el cálculo continúa en segundo plano.`);
          }}
        />
      )}
    </>
  );
}
