import type { ReactNode } from 'react';
import type { EmployeeStatus, JobStatus, LeaveStatus, LeaveType, Role, Stage, UserStatus } from '../../api/types';
import { ROLE_LABEL } from '../../auth/permissions';

export type BadgeTone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal';

export function Badge({ tone = 'gray', children, dot }: { tone?: BadgeTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

const ROLE_TONE: Record<Role, BadgeTone> = { ADMIN_RRHH: 'violet', MANAGER: 'blue', EMPLOYEE: 'teal' };
export const RoleBadge = ({ role }: { role: Role }) => <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;

const USER_STATUS: Record<UserStatus, [string, BadgeTone]> = {
  ACTIVE: ['Activo', 'green'],
  INVITED: ['Invitado', 'amber'],
  DISABLED: ['Desactivado', 'gray'],
};
export const UserStatusBadge = ({ status }: { status: UserStatus }) => {
  const [label, tone] = USER_STATUS[status] ?? [status, 'gray'];
  return <Badge tone={tone} dot>{label}</Badge>;
};

const EMP_STATUS: Record<EmployeeStatus, [string, BadgeTone]> = {
  ACTIVE: ['Activo', 'green'],
  TERMINATED: ['De baja', 'red'],
};
export const EmployeeStatusBadge = ({ status }: { status: EmployeeStatus }) => {
  const [label, tone] = EMP_STATUS[status] ?? [status, 'gray'];
  return <Badge tone={tone} dot>{label}</Badge>;
};

const JOB_STATUS: Record<JobStatus, [string, BadgeTone]> = { OPEN: ['Abierta', 'green'], CLOSED: ['Cerrada', 'gray'] };
export const JobStatusBadge = ({ status }: { status: JobStatus }) => {
  const [label, tone] = JOB_STATUS[status] ?? [status, 'gray'];
  return <Badge tone={tone} dot>{label}</Badge>;
};

export const STAGE_LABEL: Record<Stage, string> = {
  APPLIED: 'Postulado',
  SCREENING: 'Preselección',
  INTERVIEW: 'Entrevista',
  OFFER: 'Oferta',
  HIRED: 'Contratado',
  REJECTED: 'Rechazado',
};
const STAGE_TONE: Record<Stage, BadgeTone> = {
  APPLIED: 'gray',
  SCREENING: 'blue',
  INTERVIEW: 'violet',
  OFFER: 'amber',
  HIRED: 'green',
  REJECTED: 'red',
};
export const StageBadge = ({ stage }: { stage: Stage }) => <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage] ?? stage}</Badge>;

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  VACATION: 'Vacaciones',
  SICK: 'Enfermedad',
  PERSONAL: 'Permiso personal',
};

const LEAVE_STATUS: Record<LeaveStatus, [string, BadgeTone]> = {
  PENDING: ['Pendiente', 'amber'],
  APPROVED: ['Aprobada', 'green'],
  REJECTED: ['Rechazada', 'red'],
  CANCELLED: ['Cancelada', 'gray'],
};
export const LeaveStatusBadge = ({ status }: { status: LeaveStatus }) => {
  const [label, tone] = LEAVE_STATUS[status] ?? [status, 'gray'];
  return <Badge tone={tone} dot>{label}</Badge>;
};
