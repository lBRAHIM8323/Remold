// Where Remold looks for Filee on each operating system.
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { candidatePaths, locateFilee } from '../src/filee/locate';
import { fakeFilee } from './fakeFilee';

test('Linux: PATH first, then ~/.local/bin and the install folder', () => {
    const paths = candidatePaths('linux', { PATH: '/usr/bin:/opt/x' }, '/home/u');
    assert.deepEqual(paths, ['/usr/bin/filee', '/opt/x/filee', '/home/u/.local/bin/filee', '/home/u/.local/share/filee/application/filee-cli']);
});

test('macOS: the app bundle in ~/Applications and /Applications', () => {
    const paths = candidatePaths('darwin', { PATH: '' }, '/Users/u');
    assert.ok(paths.includes('/Users/u/Applications/Filee.app/Contents/MacOS/filee-cli'));
    assert.ok(paths.includes('/Applications/Filee.app/Contents/MacOS/filee-cli'));
});

test('Windows: the per-user and per-machine install, and the exe next to cli\\filee.cmd', () => {
    const paths = candidatePaths('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files', Path: 'C:\\Tools\\Filee\\cli' }, 'C:\\Users\\u');
    assert.equal(paths[0], 'C:\\Users\\u\\AppData\\Local\\Programs\\Filee\\filee-cli.exe');
    assert.ok(paths.includes('C:\\Program Files\\Filee\\filee-cli.exe'));
    assert.ok(paths.includes('C:\\Tools\\Filee\\filee-cli.exe'));
});

test('a configured path is used only if it exists', { skip: process.platform === 'win32' && 'POSIX paths' }, () => {
    const program = fakeFilee();
    assert.equal(locateFilee(program, 'linux', { PATH: '' }, '/nowhere'), program);
    assert.equal(locateFilee('/nonexistent/filee', 'linux', { PATH: '' }, '/nowhere'), undefined);
});

test('found on PATH', { skip: process.platform === 'win32' && 'POSIX paths' }, () => {
    const program = fakeFilee();
    assert.equal(locateFilee(undefined, 'linux', { PATH: path.dirname(program) }, '/nowhere'), program);
});
