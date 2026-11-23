// What Filee can convert: its formats and each format's targets, read from Filee and cached per Filee version
// (asking Filee for every format's targets takes a while). No VS Code dependency so tests can use it.
import { readFile, writeFile } from 'node:fs/promises';
import type { FileeCli, FileeFormat } from './cli';

interface CachedCatalog {
    readonly program: string;
    readonly version: string;
    readonly formats: FileeFormat[];
    readonly targets: Record<string, string[]>;
}

export class Catalog {
    private readonly byId: Map<string, FileeFormat>;
    /** Extensions (lower case, no dot) longest first, so "tar.gz" wins over "gz". */
    private readonly extensions: { extension: string; format: FileeFormat }[];

    private constructor(readonly version: string, readonly formats: readonly FileeFormat[],
        private readonly targetMap: Readonly<Record<string, readonly string[]>>) {
        this.byId = new Map(formats.map(f => [f.id, f]));
        this.extensions = formats.flatMap(format => format.extensions.map(extension => ({ extension: extension.toLowerCase(), format })))
            .sort((a, b) => b.extension.length - a.extension.length);
    }

    /** Builds the catalog from data already read from Filee (tests use this directly). */
    static from(version: string, formats: FileeFormat[], targets: Record<string, string[]>): Catalog {
        return new Catalog(version, formats, targets);
    }

    /**
     * The catalog of the Filee at `cli.program`: from `cacheFile` when it was written for the same program and
     * version, otherwise read from Filee (several calls at a time) and saved there.
     */
    static async load(cli: FileeCli, cacheFile: string | undefined): Promise<Catalog> {
        const version = await cli.version();
        if (cacheFile) {
            try {
                const cached = JSON.parse(await readFile(cacheFile, 'utf8')) as CachedCatalog;
                if (cached.program === cli.program && cached.version === version)
                    return new Catalog(version, cached.formats, cached.targets);
            } catch { /* no cache yet, or unreadable: read from Filee */ }
        }
        const formats = await cli.formats();
        const targets: Record<string, string[]> = {};
        const queue = [...formats];
        await Promise.all(Array.from({ length: 6 }, async () => {
            for (let format = queue.shift(); format; format = queue.shift())
                targets[format.id] = [...(await cli.targets(format.id)).targets];
        }));
        if (cacheFile) {
            const cache: CachedCatalog = { program: cli.program, version, formats, targets };
            await writeFile(cacheFile, JSON.stringify(cache)).catch(() => undefined);
        }
        return new Catalog(version, formats, targets);
    }

    format(id: string): FileeFormat | undefined {
        return this.byId.get(id);
    }

    /** The format of a file, by its extension. */
    formatOf(file: string): FileeFormat | undefined {
        const name = file.replace(/^.*[\\/]/, '').toLowerCase();
        return this.extensions.find(e => name.endsWith(`.${e.extension}`) && name.length > e.extension.length + 1)?.format;
    }

    targetsOf(formatId: string): readonly string[] {
        return this.targetMap[formatId] ?? [];
    }

    /** Targets every one of `files` can be converted to, in Filee's order. */
    commonTargets(files: readonly string[]): string[] {
        const formats = files.map(f => this.formatOf(f));
        if (formats.length === 0 || formats.some(f => !f))
            return [];
        const [first, ...rest] = formats.map(f => this.targetsOf(f!.id));
        return first.filter(t => rest.every(r => r.includes(t)));
    }
}
