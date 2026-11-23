// Talking to Filee: version, formats, targets, conversions with progress and failures, cancelling, the cached
// catalog, and a Filee too old to answer in JSON. Uses the fake Filee in fakeFilee.ts.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Catalog } from '../src/filee/catalog';
import { FileeCli, FileeVersionError } from '../src/filee/cli';
import { FAKE_FORMATS, fakeFilee, oldFilee } from './fakeFilee';

const work = () => mkdtempSync(path.join(tmpdir(), 'remold-filee-'));

test('version, formats and targets', async () => {
    const cli = new FileeCli(fakeFilee('2.5.0'));
    assert.equal(await cli.version(), '2.5.0');
    assert.equal((await cli.formats()).length, FAKE_FORMATS.length);
    assert.deepEqual((await cli.targets('docx')).targets, ['pdf', 'png']);
});

test('convert reports outputs, failures and progress', async () => {
    const dir = work();
    writeFileSync(path.join(dir, 'a.png'), 'png');
    writeFileSync(path.join(dir, 'bad.png'), 'bad');
    const progress: number[] = [];
    const result = await new FileeCli(fakeFilee()).convert([path.join(dir, 'a.png'), path.join(dir, 'bad.png')], 'webp', {
        quality: 80, onProgress: (_s, f) => progress.push(f),
    });
    assert.equal(result.converted, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.files[0].outputs, [path.join(dir, 'a.webp')]);
    assert.match(result.files[1].error!, /bad input/);
    assert.ok(progress.includes(0.5) && progress.includes(1));
});

test('convert passes the output folder and quality', async () => {
    const program = fakeFilee();
    const dir = work();
    writeFileSync(path.join(dir, 'a.png'), 'png');
    const result = await new FileeCli(program).convert([path.join(dir, 'a.png')], 'jpg', { outputFolder: path.join(dir, 'out'), quality: 140 });
    assert.ok(existsSync(path.join(dir, 'out', 'a.jpg')));
    assert.equal(result.files[0].state, 'done');
    const calls = readFileSync(path.join(path.dirname(program), 'calls.log'), 'utf8');
    assert.match(calls, /--output .*out --quality 100\n/, 'quality is clamped to 100');
});

test('a cancelled conversion rejects', async () => {
    const dir = work();
    writeFileSync(path.join(dir, 'a.png'), 'png');
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(new FileeCli(fakeFilee()).convert([path.join(dir, 'a.png')], 'jpg', { signal: abort.signal }));
});

test('a Filee without JSON is reported as too old', async () => {
    await assert.rejects(new FileeCli(oldFilee()).formats(), FileeVersionError);
});

test('a missing program rejects', async () => {
    await assert.rejects(new FileeCli('/nonexistent/filee').version());
});

test('the catalog is cached per program and version', async () => {
    const program = fakeFilee('3.0.0');
    const cache = path.join(work(), 'catalog.json');
    const first = await Catalog.load(new FileeCli(program), cache);
    assert.deepEqual(first.targetsOf('png'), ['jpg', 'webp', 'pdf', 'docx']);
    const callsAfterFirst = readFileSync(path.join(path.dirname(program), 'calls.log'), 'utf8').split('\n').length;
    const second = await Catalog.load(new FileeCli(program), cache);
    const callsAfterSecond = readFileSync(path.join(path.dirname(program), 'calls.log'), 'utf8').split('\n').length;
    assert.equal(callsAfterSecond - callsAfterFirst, 1, 'only "version" is asked again');
    assert.deepEqual(second.targetsOf('docx'), ['pdf', 'png']);
});
