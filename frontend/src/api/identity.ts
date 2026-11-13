import { request } from './http';
import type { CreateUserRequest, CursorPage, LoginRequest, LoginResponse, UpdateUserRequest, User } from './types';

const enc = encodeURIComponent;

export const identityApi = {
  login: (body: LoginRequest) =>
    request<LoginResponse>('identity', '/auth/login', { method: 'POST', body, auth: false }),

  me: (signal?: AbortSignal) => request<User>('identity', '/me', { signal }),

  listUsers: (params: { limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    request<CursorPage<User>>('identity', '/users', {
      query: { limit: params.limit, cursor: params.cursor },
      signal,
    }),

  createUser: (body: CreateUserRequest) => request<User>('identity', '/users', { method: 'POST', body }),

  updateUser: (email: string, body: UpdateUserRequest) =>
    request<User>('identity', `/users/${enc(email)}`, { method: 'PATCH', body }),
};
