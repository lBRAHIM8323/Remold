// Output naming: next to the source, in a relative or absolute folder, and never over an existing file.
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { outputPathFor } from '../src/outputPath';

const pics = path.resolve('/pics');
const source = path.join(pics, 'cat.png');

test('goes next to the source with the new extension', () => {
    assert.equal(outputPathFor(source, 'webp', '', () => false), path.join(pics, 'cat.webp'));
});

test('a relative output folder is inside the source folder', () => {
    assert.equal(outputPathFor(source, 'webp', 'converted', () => false), path.join(pics, 'converted', 'cat.webp'));
});

test('an absolute output folder is used as is', () => {
    const folder = path.resolve('/out');
    assert.equal(outputPathFor(source, 'jpg', folder, () => false), path.join(folder, 'cat.jpg'));
});

test('a taken name gets a number', () => {
    const taken = new Set([path.join(pics, 'cat.webp'), path.join(pics, 'cat (1).webp')]);
    assert.equal(outputPathFor(source, 'webp', '', p => taken.has(p)), path.join(pics, 'cat (2).webp'));
});

test('converting to the same format does not replace the source', () => {
    assert.equal(outputPathFor(source, 'png', '', p => p === source), path.join(pics, 'cat (1).png'));
});
