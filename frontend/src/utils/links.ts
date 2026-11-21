/**
 * Destino interno seguro para el link de una notificación, o null si no se debe navegar.
 * Solo se aceptan rutas de esta aplicación ("/jobs/123") o URLs absolutas del mismo origen.
 * Se rechazan otros dominios, "//host", "javascript:", "data:" y caracteres de control.
 */
export function safeInternalPath(link: string | null | undefined, origin: string): string | null {
  const raw = (link ?? '').trim();
  if (!raw || /[\u0000-\u001f\\]/.test(raw)) return null;
  if (raw.startsWith('/')) return raw.startsWith('//') ? null : raw;
  try {
    const url = new URL(raw);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
