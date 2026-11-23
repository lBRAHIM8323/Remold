// Talking to Filee: version, formats, targets, conversions with progress and failures, cancelling, the cached
// catalog, and a Filee too old to answer in JSON. Uses the fake Filee in fakeFilee.ts.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Catalog } from '../src/filee/catalog';
import { FileeCli, FileeVersionError } from '../src/filee/cli';
import { FAKE_FORMATS, callsLog, fakeCli, oldFilee } from './fakeFilee';

const work = () => mkdtempSync(path.join(tmpdir(), 'remold-filee-'));

test('version, formats and targets', async () => {
    const cli = fakeCli('2.5.0');
    assert.equal(await cli.version(), '2.5.0');
    assert.equal((await cli.formats()).length, FAKE_FORMATS.length);
    assert.deepEqual((await cli.targets('docx')).targets, ['pdf', 'png']);
});

test('convert reports outputs, failures and progress', async () => {
    const dir = work();
    writeFileSync(path.join(dir, 'a.png'), 'png');
    writeFileSync(path.join(dir, 'bad.png'), 'bad');
    const progress: number[] = [];
    const result = await fakeCli().convert([path.join(dir, 'a.png'), path.join(dir, 'bad.png')], 'webp', {
        quality: 80, onProgress: (_s, f) => progress.push(f),
    });
    assert.equal(result.converted, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.files[0].outputs, [path.join(dir, 'a.webp')]);
    assert.match(result.files[1].error!, /bad input/);
    assert.ok(progress.includes(0.5) && progress.includes(1));
});

test('convert passes the output folder and quality', async () => {
    const cli = fakeCli();
    const dir = work();
    writeFileSync(path.join(dir, 'a.png'), 'png');
    const result = await cli.convert([path.join(dir, 'a.png')], 'jpg', { outputFolder: path.join(dir, 'out'), quality: 140 });
    assert.ok(existsSync(path.join(dir, 'out', 'a.jpg')));
    assert.equal(result.files[0].state, 'done');
    const calls = readFileSync(callsLog(cliScript(cli)), 'utf8');
    assert.match(calls, /--output .*out --quality 100\n/, 'quality is clamped to 100');
});

test('a cancelled conversion rejects', async () => {
    const dir = work();
    writeFileSync(path.join(dir, 'a.png'), 'png');
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(fakeCli().convert([path.join(dir, 'a.png')], 'jpg', { signal: abort.signal }));
});

test('a Filee without JSON is reported as too old', { skip: process.platform === 'win32' && 'needs a shell script' }, async () => {
    await assert.rejects(new FileeCli(oldFilee()).formats(), FileeVersionError);
});

test('a missing program rejects', async () => {
    await assert.rejects(new FileeCli('/nonexistent/filee').version());
});

test('the catalog works at once and reads targets in the background, then from the cache', async () => {
    const cli = fakeCli('3.0.0');
    const log = callsLog(cliScript(cli));
    const cache = path.join(work(), 'catalog.json');
    const first = await Catalog.load(cli, cache);
    assert.equal(first.formats.length, FAKE_FORMATS.length, 'formats right away');
    await first.ensureTargets(['/x.png']);
    assert.deepEqual(first.targetsOf('png'), ['jpg', 'webp', 'pdf', 'docx'], 'a file\'s targets on demand');
    await first.complete;
    assert.ok(first.isComplete);
    assert.deepEqual(first.withEnginesOf('docx'), ['epub']);
    assert.deepEqual(first.commonWithEngines(['/a.docx']), ['epub']);
    const callsAfterFirst = readFileSync(log, 'utf8').split('\n').length;
    const second = await Catalog.load(cli, cache);
    assert.ok(second.isComplete);
    assert.equal(readFileSync(log, 'utf8').split('\n').length - callsAfterFirst, 1, 'only "version" is asked again');
    assert.deepEqual(second.targetsOf('docx'), ['pdf', 'png']);
});

test('engines: list and install', async () => {
    const cli = fakeCli();
    const engines = await cli.engines();
    assert.deepEqual(engines.map(e => e.id), ['calibre', 'tesseract']);
    assert.equal(engines[1].unavailableReason, 'Use apt.');
    await cli.installEngine('calibre');
    await assert.rejects(cli.installEngine('tesseract'));
});

/** The fake's script (the first argument passed to Node). */
function cliScript(cli: FileeCli): string {
    return (cli as unknown as { prefix: string[] }).prefix[0];
}
