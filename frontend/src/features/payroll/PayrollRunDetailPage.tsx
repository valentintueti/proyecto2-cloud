import { ArrowLeft, ReceiptText, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RUN_POLL_INTERVAL_MS, isRunActive, payrollApi, runPollTask } from '../../api/payroll';
import type { Payslip } from '../../api/types';
import { RunStatusBadge } from '../../components/ui/Badge';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Alert, ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/Form';
import { Card, DescriptionList, OffsetPagination, PageHeader, StatCard, Toolbar } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { usePolling } from '../../hooks/usePolling';
import { formatDateTime, formatPeriod, formatSoles } from '../../utils/format';
import { PayslipDownloadButton, RetryButton, RunProgress, plural, useRunRetry } from './PayrollShared';

const PAGE_SIZE = 20;

export function PayrollRunDetailPage() {
  const { runId = '' } = useParams();
  const toast = useToast();
  const run = useAsync((signal) => payrollApi.getRun(runId, signal), [runId]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [payslipsVersion, setPayslipsVersion] = useState(0);
  const status = run.data?.status;

  // Consulta el detalle cada 5 s mientras esté PENDING o PROCESSING; se limpia al salir o cambiar de corrida.
  usePolling(
    runPollTask((signal) => payrollApi.getRun(runId, signal), {
      onUpdate: (updated) => {
        setPollError(null);
        run.setData(updated);
        setPayslipsVersion((v) => v + 1); // las boletas van apareciendo por lotes
      },
      onFinish: (finished) => {
        if (finished.status === 'COMPLETED') toast.success('Planilla completada', `${plural(finished.processed, 'boleta generada', 'boletas generadas')}.`);
        else toast.error('La planilla falló', 'Puedes reintentarla: el cálculo continúa desde donde se quedó.');
      },
    }),
    {
      intervalMs: RUN_POLL_INTERVAL_MS,
      enabled: !!status && isRunActive(status),
      onError: (error) => setPollError(error instanceof Error ? error.message : 'Error al consultar el avance.'),
    },
    [runId],
  );

  const retry = useRunRetry((accepted) => {
    run.setData((current) => ({ ...current!, status: accepted.status, completedAt: null }));
  });

  if (run.loading && !run.data) return <LoadingBlock label="Cargando corrida…" />;
  const back = (
    <Link to="/payroll" className="back-link">
      <ArrowLeft size={14} /> Planillas
    </Link>
  );
  if (run.error || !run.data) {
    return (
      <>
        <PageHeader title="Corrida de planilla" back={back} />
        <ErrorState message={run.error ?? 'Corrida no encontrada'} onRetry={run.reload} />
      </>
    );
  }

  const r = run.data;
  return (
    <>
      <PageHeader
        back={back}
        title={`Planilla de ${formatPeriod(r.period)}`}
        description={
          <span className="row" style={{ marginTop: 6 }}>
            <RunStatusBadge status={r.status} /> <span className="muted">Periodo {r.period}</span>
          </span>
        }
        actions={<RetryButton run={r} busy={retry.retrying === r.runId} onRetry={retry.retry} />}
      />
      <div className="stack">
        {isRunActive(r.status) && (
          <Alert tone="info" title="Cálculo en segundo plano">
            <RunProgress run={r} />
            <span className="muted">Se actualiza cada 5 segundos sin recargar la página.</span>
          </Alert>
        )}
        {r.status === 'FAILED' && (
          <Alert tone="danger" title="La corrida falló">
            Pulsa «Reintentar» para continuar el cálculo desde donde se quedó.
          </Alert>
        )}
        {retry.error && <Alert tone="danger">{retry.error}</Alert>}
        {pollError && <Alert tone="warning">No se pudo actualizar el avance: {pollError}. Se volverá a intentar en 5 segundos.</Alert>}

        <div className="grid grid-3">
          <StatCard label="Empleados procesados" value={r.processed} tone="indigo" icon={<ReceiptText size={20} />} />
          <StatCard label="Total bruto" value={formatSoles(r.totalGross)} tone="sky" hint={isRunActive(r.status) ? 'Se calcula al completar' : undefined} />
          <StatCard label="Total neto" value={formatSoles(r.totalNet)} tone="green" hint={isRunActive(r.status) ? 'Se calcula al completar' : undefined} />
        </div>
        <Card title="Detalle">
          <DescriptionList
            items={[
              { label: 'Creada por', value: <span className="break-all">{r.createdBy}</span> },
              { label: 'Creada', value: formatDateTime(r.createdAt) },
              { label: 'Terminada', value: formatDateTime(r.completedAt) },
              { label: 'Identificador', value: <code className="break-all">{r.runId}</code> },
            ]}
          />
        </Card>
        <RunPayslips runId={r.runId} version={payslipsVersion} />
      </div>
    </>
  );
}

function RunPayslips({ runId, version }: { runId: string; version: number }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [q]);
  const slips = useAsync((signal) => payrollApi.listRunPayslips(runId, { limit: PAGE_SIZE, offset, q }, signal), [runId, offset, q, version]);

  const columns: Column<Payslip>[] = [
    {
      key: 'employee',
      header: 'Empleado',
      render: (p) => (
        <div className="cell-main">
          <div>
            <strong>{p.fullName || p.email}</strong>
            <span className="break-all">{p.email}</span>
          </div>
        </div>
      ),
    },
    { key: 'base', header: 'Salario base', align: 'right', render: (p) => <span className="num nowrap">{formatSoles(p.baseSalary)}</span> },
    { key: 'leaveDays', header: 'Lic. no remunerada', align: 'right', hideOnMobile: true, render: (p) => <span className="num">{plural(p.unpaidLeaveDays, 'día', 'días')}</span> },
    { key: 'gross', header: 'Bruto', align: 'right', render: (p) => <span className="num nowrap">{formatSoles(p.gross)}</span> },
    { key: 'pension', header: 'Desc. pensión', align: 'right', hideOnMobile: true, render: (p) => <span className="num nowrap">{formatSoles(p.pensionDeduction)}</span> },
    { key: 'leave', header: 'Desc. licencias', align: 'right', hideOnMobile: true, render: (p) => <span className="num nowrap">{formatSoles(p.leaveDeduction)}</span> },
    { key: 'net', header: 'Neto', align: 'right', render: (p) => <strong className="num nowrap">{formatSoles(p.net)}</strong> },
    { key: 'actions', header: 'Boleta', align: 'right', render: (p) => <PayslipDownloadButton payslip={p} /> },
  ];

  return (
    <Card title="Boletas" subtitle="Busca por nombre o email. La descarga genera un enlace nuevo de 5 minutos." padded={false}>
      <div className="card-body" style={{ paddingBottom: 0 }}>
        <Toolbar>
          <div className="input-icon grow">
            <Search size={16} />
            <Input type="search" placeholder="Buscar por nombre o email" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar boletas" />
          </div>
        </Toolbar>
      </div>
      <DataTable
        columns={columns}
        rows={slips.data?.items ?? []}
        rowKey={(p) => p.payslipId}
        loading={slips.loading}
        error={slips.error}
        onRetry={slips.reload}
        empty={{
          title: q ? 'Sin coincidencias' : 'Aún no hay boletas',
          description: q ? 'Prueba con otro nombre o email.' : 'Las boletas aparecen a medida que se procesan los empleados.',
          icon: <ReceiptText size={26} />,
        }}
        footer={slips.data && <OffsetPagination total={slips.data.total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} disabled={slips.loading} />}
      />
    </Card>
  );
}
