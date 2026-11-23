// Runs real conversions through the bundled worker (dist/worker.js), as the extension does.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { ConversionEngine } from '../src/engine';

const engine = new ConversionEngine(path.resolve('dist/worker.js'), path.resolve('dist/magick.wasm'));
const dir = mkdtempSync(path.join(tmpdir(), 'remold-'));
after(() => engine.dispose());

// A 1 × 1 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

test('converts a file and writes the output', async () => {
    const input = path.join(dir, 'red.png');
    writeFileSync(input, PNG);
    const output = path.join(dir, 'out', 'red.webp');
    await engine.convert({ input: input, outputPath: output, targetId: 'webp', quality: 80 });
    assert.equal(readFileSync(output).subarray(8, 12).toString('ascii'), 'WEBP');
});

test('estimate reports the size and writes nothing', async () => {
    const input = path.join(dir, 'estimate.png');
    writeFileSync(input, PNG);
    const size = await engine.estimate({ input, targetId: 'webp', quality: 80 });
    assert.ok(size > 0);
    assert.ok(!existsSync(path.join(dir, 'estimate.webp')));
});

test('converts bytes, as for a pasted image', async () => {
    const output = path.join(dir, 'pasted.webp');
    const size = await engine.convert({ input: { bytes: new Uint8Array(PNG), extension: 'png' }, outputPath: output, targetId: 'webp', quality: 80 });
    assert.equal(readFileSync(output).length, size);
});

test('never replaces an existing file', async () => {
    const input = path.join(dir, 'red2.png');
    writeFileSync(input, PNG);
    const output = path.join(dir, 'taken.jpg');
    writeFileSync(output, 'keep me');
    await assert.rejects(engine.convert({ input: input, outputPath: output, targetId: 'jpg', quality: 80 }), /EEXIST/);
    assert.equal(readFileSync(output, 'utf8'), 'keep me');
});

test('reports a file that is not an image', async () => {
    const input = path.join(dir, 'fake.png');
    writeFileSync(input, 'not an image');
    await assert.rejects(engine.convert({ input: input, outputPath: path.join(dir, 'fake.jpg'), targetId: 'jpg', quality: 80 }));
});
