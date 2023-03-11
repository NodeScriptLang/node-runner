import { ChildProcess } from 'node:child_process';

import { Event } from 'nanoevent';

import { ComputeTask } from './ComputeTask.js';
import { ComputeTimeoutError } from './errors.js';

export interface WorkerOptions {
    killTimeout: number;
}

export class WorkerProcess {

    private onFinish = new Event<void>();
    private timer: any = null;

    constructor(
        readonly process: ChildProcess,
        readonly options: WorkerOptions,
    ) { }

    async compute(task: ComputeTask) {
        try {
            this.sendPayload(task);
            const res = await Promise.race([
                this.waitForOutput(),
                this.createTimeoutPromise(task.timeout),
            ]);
            this.onFinish.emit();
            return res;
        } finally {
            this.terminate();
        }
    }

    private sendPayload(task: ComputeTask) {
        // Simple protocol is used to send both code and params
        // see bin/worker.ts for receiving end
        const codeBuffer = Buffer.from(task.code, 'utf-8');
        const paramsBuffer = Buffer.from(JSON.stringify(task.params), 'utf-8');
        const data = Buffer.concat([
            Buffer.from(String(codeBuffer.byteLength) + '\n'),
            codeBuffer,
            paramsBuffer,
        ]);
        this.process.stdin!.end(data);
    }

    private async waitForOutput() {
        const chunks: Buffer[] = [];
        for await (const chunk of this.process.stdout!) {
            chunks.push(chunk);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    }

    private createTimeoutPromise(timeout: number) {
        return new Promise<void>((resolve, reject) => {
            this.timer = setTimeout(() => {
                reject(new ComputeTimeoutError('Allocated compute time exceeded'));
            }, timeout).unref();
            this.onFinish.once(() => {
                clearTimeout(this.timer);
                this.timer = null;
                resolve();
            });
        });
    }

    terminate() {
        if (this.process.exitCode != null) {
            return;
        }
        const killTimer = setTimeout(() => {
            if (this.process.exitCode == null) {
                this.process.kill('SIGKILL');
            }
        }).unref();
        this.process.once('exit', () => {
            clearTimeout(killTimer);
        });
        this.process.kill('SIGTERM');
    }

}
