// The worker thread that runs conversions, so a large image never blocks VS Code's extension host.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { initializeImageMagick } from '@imagemagick/magick-wasm';
import { convertBytes } from './convert';
import { extensionOf, targetById } from './formats';
import type { WorkerInput, WorkerRequest, WorkerResponse } from './protocol';

const ready = readFile((workerData as { wasmPath: string }).wasmPath).then(wasm => initializeImageMagick(wasm));

// Requests are handled one after another: each conversion is synchronous, and a queue keeps memory use to one image.
let queue: Promise<void> = Promise.resolve();

parentPort!.on('message', (request: WorkerRequest) => {
    queue = queue.then(() => handle(request));
});

async function handle(request: WorkerRequest): Promise<void> {
    let response: WorkerResponse;
    try {
        await ready;
        const target = targetById(request.targetId);
        if (!target)
            throw new Error(`Unknown target format "${request.targetId}".`);
        const { bytes, extension } = await load(request.input);
        const output = convertBytes(bytes, target, { quality: request.quality, sourceExtension: extension });
        if (request.kind === 'convert') {
            await mkdir(dirname(request.outputPath), { recursive: true });
            // "wx" refuses to replace a file that appeared since the output name was chosen.
            await writeFile(request.outputPath, output, { flag: 'wx' });
        }
        response = { id: request.id, ok: true, size: output.length };
    } catch (error) {
        response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    parentPort!.postMessage(response);
}

async function load(input: WorkerInput): Promise<{ bytes: Uint8Array; extension: string }> {
    return 'path' in input
        ? { bytes: await readFile(input.path), extension: extensionOf(input.path) }
        : { bytes: input.bytes, extension: input.extension };
}
