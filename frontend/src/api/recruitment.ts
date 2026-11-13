import { putToPresignedUrl, request } from './http';
import type {
  Application,
  ApplicationInput,
  CursorPage,
  CvDownloadUrlResponse,
  CvUploadUrlResponse,
  Job,
  JobInput,
  JobStatus,
  Stage,
  StageChangeRequest,
} from './types';

const enc = encodeURIComponent;
export const CV_CONTENT_TYPE = 'application/pdf';

const appPath = (jobId: string, applicationId: string) =>
  `/jobs/${enc(jobId)}/applications/${enc(applicationId)}`;

/** Reglas de recruitment/src/repository.py: avance lineal y REJECTED desde cualquier etapa abierta. */
export const STAGES: Stage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];
const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  APPLIED: 'SCREENING',
  SCREENING: 'INTERVIEW',
  INTERVIEW: 'OFFER',
  OFFER: 'HIRED',
};

export function allowedTransitions(current: Stage): Stage[] {
  if (current === 'HIRED' || current === 'REJECTED') return [];
  const next = NEXT_STAGE[current];
  return next ? [next, 'REJECTED'] : ['REJECTED'];
}

export const recruitmentApi = {
  listJobs: (params: { status?: JobStatus | ''; limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    request<CursorPage<Job>>('recruitment', '/jobs', {
      query: { status: params.status, limit: params.limit, cursor: params.cursor },
      signal,
    }),

  getJob: (jobId: string, signal?: AbortSignal) => request<Job>('recruitment', `/jobs/${enc(jobId)}`, { signal }),

  createJob: (body: JobInput) => request<Job>('recruitment', '/jobs', { method: 'POST', body }),

  updateJob: (jobId: string, body: Partial<JobInput>) =>
    request<Job>('recruitment', `/jobs/${enc(jobId)}`, { method: 'PATCH', body }),

  listApplications: (jobId: string, params: { limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    request<CursorPage<Application>>('recruitment', `/jobs/${enc(jobId)}/applications`, {
      query: { limit: params.limit, cursor: params.cursor },
      signal,
    }),

  createApplication: (jobId: string, body: ApplicationInput) =>
    request<Application>('recruitment', `/jobs/${enc(jobId)}/applications`, { method: 'POST', body }),

  changeStage: (jobId: string, applicationId: string, body: StageChangeRequest) =>
    request<Application>('recruitment', `${appPath(jobId, applicationId)}/stage`, { method: 'PATCH', body }),

  cvUploadUrl: (jobId: string, applicationId: string, fileName: string) =>
    request<CvUploadUrlResponse>('recruitment', `${appPath(jobId, applicationId)}/cv-upload-url`, {
      method: 'POST',
      body: { fileName, contentType: CV_CONTENT_TYPE },
    }),

  cvDownloadUrl: (jobId: string, applicationId: string) =>
    request<CvDownloadUrlResponse>('recruitment', `${appPath(jobId, applicationId)}/cv-url`),

  /** Pide la URL prefirmada y hace el PUT directo a S3. */
  async uploadCv(jobId: string, applicationId: string, file: File): Promise<string> {
    const { uploadUrl, cvKey } = await recruitmentApi.cvUploadUrl(jobId, applicationId, file.name);
    await putToPresignedUrl(uploadUrl, file, CV_CONTENT_TYPE);
    return cvKey;
  },
};
