import { codeToUrl } from '@nodescript/core/util';
import assert from 'assert';
import { tmpdir } from 'os';

import { ComputeTask } from '../main/ComputeTask.js';
import { NodeRunner } from '../main/NodeRunner.js';

const runner = new NodeRunner({
    workDir: tmpdir(),
    workerReadinessTimeout: 1000,
    workerKillTimeout: 1000,
    recycleThreshold: 5,
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

    it('does not allow accessing process env', async () => {
        const moduleUrl = codeToUrl(`export async function compute(params) { return "Env: " + Object.keys(process.env).length }`);
        const res = await runner.compute({
            moduleUrl,
            params: {},
            timeout: 1000,
        });
        assert.strictEqual(res, 'Env: 0');
    });

    it('does not allow accessing process via constructor.constructor hack', async () => {
        const moduleUrl = codeToUrl(`
        export async function compute(params, ctx) {
            const env = ctx.constructor.constructor("return Object.keys(process.env).length")();
            return 'Env: ' + env;
        }`);
        const res = await runner.compute({
            moduleUrl,
            params: {},
            timeout: 1000,
        });
        assert.strictEqual(res, 'Env: 0');
    });

    it('evaluates tasks in parallel', async () => {
        const range = [...new Array(10).keys()];
        const tasks = range.map<ComputeTask>(i => {
            const moduleUrl = codeToUrl(`export async function compute(params) { return "Hello ${i}"; }`);
            return {
                moduleUrl,
                params: {},
                timeout: 1000,
            };
        });
        const results = await Promise.all(tasks.map(_ => runner.compute(_)));
        assert.deepStrictEqual(results, range.map(i => `Hello ${i}`));
    });

});
