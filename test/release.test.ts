// Picking Filee's package for each platform and checking a release is Filee's, with Filee 2.5.0's real signed
// checksum files (test/fixtures).
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compareVersions, isSupportedVersion, packageFor, parseChecksums, parseRelease, verifySignature } from '../src/filee/release';

const fixture = (name: string) => readFileSync(`test/fixtures/${name}`);

test('Filee 2.5.0\'s checksum files are signed with Filee\'s update key', () => {
    for (const name of ['Filee-2.5.0-linux-x64-SHA256SUMS.txt', 'Filee-2.5.0-SHA256SUMS.txt'])
        assert.ok(verifySignature(fixture(name), fixture(`${name}.sig`).toString()), name);
});

test('a changed checksum file, a wrong signature or another key fails', () => {
    const sums = fixture('Filee-2.5.0-linux-x64-SHA256SUMS.txt');
    const sig = fixture('Filee-2.5.0-linux-x64-SHA256SUMS.txt.sig').toString();
    const tampered = Buffer.from(sums.toString().replace(/^a/, 'b'));
    assert.ok(!verifySignature(tampered, sig));
    assert.ok(!verifySignature(sums, fixture('Filee-2.5.0-SHA256SUMS.txt.sig').toString()));
    assert.ok(!verifySignature(sums, 'not base64 at all'));
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const otherKey = other.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    assert.ok(!verifySignature(sums, sig, otherKey));
    // …and a file signed with that other key passes only with that key.
    const own = sign('sha256', sums, { key: other.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    assert.ok(verifySignature(sums, own, otherKey));
    assert.ok(!verifySignature(sums, own));
});

test('checksums are read per file name', () => {
    const sums = parseChecksums(fixture('Filee-2.5.0-SHA256SUMS.txt').toString());
    assert.equal(sums.get('Filee-2.5.0-win-Portable.zip'), 'a0e6c5f6b623f100c6ed6d4afae96f6efbee6c6e1ad790fe3e789fa4a9bfdf4f');
    assert.equal(sums.size, 4);
});

test('the package for each platform', () => {
    assert.deepEqual(packageFor('2.5.0', 'linux', 'x64'), {
        archive: 'Filee-2.5.0-linux-x64.tar.gz', checksums: 'Filee-2.5.0-linux-x64-SHA256SUMS.txt', program: 'Filee-2.5.0-linux-x64/filee-cli',
    });
    assert.equal(packageFor('2.5.0', 'darwin', 'arm64')?.program, 'Filee-2.5.0-osx-arm64/Filee.app/Contents/MacOS/filee-cli');
    assert.equal(packageFor('2.5.0', 'win32', 'x64')?.archive, 'Filee-2.5.0-win-Portable.zip');
    assert.equal(packageFor('2.5.0', 'win32', 'arm64')?.archive, 'Filee-2.5.0-win-arm64-Portable.zip');
    assert.equal(packageFor('2.5.0', 'win32', 'arm64')?.checksums, 'Filee-2.5.0-SHA256SUMS.txt');
    assert.equal(packageFor('2.5.0', 'linux', 'ia32'), undefined);
    assert.equal(packageFor('2.5.0', 'freebsd', 'x64'), undefined);
});

test('releases: versions, drafts and pre-releases', () => {
    assert.equal(parseRelease({ tag_name: 'v2.5.0', assets: [] })?.version, '2.5.0');
    assert.equal(parseRelease({ tag_name: 'v2.6.0-beta.1', assets: [] }), undefined);
    assert.equal(parseRelease({ tag_name: 'v2.6.0', prerelease: true, assets: [] }), undefined);
    assert.equal(parseRelease({ tag_name: 'v2.6.0', assets: [{ name: 'x', browser_download_url: 'http://insecure' }] })?.assets.length, 0);
});

test('supported versions: 2.5 up to, not including, 3.0', () => {
    assert.ok(isSupportedVersion('2.5.0'));
    assert.ok(isSupportedVersion('2.10.3'));
    assert.ok(!isSupportedVersion('2.4.9'));
    assert.ok(!isSupportedVersion('3.0.0'));
    assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
});
