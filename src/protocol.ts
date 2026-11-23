// Messages between the extension and the conversion worker.

/** The image to convert: a file, or bytes (a pasted image) with the extension of their format. */
export type WorkerInput =
    | { readonly path: string }
    | { readonly bytes: Uint8Array; readonly extension: string };

export type WorkerRequest =
    /** Convert and write `outputPath`; never replaces an existing file. */
    | { readonly id: number; readonly kind: 'convert'; readonly input: WorkerInput; readonly outputPath: string; readonly targetId: string; readonly quality: number }
    /** Convert in memory and report the output's size in bytes; writes nothing. */
    | { readonly id: number; readonly kind: 'estimate'; readonly input: WorkerInput; readonly targetId: string; readonly quality: number };

export type WorkerResponse =
    | { readonly id: number; readonly ok: true; readonly size: number }
    | { readonly id: number; readonly ok: false; readonly error: string };
