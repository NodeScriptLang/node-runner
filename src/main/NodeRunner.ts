import path from 'node:path';

import { mkdir } from 'fs/promises';
import { Event } from 'nanoevent';

import { ComputeTask } from './ComputeTask.js';
import { InvalidStateError } from './errors.js';
import { WorkerProcess } from './WorkerProcess.js';

export interface WorkerQueueConfig {
    workDir: string;
    workerPoolSize: number;
    workerKillTimeout: number;
    queueWaitTimeout: number;
    workerRecycleThreshold: number;
}

/**
 * Maintains a queue of pre-spawned workers, ready to execute tasks in isolated subprocesses.
 */
export class NodeRunner {

    onSpawn = new Event<void>();
    onRecycle = new Event<void>();

    private workerPool: WorkerProcess[] = [];
    private running = false;
    private populating = false;

    constructor(
        readonly config: WorkerQueueConfig,
    ) {}

    async start() {
        if (this.running) {
            return;
        }
        this.running = true;
        await mkdir(this.config.workDir, { recursive: true });
        await this.populatePool();
    }

    async stop() {
        this.running = false;
        const workers = this.workerPool;
        this.workerPool = [];
        for (const worker of workers) {
            worker.terminate(this.config.workerKillTimeout);
        }
        await Promise.all(workers.map(_ => _.waitForTerminate()));
    }

    async compute(task: ComputeTask) {
        if (!this.running) {
            throw new InvalidStateError('Cannot compute: runner is not ready');
        }
        const worker = await this.grabWorker();
        return await worker.compute(task);
    }

    private async grabWorker(): Promise<WorkerProcess> {
        while (true) {
            const worker = this.workerPool.shift();
            if (!worker) {
                // Edge case: pool is drained, so wait synchronously for the pool to be re-populated
                await this.populatePool();
                continue;
            }
            if (!worker.ready) {
                // Just grab the next one
                this.populateInBackground();
                continue;
            }
            if (worker.tasksProcessed > this.config.workerRecycleThreshold) {
                worker.terminate(this.config.workerKillTimeout);
                this.populateInBackground();
                this.onRecycle.emit();
                continue;
            }
            this.workerPool.push(worker);
            return worker;
        }
    }

    private populateInBackground() {
        setTimeout(() => this.populatePool(), 0).unref();
    }

    private async populatePool() {
        if (this.populating) {
            return;
        }
        this.populating = true;
        try {
            const promises: Promise<WorkerProcess>[] = [];
            for (let i = this.workerPool.length; i < this.config.workerPoolSize; i++) {
                promises.push(this.spawnWorker());
            }
            const workers = await Promise.all(promises);
            this.workerPool.push(...workers);
        } finally {
            this.populating = false;
        }
    }

    private async spawnWorker() {
        const id = Math.random().toString(16).substring(2);
        const socketFile = path.join(this.config.workDir, id + '.sock');
        const worker = await WorkerProcess.create(socketFile);
        this.onSpawn.emit();
        return worker;
    }

}
