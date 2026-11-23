// Downloading and installing Filee from a fake GitHub served on localhost: signed checksums, damaged downloads,
// a package whose program doesn't run, updates and rollback.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { ManagedFilee } from '../src/filee/managed';
import { fakeFilee } from './fakeFilee';

// The fake packages hold a shell-script Filee; Windows is covered by the integration test with real Filee.
const skip = process.platform === 'win32' && 'needs shell scripts';
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const files = new Map<string, Buffer>();
let server: Server, base = '';

/** Publishes a fake Filee release: a tar.gz with a filee-cli that says `says`, and its signed checksums. */
function publish(version: string, options: { says?: string; damage?: boolean; badSignature?: boolean; noProgram?: boolean } = {}): void {
    const work = mkdtempSync(path.join(tmpdir(), 'remold-release-'));
    const name = `Filee-${version}-linux-x64`;
    mkdirSync(path.join(work, name));
    if (!options.noProgram)
        copyFileSync(fakeFilee(options.says ?? version), path.join(work, name, 'filee-cli'));
    writeFileSync(path.join(work, name, 'readme.txt'), 'fake');
    execFileSync('tar', ['czf', `${name}.tar.gz`, name], { cwd: work });
    const archive = readFileSync(path.join(work, `${name}.tar.gz`));
    const sums = Buffer.from(`${createHash('sha256').update(archive).digest('hex')}  ${name}.tar.gz\n`);
    const signature = sign('sha256', options.badSignature ? Buffer.from('other') : sums, { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    files.set(`/${version}/${name}.tar.gz`, options.damage ? Buffer.concat([archive, Buffer.from('x')]) : archive);
    files.set(`/${version}/${name}-SHA256SUMS.txt`, sums);
    files.set(`/${version}/${name}-SHA256SUMS.txt.sig`, Buffer.from(signature));
}

function releasesJson(versions: string[]): Buffer {
    return Buffer.from(JSON.stringify(versions.map(version => {
        const name = `Filee-${version}-linux-x64`;
        return {
            tag_name: `v${version}`,
            assets: [`${name}.tar.gz`, `${name}-SHA256SUMS.txt`, `${name}-SHA256SUMS.txt.sig`].map(file => ({
                name: file, browser_download_url: `${base}/${version}/${file}`.replace('http://', 'https://'), size: files.get(`/${version}/${file}`)?.length ?? 0,
            })),
        };
    })));
}

before(async () => {
    server = createServer((request, response) => {
        const body = files.get(request.url!.replace(/\?.*$/, ''));
        response.writeHead(body ? 200 : 404, { 'content-length': body?.length ?? 0 });
        response.end(body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

/** fetch for the fake server: release asset URLs must be https, so map them back to http. */
const localFetch: typeof fetch = (input, init) => fetch(String(input).replace('https://', 'http://'), init);

function managed(versions: string[]): ManagedFilee {
    files.set('/releases', releasesJson(versions));
    return new ManagedFilee(mkdtempSync(path.join(tmpdir(), 'remold-managed-')), {
        platform: 'linux', arch: 'x64', releasesApi: `${base}/releases`, publicKey, fetch: localFetch,
    });
}

test('installs the newest supported release, checked and runnable', { skip }, async () => {
    publish('2.5.0');
    publish('2.6.0');
    publish('3.0.0');
    const filee = managed(['2.5.0', '2.6.0', '3.0.0']);
    const latest = await filee.latest();
    assert.equal(latest.version, '2.6.0', '3.x is not supported yet');
    let progress = 0;
    const installed = await filee.install(latest, received => { progress = received; });
    assert.equal(installed.version, '2.6.0');
    assert.ok(existsSync(installed.program));
    assert.ok(progress > 0);
    assert.deepEqual(filee.current(), installed);
    assert.equal(filee.environment({}).FILEE_DATA_DIR, path.join(filee.root, 'data'));
});

test('a damaged download, a bad signature, a missing program or a wrong version is not installed', { skip }, async () => {
    publish('2.7.0', { damage: true });
    publish('2.8.0', { badSignature: true });
    publish('2.9.0', { noProgram: true });
    publish('2.10.0', { says: '2.4.0' });
    const filee = managed(['2.7.0', '2.8.0', '2.9.0', '2.10.0']);
    const release = (version: string) => ({ version, assets: JSON.parse(releasesJson([version]).toString())[0].assets.map((a: { name: string; browser_download_url: string; size: number }) => ({ name: a.name, url: a.browser_download_url, size: a.size })) });
    await assert.rejects(filee.install(release('2.7.0')), /checksum/);
    await assert.rejects(filee.install(release('2.8.0')), /signed/);
    await assert.rejects(filee.install(release('2.9.0')), /has no/);
    await assert.rejects(filee.install(release('2.10.0')), /says it is 2.4.0/);
    assert.equal(filee.current(), undefined, 'nothing was installed');
});

test('an update replaces the old copy; a failed one keeps it', { skip }, async () => {
    publish('2.5.0');
    publish('2.11.0', { damage: true });
    publish('2.12.0');
    const filee = managed(['2.5.0']);
    await filee.install(await filee.latest());
    assert.equal(await filee.update(), undefined, 'up to date');

    files.set('/releases', releasesJson(['2.5.0', '2.11.0']));
    const broken = await filee.update();
    assert.equal(broken?.version, '2.11.0');
    await assert.rejects(filee.install(broken!));
    assert.equal(filee.current()?.version, '2.5.0', 'the working copy stays');

    files.set('/releases', releasesJson(['2.5.0', '2.11.0', '2.12.0']));
    const next = (await filee.update())!;
    await filee.install(next);
    assert.equal(filee.current()?.version, '2.12.0');
    assert.ok(!existsSync(path.join(filee.root, 'versions', '2.5.0')), 'the old copy is removed');
});

test('the download size comes from the release', { skip }, async () => {
    publish('2.5.0');
    const filee = managed(['2.5.0']);
    const release = await filee.latest();
    assert.equal(filee.downloadSize(release), files.get('/2.5.0/Filee-2.5.0-linux-x64.tar.gz')!.length);
});

test('a platform without packages is reported', () => {
    const filee = new ManagedFilee(mkdtempSync(path.join(tmpdir(), 'remold-managed-')), { platform: 'freebsd', arch: 'x64' });
    assert.equal(filee.supported, false);
});
