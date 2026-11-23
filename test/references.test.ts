// Which mentions of an image count as references to it.
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { findReferences } from '../src/references';

const root = path.join(path.sep, 'repo');
const source = path.join(root, 'public', 'img', 'cat.png');
const docInImg = path.join(root, 'public', 'img', 'page.md');
const docInSrc = path.join(root, 'src', 'components', 'Hero.tsx');
const docInPublic = path.join(root, 'public', 'index.html');

const matched = (text: string, doc: string) => findReferences(text, doc, source, [root]).map(m => text.slice(m.start, m.end));

test('relative paths from the document', () => {
    assert.deepEqual(matched('<img src="img/cat.png">', docInPublic), ['cat.png']);
    assert.deepEqual(matched('<img src="./img/cat.png">', docInPublic), ['cat.png']);
    assert.deepEqual(matched('![a cat](cat.png)', docInImg), ['cat.png']);
    assert.deepEqual(matched("import cat from '../../public/img/cat.png';", docInSrc), ['cat.png']);
});

test('CSS url() with and without quotes', () => {
    const css = path.join(root, 'public', 'style.css');
    assert.deepEqual(matched('a { background: url(img/cat.png); b: url("img/cat.png") }', css), ['cat.png', 'cat.png']);
});

test('root-relative and alias paths match by the end of the source path', () => {
    assert.deepEqual(matched('<Image src="/img/cat.png" />', docInSrc), ['cat.png']);
    assert.deepEqual(matched("import cat from '@/img/cat.png'", docInSrc), ['cat.png']);
    assert.deepEqual(matched("const a = '~/img/cat.png'", docInSrc), ['cat.png']);
});

test('paths relative to a workspace root', () => {
    assert.deepEqual(matched('"public/img/cat.png"', path.join(root, 'config', 'site.json')), ['cat.png']);
});

test('query strings and sentence ends are fine', () => {
    assert.deepEqual(matched('<img src="img/cat.png?v=2">', docInPublic), ['cat.png']);
    assert.deepEqual(matched('See cat.png.', docInImg), ['cat.png']);
});

test('other files are left alone', () => {
    assert.deepEqual(matched('bobcat.png and cat.png.bak and cat.pngx', docInImg), []);
    assert.deepEqual(matched('<img src="other/cat.png">', docInPublic), []);
    assert.deepEqual(matched('<img src="/other/cat.png">', docInSrc), []);
    assert.deepEqual(matched('<img src="https://example.com/img/cat.png">', docInPublic), []);
});

test('several references in one file', () => {
    assert.deepEqual(matched('![](cat.png) and ![](./cat.png)', docInImg), ['cat.png', 'cat.png']);
});
