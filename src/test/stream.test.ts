import assert from 'assert';
import { Readable } from 'stream';

import { consumeChunkedStream } from '../shared/stream.js';

describe('consumeChunkedStream', () => {

    it('reads single payload from a single chunk', async () => {
        async function* stream() {
            yield Buffer.from('11\nHello world');
        }
        const payloads: string[] = [];
        for await (const payload of consumeChunkedStream(Readable.from(stream()))) {
            payloads.push(payload);
        }
        assert.deepStrictEqual(payloads, [
            'Hello world',
        ]);
    });

    it('reads single payload from multiple chunks', async () => {
        async function* stream() {
            yield Buffer.from('1');
            yield Buffer.from('1\nH');
            yield Buffer.from('ello world');
        }
        const payloads: string[] = [];
        for await (const payload of consumeChunkedStream(Readable.from(stream()))) {
            payloads.push(payload);
        }
        assert.deepStrictEqual(payloads, [
            'Hello world',
        ]);
    });

    it('reads multiple payloads from aligned chunks', async () => {
        async function* stream() {
            yield Buffer.from('11\nHello world');
            yield Buffer.from('7\nkthxbye');
        }
        const payloads: string[] = [];
        for await (const payload of consumeChunkedStream(Readable.from(stream()))) {
            payloads.push(payload);
        }
        assert.deepStrictEqual(payloads, [
            'Hello world',
            'kthxbye'
        ]);
    });

    it('reads multiple payloads from fragmented chunks', async () => {
        async function* stream() {
            yield Buffer.from('1');
            yield Buffer.from('1\nH');
            yield Buffer.from('ello worl');
            yield Buffer.from('d7');
            yield Buffer.from('\nkthxby');
            yield Buffer.from('e');
        }
        const payloads: string[] = [];
        for await (const payload of consumeChunkedStream(Readable.from(stream()))) {
            payloads.push(payload);
        }
        assert.deepStrictEqual(payloads, [
            'Hello world',
            'kthxbye'
        ]);
    });

});
