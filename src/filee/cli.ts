// Runs Filee's command-line program and reads its JSON. No VS Code dependency so tests can use it.
import { spawn } from 'node:child_process';

/** One format from `filee formats --json`. */
export interface FileeFormat {
    readonly id: string;
    readonly name: string;
    readonly category: string;
    /** Without the dot; can contain dots ("tar.gz"). */
    readonly extensions: readonly string[];
    readonly writable: boolean;
}

/** `filee formats <id> --json`. */
export interface FileeFormatTargets extends FileeFormat {
    readonly targets: readonly string[];
    /** Targets that need an optional engine that isn't installed ("filee engines install …"). */
    readonly withEngines?: readonly string[];
}

/** One file of `filee convert --json`. */
export interface FileeFileResult {
    readonly source: string;
    readonly state: 'done' | 'failed' | 'skipped' | string;
    readonly outputs: readonly string[];
    readonly error?: string;
}

export interface FileeConvertResult {
    readonly target: string;
    readonly converted: number;
    readonly skipped: number;
    readonly failed: number;
    readonly files: readonly FileeFileResult[];
}

export interface ConvertOptions {
    /** Where the outputs go; undefined puts them next to the sources. */
    readonly outputFolder?: string;
    /** 1–100, for image targets. */
    readonly quality?: number;
    /** Called with each file's progress (0–1) as Filee reports it. */
    readonly onProgress?: (source: string, fraction: number) => void;
    /** Stops the conversion when it fires. */
    readonly signal?: AbortSignal;
}

/** One optional engine from `filee engines --json` (LibreOffice, Pandoc, FFmpeg, Calibre, Tesseract, …). */
export interface FileeEngine {
    readonly id: string;
    /** "installed", "owncopy" (the user's own or the system's), "notinstalled", … */
    readonly status: string;
    readonly downloadable?: boolean;
    readonly downloadSize?: number;
    /** Why Filee can't download it (install it with the system's package manager instead). */
    readonly unavailableReason?: string;
}

/** Filee is installed but answers in a way Remold can't use: too old (no --json) or broken. */
export class FileeVersionError extends Error {}

export class FileeCli {
    /**
     * @param program Filee's command-line program.
     * @param env The environment to run it with.
     * @param prefix Arguments before every command (tests run a script through Node this way).
     */
    constructor(readonly program: string, private readonly env: NodeJS.ProcessEnv = process.env, private readonly prefix: readonly string[] = []) {}

    /** "2.5.0" from `filee version`. */
    async version(): Promise<string> {
        const { stdout } = await this.run(['version']);
        const match = /(\d+\.\d+\.\d+\S*)/.exec(stdout);
        if (!match)
            throw new FileeVersionError(`Unexpected answer from "${this.program} version": ${stdout.trim().slice(0, 200)}`);
        return match[1];
    }

    async formats(): Promise<FileeFormat[]> {
        return (await this.json<{ formats: FileeFormat[] }>(['formats', '--json'])).formats;
    }

    async targets(formatId: string): Promise<FileeFormatTargets> {
        return this.json<FileeFormatTargets>(['formats', formatId, '--json']);
    }

    async engines(): Promise<FileeEngine[]> {
        return (await this.json<{ engines: FileeEngine[] }>(['engines', '--json'])).engines;
    }

    /** Downloads and installs an optional engine with Filee's own download and checks. */
    async installEngine(id: string, signal?: AbortSignal): Promise<void> {
        await this.run(['engines', 'install', id, '--quiet'], { signal });
    }

    /**
     * Converts `files` to `target`. Never replaces an existing file: Filee adds a number to the name instead.
     * Resolves with Filee's result also when some files failed; rejects when Filee couldn't run at all.
     */
    async convert(files: readonly string[], target: string, options: ConvertOptions = {}): Promise<FileeConvertResult> {
        const args = ['convert', ...files, '--to', target, '--json'];
        if (options.outputFolder)
            args.push('--output', options.outputFolder);
        if (options.quality !== undefined)
            args.push('--quality', String(Math.round(Math.min(100, Math.max(1, options.quality)))));
        const { stdout, stderr } = await this.run(args, {
            signal: options.signal,
            // Progress comes on stderr, one JSON object per line.
            onStderrLine: line => {
                if (!options.onProgress || !line.startsWith('{'))
                    return;
                try {
                    const event = JSON.parse(line) as { event?: string; source?: string; fraction?: number };
                    if (event.event === 'progress' && event.source && typeof event.fraction === 'number')
                        options.onProgress(event.source, event.fraction);
                    else if (event.event === 'file' && event.source)
                        options.onProgress(event.source, 1);
                } catch { /* not an event */ }
            },
            // Exit code 1 means "some failed", 3 "nothing to convert": the JSON still says what happened.
            okExitCodes: [0, 1, 3],
        });
        return parse<FileeConvertResult>(stdout, args, stderr);
    }

    private async json<T>(args: string[]): Promise<T> {
        const { stdout, stderr } = await this.run(args);
        return parse<T>(stdout, args, stderr);
    }

    private run(args: string[], options: { signal?: AbortSignal; onStderrLine?: (line: string) => void; okExitCodes?: number[] } = {}): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.program, [...this.prefix, ...args], { env: this.env, signal: options.signal, windowsHide: true });
            let stdout = '', stderr = '', pending = '';
            child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
            child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
                stderr += chunk;
                pending += chunk;
                const lines = pending.split(/\r?\n/);
                pending = lines.pop()!;
                for (const line of lines)
                    options.onStderrLine?.(line);
            });
            child.on('error', reject);
            child.on('close', code => {
                if ((options.okExitCodes ?? [0]).includes(code ?? -1))
                    resolve({ stdout, stderr });
                else
                    reject(new Error(`Filee stopped with exit code ${code}: ${(stderr || stdout).trim().split(/\r?\n/).filter(l => !l.startsWith('{')).slice(-3).join(' ') || 'no message'}`));
            });
        });
    }
}

function parse<T>(stdout: string, args: readonly string[], stderr: string): T {
    try {
        return JSON.parse(stdout) as T;
    } catch {
        throw new FileeVersionError(`Filee didn't answer "filee ${args.slice(0, 2).join(' ')} … --json" with JSON; it may be too old. ` +
            `${(stdout || stderr).trim().slice(0, 160)}`);
    }
}
