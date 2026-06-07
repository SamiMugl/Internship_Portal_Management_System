/**
 * In-memory queue mock for development without a Redis server.
 * Implements just enough of the Bull API that the application uses.
 * Cast to Bull.Queue at call sites via `as unknown as Bull.Queue`.
 */

import { EventEmitter } from 'events';

type MockJob = { id: string; data: unknown };
type MockProcessor = (job: MockJob) => Promise<void>;

export class MockQueue extends EventEmitter {
  readonly name: string;
  private processor: MockProcessor | null = null;

  constructor(name: string, _opts?: unknown) {
    super();
    this.name = name;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async add(data: unknown, _opts?: unknown): Promise<any> {
    const job: MockJob = { id: `mock-${Date.now()}`, data };

    if (this.processor) {
      setImmediate(() => {
        this.processor!(job).catch((err: Error) => {
          console.error(`[mock-queue:${this.name}] Job ${job.id} failed:`, err.message);
          this.emit('failed', job, err);
        });
      });
    }

    return job;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async process(...args: unknown[]): Promise<any> {
    const handler = args.find((arg): arg is MockProcessor => typeof arg === 'function');
    if (handler) {
      this.processor = handler;
    }
  }

  async close(): Promise<void> {
    // No-op
  }

  async getRepeatableJobs(): Promise<[]> {
    return [];
  }

  async removeRepeatableByKey(_key: string): Promise<void> {}
}
