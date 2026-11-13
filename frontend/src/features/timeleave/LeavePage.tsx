import { CalendarDays, CalendarPlus, Palmtree, X } from 'lucide-react';
import { useState } from 'react';
import { timeLeaveApi } from '../../api/timeLeave';
import type { Balance, LeaveRequest, LeaveType } from '../../api/types';
import { LEAVE_TYPE_LABEL, LeaveStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Alert, ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { Field, FormGrid, Input, Select, Textarea } from '../../components/ui/Form';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Card, LoadMore, PageHeader } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { errorMessage, useAsync } from '../../hooks/useAsync';
import { useCursorList } from '../../hooks/useCursorList';
import { addDays, businessDays, formatDate, formatDateTime, todayISO } from '../../utils/format';
import { isDate, maxLength } from '../../utils/validation';

export function BalanceCard({ balance }: { balance: ReturnType<typeof useAsync<Balance>> }) {
  const b = balance.data;
  return (
    <Card title="Saldo de vacaciones" subtitle={b ? `Año ${b.year}` : undefined}>
      {balance.loading && !b ? (
        <LoadingBlock />
      ) : balance.error && !b ? (
        <ErrorState message={balance.error} onRetry={balance.reload} />
      ) : b ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
            <strong style={{ fontSize: 36, letterSpacing: '-0.03em' }}>{b.availableDays}</strong>
            <span className="muted">días disponibles de {b.vacationDays}</span>
          </div>
          <div className="balance-meter" aria-label={`${b.usedDays} de ${b.vacationDays} días usados`}>
            <span style={{ width: `${Math.min(100, (b.usedDays / Math.max(1, b.vacationDays)) * 100)}%` }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Usados: {b.usedDays}</span>
            <span className="muted">Asignados: {b.vacationDays}</span>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Se descuentan días hábiles (lunes a viernes) al aprobarse una solicitud de vacaciones.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

export function LeavePage() {
  const toast = useToast();
  const balance = useAsync((signal) => timeLeaveApi.myBalance(signal), []);
  const list = useCursorList((cursor, signal) => timeLeaveApi.myLeaves({ limit: 20, cursor }, signal), []);
  const [creating, setCreating] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const updated = await timeLeaveApi.cancelLeave(cancelTarget.requestId);
      list.setItems((items) => items.map((l) => (l.requestId === updated.requestId ? updated : l)));
      toast.success('Solicitud cancelada');
      setCancelTarget(null);
    } catch (error) {
      setCancelError(errorMessage(error));
    } finally {
      setCancelBusy(false);
    }
  };

  const columns: Column<LeaveRequest>[] = [
    {
      key: 'type',
      header: 'Tipo',
      render: (l) => (
        <div className="cell-main">
          <div>
            <strong>{LEAVE_TYPE_LABEL[l.type] ?? l.type}</strong>
            <span>{l.reason || 'Sin motivo'}</span>
          </div>
        </div>
      ),
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
    { key: 'days', header: 'Días hábiles', align: 'center', render: (l) => <strong>{l.days}</strong> },
    { key: 'status', header: 'Estado', render: (l) => <LeaveStatusBadge status={l.status} /> },
    {
      key: 'decided',
      header: 'Decisión',
      hideOnMobile: true,
      render: (l) =>
        l.decidedAt ? (
          <span className="muted" style={{ fontSize: 12.5 }}>
            {l.decidedBy} · {formatDateTime(l.decidedAt)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (l) =>
        l.status === 'PENDING' ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={15} />}
            onClick={() => {
              setCancelError(null);
              setCancelTarget(l);
            }}
          >
            Cancelar
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Vacaciones y permisos"
        description="Solicita días libres y sigue el estado de tus solicitudes."
        actions={
          <Button icon={<CalendarPlus size={16} />} onClick={() => setCreating(true)}>
            Nueva solicitud
          </Button>
        }
      />
      <div className="grid grid-main-side" style={{ alignItems: 'start' }}>
        <Card title="Mis solicitudes" padded={false}>
          <DataTable
            columns={columns}
            rows={list.items}
            rowKey={(l) => l.requestId}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            empty={{
              title: 'Aún no tienes solicitudes',
              description: 'Cuando solicites vacaciones o permisos aparecerán aquí.',
              icon: <Palmtree size={26} />,
            }}
            footer={
              list.items.length > 0 && (
                <LoadMore hasMore={!!list.nextCursor} loading={list.loadingMore} onClick={list.loadMore} count={list.items.length} />
              )
            }
          />
        </Card>
        <BalanceCard balance={balance} />
      </div>

      {creating && (
        <LeaveRequestModal
          available={balance.data?.availableDays}
          onClose={() => setCreating(false)}
          onSaved={(leave) => {
            setCreating(false);
            list.setItems((items) => [leave, ...items]);
            toast.success('Solicitud enviada', `${LEAVE_TYPE_LABEL[leave.type]} · ${leave.days} días hábiles`);
          }}
        />
      )}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancelar solicitud"
        tone="danger"
        confirmLabel="Cancelar solicitud"
        busy={cancelBusy}
        error={cancelError}
        onConfirm={cancel}
        onCancel={() => setCancelTarget(null)}
        message={
          cancelTarget && (
            <>
              Se cancelará tu solicitud de <strong>{LEAVE_TYPE_LABEL[cancelTarget.type].toLowerCase()}</strong> del{' '}
              {formatDate(cancelTarget.startDate)} al {formatDate(cancelTarget.endDate)}.
            </>
          )
        }
      />
    </>
  );
}

function LeaveRequestModal({
  available,
  onClose,
  onSaved,
}: {
  available?: number;
  onClose: () => void;
  onSaved: (leave: LeaveRequest) => void;
}) {
  const tomorrow = addDays(todayISO(), 1);
  const [type, setType] = useState<LeaveType>('VACATION');
  const [startDate, setStartDate] = useState(tomorrow);
  const [endDate, setEndDate] = useState(tomorrow);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ startDate?: string; endDate?: string; reason?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const validDates = isDate(startDate) && isDate(endDate) && endDate >= startDate;
  const days = validDates ? businessDays(startDate, endDate) : 0;
  const exceedsBalance = type === 'VACATION' && available !== undefined && days > available;

  const submit = async () => {
    const found = {
      startDate: !isDate(startDate) ? 'Ingresa una fecha válida.' : undefined,
      endDate: !isDate(endDate)
        ? 'Ingresa una fecha válida.'
        : endDate < startDate
          ? 'Debe ser igual o posterior a la fecha de inicio.'
          : endDate >= addDays(startDate, 366)
            ? 'El rango no puede superar un año.'
            : validDates && days === 0
              ? 'El rango no incluye días hábiles.'
              : undefined,
      reason: maxLength(reason, 'El motivo', 500),
    };
    setErrors(found);
    if (found.startDate || found.endDate || found.reason || exceedsBalance) return;
    setSaving(true);
    setSubmitError(null);
    try {
      onSaved(await timeLeaveApi.createLeave({ type, startDate, endDate, reason: reason.trim() || undefined }));
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Nueva solicitud"
      description="Quien te aprueba verá la solicitud en su bandeja de pendientes."
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={exceedsBalance}>
            Enviar solicitud
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      <FormGrid>
        <Field label="Tipo" required className="span-2">
          <Select value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
            {(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desde" error={errors.startDate} required>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
          />
        </Field>
        <Field label="Hasta" error={errors.endDate} required>
          <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Motivo" error={errors.reason} className="span-2" hint={`${reason.length}/500 · Opcional`}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
        </Field>
      </FormGrid>
      <div className="info-row" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="row">
          <CalendarDays size={15} /> Días hábiles solicitados
        </span>
        <strong>{days}</strong>
      </div>
      {type === 'VACATION' && available !== undefined && (
        <Alert tone={exceedsBalance ? 'danger' : 'info'}>
          {exceedsBalance
            ? `Saldo insuficiente: solicitas ${days} días y tienes ${available} disponibles.`
            : `Tienes ${available} días de vacaciones disponibles. Se descontarán al aprobarse.`}
        </Alert>
      )}
    </Modal>
  );
}
