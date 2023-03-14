import path from 'node:path';

import { mkdir } from 'fs/promises';
import { Event } from 'nanoevent';

import { ComputeTask } from './ComputeTask.js';
import { QueueTimeoutError } from './errors.js';
import { WorkerProcess } from './WorkerProcess.js';

type TaskCallback = (worker: WorkerProcess) => void;

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

    onSpawn = new Event<{ type: 'backlog' | 'idle' }>();
    onRecycle = new Event<void>();

    private workerPool: WorkerProcess[] = [];
    private taskQueue: TaskCallback[] = [];
    private running = false;

    constructor(
        readonly config: WorkerQueueConfig,
    ) {}

    async start() {
        if (this.running) {
            return;
        }
        this.running = true;
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
        const worker = this.grabWorker();
        if (worker) {
            this.recycleWorker(worker);
            return await worker.compute(task);
        }
        return await this.createDeferredTask(task);
    }

    private async populatePool() {
        await mkdir(this.config.workDir, { recursive: true });
        while (this.workerPool.length < this.config.workerPoolSize) {
            this.spawnWorker();
        }
        await Promise.all(this.workerPool.map(_ => _.waitForReady()));
    }

    private spawnWorker() {
        const id = Math.random().toString(16).substring(2);
        const socketFile = path.join(this.config.workDir, id + '.sock');
        const worker = WorkerProcess.create(socketFile);
        this.workerPool.push(worker);
        // If we have a backlog of tasks, allocate workers for them first
        const queued = this.taskQueue.shift();
        if (queued) {
            queued(worker);
            this.onSpawn.emit({ type: 'backlog' });
        } else {
            this.onSpawn.emit({ type: 'idle' });
        }
    }

    private grabWorker(): WorkerProcess | null {
        while (this.workerPool.length > 0) {
            const worker = this.workerPool.shift()!;
            if (!worker.ready) {
                return null;
            }
            return worker;
        }
        return null;
    }

    private recycleWorker(worker: WorkerProcess) {
        if (worker.tasksProcessed < this.config.workerRecycleThreshold) {
            this.workerPool.push(worker);
        } else {
            worker.terminate(this.config.workerKillTimeout);
            setTimeout(() => this.populatePool(), 0).unref();
            this.onRecycle.emit();
        }
    }

    private createDeferredTask(task: ComputeTask) {
        return new Promise((resolve, reject) => {
            const callback: TaskCallback = worker => {
                clearTimeout(timer);
                worker.compute(task).then(resolve, reject);
            };
            const timer = setTimeout(() => {
                reject(new QueueTimeoutError('Exceeded timeout waiting for a worker, please try again later.'));
                remove(this.taskQueue, callback);
            }, this.config.queueWaitTimeout);
            this.taskQueue.push(callback);
        });
    }

}

function remove<T>(arr: T[], item: T) {
    const i = arr.indexOf(item);
    if (i > -1) {
        arr.splice(i, 1);
    }
}
