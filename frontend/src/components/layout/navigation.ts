import {
  Briefcase,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  Building2,
  IdCard,
  LayoutDashboard,
  ShieldCheck,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '../../auth/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  end?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** El menú solo muestra los módulos permitidos para el rol (se filtra en Sidebar). */
export const NAVIGATION: NavSection[] = [
  {
    title: 'General',
    items: [
      { to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
      { to: '/profile', label: 'Mi perfil', icon: UserCircle, permission: 'profile.view' },
    ],
  },
  {
    title: 'Personas',
    items: [
      { to: '/employees', label: 'Empleados', icon: Users, permission: 'employees.list', end: true },
      { to: '/employees/me', label: 'Mi ficha', icon: IdCard, permission: 'employees.view' },
      { to: '/organization', label: 'Departamentos y puestos', icon: Building2, permission: 'org.view' },
      { to: '/users', label: 'Usuarios y roles', icon: ShieldCheck, permission: 'users.list' },
    ],
  },
  {
    title: 'Reclutamiento',
    items: [{ to: '/jobs', label: 'Vacantes', icon: Briefcase, permission: 'jobs.list' }],
  },
  {
    title: 'Tiempo y ausencias',
    items: [
      { to: '/attendance', label: 'Asistencia', icon: CalendarCheck, permission: 'attendance.self' },
      { to: '/leave', label: 'Vacaciones y permisos', icon: CalendarDays, permission: 'leave.self' },
      { to: '/approvals', label: 'Aprobaciones', icon: ClipboardCheck, permission: 'leave.approve' },
    ],
  },
];
