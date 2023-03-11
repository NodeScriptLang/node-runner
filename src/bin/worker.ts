import { GraphEvalContext } from '@nodescript/core/runtime';
import { evalEsmModule } from '@nodescript/core/util';
import WebSocket from 'isomorphic-ws';

import { WorkerError } from '../main/errors.js';

const process = global.process;

// Runtime globals
(global as any).process = undefined;
(global as any).WebSocket = WebSocket as any;

try {
    const inputChunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        inputChunks.push(chunk);
    }
    const inputBuffer = Buffer.concat(inputChunks);
    const { code, params } = parseInput(inputBuffer);
    const ctx = new GraphEvalContext();
    const { compute } = await evalEsmModule(code);
    const result = await compute(params, ctx);
    sendOutput(result);
    process.exit(0);
} catch (error: any) {
    sendOutput({
        name: error.name,
        message: error.message,
        status: error.status,
    });
    process.exit(1);
}

function parseInput(input: Buffer) {
    const i = input.indexOf('\n');
    if (i === -1) {
        throw new WorkerError('Invalid input payload, expected <codeLength>\\n');
    }
    const codeLengthBuffer = input.subarray(0, i);
    const codeLength = Number(codeLengthBuffer.toString('utf-8'));
    if (!codeLength) {
        throw new WorkerError('Invalid input payload, expected non-zero <codeLength>\\n');
    }
    const codeBuffer = input.subarray(i + 1, i + 1 + codeLength);
    const paramsBuffer = input.subarray(i + 1 + codeLength);
    return {
        code: codeBuffer.toString('utf-8'),
        params: JSON.parse(paramsBuffer.toString('utf-8')),
    };
}

function sendOutput(result: any) {
    const buf = Buffer.from(JSON.stringify(result), 'utf-8');
    process.stdout.end(buf);
}
