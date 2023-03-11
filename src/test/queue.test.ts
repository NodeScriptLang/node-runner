import assert from 'assert';

import { ComputeTask } from '../main/ComputeTask.js';
import { WorkerQueue } from '../main/WorkerQueue.js';

const queue = new WorkerQueue({
    workersCount: 3,
    queueWaitTimeout: 50,
    workerKillTimeout: 1000,
});

describe('WorkerQueue', () => {

    beforeEach(() => queue.start());
    afterEach(() => queue.stop(true));

    it('computes code', async () => {
        const res = await queue.compute({
            code: `export async function compute(params) { return "Hello, " + params.name; }`,
            params: {
                name: 'World',
            },
            timeout: 1000,
        });
        assert.strictEqual(res, 'Hello, World');
    });

    it('does not allow accessing process global', async () => {
        const res = await queue.compute({
            code: `export async function compute(params) { return "Process: " + typeof process }`,
            params: {},
            timeout: 1000,
        });
        assert.strictEqual(res, 'Process: undefined');
    });

    it('does not allow accessing process via constructor.constructor hack', async () => {
        const res = await queue.compute({
            code: `export async function compute(params, ctx) {
                const process = ctx.constructor.constructor("return process")();
                return 'Process: '+ typeof process;
            }`,
            params: {},
            timeout: 1000,
        });
        assert.strictEqual(res, 'Process: undefined');
    });

    it('evaluates more tasks then workers available', async () => {
        const tasks = [1, 2, 3, 4, 5].map<ComputeTask>(i => {
            return {
                code: `export async function compute(params) { return "Hello ${i}"; }`,
                params: {},
                timeout: 1000,
            };
        });
        const results = await Promise.all(tasks.map(_ => queue.compute(_)));
        assert.deepEqual(results, [
            'Hello 1',
            'Hello 2',
            'Hello 3',
            'Hello 4',
            'Hello 5',
        ]);
    });

});
