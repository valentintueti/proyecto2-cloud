/**
 * ⚠️ DATOS SIMULADOS — SOLO DESARROLLO (VITE_USE_MOCKS=true con `npm run dev`).
 * No se incluyen en el build de producción. Las credenciales son ficticias.
 */
import type {
  Application,
  AttendanceRecord,
  Department,
  Employee,
  Job,
  LeaveRequest,
  Position,
  Role,
  User,
} from '../api/types';
import { addDays, todayISO } from '../utils/format';

export const MOCK_PASSWORD = 'demo1234';

export interface MockUser extends User {
  password: string | null;
}

export interface TenantDb {
  name: string;
  users: MockUser[];
  departments: Department[];
  positions: Position[];
  employees: Employee[];
  jobs: Job[];
  applications: Application[];
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  balances: { email: string; year: number; vacationDays: number; usedDays: number }[];
}

let seq = 1;
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const n = (seq++).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${n}`;
}

const nowIso = () => new Date().toISOString();

interface TenantSeed {
  tenantId: string;
  name: string;
  domain: string;
  departments: string[];
  positions: [string, number, number, number][]; // título, índice depto, min, max
  people: [string, string][];
  jobs: [string, number, string, number, 'OPEN' | 'CLOSED'][];
}

const SEEDS: TenantSeed[] = [
  {
    tenantId: 'acme',
    name: 'Acme Corporation',
    domain: 'acme.com',
    departments: ['Tecnología', 'Recursos Humanos', 'Finanzas', 'Ventas'],
    positions: [
      ['Desarrollador Frontend', 0, 4500, 8000],
      ['Desarrollador Backend', 0, 5000, 9000],
      ['Analista de RR. HH.', 1, 3500, 6000],
      ['Contador', 2, 4000, 7000],
      ['Ejecutivo de ventas', 3, 3000, 6500],
    ],
    people: [
      ['Lucía', 'Fernández'],
      ['Mateo', 'Rojas'],
      ['Valeria', 'Quispe'],
      ['Santiago', 'Torres'],
      ['Camila', 'Vargas'],
      ['Diego', 'Mendoza'],
      ['Isabella', 'Castro'],
      ['Sebastián', 'Flores'],
      ['Renata', 'Huamán'],
      ['Nicolás', 'Paredes'],
      ['Mariana', 'Salazar'],
      ['Joaquín', 'Ríos'],
      ['Antonella', 'Chávez'],
      ['Gabriel', 'Ramírez'],
      ['Sofía', 'Gutiérrez'],
      ['Tomás', 'Aguilar'],
      ['Daniela', 'Navarro'],
      ['Emilio', 'Cárdenas'],
    ],
    jobs: [
      ['Desarrollador Frontend Senior', 0, 'Lima (híbrido)', 2, 'OPEN'],
      ['Analista de Nómina', 1, 'Lima', 1, 'OPEN'],
      ['Ejecutivo Comercial B2B', 3, 'Arequipa', 3, 'OPEN'],
      ['Contador Junior', 2, 'Remoto', 1, 'CLOSED'],
    ],
  },
  {
    tenantId: 'globex',
    name: 'Globex Industries',
    domain: 'globex.com',
    departments: ['Operaciones', 'Logística', 'Marketing'],
    positions: [
      ['Jefe de planta', 0, 7000, 11000],
      ['Coordinador logístico', 1, 4000, 6500],
      ['Especialista de marketing', 2, 3800, 6000],
    ],
    people: [
      ['Andrés', 'Molina'],
      ['Paula', 'Herrera'],
      ['Felipe', 'Ortega'],
      ['Julieta', 'Medina'],
      ['Martín', 'Silva'],
      ['Elena', 'Campos'],
      ['Rodrigo', 'Vega'],
    ],
    jobs: [
      ['Operario de producción', 0, 'Callao', 5, 'OPEN'],
      ['Analista de marketing digital', 2, 'Lima', 1, 'OPEN'],
    ],
  },
];

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function buildTenant(seed: TenantSeed): TenantDb {
  const created = '2025-01-10T15:00:00+00:00';
  const departments: Department[] = seed.departments.map((name) => ({ id: uuid(), name, createdAt: created }));
  const positions: Position[] = seed.positions.map(([title, d, min, max]) => ({
    id: uuid(),
    title,
    departmentId: departments[d].id,
    departmentName: departments[d].name,
    minSalary: min,
    maxSalary: max,
  }));

  const mkEmployee = (first: string, last: string, email: string, i: number, managerId: string | null): Employee => {
    const pos = positions[i % positions.length];
    const hire = addDays('2022-03-01', i * 41);
    return {
      id: uuid(),
      firstName: first,
      lastName: last,
      email,
      documentNumber: String(70_000_000 + i * 7_919 + seed.tenantId.length),
      phone: `+51 9${String(10_000_000 + i * 12_347).slice(0, 8)}`,
      hireDate: hire,
      terminationDate: null,
      status: 'ACTIVE',
      salary: pos.minSalary! + ((i * 350) % (pos.maxSalary! - pos.minSalary!)),
      departmentId: pos.departmentId,
      departmentName: pos.departmentName,
      positionId: pos.id,
      positionTitle: pos.title,
      managerId,
      createdAt: created,
      updatedAt: created,
    };
  };

  // Personas fijas para iniciar sesión con cada rol.
  const admin = mkEmployee('Ana', 'Admin', `admin@${seed.domain}`, 0, null);
  const manager = mkEmployee('Marco', 'Manager', `manager@${seed.domain}`, 1, null);
  const employee = mkEmployee('Elisa', 'Empleado', `empleado@${seed.domain}`, 2, manager.id);
  const others = seed.people.map(([first, last], idx) => {
    const email = `${strip(first)}.${strip(last)}@${seed.domain}`;
    return mkEmployee(first, last, email, idx + 3, idx % 2 === 0 ? manager.id : null);
  });
  if (others.length > 4) {
    others[4] = { ...others[4], status: 'TERMINATED', terminationDate: addDays(todayISO(), -40) };
  }
  const employees = [admin, manager, employee, ...others];

  const userFor = (e: Employee, role: Role, password: string | null = MOCK_PASSWORD): MockUser => ({
    userId: e.email,
    email: e.email,
    name: `${e.firstName} ${e.lastName}`,
    role,
    status: e.status === 'TERMINATED' ? 'DISABLED' : password ? 'ACTIVE' : 'INVITED',
    employeeId: e.id,
    createdAt: created,
    password,
  });
  const users: MockUser[] = [
    userFor(admin, 'ADMIN_RRHH'),
    userFor(manager, 'MANAGER'),
    userFor(employee, 'EMPLOYEE'),
    ...others.slice(0, 6).map((e, i) => userFor(e, 'EMPLOYEE', i === 5 ? null : MOCK_PASSWORD)),
  ];

  const jobs: Job[] = seed.jobs.map(([title, d, location, openings, status], i) => ({
    jobId: uuid(),
    title,
    description: `Buscamos ${title.toLowerCase()} para unirse al equipo de ${departments[d].name}.\n\nRequisitos:\n- Experiencia relevante\n- Trabajo en equipo`,
    location,
    openings,
    status,
    departmentId: departments[d].id,
    createdBy: admin.email,
    createdAt: addDays('2026-01-05', i * 9) + 'T14:00:00+00:00',
    updatedAt: addDays('2026-01-05', i * 9) + 'T14:00:00+00:00',
  }));

  const candidates: [string, string, Application['stage']][] = [
    ['Carlos', 'Peña', 'APPLIED'],
    ['Rocío', 'Luna', 'SCREENING'],
    ['Hugo', 'Salas', 'INTERVIEW'],
    ['Patricia', 'León', 'OFFER'],
    ['Iván', 'Guerra', 'REJECTED'],
    ['Natalia', 'Bravo', 'APPLIED'],
  ];
  const applications: Application[] = [];
  jobs.forEach((job, j) => {
    candidates.slice(0, j === 0 ? 6 : 3).forEach(([first, last, stage], c) => {
      applications.push({
        applicationId: uuid(),
        jobId: job.jobId,
        firstName: first,
        lastName: last,
        email: `${strip(first)}.${strip(last)}${j}@correo.com`,
        phone: c % 2 ? '+51 987 654 321' : '',
        stage,
        cvKey: c % 3 === 0 ? `tenants/${seed.tenantId}/cvs/x/cv.pdf` : null,
        notes: c === 2 ? 'Buena comunicación en la primera llamada.' : '',
        createdAt: addDays(job.createdAt.slice(0, 10), c + 1) + 'T16:00:00+00:00',
        updatedAt: addDays(job.createdAt.slice(0, 10), c + 2) + 'T16:00:00+00:00',
      });
    });
  });

  // Asistencia de los últimos días hábiles para los usuarios fijos.
  const attendance: AttendanceRecord[] = [];
  const today = todayISO();
  for (const person of [admin, manager, employee]) {
    for (let d = 1; d <= 20; d += 1) {
      const day = addDays(today, -d);
      const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const inMin = 8 * 60 + ((d * 7) % 40);
      const outMin = 17 * 60 + ((d * 11) % 50);
      const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
      attendance.push({
        email: person.email,
        date: day,
        checkIn: `${day}T${hhmm(inMin)}-05:00`,
        checkOut: `${day}T${hhmm(outMin)}-05:00`,
        workedMinutes: outMin - inMin,
      });
    }
  }

  const year = Number(today.slice(0, 4));
  const leaves: LeaveRequest[] = [
    {
      requestId: uuid(),
      email: employee.email,
      type: 'VACATION',
      startDate: addDays(today, 20),
      endDate: addDays(today, 24),
      days: 5,
      reason: 'Viaje familiar',
      status: 'PENDING',
      createdAt: nowIso(),
    },
    {
      requestId: uuid(),
      email: employee.email,
      type: 'SICK',
      startDate: addDays(today, -30),
      endDate: addDays(today, -29),
      days: 2,
      reason: 'Descanso médico',
      status: 'APPROVED',
      createdAt: nowIso(),
      decidedBy: manager.email,
      decidedAt: nowIso(),
    },
    {
      requestId: uuid(),
      email: manager.email,
      type: 'PERSONAL',
      startDate: addDays(today, 7),
      endDate: addDays(today, 7),
      days: 1,
      reason: 'Trámite personal',
      status: 'PENDING',
      createdAt: nowIso(),
    },
    {
      requestId: uuid(),
      email: others[0].email,
      type: 'VACATION',
      startDate: addDays(today, 35),
      endDate: addDays(today, 41),
      days: 5,
      reason: '',
      status: 'PENDING',
      createdAt: nowIso(),
    },
  ];
  const balances = [
    { email: employee.email, year, vacationDays: 30, usedDays: 8 },
    { email: manager.email, year, vacationDays: 30, usedDays: 12 },
  ];

  return { name: seed.name, users, departments, positions, employees, jobs, applications, attendance, leaves, balances };
}

export function createDatabase(): Record<string, TenantDb> {
  return Object.fromEntries(SEEDS.map((seed) => [seed.tenantId, buildTenant(seed)]));
}
