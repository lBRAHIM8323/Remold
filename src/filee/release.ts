// Filee's official releases on GitHub: which file to download for this computer, and checking that it is Filee's.
// Every release has SHA256SUMS files signed with Filee's update key (ECDSA P-256 over SHA-256; the same check as
// Filee's own updater, src/Filee.App/Services/UpdateSignature.cs). No VS Code dependency so tests can use it.
import { createPublicKey, verify } from 'node:crypto';

export const RELEASES_API = 'https://api.github.com/repos/KnifeLemon/Filee/releases';

/** The public half of Filee's update key (FileeUpdatePublicKey in Filee's Directory.Build.props). */
export const FILEE_UPDATE_PUBLIC_KEY =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE8mlW6UZaGmh9cKDhL25Bfl7SJscOpTzRvHrfZGsJOOOIP7zH58g/XyM59H3sDeV4QQRul3TeKqg2x6In1S+uUA==';

/** Filee versions Remold works with: the command line's JSON (--json) is from 2.5; a 3.x may change it. */
export const MIN_VERSION = '2.5.0';
export const BELOW_VERSION = '3.0.0';

export interface ReleaseAsset {
    readonly name: string;
    readonly url: string;
    readonly size: number;
}

export interface Release {
    readonly version: string;
    readonly assets: readonly ReleaseAsset[];
}

/** The files for one platform: the package, its checksum file, and where the command line is inside the package. */
export interface PlatformPackage {
    readonly archive: string;
    readonly checksums: string;
    /** Relative to the folder the package is unpacked into. */
    readonly program: string;
}

/** Undefined for a platform Filee doesn't publish packages for. */
export function packageFor(version: string, platform: NodeJS.Platform, arch: string): PlatformPackage | undefined {
    if (arch !== 'x64' && arch !== 'arm64')
        return undefined;
    switch (platform) {
        case 'linux': {
            const name = `Filee-${version}-linux-${arch}`;
            return { archive: `${name}.tar.gz`, checksums: `${name}-SHA256SUMS.txt`, program: `${name}/filee-cli` };
        }
        case 'darwin': {
            const name = `Filee-${version}-osx-${arch}`;
            return { archive: `${name}.tar.gz`, checksums: `${name}-SHA256SUMS.txt`, program: `${name}/Filee.app/Contents/MacOS/filee-cli` };
        }
        case 'win32':
            // One checksum file lists both Windows builds; the portable zip has filee-cli.exe at its root.
            return {
                archive: `Filee-${version}-win${arch === 'arm64' ? '-arm64' : ''}-Portable.zip`,
                checksums: `Filee-${version}-SHA256SUMS.txt`,
                program: 'filee-cli.exe',
            };
        default:
            return undefined;
    }
}

/** A release from GitHub's API ("tag_name": "v2.5.0"). */
export function parseRelease(json: unknown): Release | undefined {
    const release = json as { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: { name?: string; browser_download_url?: string; size?: number }[] };
    const version = /^v?(\d+\.\d+\.\d+)$/.exec(release?.tag_name ?? '')?.[1];
    if (!version || release.draft || release.prerelease)
        return undefined;
    const assets = (release.assets ?? [])
        .filter(a => a.name && a.browser_download_url?.startsWith('https://'))
        .map(a => ({ name: a.name!, url: a.browser_download_url!, size: a.size ?? 0 }));
    return { version, assets };
}

/** "hash  name" lines → name → lower-case hash. */
export function parseChecksums(text: string): Map<string, string> {
    const sums = new Map<string, string>();
    for (const line of text.split(/\r?\n/)) {
        const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
        if (match)
            sums.set(match[2].trim(), match[1].toLowerCase());
    }
    return sums;
}

/** Whether `signature` (base64 of the 64-byte r‖s form) signs `data` with `publicKey` (base64 SubjectPublicKeyInfo). */
export function verifySignature(data: Uint8Array, signature: string, publicKey = FILEE_UPDATE_PUBLIC_KEY): boolean {
    try {
        const key = createPublicKey({ key: Buffer.from(publicKey.trim(), 'base64'), format: 'der', type: 'spki' });
        if (key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
            return false;
        const bytes = Buffer.from(signature.trim(), 'base64');
        return bytes.length === 64 && verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, bytes);
    } catch {
        return false;
    }
}

/** -1, 0 or 1. Versions are "major.minor.patch". */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++)
        if ((pa[i] ?? 0) !== (pb[i] ?? 0))
            return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
    return 0;
}

export function isSupportedVersion(version: string): boolean {
    return compareVersions(version, MIN_VERSION) >= 0 && compareVersions(version, BELOW_VERSION) < 0;
}
