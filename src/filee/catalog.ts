// What Filee can convert: its formats and each format's targets, read from Filee and cached per Filee version.
// Filee's list of formats comes in one call; each format's targets take one call each (about 300), so they are read in
// the background while the menus already work, and a format whose targets are needed sooner is asked for first.
// No VS Code dependency so tests can use it.
import { readFile, writeFile } from 'node:fs/promises';
import type { FileeCli, FileeFormat } from './cli';

interface CachedCatalog {
    readonly program: string;
    readonly version: string;
    readonly formats: FileeFormat[];
    readonly targets: Record<string, string[]>;
    readonly withEngines: Record<string, string[]>;
}

export class Catalog {
    private readonly byId: Map<string, FileeFormat>;
    /** Extensions (lower case, no dot) longest first, so "tar.gz" wins over "gz". */
    private readonly extensions: { extension: string; format: FileeFormat }[];
    private readonly targetMap = new Map<string, readonly string[]>();
    private readonly engineMap = new Map<string, readonly string[]>();
    private readonly inFlight = new Map<string, Promise<void>>();
    /** Settles when every format's targets are known. */
    readonly complete: Promise<void>;

    private constructor(readonly version: string, readonly formats: readonly FileeFormat[], private readonly cli: FileeCli | undefined,
        targets: Record<string, readonly string[]>, withEngines: Record<string, readonly string[]>, onComplete?: (catalog: Catalog) => Promise<void>) {
        this.byId = new Map(formats.map(f => [f.id, f]));
        this.extensions = formats.flatMap(format => format.extensions.map(extension => ({ extension: extension.toLowerCase(), format })))
            .sort((a, b) => b.extension.length - a.extension.length);
        for (const [id, list] of Object.entries(targets))
            this.targetMap.set(id, list);
        for (const [id, list] of Object.entries(withEngines))
            this.engineMap.set(id, list);
        this.complete = this.isComplete ? Promise.resolve() : this.fillAll().then(() => onComplete?.(this));
    }

    /** Builds a complete catalog from data already read from Filee (tests use this directly). */
    static from(version: string, formats: FileeFormat[], targets: Record<string, string[]>, withEngines: Record<string, string[]> = {}): Catalog {
        return new Catalog(version, formats, undefined, targets, Object.fromEntries(formats.map(f => [f.id, withEngines[f.id] ?? []])));
    }

    /**
     * The catalog of the Filee at `cli.program`: complete from `cacheFile` when it was written for the same program
     * and version; otherwise Filee's formats now and their targets in the background, saved to `cacheFile` when done.
     */
    static async load(cli: FileeCli, cacheFile: string | undefined): Promise<Catalog> {
        const version = await cli.version();
        if (cacheFile) {
            try {
                const cached = JSON.parse(await readFile(cacheFile, 'utf8')) as CachedCatalog;
                if (cached.program === cli.program && cached.version === version && cached.withEngines)
                    return new Catalog(version, cached.formats, cli, cached.targets, cached.withEngines);
            } catch { /* no cache yet, or unreadable: read from Filee */ }
        }
        const formats = await cli.formats();
        return new Catalog(version, formats, cli, {}, {}, async catalog => {
            if (!cacheFile)
                return;
            const cache: CachedCatalog = {
                program: cli.program, version, formats,
                targets: Object.fromEntries(formats.map(f => [f.id, [...catalog.targetsOf(f.id)]])),
                withEngines: Object.fromEntries(formats.map(f => [f.id, [...catalog.withEnginesOf(f.id)]])),
            };
            await writeFile(cacheFile, JSON.stringify(cache)).catch(() => undefined);
        });
    }

    get isComplete(): boolean {
        return this.formats.every(f => this.targetMap.has(f.id));
    }

    format(id: string): FileeFormat | undefined {
        return this.byId.get(id);
    }

    /** The format of a file, by its extension. */
    formatOf(file: string): FileeFormat | undefined {
        const name = file.replace(/^.*[\\/]/, '').toLowerCase();
        return this.extensions.find(e => name.endsWith(`.${e.extension}`) && name.length > e.extension.length + 1)?.format;
    }

    /** Whether the targets of a format are known yet. */
    hasTargets(formatId: string): boolean {
        return this.targetMap.has(formatId);
    }

    /** Targets with the engines installed now; empty while not known yet (see ensureTargets). */
    targetsOf(formatId: string): readonly string[] {
        return this.targetMap.get(formatId) ?? [];
    }

    /** Targets that need an optional engine that isn't installed. */
    withEnginesOf(formatId: string): readonly string[] {
        return this.engineMap.get(formatId) ?? [];
    }

    /** Reads the targets of these files' formats now, ahead of the background reading. */
    async ensureTargets(files: readonly string[]): Promise<void> {
        await Promise.all(files.map(f => this.formatOf(f)?.id).filter((id): id is string => !!id).map(id => this.fill(id)));
    }

    /** Targets every one of `files` can be converted to, in Filee's order (call ensureTargets first). */
    commonTargets(files: readonly string[]): string[] {
        return this.shared(files, id => this.targetsOf(id));
    }

    /** Targets every one of `files` could be converted to with an optional engine installed. */
    commonWithEngines(files: readonly string[]): string[] {
        return this.shared(files, id => [...this.targetsOf(id), ...this.withEnginesOf(id)]).filter(t => !this.commonTargets(files).includes(t));
    }

    private shared(files: readonly string[], of: (id: string) => readonly string[]): string[] {
        const formats = files.map(f => this.formatOf(f));
        if (formats.length === 0 || formats.some(f => !f))
            return [];
        const [first, ...rest] = formats.map(f => of(f!.id));
        return first.filter(t => rest.every(r => r.includes(t)));
    }

    private fill(id: string): Promise<void> {
        if (this.targetMap.has(id) || !this.cli)
            return Promise.resolve();
        let pending = this.inFlight.get(id);
        if (!pending) {
            pending = this.cli.targets(id).then(answer => {
                this.engineMap.set(id, answer.withEngines ?? []);
                this.targetMap.set(id, answer.targets);
            }).finally(() => this.inFlight.delete(id));
            this.inFlight.set(id, pending);
        }
        return pending;
    }

    private async fillAll(): Promise<void> {
        const queue = this.formats.map(f => f.id).filter(id => !this.targetMap.has(id));
        await Promise.all(Array.from({ length: 4 }, async () => {
            for (let id = queue.shift(); id; id = queue.shift())
                await this.fill(id).catch(() => undefined);
        }));
    }
}
