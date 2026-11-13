/** Tipos de las respuestas de cada API, según los handlers de services/<nombre>. */

export type Role = 'ADMIN_RRHH' | 'MANAGER' | 'EMPLOYEE';
export const ROLES: Role[] = ['ADMIN_RRHH', 'MANAGER', 'EMPLOYEE'];

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OffsetPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ItemsResponse<T> {
  items: T[];
}

// ── Identity ────────────────────────────────────────────────────────────────
export type UserStatus = 'ACTIVE' | 'INVITED' | 'DISABLED';

export interface User {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  employeeId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface LoginRequest {
  tenantId: string;
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  tokenType: 'Bearer';
  user: User;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  role: Role;
  password: string;
}

export interface UpdateUserRequest {
  name?: string;
  role?: Role;
  status?: 'ACTIVE' | 'DISABLED';
  password?: string;
}

// ── Employees ───────────────────────────────────────────────────────────────
export type EmployeeStatus = 'ACTIVE' | 'TERMINATED';

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  documentNumber: string;
  phone: string | null;
  hireDate: string;
  terminationDate: string | null;
  status: EmployeeStatus;
  salary: number;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionTitle: string | null;
  managerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeInput {
  firstName: string;
  lastName: string;
  email: string;
  documentNumber: string;
  phone: string | null;
  hireDate: string;
  salary: number;
  departmentId: string | null;
  positionId: string | null;
  managerId: string | null;
}

export type EmployeeChanges = Partial<Omit<EmployeeInput, 'email'>>;

export interface EmployeeFilters {
  limit?: number;
  offset?: number;
  departmentId?: string;
  status?: EmployeeStatus | '';
  q?: string;
}

export interface Department {
  id: string;
  name: string;
  createdAt: string;
}

export interface Position {
  id: string;
  title: string;
  departmentId: string;
  departmentName: string;
  minSalary: number | null;
  maxSalary: number | null;
}

export interface PositionInput {
  title: string;
  departmentId: string;
  minSalary?: number | null;
  maxSalary?: number | null;
}

// ── Recruitment ─────────────────────────────────────────────────────────────
export type JobStatus = 'OPEN' | 'CLOSED';

export interface Job {
  jobId: string;
  title: string;
  description: string;
  location: string;
  openings: number;
  status: JobStatus;
  departmentId?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobInput {
  title: string;
  description?: string;
  location?: string;
  openings?: number;
  status?: JobStatus;
  departmentId?: string | null;
}

export type Stage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED';

export interface Application {
  applicationId: string;
  jobId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stage: Stage;
  cvKey: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
}

export interface StageChangeRequest {
  stage: Stage;
  notes?: string;
  /** Solo para HIRED. */
  startDate?: string;
  /** Solo para HIRED. */
  salary?: number;
}

export interface CvUploadUrlResponse {
  uploadUrl: string;
  cvKey: string;
}

export interface CvDownloadUrlResponse {
  downloadUrl: string;
}

// ── Time & Leave ────────────────────────────────────────────────────────────
export interface AttendanceRecord {
  email: string;
  date: string;
  checkIn: string;
  checkOut?: string;
  workedMinutes?: number;
}

export type LeaveType = 'VACATION' | 'SICK' | 'PERSONAL';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  requestId: string;
  email: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface LeaveRequestInput {
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface Balance {
  email: string;
  year: number;
  vacationDays: number;
  usedDays: number;
  availableDays: number;
}
