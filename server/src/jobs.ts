export interface JobEvent {
  stage: 'transcribe' | 'analyze' | 'export';
  pct: number; message?: string; done?: boolean; error?: string;
}

export class JobBus {
  private subs = new Map<string, Set<(e: JobEvent) => void>>();
  private running = new Map<string, Promise<unknown>>();

  emit(projectId: string, e: JobEvent) {
    this.subs.get(projectId)?.forEach((cb) => cb(e));
  }
  subscribe(projectId: string, cb: (e: JobEvent) => void) {
    if (!this.subs.has(projectId)) this.subs.set(projectId, new Set());
    this.subs.get(projectId)!.add(cb);
    return () => { this.subs.get(projectId)?.delete(cb); };
  }
  /** Runs fn, rejecting immediately if a job for this project is already running. */
  runExclusive<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    if (this.running.has(projectId)) return Promise.reject(new Error('Job already running'));
    const p = fn().finally(() => this.running.delete(projectId));
    this.running.set(projectId, p);
    return p;
  }
  isRunning(projectId: string) { return this.running.has(projectId); }
  async whenIdle(projectId: string) {
    await this.running.get(projectId)?.catch(() => {});
  }
}
