import { ArrowLeft, Download, FileUp, Lock, MapPin, MoveRight, Pencil, Unlock, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STAGES, allowedTransitions, recruitmentApi } from '../../api/recruitment';
import type { Application, Stage } from '../../api/types';
import { useSession } from '../../auth/AuthContext';
import { JobStatusBadge, STAGE_LABEL, StageBadge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Alert, ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Card, DescriptionList, LoadMore, PageHeader } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { errorMessage, useAsync } from '../../hooks/useAsync';
import { useCursorList } from '../../hooks/useCursorList';
import { formatDate, formatDateTime, fullName } from '../../utils/format';
import { useOrgData } from '../employees/useOrgData';
import { ApplicationFormModal, CvUploadModal, StageModal } from './ApplicationModals';
import { JobFormModal } from './JobFormModal';

export function JobDetailPage() {
  const { jobId = '' } = useParams();
  const { can } = useSession();
  const toast = useToast();
  const job = useAsync((signal) => recruitmentApi.getJob(jobId, signal), [jobId]);
  const org = useOrgData();
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  if (job.loading && !job.data) return <LoadingBlock label="Cargando vacante…" />;
  const back = (
    <Link to="/jobs" className="back-link">
      <ArrowLeft size={14} /> Vacantes
    </Link>
  );
  if (job.error || !job.data) {
    return (
      <>
        <PageHeader title="Vacante" back={back} />
        <ErrorState message={job.error ?? 'Vacante no encontrada'} onRetry={job.reload} />
      </>
    );
  }

  const j = job.data;
  const department = org.data?.departments.find((d) => d.id === j.departmentId)?.name;
  const nextStatus = j.status === 'OPEN' ? 'CLOSED' : 'OPEN';

  const toggleStatus = async () => {
    setToggleBusy(true);
    setToggleError(null);
    try {
      const updated = await recruitmentApi.updateJob(j.jobId, { status: nextStatus });
      job.setData(updated);
      setToggling(false);
      toast.success(nextStatus === 'OPEN' ? 'Vacante reabierta' : 'Vacante cerrada', updated.title);
    } catch (error) {
      setToggleError(errorMessage(error));
    } finally {
      setToggleBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        back={back}
        title={j.title}
        description={
          <span className="row" style={{ marginTop: 6 }}>
            <JobStatusBadge status={j.status} />
            {j.location && (
              <span className="row" style={{ gap: 4 }}>
                <MapPin size={14} /> {j.location}
              </span>
            )}
            <span>· {j.openings} {j.openings === 1 ? 'puesto' : 'puestos'}</span>
          </span>
        }
        actions={
          can('jobs.update') && (
            <>
              <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button
                variant="secondary"
                icon={j.status === 'OPEN' ? <Lock size={16} /> : <Unlock size={16} />}
                onClick={() => {
                  setToggleError(null);
                  setToggling(true);
                }}
              >
                {j.status === 'OPEN' ? 'Cerrar vacante' : 'Reabrir'}
              </Button>
            </>
          )
        }
      />

      <div className="stack">
        <div className="grid grid-main-side">
          <Card title="Descripción">
            {j.description ? <p className="text-pre">{j.description}</p> : <p className="muted">Sin descripción.</p>}
          </Card>
          <Card title="Detalles">
            <DescriptionList
              items={[
                { label: 'Departamento', value: department ?? (j.departmentId ? 'Asignado' : '—') },
                { label: 'Puestos disponibles', value: j.openings },
                { label: 'Publicada', value: formatDate(j.createdAt) },
                { label: 'Actualizada', value: formatDateTime(j.updatedAt) },
                { label: 'Creada por', value: <span style={{ wordBreak: 'break-all' }}>{j.createdBy}</span> },
              ]}
            />
          </Card>
        </div>

        {can('applications.list') ? (
          <ApplicationsSection jobId={j.jobId} jobOpen={j.status === 'OPEN'} onJobChanged={job.reload} />
        ) : (
          <Alert tone="info" title="¿Te interesa esta vacante?">
            Comunícate con RR. HH. para postular o recomendar a alguien.
          </Alert>
        )}
      </div>

      {editing && (
        <JobFormModal
          job={j}
          departments={org.data?.departments ?? []}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            job.setData(saved);
            setEditing(false);
            toast.success('Vacante actualizada', saved.title);
          }}
        />
      )}
      <ConfirmDialog
        open={toggling}
        title={nextStatus === 'CLOSED' ? 'Cerrar vacante' : 'Reabrir vacante'}
        message={
          nextStatus === 'CLOSED'
            ? 'No se podrán registrar nuevos postulantes mientras esté cerrada.'
            : 'La vacante volverá a aceptar postulantes.'
        }
        confirmLabel={nextStatus === 'CLOSED' ? 'Cerrar' : 'Reabrir'}
        busy={toggleBusy}
        error={toggleError}
        onConfirm={toggleStatus}
        onCancel={() => setToggling(false)}
      />
    </>
  );
}

function ApplicationsSection({ jobId, jobOpen, onJobChanged }: { jobId: string; jobOpen: boolean; onJobChanged: () => void }) {
  const toast = useToast();
  const list = useCursorList((cursor, signal) => recruitmentApi.listApplications(jobId, { limit: 50, cursor }, signal), [jobId]);
  const [stageFilter, setStageFilter] = useState<Stage | ''>('');
  const [registering, setRegistering] = useState(false);
  const [moving, setMoving] = useState<Application | null>(null);
  const [uploading, setUploading] = useState<Application | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const replace = (app: Application) =>
    list.setItems((items) => items.map((a) => (a.applicationId === app.applicationId ? app : a)));

  const counts = STAGES.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: 0 }), {});
  list.items.forEach((a) => (counts[a.stage] = (counts[a.stage] ?? 0) + 1));
  const rows = list.items.filter((a) => !stageFilter || a.stage === stageFilter);

  const download = async (app: Application) => {
    setDownloading(app.applicationId);
    // La pestaña se abre en el mismo clic para que el navegador no la bloquee como pop-up.
    const tab = window.open('', '_blank');
    try {
      const { downloadUrl } = await recruitmentApi.cvDownloadUrl(app.jobId, app.applicationId);
      if (tab) {
        tab.opener = null;
        tab.location.href = downloadUrl;
      } else {
        window.location.assign(downloadUrl);
      }
    } catch (error) {
      tab?.close();
      toast.error('No se pudo descargar el CV', errorMessage(error));
    } finally {
      setDownloading(null);
    }
  };

  const columns: Column<Application>[] = [
    {
      key: 'candidate',
      header: 'Postulante',
      render: (a) => (
        <div className="cell-main">
          <div>
            <strong>{fullName(a)}</strong>
            <span>
              {a.email}
              {a.phone ? ` · ${a.phone}` : ''}
            </span>
          </div>
        </div>
      ),
    },
    { key: 'stage', header: 'Etapa', render: (a) => <StageBadge stage={a.stage} /> },
    { key: 'updated', header: 'Actualizado', hideOnMobile: true, render: (a) => <span className="nowrap">{formatDate(a.updatedAt)}</span> },
    {
      key: 'notes',
      header: 'Notas',
      hideOnMobile: true,
      render: (a) => (
        <span className="muted" title={a.notes} style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.notes || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (a) => (
        <div className="table-actions">
          {a.cvKey && (
            <IconButton
              label="Descargar CV"
              icon={<Download size={15} />}
              loading={downloading === a.applicationId}
              onClick={() => download(a)}
            />
          )}
          <IconButton label={a.cvKey ? 'Reemplazar CV' : 'Subir CV'} icon={<FileUp size={15} />} onClick={() => setUploading(a)} />
          <Button
            size="sm"
            variant="secondary"
            icon={<MoveRight size={15} />}
            disabled={allowedTransitions(a.stage).length === 0}
            onClick={() => setMoving(a)}
          >
            Etapa
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Postulaciones"
      subtitle={
        <span className="stage-flow">
          {(['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'] as Stage[]).map((s, i) => (
            <span key={s} className="row" style={{ gap: 6 }}>
              {i > 0 && <MoveRight size={12} />}
              {STAGE_LABEL[s]}
            </span>
          ))}
          <span>· Rechazo desde cualquier etapa abierta</span>
        </span>
      }
      actions={
        <Button icon={<UserPlus size={16} />} onClick={() => setRegistering(true)} disabled={!jobOpen} title={jobOpen ? undefined : 'La vacante está cerrada'}>
          Registrar postulante
        </Button>
      }
      padded={false}
    >
      <div className="card-body" style={{ paddingBottom: 0 }}>
        <div className="pipeline">
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              className={`pipeline-step${stageFilter === s ? ' active' : ''}`}
              onClick={() => setStageFilter((cur) => (cur === s ? '' : s))}
              aria-pressed={stageFilter === s}
            >
              <StageBadge stage={s} />
              <strong>{counts[s]}</strong>
            </button>
          ))}
        </div>
        {!jobOpen && (
          <div style={{ marginTop: 16 }}>
            <Alert tone="warning">La vacante está cerrada: no se pueden registrar nuevos postulantes.</Alert>
          </div>
        )}
      </div>
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)' }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.applicationId}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={{
            title: stageFilter ? `Nadie en “${STAGE_LABEL[stageFilter]}”` : 'Aún no hay postulantes',
            description: stageFilter ? 'Quita el filtro para ver todas las postulaciones.' : 'Registra al primer postulante de esta vacante.',
            icon: <Users size={26} />,
          }}
          footer={
            list.items.length > 0 && (
              <LoadMore hasMore={!!list.nextCursor} loading={list.loadingMore} onClick={list.loadMore} count={list.items.length} />
            )
          }
        />
      </div>

      {registering && (
        <ApplicationFormModal
          jobId={jobId}
          onClose={() => setRegistering(false)}
          onSaved={async (app, cv) => {
            setRegistering(false);
            list.setItems((items) => [...items, app]);
            toast.success('Postulante registrado', fullName(app));
            if (cv) {
              try {
                const cvKey = await recruitmentApi.uploadCv(app.jobId, app.applicationId, cv);
                replace({ ...app, cvKey });
                toast.success('CV subido', cv.name);
              } catch (error) {
                toast.error('El postulante se registró, pero el CV no se pudo subir', errorMessage(error));
              }
            }
          }}
        />
      )}
      {uploading && (
        <CvUploadModal
          application={uploading}
          onClose={() => setUploading(null)}
          onUploaded={(cvKey) => {
            replace({ ...uploading, cvKey });
            toast.success('CV subido', fullName(uploading));
            setUploading(null);
          }}
        />
      )}
      {moving && (
        <StageModal
          application={moving}
          onClose={() => setMoving(null)}
          onChanged={(app) => {
            replace(app);
            setMoving(null);
            toast.success(`Movido a ${STAGE_LABEL[app.stage]}`, fullName(app));
            if (app.stage === 'HIRED') onJobChanged(); // la vacante descuenta un puesto
          }}
        />
      )}
    </Card>
  );
}
