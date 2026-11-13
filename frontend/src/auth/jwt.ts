import type { Role } from '../api/types';
import { ROLES } from '../api/types';

/** Claims que el frontend lee del JWT. La firma la verifica el backend, nunca el frontend. */
export interface TokenClaims {
  sub: string;
  tenantId: string;
  role: Role;
  exp: number;
  iat?: number;
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Decodifica el payload. Devuelve null si el token no tiene la forma o los claims esperados. */
export function decodeToken(token: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    const { sub, tenantId, role, exp, iat } = payload;
    if (typeof sub !== 'string' || typeof tenantId !== 'string' || typeof exp !== 'number') return null;
    if (!ROLES.includes(role as Role)) return null;
    return { sub, tenantId, role: role as Role, exp, iat: typeof iat === 'number' ? iat : undefined };
  } catch {
    return null;
  }
}

/** Un token vencido (o a menos de `skewSeconds` de vencer) equivale a no tener sesión. */
export function isExpired(claims: Pick<TokenClaims, 'exp'>, nowMs = Date.now(), skewSeconds = 5): boolean {
  return claims.exp * 1000 <= nowMs + skewSeconds * 1000;
}
