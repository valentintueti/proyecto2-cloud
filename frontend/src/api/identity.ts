import { request } from './http';
import type {
  CreateUserRequest,
  CursorPage,
  LoginRequest,
  LoginResponse,
  SignupRequest,
  SignupResponse,
  UpdateUserRequest,
  User,
} from './types';

const enc = encodeURIComponent;

export const identityApi = {
  login: (body: LoginRequest) =>
    request<LoginResponse>('identity', '/auth/login', { method: 'POST', body, auth: false }),

  /** Registro público de una empresa nueva. Nunca se reintenta automáticamente. */
  signup: (body: SignupRequest) =>
    request<SignupResponse>('identity', '/signup', { method: 'POST', body, auth: false }),

  me: (signal?: AbortSignal) => request<User>('identity', '/me', { signal }),

  listUsers: (params: { limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    request<CursorPage<User>>('identity', '/users', {
      query: { limit: params.limit, cursor: params.cursor },
      signal,
    }),

  createUser: (body: CreateUserRequest) => request<User>('identity', '/users', { method: 'POST', body }),

  updateUser: (email: string, body: UpdateUserRequest) =>
    request<User>('identity', `/users/${enc(email)}`, { method: 'PATCH', body }),

  /** 204 sin cuerpo. 400 si es el propio usuario; 409 si está vinculado a un empleado. */
  deleteUser: (email: string) => request<void>('identity', `/users/${enc(email)}`, { method: 'DELETE' }),
};
