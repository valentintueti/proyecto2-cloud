import { ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { payrollApi, totalDeductions } from '../../api/payroll';
import type { Payslip } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Alert } from '../../components/ui/Feedback';
import { Card, OffsetPagination, PageHeader } from '../../components/ui/Page';
import { useAsync } from '../../hooks/useAsync';
import { formatPeriod, formatSoles } from '../../utils/format';
import { SETUP_MAX_RETRIES, retryWhileConfiguring } from '../../utils/retry503';
import { PayslipDownloadButton, plural } from './PayrollShared';

const PAGE_SIZE = 12;

/** Mis boletas: todos los roles. Cada descarga pide una URL prefirmada nueva. */
export function MyPayslipsPage() {
  const [offset, setOffset] = useState(0);
  const [setupNotice, setSetupNotice] = useState<string | null>(null);
  const slips = useAsync(
    (signal) =>
      retryWhileConfiguring((s) => payrollApi.myPayslips({ limit: PAGE_SIZE, offset }, s), {
        signal,
        onRetry: (n, message) => setSetupNotice(`${message} Reintento ${n} de ${SETUP_MAX_RETRIES}…`),
      }).finally(() => setSetupNotice(null)),
    [offset],
  );

  const columns: Column<Payslip>[] = [
    {
      key: 'period',
      header: 'Periodo',
      render: (p) => (
        <div className="cell-main">
          <div>
            <strong>{formatPeriod(p.period)}</strong>
            <span>{p.period}</span>
          </div>
        </div>
      ),
    },
    { key: 'gross', header: 'Bruto', align: 'right', render: (p) => <span className="num nowrap">{formatSoles(p.gross)}</span> },
    {
      key: 'deductions',
      header: 'Descuentos',
      align: 'right',
      render: (p) => (
        <div className="stacked-dates align-right">
          <span className="num nowrap">{formatSoles(totalDeductions(p))}</span>
          <small className="muted nowrap">
            Pensión {formatSoles(p.pensionDeduction)} · Licencias {formatSoles(p.leaveDeduction)}
            {p.unpaidLeaveDays > 0 ? ` (${plural(p.unpaidLeaveDays, 'día', 'días')})` : ''}
          </small>
        </div>
      ),
    },
    { key: 'net', header: 'Neto', align: 'right', render: (p) => <strong className="num nowrap">{formatSoles(p.net)}</strong> },
    { key: 'actions', header: 'Boleta', align: 'right', render: (p) => <PayslipDownloadButton payslip={p} withLabel /> },
  ];

  return (
    <>
      <PageHeader title="Mis boletas" description="Tus boletas de pago por periodo. El enlace de descarga se genera en cada clic y dura 5 minutos." />
      <div className="stack">
        {setupNotice && (
          <Alert tone="warning" title="Empresa en preparación">
            {setupNotice}
          </Alert>
        )}
        <Card padded={false}>
          <DataTable
            columns={columns}
            rows={slips.data?.items ?? []}
            rowKey={(p) => p.payslipId}
            loading={slips.loading}
            error={slips.error}
            onRetry={slips.reload}
            empty={{ title: 'Aún no tienes boletas', description: 'Aparecerán aquí cuando RR. HH. procese la planilla del mes.', icon: <ReceiptText size={26} /> }}
            footer={slips.data && <OffsetPagination total={slips.data.total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} disabled={slips.loading} />}
          />
        </Card>
      </div>
    </>
  );
}
