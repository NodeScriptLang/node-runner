import { createServer, Socket } from 'node:net';

import { GraphEvalContext } from '@nodescript/core/runtime';
import WebSocket from 'isomorphic-ws';

import { WorkerError } from '../main/errors.js';

const process = global.process;
const socketFile = process.argv.at(-1) ?? '';
if (!socketFile) {
    throw new WorkerError('Socket file not specified');
}

// Runtime globals
(globalThis as any).process = {
    // Note: those are required by isomorphic-ws
    env: {},
    nextTick,
};
(globalThis as any).WebSocket = WebSocket as any;

// IPC server
const server = createServer({
    allowHalfOpen: true,
}, serveClient);
server.listen(socketFile);

// Graceful termination
process.once('SIGTERM', () => {
    server.close(() => {
        process.exit(0);
    });
});

async function serveClient(socket: Socket) {
    const ctx = new GraphEvalContext();
    ctx.setLocal('ns:env', 'server');
    try {
        const payload = await readStream(socket);
        const {
            moduleUrl,
            params,
        } = JSON.parse(payload);
        const { compute } = await import(moduleUrl);
        const result = await compute(params, ctx);
        const output = Buffer.from(JSON.stringify(result), 'utf-8');
        socket.end(output, () => socket.destroy());
    } catch (error: any) {
        socket.end(Buffer.from(JSON.stringify({
            name: error.name,
            message: error.message,
            status: error.status,
        }), 'utf-8'), () => socket.destroy());
    } finally {
        await ctx.finalize();
    }
}

async function readStream(socket: Socket): Promise<string> {
    // Note reading with for await destroys the writeable stream for some reason
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        socket.on('data', chunk => {
            chunks.push(chunk);
        });
        socket.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf-8'));
        });
        socket.on('error', err => {
            reject(err);
        });
    });
}

function nextTick(callback: Function, ...args: any[]) {
    process.nextTick(callback, ...args);
}
