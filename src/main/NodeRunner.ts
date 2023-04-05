import path from 'node:path';

import { mkdir } from 'fs/promises';
import { Event } from 'nanoevent';

import { ComputeTask } from './ComputeTask.js';
import { WorkerProcess } from './WorkerProcess.js';

export interface WorkerQueueConfig {
    workDir: string;
    workerReadinessTimeout: number;
    workerKillTimeout: number;
    recycleThreshold: number;
    retries: number;
}

/**
 * Maintains a queue of pre-spawned workers, ready to execute tasks in isolated subprocesses.
 */
export class NodeRunner {

    protected currentWorker: WorkerProcess | null = null;
    protected workerPromise: Promise<WorkerProcess> | null = null;

    tasksProcessed = 0;

    onSpawn = new Event<void>();
    onRecycle = new Event<void>();

    constructor(
        readonly config: WorkerQueueConfig,
    ) {}

    async start() {
        await mkdir(this.config.workDir, { recursive: true });
        await this.acquireWorker();
    }

    async stop() {
        const worker = this.currentWorker;
        this.currentWorker = null;
        this.workerPromise = null;
        if (worker) {
            worker.scheduleTermination();
        }
        const promises = [...WorkerProcess.terminatingWorkers]
            .map(_ => _.terminate(this.config.workerKillTimeout));
        await Promise.allSettled(promises);
    }

    async compute(task: ComputeTask) {
        this.tasksProcessed += 1;
        for (let i = 0; i <= this.config.retries; i++) {
            try {
                const worker = await this.acquireWorker();
                if (this.tasksProcessed % this.config.recycleThreshold === 0) {
                    // Schedule this worker for termination,
                    // the next task will be picked up by a different worker
                    this.workerPromise = null;
                    this.currentWorker = null;
                    worker.scheduleTermination();
                    this.onRecycle.emit();
                }
                return await worker.compute(task);
            } catch (err: any) {
                const socketFile = this.currentWorker?.socketFile;
                if (err.code === 'ECONNREFUSED' && socketFile && err.message.includes(socketFile)) {
                    this.workerPromise = null;
                    this.currentWorker = null;
                    continue;
                }
                throw err;
            }
        }
    }

    private acquireWorker(): Promise<WorkerProcess> {
        if (!this.workerPromise) {
            this.workerPromise = (async () => {
                if (!this.currentWorker) {
                    this.currentWorker = await this.spawnWorker();
                }
                return this.currentWorker;
            })();
        }
        return this.workerPromise;
    }

    private async spawnWorker() {
        const id = Math.random().toString(16).substring(2);
        const socketFile = path.join(this.config.workDir, id + '.sock');
        const worker = WorkerProcess.create(socketFile);
        await worker.waitForReady(this.config.workerReadinessTimeout);
        this.onSpawn.emit();
        worker.onProcessExit.on(() => {
            // If worker process exits and still active, it means it has crashed,
            // so let's swap it out
            if (this.currentWorker === worker) {
                this.currentWorker = null;
                this.workerPromise = null;
            }
        });
        return worker;
    }

}
