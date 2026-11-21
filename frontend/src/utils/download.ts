import { ApiError } from '../api/http';

/** Lo mínimo de una pestaña abierta con window.open (inyectable en tests). */
export interface OpenedTab {
  opener: unknown;
  location: { href: string };
  close: () => void;
}

export type OpenTab = () => OpenedTab | null;

const defaultOpen: OpenTab = () => window.open('', '_blank');
const defaultFallback = (url: string) => window.location.assign(url);

/**
 * Descarga con URL prefirmada: la URL se pide recién al hacer clic (dura 5 minutos) y se abre
 * tal cual, sin Authorization (la firma de S3 va en la propia URL).
 * La pestaña se abre en el mismo clic para que el navegador no la bloquee como pop-up.
 */
export async function openFreshDownload(
  getUrl: () => Promise<{ downloadUrl: string }>,
  open: OpenTab = defaultOpen,
  fallback: (url: string) => void = defaultFallback,
): Promise<void> {
  const tab = open();
  try {
    const { downloadUrl } = await getUrl();
    if (typeof downloadUrl !== 'string' || !/^(https?:|blob:)/i.test(downloadUrl)) {
      throw new ApiError('El servidor no devolvió una URL de descarga válida.', 0);
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = downloadUrl;
    } else {
      fallback(downloadUrl);
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}

export const EXPIRED_LINK_HINT =
  'El enlace de descarga dura 5 minutos. Si venció, vuelve a pulsar «Descargar» para obtener uno nuevo.';
