// Starts the conversion worker on first use and passes jobs to it. Has no VS Code dependency so tests can use it.
import { Worker } from 'node:worker_threads';
import type { WorkerInput, WorkerRequest, WorkerResponse } from './protocol';

export interface ConversionJob {
    /** A file path, or the image's bytes with the extension of their format. */
    readonly input: string | Extract<WorkerInput, { bytes: Uint8Array }>;
    readonly outputPath: string;
    readonly targetId: string;
    readonly quality: number;
}

export interface EstimateJob {
    readonly input: string;
    readonly targetId: string;
    readonly quality: number;
}

export class ConversionEngine {
    private worker: Worker | undefined;
    private nextId = 1;
    private readonly pending = new Map<number, { resolve(size: number): void; reject(error: Error): void }>();

    /**
     * @param workerPath The bundled worker script (dist/worker.js).
     * @param wasmPath ImageMagick's magick.wasm.
     */
    constructor(private readonly workerPath: string, private readonly wasmPath: string) {}

    /** Converts one image and writes the output. Resolves with its size in bytes; rejects with the reason it failed. */
    convert(job: ConversionJob): Promise<number> {
        const input = typeof job.input === 'string' ? { path: job.input } : job.input;
        return this.send({ id: this.nextId++, kind: 'convert', input, outputPath: job.outputPath, targetId: job.targetId, quality: job.quality });
    }

    /** The size in bytes `job.input` would have in the target format. Writes nothing. */
    estimate(job: EstimateJob): Promise<number> {
        return this.send({ id: this.nextId++, kind: 'estimate', input: { path: job.input }, targetId: job.targetId, quality: job.quality });
    }

    private send(request: WorkerRequest): Promise<number> {
        const worker = this.start();
        return new Promise((resolve, reject) => {
            this.pending.set(request.id, { resolve, reject });
            worker.postMessage(request);
        });
    }

    /** Stops the worker; pending conversions are rejected. */
    async dispose(): Promise<void> {
        const worker = this.worker;
        this.worker = undefined;
        this.failAll(new Error('Remold was stopped.'));
        await worker?.terminate();
    }

    private start(): Worker {
        if (this.worker)
            return this.worker;
        const worker = new Worker(this.workerPath, { workerData: { wasmPath: this.wasmPath } });
        worker.on('message', (response: WorkerResponse) => {
            const entry = this.pending.get(response.id);
            if (!entry)
                return;
            this.pending.delete(response.id);
            if (response.ok)
                entry.resolve(response.size);
            else
                entry.reject(new Error(response.error));
        });
        // A crash (for example WebAssembly running out of memory) fails the jobs in flight; the next job starts a new
        // worker.
        const lost = (error: Error) => {
            if (this.worker === worker)
                this.worker = undefined;
            this.failAll(error);
        };
        worker.on('error', lost);
        worker.on('exit', code => { if (code !== 0) lost(new Error(`The conversion worker stopped (exit code ${code}).`)); });
        worker.unref();
        this.worker = worker;
        return worker;
    }

    private failAll(error: Error): void {
        for (const entry of this.pending.values())
            entry.reject(error);
        this.pending.clear();
    }
}
