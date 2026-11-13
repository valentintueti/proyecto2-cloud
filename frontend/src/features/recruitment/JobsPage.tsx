import { Briefcase, MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recruitmentApi } from '../../api/recruitment';
import type { Job, JobStatus } from '../../api/types';
import { useSession } from '../../auth/AuthContext';
import { JobStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Card, LoadMore, PageHeader, Tabs } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { useCursorList } from '../../hooks/useCursorList';
import { formatDate } from '../../utils/format';
import { useOrgData } from '../employees/useOrgData';
import { JobFormModal } from './JobFormModal';

const PAGE_SIZE = 20;

export function JobsPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const org = useOrgData();
  const [status, setStatus] = useState<JobStatus | ''>('OPEN');
  const [creating, setCreating] = useState(false);
  const list = useCursorList((cursor, signal) => recruitmentApi.listJobs({ status, limit: PAGE_SIZE, cursor }, signal), [status]);
  const deptName = (id?: string | null) => org.data?.departments.find((d) => d.id === id)?.name;

  const columns: Column<Job>[] = [
    {
      key: 'title',
      header: 'Vacante',
      render: (j) => (
        <div className="cell-main">
          <span className="stat-icon" style={{ width: 36, height: 36, background: 'var(--primary-50)', color: 'var(--primary)' }}>
            <Briefcase size={16} />
          </span>
          <div>
            <strong>{j.title}</strong>
            <span>{deptName(j.departmentId) ?? 'Sin departamento'}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Ubicación',
      hideOnMobile: true,
      render: (j) =>
        j.location ? (
          <span className="row" style={{ gap: 4 }}>
            <MapPin size={14} className="muted" /> {j.location}
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'openings', header: 'Puestos', align: 'center', render: (j) => <strong>{j.openings}</strong> },
    { key: 'status', header: 'Estado', render: (j) => <JobStatusBadge status={j.status} /> },
    { key: 'created', header: 'Publicada', hideOnMobile: true, render: (j) => <span className="nowrap">{formatDate(j.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Vacantes"
        description="Posiciones abiertas y procesos de selección."
        actions={
          can('jobs.create') && (
            <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Nueva vacante
            </Button>
          )
        }
      />
      <div className="stack">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'OPEN', label: 'Abiertas' },
            { value: 'CLOSED', label: 'Cerradas' },
            { value: '', label: 'Todas' },
          ]}
        />
        <Card padded={false}>
          <DataTable
            columns={columns}
            rows={list.items}
            rowKey={(j) => j.jobId}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            onRowClick={(j) => navigate(`/jobs/${j.jobId}`)}
            empty={{
              title: list.nextCursor ? 'Sin vacantes en esta página' : 'No hay vacantes',
              description: list.nextCursor
                ? 'El filtro se aplica por página; carga más resultados para seguir buscando.'
                : status === 'OPEN'
                  ? 'No hay posiciones abiertas en este momento.'
                  : 'No hay vacantes para este filtro.',
              icon: <Briefcase size={26} />,
              action: list.nextCursor ? (
                <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
                  Cargar más
                </Button>
              ) : undefined,
            }}
            footer={
              list.items.length > 0 && (
                <LoadMore hasMore={!!list.nextCursor} loading={list.loadingMore} onClick={list.loadMore} count={list.items.length} />
              )
            }
          />
        </Card>
      </div>
      {creating && (
        <JobFormModal
          job={null}
          departments={org.data?.departments ?? []}
          onClose={() => setCreating(false)}
          onSaved={(job) => {
            setCreating(false);
            toast.success('Vacante creada', job.title);
            navigate(`/jobs/${job.jobId}`);
          }}
        />
      )}
    </>
  );
}
