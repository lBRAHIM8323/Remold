// Where Remold keeps its Filee, and removing it when the last VS Code using it uninstalls Remold.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { managedRoot, register, unregister } from '../src/filee/paths';

test('the folder per platform', () => {
    assert.equal(managedRoot('linux', {}, '/home/u'), '/home/u/.local/share/remold');
    assert.equal(managedRoot('linux', { XDG_DATA_HOME: '/data' }, '/home/u'), '/data/remold');
    assert.equal(managedRoot('darwin', {}, '/Users/u'), '/Users/u/Library/Application Support/Remold');
    assert.equal(managedRoot('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u'), 'C:\\Users\\u\\AppData\\Local\\Remold');
});

test('the copy stays while another VS Code uses it, and goes with the last one', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'remold-root-'));
    writeFileSync(path.join(root, 'current.json'), '{}');
    const stable = mkdtempSync(path.join(tmpdir(), 'remold-ext-')), insiders = mkdtempSync(path.join(tmpdir(), 'remold-ext-'));
    register(root, stable);
    register(root, insiders);
    register(root, stable);
    assert.equal(unregister(root, stable), false);
    assert.ok(existsSync(path.join(root, 'current.json')));
    assert.equal(unregister(root, insiders), true);
    assert.ok(!existsSync(root));
});

test('users whose folder is gone don\'t keep the copy', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'remold-root-'));
    mkdirSync(path.join(root, 'versions'));
    register(root, '/gone/extension');
    register(root, '/me/extension');
    assert.equal(unregister(root, '/me/extension', p => p !== '/gone/extension'), true);
    assert.ok(!existsSync(root));
});

test('nothing to remove', () => {
    assert.equal(unregister(path.join(tmpdir(), 'remold-never-created'), '/x'), false);
});
