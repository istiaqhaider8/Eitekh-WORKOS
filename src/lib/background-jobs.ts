/**
 * Eitekh WorkOS Asynchronous Background Job Engine
 * Handles non-blocking background tasks (heavy exports, bulk updates, aggregations)
 */

export interface BackgroundJob<T = any> {
  id: string;
  type: 'EXPORT_CSV' | 'EXPORT_PDF' | 'EXPORT_JSON' | 'BULK_UPDATE' | 'RECONCILE' | 'CUSTOM';
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number; // 0 - 100
  userId: string;
  projectId?: string;
  orgId?: string;
  metadata?: Record<string, any>;
  result?: T;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

class BackgroundJobManager {
  private jobs: Map<string, BackgroundJob> = new Map();

  constructor() {
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.cleanOldJobs(), 10 * 60 * 1000);
    }
  }

  public enqueueJob<T = any>(
    type: BackgroundJob['type'],
    userId: string,
    executor: (job: BackgroundJob<T>, updateProgress: (p: number) => void) => Promise<T>,
    options?: { projectId?: string; orgId?: string; metadata?: Record<string, any> }
  ): string {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const job: BackgroundJob<T> = {
      id,
      type,
      status: 'QUEUED',
      progress: 0,
      userId,
      projectId: options?.projectId,
      orgId: options?.orgId,
      metadata: options?.metadata,
      createdAt: now,
    };

    this.jobs.set(id, job);

    // Execute asynchronously (non-blocking)
    setTimeout(async () => {
      job.status = 'PROCESSING';
      job.startedAt = new Date().toISOString();
      job.progress = 10;

      try {
        const updateProgress = (p: number) => {
          job.progress = Math.min(100, Math.max(0, Math.round(p)));
        };

        const result = await executor(job, updateProgress);
        job.status = 'COMPLETED';
        job.progress = 100;
        job.result = result;
        job.completedAt = new Date().toISOString();
      } catch (err: any) {
        job.status = 'FAILED';
        job.error = err.message || 'Background execution failed';
        job.completedAt = new Date().toISOString();
      }
    }, 0);

    return id;
  }

  public getJob(jobId: string): BackgroundJob | null {
    return this.jobs.get(jobId) || null;
  }

  public listUserJobs(userId: string): BackgroundJob[] {
    return Array.from(this.jobs.values())
      .filter((j) => j.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);
  }

  public cleanOldJobs() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    for (const [id, job] of this.jobs.entries()) {
      if (new Date(job.createdAt).getTime() < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}

export const backgroundJobManager = new BackgroundJobManager();
