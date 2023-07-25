import { ChildProcess, fork } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createConnection, Socket } from 'node:net';

import { Event } from 'nanoevent';

import { ComputeTask } from './ComputeTask.js';
import { ComputeTimeoutError, InvalidStateError, WorkerError } from './errors.js';

export class WorkerProcess {

    static terminatingWorkers = new Set<WorkerProcess>;

    static create(socketFile: string) {
        const modulePath = this.getWorkerBinary();
        const process = fork(modulePath, [
            socketFile,
        ], {
            stdio: 'inherit',
            execArgv: [
                '--experimental-network-imports',
                '--experimental-global-webcrypto',
                '--no-warnings',
            ],
            env: {},
        });
        const worker = new WorkerProcess(process, socketFile);
        return worker;
    }

    static getWorkerBinary() {
        return new URL('../bin/worker.js', import.meta.url).pathname;
    }

    onTaskFinished = new Event<void>();
    onProcessExit = new Event<void>();

    pendingTasks = 0;
    terminating = false;

    constructor(
        readonly process: ChildProcess,
        readonly socketFile: string,
    ) {
        this.process.on('exit', () => {
            WorkerProcess.terminatingWorkers.delete(this);
            this.onProcessExit.emit();
        });
    }

    async compute(task: ComputeTask) {
        if (this.process.killed) {
            throw new InvalidStateError('Worker has been destroyed');
        }
        this.pendingTasks += 1;
        const { moduleUrl, params, timeout } = task;
        const socket = await this.connect();
        return new Promise((resolve, reject) => {
            const payload = Buffer.from(JSON.stringify({ moduleUrl, params }), 'utf-8');
            socket.end(payload);
            const timer = setTimeout(() => {
                const err = new ComputeTimeoutError('Allocated compute time exceeded');
                reject(err);
            }, timeout);
            this.waitForOutput(socket).then(value => {
                clearTimeout(timer);
                resolve(value);
            }, error => reject(error));
            socket.once('error', error => {
                clearTimeout(timer);
                reject(error);
            });
        }).finally(() => {
            this.pendingTasks -= 1;
            this.onTaskFinished.emit();
        });
    }

    async connect(): Promise<Socket> {
        return new Promise((resolve, reject) => {
            const sock = createConnection(this.socketFile);
            sock.once('connect', () => resolve(sock));
            sock.once('error', err => reject(err));
        });
    }

    private async waitForOutput(socket: Socket) {
        const chunks: Buffer[] = [];
        for await (const chunk of socket) {
            chunks.push(chunk);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    }

    async waitForReady(timeout: number) {
        const timeoutAt = Date.now() + timeout;
        let i = 0;
        while (Date.now() < timeoutAt) {
            try {
                i += 1;
                await stat(this.socketFile);
                return;
            } catch (error) {
                await new Promise(r => setTimeout(r, 20 * i));
            }
        }
        throw new WorkerError('Timeout waiting for worker readiness');
    }

    scheduleTermination() {
        if (this.terminating) {
            return;
        }
        this.terminating = true;
        WorkerProcess.terminatingWorkers.add(this);
        this.onTaskFinished.on(() => {
            if (this.pendingTasks === 0) {
                this.process.kill('SIGTERM');
            }
        });
    }

    async terminate(killTimeout: number) {
        const { process } = this;
        return new Promise<void>(resolve => {
            if (process.exitCode != null) {
                return resolve();
            }
            const killTimer = setTimeout(() => {
                if (process.exitCode == null) {
                    process.kill('SIGKILL');
                }
                resolve();
            }, killTimeout).unref();
            process.once('exit', () => {
                clearTimeout(killTimer);
                resolve();
            });
            process.kill('SIGTERM');
        });
    }

}
