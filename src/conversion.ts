// Converts a batch of files one after another through the engine. Shared by the donut and tests; no VS Code dependency.
import { existsSync } from 'node:fs';
import type { ConversionEngine } from './engine';
import type { TargetFormat } from './formats';
import { outputPathFor } from './outputPath';

export interface Converted {
    readonly source: string;
    readonly output: string;
    /** Size of the output in bytes. */
    readonly size: number;
}

export interface BatchOptions {
    readonly quality: number;
    readonly outputFolder: string;
    /** Called before each file with the number done so far. */
    readonly onProgress?: (done: number, total: number, file: string) => void;
    /** Checked before each file; true stops the batch. */
    readonly isCancelled?: () => boolean;
}

export interface BatchResult {
    readonly converted: Converted[];
    readonly failed: { readonly source: string; readonly error: string }[];
}

export async function convertBatch(engine: ConversionEngine, files: readonly string[], target: TargetFormat,
    options: BatchOptions): Promise<BatchResult> {
    // Names picked earlier in this batch count as taken, so a.png and a.jpg don't both become a.webp.
    const reserved = new Set<string>();
    const result: BatchResult = { converted: [], failed: [] };
    for (const [index, source] of files.entries()) {
        if (options.isCancelled?.())
            break;
        options.onProgress?.(index, files.length, source);
        const output = outputPathFor(source, target.id, options.outputFolder, p => reserved.has(p) || existsSync(p));
        reserved.add(output);
        try {
            const size = await engine.convert({ input: source, outputPath: output, targetId: target.id, quality: options.quality });
            result.converted.push({ source, output, size });
        } catch (error) {
            result.failed.push({ source, error: error instanceof Error ? error.message : String(error) });
        }
    }
    options.onProgress?.(files.length, files.length, '');
    return result;
}
