import { fork } from 'child_process';
import { Event } from 'nanoevent';

import { ComputeTask } from './ComputeTask.js';
import { QueueTimeoutError } from './errors.js';
import { WorkerProcess } from './WorkerProcess.js';

type TaskCallback = (worker: WorkerProcess) => void;

export interface WorkerQueueConfig {
    workersCount: number;
    workerKillTimeout: number;
    queueWaitTimeout: number;
}

/**
 * Maintains a queue of pre-spawned workers, ready to execute tasks in isolated subprocesses.
 */
export class WorkerQueue {

    onSpawn = new Event<{ type: 'backlog' | 'idle' }>();

    private idleWorkers: WorkerProcess[] = [];
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
        this.ensureCapacity();
    }

    async stop(force = false) {
        this.running = false;
        const workers = this.idleWorkers;
        this.idleWorkers = [];
        if (force) {
            for (const worker of workers) {
                worker.terminate();
            }
        }
    }

    async compute(task: ComputeTask) {
        // Spawn new worker as soon as we're free
        const worker = this.idleWorkers.shift();
        setTimeout(() => this.ensureCapacity(), 0).unref();
        if (!worker) {
            return await this.createDeferredTask(task);
        }
        return await worker.compute(task);
    }

    private getWorkerBinary() {
        return new URL('../bin/worker.js', import.meta.url).pathname;
    }

    private ensureCapacity() {
        while (this.idleWorkers.length < this.config.workersCount) {
            this.spawnWorker();
        }
    }

    private spawnWorker() {
        const modulePath = this.getWorkerBinary();
        const process = fork(modulePath, {
            stdio: ['pipe', 'pipe', 'inherit', 'ipc'],
            env: {},
        });
        const worker = new WorkerProcess(process, {
            killTimeout: this.config.workerKillTimeout,
        });
        process.once('exit', () => remove(this.idleWorkers, worker));
        // If we have a backlog of tasks, allocate workers for them first
        const queued = this.taskQueue.shift();
        if (queued) {
            queued(worker);
            this.onSpawn.emit({ type: 'backlog' });
        } else {
            this.idleWorkers.push(worker);
            this.onSpawn.emit({ type: 'idle' });
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
