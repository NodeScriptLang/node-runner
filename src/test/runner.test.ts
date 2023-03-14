import { codeToUrl } from '@nodescript/core/util';
import assert from 'assert';
import { tmpdir } from 'os';

import { ComputeTask } from '../main/ComputeTask.js';
import { NodeRunner } from '../main/NodeRunner.js';

const runner = new NodeRunner({
    workDir: tmpdir(),
    workerPoolSize: 2,
    queueWaitTimeout: 50,
    workerKillTimeout: 1000,
    workerRecycleThreshold: 5,
});

describe('NodeRunner', () => {

    beforeEach(() => runner.start());
    afterEach(() => runner.stop());

    it('computes code', async () => {
        const moduleUrl = codeToUrl(`export async function compute(params) { return "Hello, " + params.name; }`);
        const res = await runner.compute({
            moduleUrl,
            params: {
                name: 'World',
            },
            timeout: 1000,
        });
        assert.strictEqual(res, 'Hello, World');
    });

    it('does not allow accessing process global', async () => {
        const moduleUrl = codeToUrl(`export async function compute(params) { return "Process: " + typeof process }`);
        const res = await runner.compute({
            moduleUrl,
            params: {},
            timeout: 1000,
        });
        assert.strictEqual(res, 'Process: undefined');
    });

    it('does not allow accessing process via constructor.constructor hack', async () => {
        const moduleUrl = codeToUrl(`
        export async function compute(params, ctx) {
            const process = ctx.constructor.constructor("return process")();
            return 'Process: '+ typeof process;
        }`);
        const res = await runner.compute({
            moduleUrl,
            params: {},
            timeout: 1000,
        });
        assert.strictEqual(res, 'Process: undefined');
    });

    it('evaluates more tasks then workers available', async () => {
        const tasks = [1, 2, 3, 4, 5].map<ComputeTask>(i => {
            const moduleUrl = codeToUrl(`export async function compute(params) { return "Hello ${i}"; }`);
            return {
                moduleUrl,
                params: {},
                timeout: 1000,
            };
        });
        const results = await Promise.all(tasks.map(_ => runner.compute(_)));
        assert.deepEqual(results, [
            'Hello 1',
            'Hello 2',
            'Hello 3',
            'Hello 4',
            'Hello 5',
        ]);
    });

});
