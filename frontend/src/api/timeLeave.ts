import { request } from './http';
import type {
  AttendanceRecord,
  Balance,
  CursorPage,
  ItemsResponse,
  LeaveRequest,
  LeaveRequestInput,
} from './types';

const enc = encodeURIComponent;

export interface DateRange {
  from?: string;
  to?: string;
}

export const timeLeaveApi = {
  checkIn: () => request<AttendanceRecord>('timeLeave', '/attendance/check-in', { method: 'POST' }),

  checkOut: () => request<AttendanceRecord>('timeLeave', '/attendance/check-out', { method: 'POST' }),

  myAttendance: (range: DateRange, signal?: AbortSignal) =>
    request<ItemsResponse<AttendanceRecord>>('timeLeave', '/attendance/me', {
      query: { from: range.from, to: range.to },
      signal,
    }),

  attendanceOf: (email: string, range: DateRange, signal?: AbortSignal) =>
    request<ItemsResponse<AttendanceRecord>>('timeLeave', '/attendance', {
      query: { email, from: range.from, to: range.to },
      signal,
    }),

  createLeave: (body: LeaveRequestInput) =>
    request<LeaveRequest>('timeLeave', '/leave-requests', { method: 'POST', body }),

  myLeaves: (params: { limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    request<CursorPage<LeaveRequest>>('timeLeave', '/leave-requests/me', {
      query: { limit: params.limit, cursor: params.cursor },
      signal,
    }),

  pendingLeaves: (params: { limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    request<CursorPage<LeaveRequest>>('timeLeave', '/leave-requests', {
      query: { status: 'PENDING', limit: params.limit, cursor: params.cursor },
      signal,
    }),

  cancelLeave: (requestId: string) =>
    request<LeaveRequest>('timeLeave', `/leave-requests/${enc(requestId)}/cancel`, { method: 'POST' }),

  approveLeave: (requestId: string) =>
    request<LeaveRequest>('timeLeave', `/leave-requests/${enc(requestId)}/approve`, { method: 'POST' }),

  rejectLeave: (requestId: string) =>
    request<LeaveRequest>('timeLeave', `/leave-requests/${enc(requestId)}/reject`, { method: 'POST' }),

  myBalance: (signal?: AbortSignal) => request<Balance>('timeLeave', '/balances/me', { signal }),
};
