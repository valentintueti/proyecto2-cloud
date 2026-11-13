import { Check, ClipboardCheck, X } from 'lucide-react';
import { useState } from 'react';
import { timeLeaveApi } from '../../api/timeLeave';
import type { LeaveRequest } from '../../api/types';
import { useSession } from '../../auth/AuthContext';
import { Badge, LEAVE_TYPE_LABEL } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Avatar, Card, LoadMore, PageHeader } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../hooks/useAsync';
import { useCursorList } from '../../hooks/useCursorList';
import { formatDate, formatDateTime } from '../../utils/format';

type Decision = { leave: LeaveRequest; action: 'approve' | 'reject' };

export function ApprovalsPage() {
  const { user } = useSession();
  const toast = useToast();
  const list = useCursorList((cursor, signal) => timeLeaveApi.pendingLeaves({ limit: 20, cursor }, signal), []);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      const { leave, action } = decision;
      await (action === 'approve' ? timeLeaveApi.approveLeave(leave.requestId) : timeLeaveApi.rejectLeave(leave.requestId));
      // Ya no está pendiente: sale de la bandeja.
      list.setItems((items) => items.filter((l) => l.requestId !== leave.requestId));
      toast.success(action === 'approve' ? 'Solicitud aprobada' : 'Solicitud rechazada', leave.email);
      setDecision(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<LeaveRequest>[] = [
    {
      key: 'who',
      header: 'Solicitante',
      render: (l) => (
        <div className="cell-main">
          <Avatar name={l.email} size={34} />
          <div>
            <strong style={{ wordBreak: 'break-all' }}>{l.email}</strong>
            <span>Enviada {formatDateTime(l.createdAt)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Tipo',
      render: (l) => <Badge tone={l.type === 'VACATION' ? 'violet' : l.type === 'SICK' ? 'red' : 'blue'}>{LEAVE_TYPE_LABEL[l.type]}</Badge>,
    },
    {
      key: 'dates',
      header: 'Fechas',
      render: (l) => (
        <span className="nowrap">
          {formatDate(l.startDate)}
          {l.endDate !== l.startDate && ` – ${formatDate(l.endDate)}`}
        </span>
      ),
    },
    { key: 'days', header: 'Días', align: 'center', render: (l) => <strong>{l.days}</strong> },
    { key: 'reason', header: 'Motivo', hideOnMobile: true, render: (l) => <span className="muted">{l.reason || '—'}</span> },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (l) =>
        l.email === user.email ? (
          <Badge tone="gray">Tu solicitud</Badge>
        ) : (
          <div className="table-actions">
            <Button size="sm" variant="success" icon={<Check size={15} />} onClick={() => { setError(null); setDecision({ leave: l, action: 'approve' }); }}>
              Aprobar
            </Button>
            <Button size="sm" variant="secondary" icon={<X size={15} />} onClick={() => { setError(null); setDecision({ leave: l, action: 'reject' }); }}>
              Rechazar
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Aprobaciones"
        description="Solicitudes de vacaciones y permisos pendientes de decisión."
        actions={
          <Button variant="secondary" onClick={list.reload} loading={list.loading && list.items.length > 0}>
            Actualizar
          </Button>
        }
      />
      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={list.items}
          rowKey={(l) => l.requestId}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={{ title: 'Bandeja al día', description: 'No hay solicitudes pendientes de aprobación.', icon: <ClipboardCheck size={26} /> }}
          footer={
            list.items.length > 0 && (
              <LoadMore hasMore={!!list.nextCursor} loading={list.loadingMore} onClick={list.loadMore} count={list.items.length} />
            )
          }
        />
      </Card>
      <ConfirmDialog
        open={!!decision}
        title={decision?.action === 'approve' ? 'Aprobar solicitud' : 'Rechazar solicitud'}
        tone={decision?.action === 'approve' ? 'success' : 'danger'}
        confirmLabel={decision?.action === 'approve' ? 'Aprobar' : 'Rechazar'}
        busy={busy}
        error={error}
        onConfirm={decide}
        onCancel={() => setDecision(null)}
        message={
          decision && (
            <>
              {decision.action === 'approve' ? 'Aprobarás' : 'Rechazarás'} la solicitud de{' '}
              <strong>{LEAVE_TYPE_LABEL[decision.leave.type].toLowerCase()}</strong> de <strong>{decision.leave.email}</strong> (
              {decision.leave.days} días hábiles, {formatDate(decision.leave.startDate)} – {formatDate(decision.leave.endDate)}).
              {decision.action === 'approve' && decision.leave.type === 'VACATION' && ' Los días se descontarán de su saldo.'}
            </>
          )
        }
      />
    </>
  );
}
