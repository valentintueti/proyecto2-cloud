/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IDENTITY_API_URL?: string;
  readonly VITE_EMPLOYEES_API_URL?: string;
  readonly VITE_RECRUITMENT_API_URL?: string;
  readonly VITE_TIMELEAVE_API_URL?: string;
  /** Solo desarrollo: "true" usa el backend simulado de src/mocks. Se ignora en producción. */
  readonly VITE_USE_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
