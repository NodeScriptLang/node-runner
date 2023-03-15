import path from 'node:path';

import { mkdir } from 'fs/promises';

import { ComputeTask } from './ComputeTask.js';
import { WorkerProcess } from './WorkerProcess.js';

export interface WorkerQueueConfig {
    workDir: string;
    workerReadinessTimeout: number;
    workerKillTimeout: number;
    recycleThreshold: number;
}

/**
 * Maintains a queue of pre-spawned workers, ready to execute tasks in isolated subprocesses.
 */
export class NodeRunner {

    protected currentWorker: WorkerProcess | null = null;
    protected workerPromise: Promise<WorkerProcess> | null = null;

    tasksProcessed = 0;

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
        const worker = await this.acquireWorker();
        if (this.tasksProcessed % this.config.recycleThreshold === 0) {
            this.workerPromise = null;
            this.currentWorker = null;
            worker.scheduleTermination();
        }
        return await worker.compute(task);
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
        return worker;
    }

}
