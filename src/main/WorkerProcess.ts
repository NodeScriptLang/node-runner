import { ChildProcess, fork } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createConnection, Socket } from 'node:net';

import { ComputeTask } from './ComputeTask.js';
import { ComputeTimeoutError, WorkerError } from './errors.js';

const READINESS_TIMEOUT = 5000;

export class WorkerProcess {

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

    ready = false;
    tasksProcessed = 0;

    constructor(
        readonly process: ChildProcess,
        readonly socketFile: string,
    ) {
        process.once('exit', () => {
            this.ready = false;
        });
    }

    async compute(task: ComputeTask) {
        this.tasksProcessed += 1;
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
            });
            socket.once('error', error => {
                clearTimeout(timer);
                reject(error);
            });
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

    terminate(killTimeout = 60_000) {
        const { process } = this;
        if (process.exitCode == null) {
            const killTimer = setTimeout(() => {
                if (process.exitCode == null) {
                    process.kill('SIGKILL');
                }
            }, killTimeout).unref();
            process.once('exit', () => {
                clearTimeout(killTimer);
            });
            process.kill('SIGTERM');
        }
    }

    async waitForReady() {
        if (this.ready) {
            return;
        }
        const timeoutAt = Date.now() + READINESS_TIMEOUT;
        let i = 0;
        while (Date.now() < timeoutAt) {
            try {
                i += 1;
                await stat(this.socketFile);
                this.ready = true;
                return;
            } catch (error) {
                await new Promise(r => setTimeout(r, 10 * i));
            }
        }
        throw new WorkerError('Timeout waiting for worker readiness');
    }

}
