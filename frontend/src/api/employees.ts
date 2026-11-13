import { request } from './http';
import type {
  Department,
  Employee,
  EmployeeChanges,
  EmployeeFilters,
  EmployeeInput,
  ItemsResponse,
  OffsetPage,
  Position,
  PositionInput,
} from './types';

const enc = encodeURIComponent;

export const employeesApi = {
  list: (filters: EmployeeFilters, signal?: AbortSignal) =>
    request<OffsetPage<Employee>>('employees', '/employees', {
      query: {
        limit: filters.limit,
        offset: filters.offset,
        departmentId: filters.departmentId,
        status: filters.status,
        q: filters.q?.trim(),
      },
      signal,
    }),

  get: (id: string, signal?: AbortSignal) => request<Employee>('employees', `/employees/${enc(id)}`, { signal }),

  create: (body: EmployeeInput) => request<Employee>('employees', '/employees', { method: 'POST', body }),

  update: (id: string, body: EmployeeChanges) =>
    request<Employee>('employees', `/employees/${enc(id)}`, { method: 'PATCH', body }),

  terminate: (id: string, terminationDate: string) =>
    request<Employee>('employees', `/employees/${enc(id)}/terminate`, {
      method: 'POST',
      body: { terminationDate },
    }),

  listDepartments: (signal?: AbortSignal) =>
    request<ItemsResponse<Department>>('employees', '/departments', { signal }),

  createDepartment: (name: string) =>
    request<Department>('employees', '/departments', { method: 'POST', body: { name } }),

  listPositions: (departmentId?: string, signal?: AbortSignal) =>
    request<ItemsResponse<Position>>('employees', '/positions', { query: { departmentId }, signal }),

  createPosition: (body: PositionInput) =>
    request<Position>('employees', '/positions', { method: 'POST', body }),
};
