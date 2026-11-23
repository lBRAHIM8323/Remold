// A stand-in for Filee's command-line program: answers like the real one for a few formats, so the tests don't need
// Filee installed. Writes it as an executable script and returns its path.
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FileeCli } from '../src/filee/cli';

/** A FileeCli for the fake: run through Node, so it works on Windows too. */
export function fakeCli(version = '9.9.9', env: NodeJS.ProcessEnv = process.env): FileeCli {
    const script = fakeFilee(version);
    return new FileeCli(process.execPath, env, [script]);
}

/** Where the fake logs its calls (one line per call). */
export const callsLog = (program: string) => path.join(path.dirname(program), 'calls.log');

export const FAKE_FORMATS = [
    { id: 'png', name: 'PNG', category: 'image', extensions: ['png'], writable: true },
    { id: 'jpg', name: 'JPG', category: 'image', extensions: ['jpg', 'jpeg', 'jfif'], writable: true },
    { id: 'webp', name: 'WEBP', category: 'image', extensions: ['webp'], writable: true },
    { id: 'pdf', name: 'PDF', category: 'pdf', extensions: ['pdf'], writable: true },
    { id: 'docx', name: 'DOCX', category: 'document', extensions: ['docx'], writable: true },
    { id: 'tgz', name: 'TAR.GZ', category: 'archive', extensions: ['tar.gz', 'tgz'], writable: true },
    { id: 'gz', name: 'GZ', category: 'archive', extensions: ['gz'], writable: false },
    { id: 'folder', name: 'Folder', category: 'archive', extensions: [], writable: true },
];

export const FAKE_TARGETS: Record<string, string[]> = {
    png: ['jpg', 'webp', 'pdf', 'docx'], jpg: ['png', 'webp', 'pdf'], webp: ['png', 'jpg'], pdf: ['png', 'jpg', 'docx'],
    docx: ['pdf', 'png'], tgz: ['folder'], gz: ['folder'], folder: [],
};

export function fakeFilee(version = '9.9.9'): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'fake-filee-'));
    const file = path.join(dir, 'filee');
    writeFileSync(file, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const formats = ${JSON.stringify(FAKE_FORMATS)}, targets = ${JSON.stringify(FAKE_TARGETS)};
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(dir, 'calls.log'))}, args.join(' ') + '\\n');
const out = s => process.stdout.write(JSON.stringify(s, null, 2));
if (args[0] === 'version') { console.log('filee ${version}'); process.exit(0); }
if (args[0] === 'formats' && args[1] === '--json') { out({ formats }); process.exit(0); }
if (args[0] === 'formats') { const f = formats.find(f => f.id === args[1]); out({ ...f, targets: targets[f.id], withEngines: f.id === 'docx' ? ['epub'] : [] }); process.exit(0); }
if (args[0] === 'engines' && args[1] === '--json') { out({ platform: 'fake', engines: [{ id: 'calibre', status: 'notinstalled', downloadable: true, downloadSize: 1000 }, { id: 'tesseract', status: 'notinstalled', downloadable: false, unavailableReason: 'Use apt.' }] }); process.exit(0); }
if (args[0] === 'engines' && args[1] === 'install') { process.exit(args[2] === 'calibre' ? 0 : 1); }
if (args[0] === 'convert') {
    const to = args[args.indexOf('--to') + 1];
    const outDir = args.includes('--output') ? args[args.indexOf('--output') + 1] : undefined;
    const sources = args.slice(1, args.indexOf('--to'));
    const files = sources.map(source => {
        process.stderr.write(JSON.stringify({ event: 'progress', source, fraction: 0.5 }) + '\\n');
        const content = fs.readFileSync(source, 'utf8');
        if (content.startsWith('bad')) return { source, state: 'failed', outputs: [], error: 'The engine reported an error (bad input)' };
        const folder = outDir ?? path.dirname(source);
        fs.mkdirSync(folder, { recursive: true });
        const base = path.basename(source).replace(/\\.[^.]+$/, '');
        let output = path.join(folder, base + '.' + to);
        for (let n = 1; fs.existsSync(output); n++) output = path.join(folder, base + ' (' + n + ').' + to);
        fs.writeFileSync(output, to.repeat(10));
        process.stderr.write(JSON.stringify({ event: 'file', source, state: 'done', outputs: [output] }) + '\\n');
        return { source, state: 'done', outputs: [output] };
    });
    const failed = files.filter(f => f.state === 'failed').length;
    out({ preset: to.toUpperCase(), target: to, converted: files.length - failed, skipped: 0, failed, files });
    process.exit(failed ? 1 : 0);
}
console.error('unknown command'); process.exit(2);
`);
    chmodSync(file, 0o755);
    return file;
}

/** A program that's "Filee 1.x": plain text where JSON is expected. */
export function oldFilee(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'old-filee-'));
    const file = path.join(dir, 'filee');
    writeFileSync(file, `#!/bin/sh
case "$1" in version) echo "filee 1.11.0";; *) echo "Image:"; echo "  png        PNG  .png";; esac
`);
    chmodSync(file, 0o755);
    return file;
}
