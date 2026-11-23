// A batch through the real worker: outputs, name clashes within the batch, failures and cancelling.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { convertBatch } from '../src/conversion';
import { ConversionEngine } from '../src/engine';
import { targetById } from '../src/formats';

const engine = new ConversionEngine(path.resolve('dist/worker.js'), path.resolve('dist/magick.wasm'));
after(() => engine.dispose());
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

test('files with the same name get different outputs; a bad file fails alone', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'remold-batch-'));
    const a = path.join(dir, 'pic.png'), b = path.join(dir, 'pic.bmp'), bad = path.join(dir, 'bad.png');
    writeFileSync(a, PNG);
    writeFileSync(b, PNG); // a PNG named .bmp: ImageMagick reads it by its content
    writeFileSync(bad, 'nope');
    const progress: number[] = [];
    const result = await convertBatch(engine, [a, b, bad], targetById('webp')!, { quality: 80, outputFolder: '', onProgress: done => progress.push(done) });
    assert.deepEqual(result.converted.map(c => path.basename(c.output)), ['pic.webp', 'pic (1).webp']);
    assert.ok(result.converted.every(c => existsSync(c.output) && c.size > 0));
    assert.deepEqual(result.failed.map(f => path.basename(f.source)), ['bad.png']);
    assert.deepEqual(progress, [0, 1, 2, 3]);
});

test('cancelling stops before the next file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'remold-cancel-'));
    const files = ['a.png', 'b.png'].map(n => path.join(dir, n));
    files.forEach(f => writeFileSync(f, PNG));
    let calls = 0;
    const result = await convertBatch(engine, files, targetById('jpg')!, { quality: 80, outputFolder: '', isCancelled: () => calls++ > 0 });
    assert.equal(result.converted.length, 1);
});
