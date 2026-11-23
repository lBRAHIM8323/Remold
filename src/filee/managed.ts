// The copy of Filee that Remold downloads and keeps up to date in its own storage, so users don't have to install
// Filee. Only its command line is used. No VS Code dependency so tests can use it.
//
// Layout of the storage folder:
//   versions/<version>/   the unpacked official package
//   data/                 Filee's settings, logs and downloaded engines (FILEE_DATA_DIR), kept across updates
//   current.json          { version, program } of the copy in use
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FileeCli } from './cli';
import { Release, RELEASES_API, compareVersions, isSupportedVersion, packageFor, parseChecksums, parseRelease, verifySignature } from './release';

export interface Installed {
    readonly version: string;
    /** Absolute path of filee-cli. */
    readonly program: string;
}

export interface ManagedOptions {
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    /** Where the releases list comes from (tests serve their own). */
    readonly releasesApi?: string;
    readonly publicKey?: string;
    readonly fetch?: typeof fetch;
}

export class ManagedFilee {
    private readonly platform: NodeJS.Platform;
    private readonly arch: string;
    private readonly api: string;
    private readonly fetch: typeof fetch;

    constructor(readonly root: string, private readonly options: ManagedOptions = {}) {
        this.platform = options.platform ?? process.platform;
        this.arch = options.arch ?? process.arch;
        this.api = options.releasesApi ?? RELEASES_API;
        this.fetch = options.fetch ?? fetch;
    }

    /** Whether Filee publishes a package for this computer. */
    get supported(): boolean {
        return packageFor(MIN_PLACEHOLDER, this.platform, this.arch) !== undefined;
    }

    /** Filee's data folder for this copy: give it to Filee as FILEE_DATA_DIR. */
    get dataDirectory(): string {
        return path.join(this.root, 'data');
    }

    /** The environment to run this copy with. */
    environment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
        return { ...base, FILEE_DATA_DIR: this.dataDirectory };
    }

    /** The copy in use, if one is installed and still there. */
    current(): Installed | undefined {
        try {
            const current = JSON.parse(readFileSync(path.join(this.root, 'current.json'), 'utf8')) as Installed;
            return existsSync(current.program) ? current : undefined;
        } catch {
            return undefined;
        }
    }

    /** The newest release Remold supports, from GitHub. */
    async latest(signal?: AbortSignal): Promise<Release> {
        const response = await this.fetch(`${this.api}?per_page=20`, { headers: { Accept: 'application/vnd.github+json' }, signal });
        if (!response.ok)
            throw new Error(`GitHub answered ${response.status} for Filee's releases.`);
        const releases = ((await response.json()) as unknown[]).map(parseRelease)
            .filter((r): r is Release => !!r && isSupportedVersion(r.version) && !!this.files(r));
        if (releases.length === 0)
            throw new Error('No Filee release for this computer was found.');
        return releases.sort((a, b) => compareVersions(b.version, a.version))[0];
    }

    /** Bytes to download for `release` on this computer. */
    downloadSize(release: Release): number | undefined {
        return this.files(release)?.archive.size;
    }

    /** A newer supported release than the one installed, or undefined. */
    async update(signal?: AbortSignal): Promise<Release | undefined> {
        const latest = await this.latest(signal);
        const current = this.current();
        return !current || compareVersions(latest.version, current.version) > 0 ? latest : undefined;
    }

    /**
     * Downloads `release`, checks it against its signed checksum file, unpacks it, checks the program runs and
     * reports the same version, then makes it the copy in use and removes the older one. On any failure the copy in
     * use stays as it was.
     */
    async install(release: Release, onProgress?: (received: number, total: number) => void, signal?: AbortSignal): Promise<Installed> {
        const files = this.files(release);
        if (!files)
            throw new Error(`Filee ${release.version} has no package for ${this.platform} ${this.arch}.`);
        const { pkg, archive, checksums, signature } = files;
        mkdirSync(this.root, { recursive: true });
        // A folder of its own, so an install never touches another one's files.
        mkdirSync(path.join(this.root, 'downloads'), { recursive: true });
        const downloads = mkdtempSync(path.join(this.root, 'downloads', `${release.version}-`));
        try {
            // The checksum file is only trusted when Filee's update key signed it.
            const sums = Buffer.from(await (await this.get(checksums.url, signal)).arrayBuffer());
            const sig = await (await this.get(signature.url, signal)).text();
            if (!verifySignature(sums, sig, this.options.publicKey))
                throw new Error(`${checksums.name} isn't signed with Filee's update key; not installing.`);
            const expected = parseChecksums(sums.toString('utf8')).get(archive.name);
            if (!expected)
                throw new Error(`${checksums.name} doesn't list ${archive.name}.`);

            const file = path.join(downloads, archive.name);
            const actual = await this.download(archive, file, onProgress, signal);
            if (actual !== expected)
                throw new Error(`${archive.name} doesn't match its checksum; the download may be damaged.`);

            const target = path.join(this.root, 'versions', release.version);
            const staging = `${downloads}-unpacked`;
            rmSync(staging, { recursive: true, force: true });
            mkdirSync(staging, { recursive: true });
            await unpack(file, staging, signal);
            const program = path.join(staging, pkg.program);
            if (!existsSync(program))
                throw new Error(`${archive.name} has no ${pkg.program}.`);

            // The program must run and be the version that was downloaded.
            const version = await new FileeCli(program, this.environment()).version();
            if (version !== release.version)
                throw new Error(`The downloaded Filee says it is ${version}, not ${release.version}.`);

            rmSync(target, { recursive: true, force: true });
            mkdirSync(path.dirname(target), { recursive: true });
            renameSync(staging, target);
            const installed: Installed = { version: release.version, program: path.join(target, pkg.program) };
            writeFileSync(path.join(this.root, 'current.json'), JSON.stringify(installed, null, 2));
            // Older copies take a few hundred MB each.
            for (const other of readdirSync(path.join(this.root, 'versions')))
                if (other !== release.version)
                    rmSync(path.join(this.root, 'versions', other), { recursive: true, force: true });
            return installed;
        } finally {
            rmSync(downloads, { recursive: true, force: true });
            rmSync(`${downloads}-unpacked`, { recursive: true, force: true });
        }
    }

    private files(release: Release) {
        const pkg = packageFor(release.version, this.platform, this.arch);
        const find = (name: string | undefined) => release.assets.find(a => a.name === name);
        const archive = find(pkg?.archive), checksums = find(pkg?.checksums), signature = find(pkg && `${pkg.checksums}.sig`);
        return pkg && archive && checksums && signature ? { pkg, archive, checksums, signature } : undefined;
    }

    private async get(url: string, signal?: AbortSignal): Promise<Response> {
        const response = await this.fetch(url, { signal, redirect: 'follow' });
        if (!response.ok || !response.body)
            throw new Error(`Download failed (${response.status}): ${url}`);
        return response;
    }

    /** Saves the file and returns its SHA-256. */
    private async download(asset: { url: string; size: number }, file: string, onProgress?: (received: number, total: number) => void, signal?: AbortSignal): Promise<string> {
        const response = await this.get(asset.url, signal);
        const total = Number(response.headers.get('content-length')) || asset.size;
        const hash = createHash('sha256');
        let received = 0;
        const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
        body.on('data', (chunk: Buffer) => {
            hash.update(chunk);
            received += chunk.length;
            onProgress?.(received, total);
        });
        await pipeline(body, createWriteStream(file), { signal });
        return hash.digest('hex');
    }
}

/** Any version works for asking whether a platform has packages at all. */
const MIN_PLACEHOLDER = '0.0.0';

/**
 * Unpacks a .tar.gz or .zip with the system's tar (GNU tar on Linux, bsdtar on macOS and on Windows 10 and later,
 * which also reads zip files).
 */
function unpack(archive: string, folder: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('tar', ['-xf', archive, '-C', folder], { stdio: ['ignore', 'ignore', 'pipe'], signal, windowsHide: true });
        let error = '';
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => { error += chunk; });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`Couldn't unpack ${path.basename(archive)}: ${error.trim() || `tar exit code ${code}`}`)));
    });
}
