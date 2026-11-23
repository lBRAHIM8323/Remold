// Checks every conversion Filee offers through Remold's own Filee code (src/filee/cli.ts), and writes the results
// to .parity/ (not committed): results.json and CHECKLIST.md.
//
//   npm run parity -- [--filee <program>] [--only <format or category>] [--jobs 4] [--fresh] [--retry-failed]
//   npm run parity -- --checklist-only   (rewrites CHECKLIST.md from the results so far, converting nothing)
//
// Samples: a few starter files are written here (or copied from Filee's test folder when --filee-repo is given);
// every other format Filee can write is made from them with Filee itself. Formats Filee can only read and that no
// starter covers stay "no sample". Resumable: finished pairs are kept unless --fresh.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { Catalog } from '../src/filee/catalog';
import { FileeCli } from '../src/filee/cli';
import { locateFilee } from '../src/filee/locate';

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (name: string) => argv.includes(name);
const ROOT = path.resolve('.parity');
const SAMPLES = path.join(ROOT, 'samples'), OUT = path.join(ROOT, 'out'), RESULTS = path.join(ROOT, 'results.json');
const JOBS = Number(option('--jobs') ?? 4);
const TIMEOUT_MS = 180_000;

type Status = 'verified' | 'failed';
interface PairResult { status: Status; ms: number; error?: string; outputs?: number }

async function main(): Promise<void> {
    const program = option('--filee') ?? locateFilee(process.env.REMOLD_FILEE);
    if (!program)
        throw new Error('Filee not found: pass --filee <program> or set REMOLD_FILEE.');
    const cli = new FileeCli(program);
    mkdirSync(ROOT, { recursive: true });
    const catalog = await Catalog.load(cli, path.join(ROOT, 'catalog-cache.json'));
    console.log(`Filee ${catalog.version} at ${program}: ${catalog.formats.length} formats`);

    if (flag('--checklist-only')) {
        const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
        await writeChecklist(cli, catalog, existingSamples(catalog), results);
        return;
    }
    const samples = await makeSamples(cli, catalog);
    const results: Record<string, PairResult> = !flag('--fresh') && existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
    const only = option('--only');
    const pairs = catalog.formats
        .filter(f => !only || f.id === only || f.category === only)
        .flatMap(f => catalog.targetsOf(f.id).map(to => ({ from: f.id, to })))
        .filter(p => samples.has(p.from))
        .filter(p => !results[key(p)] || (flag('--retry-failed') && results[key(p)].status === 'failed'));
    console.log(`${pairs.length} conversions to check (${JOBS} at a time)`);

    let done = 0, lastSave = Date.now();
    const queue = [...pairs];
    await Promise.all(Array.from({ length: JOBS }, async (_, worker) => {
        for (let pair = queue.shift(); pair; pair = queue.shift()) {
            results[key(pair)] = await check(cli, samples.get(pair.from)!, pair.to, path.join(OUT, `w${worker}`));
            done++;
            if (results[key(pair)].status === 'failed')
                console.log(`  ✖ ${key(pair)}: ${results[key(pair)].error}`);
            if (done % 50 === 0 || Date.now() - lastSave > 30_000) {
                writeFileSync(RESULTS, JSON.stringify(results, null, 1));
                lastSave = Date.now();
                console.log(`${done}/${pairs.length}`);
            }
        }
    }));
    writeFileSync(RESULTS, JSON.stringify(results, null, 1));
    rmSync(OUT, { recursive: true, force: true });
    await writeChecklist(cli, catalog, samples, results);
}

const key = (p: { from: string; to: string }) => `${p.from}>${p.to}`;

async function check(cli: FileeCli, sample: string, to: string, folder: string): Promise<PairResult> {
    rmSync(folder, { recursive: true, force: true });
    const started = Date.now();
    try {
        const result = await cli.convert([sample], to, { outputFolder: folder, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const file = result.files[0];
        const ms = Date.now() - started;
        if (file?.state !== 'done')
            return { status: 'failed', ms, error: file?.error ?? `state ${file?.state ?? 'missing'}` };
        const missing = file.outputs.filter(o => !hasContent(o));
        if (file.outputs.length === 0 || missing.length > 0)
            return { status: 'failed', ms, error: `empty or missing output: ${missing.map(m => path.basename(m)).join(', ') || 'none'}` };
        return { status: 'verified', ms, outputs: file.outputs.length };
    } catch (error) {
        return { status: 'failed', ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
}

function hasContent(file: string): boolean {
    try {
        const stat = statSync(file);
        return stat.isFile() ? stat.size > 0 : readdirSync(file).length > 0;
    } catch {
        return false;
    }
}

// ── Samples ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Starter files: text formats written here, binary ones built byte by byte. */
async function writeStarters(): Promise<string[]> {
    const dir = path.join(SAMPLES, 'starters');
    mkdirSync(dir, { recursive: true });
    const files: Record<string, string | Buffer> = {
        'sample.txt': 'Remold parity sample.\nSecond line with ümlauts and 日本語.\n',
        'sample.md': '# Sample\n\nA paragraph with **bold** and a [link](https://example.com).\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
        'sample.html': '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sample</title></head><body><h1>Sample</h1><p>Hello <b>world</b>.</p><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>\n',
        'sample.csv': 'name,value,date\nalpha,1,2026-01-01\nbeta,2,2026-01-02\n',
        'sample.json': JSON.stringify([{ name: 'alpha', value: 1 }, { name: 'beta', value: 2 }], null, 2),
        'sample.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<items><item><name>alpha</name><value>1</value></item><item><name>beta</name><value>2</value></item></items>\n',
        'sample.yaml': '- name: alpha\n  value: 1\n- name: beta\n  value: 2\n',
        'sample.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><rect x="4" y="4" width="40" height="30" fill="#4F46E5"/><circle cx="46" cy="30" r="14" fill="#14B8A6"/><text x="6" y="44" font-size="8">Remold</text></svg>\n',
        'sample.srt': '1\n00:00:00,500 --> 00:00:02,000\nHello\n\n2\n00:00:02,500 --> 00:00:04,000\nWorld\n',
        'sample.gpx': '<?xml version="1.0"?>\n<gpx version="1.1" creator="remold" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="52.52" lon="13.40"><name>A</name></wpt><trk><name>T</name><trkseg><trkpt lat="52.52" lon="13.40"><ele>34</ele><time>2026-01-01T10:00:00Z</time></trkpt><trkpt lat="52.53" lon="13.41"><ele>36</ele><time>2026-01-01T10:05:00Z</time></trkpt></trkseg></trk></gpx>\n',
        'sample.gcode': 'G21\nG90\nG1 X10 Y10 F1500\nG1 X20 Y10 E1\nG1 X20 Y20 E2\n',
        'sample.wav': wav(),
        'sample.png': readFileSync(path.resolve('media/icon.png')),
        'sample.eml': 'From: Alice <alice@example.com>\r\nTo: Bob <bob@example.com>\r\nSubject: Sample\r\nDate: Mon, 23 Nov 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello Bob,\r\nthis is a sample.\r\n',
        'sample.ics': 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//remold//EN\r\nBEGIN:VEVENT\r\nUID:1@remold\r\nDTSTAMP:20261123T100000Z\r\nDTSTART:20261124T090000Z\r\nDTEND:20261124T100000Z\r\nSUMMARY:Sample event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
        'sample.plist': '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>name</key><string>alpha</string><key>value</key><integer>1</integer></dict></plist>\n',
        'sample.har': JSON.stringify({ log: { version: '1.2', creator: { name: 'remold', version: '1' }, entries: [{ startedDateTime: '2026-11-23T10:00:00.000Z', time: 12, request: { method: 'GET', url: 'https://example.com/', httpVersion: 'HTTP/1.1', headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 0 }, response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [], cookies: [], content: { size: 5, mimeType: 'text/plain', text: 'hello' }, redirectURL: '', headersSize: -1, bodySize: 5 }, cache: {}, timings: { send: 1, wait: 10, receive: 1 } }] } }),
        'sample.mhtml': 'From: <Saved by remold>\r\nSubject: Sample\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; type="text/html"; boundary="B"\r\n\r\n--B\r\nContent-Type: text/html; charset=utf-8\r\nContent-Location: https://example.com/\r\n\r\n<html><body><h1>Sample</h1><p>Hello.</p></body></html>\r\n--B--\r\n',
        'sample.osm': '<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="remold"><node id="1" lat="52.52" lon="13.40"><tag k="name" v="A"/></node><node id="2" lat="52.53" lon="13.41"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way></osm>\n',
        'sample.ssa': '[Script Info]\nScriptType: v4.00\n\n[V4 Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding\nStyle: Default,Arial,20,16777215,65535,65535,0,0,0,1,2,2,2,10,10,10,0,1\n\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:00.50,0:00:02.00,Default,,0,0,0,,Hello\n',
        'sample.scc': 'Scenarist_SCC V1.0\n\n00:00:00:15\t9420 9420 94ae 94ae 9452 9452 97a2 97a2 c8e5 ecec ef80 942c 942c 942f 942f\n\n00:00:02:00\t942c 942c\n',
    };
    for (const [name, content] of Object.entries(files))
        writeFileSync(path.join(dir, name), content);
    const repo = option('--filee-repo');
    if (repo) {
        // Filee's own test fonts and shapefiles (OFL / generated by its make-test-*.py).
        for (const sub of ['tests/Filee.Engines.Tests/Fonts', 'tests/Filee.Engines.Tests/Geo']) {
            const folder = path.join(repo, sub);
            if (existsSync(folder))
                for (const f of readdirSync(folder))
                    if (!/\.(py|txt)$/.test(f) && !f.startsWith('gdal_utm33') && !f.startsWith('gdal_lines') && !f.startsWith('gdal_polygons'))
                        copyFileSync(path.join(folder, f), path.join(dir, f));
        }
    }
    toolStarters(dir);
    await magickStarters(dir);
    return readdirSync(dir).filter(f => statSync(path.join(dir, f)).isFile()).map(f => path.join(dir, f));
}

/** Archives and media made with tools found on this computer (tar, zip, gzip, …, ffmpeg); each is skipped if missing. */
function toolStarters(dir: string): void {
    const run = (command: string, args: string[], cwd = dir) => spawnSync(command, args, { cwd, stdio: 'ignore' }).status === 0;
    const payload = path.join(dir, 'payload');
    mkdirSync(payload, { recursive: true });
    copyFileSync(path.join(dir, 'sample.txt'), path.join(payload, 'readme.txt'));
    copyFileSync(path.join(dir, 'sample.png'), path.join(payload, 'image.png'));
    run('zip', ['-qr', 'sample.zip', 'payload']);
    run('tar', ['cf', 'sample.tar', 'payload']);
    run('tar', ['czf', 'sample.tar.gz', 'payload']);
    run('tar', ['cjf', 'sample.tar.bz2', 'payload']);
    run('tar', ['cJf', 'sample.tar.xz', 'payload']);
    run('tar', ['--zstd', '-cf', 'sample.tar.zst', 'payload']);
    for (const [tool, extension] of [['gzip', 'gz'], ['bzip2', 'bz2'], ['xz', 'xz'], ['zstd', 'zst'], ['lzma', 'lzma']]) {
        copyFileSync(path.join(dir, 'sample.txt'), path.join(dir, `single-${extension}.txt`));
        run(tool, ['-q', `single-${extension}.txt`]);
        rmSync(path.join(dir, `single-${extension}.txt`), { force: true });
    }
    spawnSync('sh', ['-c', 'find payload | cpio -o --quiet > sample.cpio'], { cwd: dir, stdio: 'ignore' });
    // A .deb is an ar archive of debian-binary, control.tar.gz and data.tar.gz.
    writeFileSync(path.join(dir, 'debian-binary'), '2.0\n');
    writeFileSync(path.join(payload, 'control'), 'Package: sample\nVersion: 1.0\nArchitecture: all\nMaintainer: Remold <r@example.com>\nDescription: sample\n');
    run('tar', ['czf', 'control.tar.gz', '-C', 'payload', 'control']);
    run('tar', ['czf', 'data.tar.gz', 'payload']);
    run('ar', ['rc', 'sample.deb', 'debian-binary', 'control.tar.gz', 'data.tar.gz']);
    for (const f of ['debian-binary', 'control.tar.gz', 'data.tar.gz'])
        rmSync(path.join(dir, f), { force: true });
    // ZIP-based package formats: Filee reads them by extension.
    if (existsSync(path.join(dir, 'sample.zip')))
        for (const extension of ['jar', 'zxp', 'nupkg', 'apks', 'aab', 'msix', 'cbz'])
            copyFileSync(path.join(dir, 'sample.zip'), path.join(dir, `sample.${extension}`));
    rmSync(payload, { recursive: true, force: true });

    const video = ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10'];
    const audio = ['-i', 'sample.wav'];
    const ffmpeg = (args: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    ffmpeg([...video, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'h264', 'sample.h264']);
    ffmpeg([...video, '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-f', 'hevc', 'sample.h265']);
    ffmpeg([...video, '-c:v', 'flashsv', '-f', 'swf', 'sample.swf']);
    ffmpeg([...video, '-c:v', 'rv10', '-f', 'rm', 'sample.rm']);
    ffmpeg([...video, '-c:v', 'mpeg2video', '-f', 'wtv', 'sample.wtv']);
    ffmpeg([...video, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'sample.m4s']);
    ffmpeg([...audio, '-c:a', 'libspeex', '-f', 'spx', 'sample.spx']);
    ffmpeg([...audio, '-ar', '48000', '-c:a', 'dca', '-strict', '-2', '-f', 'dts', 'sample.dts']);
}

/** Image formats Filee only reads, written with magick-wasm (a development dependency). */
async function magickStarters(dir: string): Promise<void> {
    try {
        const require = createRequire(path.resolve('package.json'));
        // Loaded at run time from node_modules (its CommonJS build), not bundled into this script.
        const magick = require('@imagemagick/magick-wasm');
        await magick.initializeImageMagick(readFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm')));
        const png = readFileSync(path.join(dir, 'sample.png'));
        for (const [format, extension] of [['Exr', 'exr'], ['Hdr', 'hdr'], ['Fits', 'fits'], ['Pcd', 'pcd'], ['Dcm', 'dcm']]) {
            try {
                magick.ImageMagick.read(png, (image: { write(f: unknown, cb: (d: Uint8Array) => void): void }) =>
                    image.write(magick.MagickFormat[format], (data: Uint8Array) => writeFileSync(path.join(dir, `sample.${extension}`), data)));
            } catch { /* this build can't write it */ }
        }
    } catch (error) {
        console.log(`magick-wasm unavailable: ${error instanceof Error ? error.message : error}`);
    }
}

/** One second of a 440 Hz tone, 16-bit mono PCM at 16 kHz. */
function wav(): Buffer {
    const rate = 16000, samples = rate;
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++)
        data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), i * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

/** The samples earlier runs made or wrote, without making new ones. */
function existingSamples(catalog: Catalog): Map<string, string> {
    const samples = new Map<string, string>();
    for (const folder of [path.join(SAMPLES, 'starters'), ...(existsSync(path.join(SAMPLES, 'made')) ? readdirSync(path.join(SAMPLES, 'made')).map(id => path.join(SAMPLES, 'made', id)) : [])]) {
        if (!existsSync(folder))
            continue;
        for (const f of readdirSync(folder)) {
            const format = catalog.formatOf(f);
            if (format && !samples.has(format.id) && statSync(path.join(folder, f)).isFile())
                samples.set(format.id, path.join(folder, f));
        }
    }
    return samples;
}

/** A sample file per format: starters first, then each missing format made by Filee from one that has a sample. */
async function makeSamples(cli: FileeCli, catalog: Catalog): Promise<Map<string, string>> {
    const samples = new Map<string, string>();
    for (const file of await writeStarters()) {
        const format = catalog.formatOf(file);
        if (format && !samples.has(format.id))
            samples.set(format.id, file);
    }
    // Reuse samples made by an earlier run.
    const made = path.join(SAMPLES, 'made');
    mkdirSync(made, { recursive: true });
    for (const id of readdirSync(made)) {
        const files = readdirSync(path.join(made, id)).map(f => path.join(made, id, f)).filter(f => catalog.formatOf(f)?.id === id);
        if (files[0] && !samples.has(id))
            samples.set(id, files[0]);
    }
    // Prefer a source of the same kind (a document from a document), then anything.
    for (let progress = true; progress;) {
        progress = false;
        for (const format of catalog.formats) {
            if (samples.has(format.id) || !format.writable)
                continue;
            const sources = [...samples.keys()].filter(id => catalog.targetsOf(id).includes(format.id))
                .sort((a, b) => Number(catalog.format(b)?.category === format.category) - Number(catalog.format(a)?.category === format.category));
            for (const source of sources) {
                const folder = path.join(made, format.id);
                rmSync(folder, { recursive: true, force: true });
                try {
                    const result = await cli.convert([samples.get(source)!], format.id, { outputFolder: folder, signal: AbortSignal.timeout(TIMEOUT_MS) });
                    const outputs = (result.files[0]?.outputs ?? []).flatMap(o => statSync(o).isDirectory() ? [] : [o]);
                    const sample = outputs.find(o => catalog.formatOf(o)?.id === format.id);
                    if (result.files[0]?.state === 'done' && sample) {
                        samples.set(format.id, sample);
                        progress = true;
                        console.log(`sample ${format.id} from ${source}`);
                        break;
                    }
                } catch { /* try the next source */ }
            }
        }
    }
    const missing = catalog.formats.filter(f => !samples.has(f.id)).map(f => f.id);
    console.log(`${samples.size} formats have a sample; none for ${missing.length}: ${missing.join(' ')}`);
    return samples;
}

// ── Checklist ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function writeChecklist(cli: FileeCli, catalog: Catalog, samples: Map<string, string>, results: Record<string, PairResult>): Promise<void> {
    // Targets that need an optional engine that isn't installed: part of Filee, not checkable here.
    const optional = new Map<string, readonly string[]>();
    const queue = [...catalog.formats];
    await Promise.all(Array.from({ length: 6 }, async () => {
        for (let f = queue.shift(); f; f = queue.shift())
            optional.set(f.id, (await cli.targets(f.id)).withEngines ?? []);
    }));
    const mark = (from: string, to: string, needsEngine: boolean) => {
        if (needsEngine)
            return '⚙';
        const r = results[`${from}>${to}`];
        return r ? (r.status === 'verified' ? '✅' : '❌') : samples.has(from) ? '⏳' : '∅';
    };
    let verified = 0, failed = 0, pending = 0, noSample = 0, engine = 0;
    const sections: string[] = [];
    const categories = [...new Set(catalog.formats.map(f => f.category))];
    const table: string[] = [];
    for (const category of categories) {
        const counts = { verified: 0, failed: 0, other: 0 };
        sections.push('', `## ${category}`, '');
        for (const format of catalog.formats.filter(f => f.category === category)) {
            const targets = catalog.targetsOf(format.id), extra = optional.get(format.id) ?? [];
            const marks = [...targets.map(t => [t, mark(format.id, t, false)]), ...extra.map(t => [t, mark(format.id, t, true)])];
            const ok = marks.filter(m => m[1] === '✅').length, bad = marks.filter(m => m[1] === '❌').length;
            verified += ok; failed += bad; counts.verified += ok; counts.failed += bad; counts.other += marks.length - ok - bad;
            pending += marks.filter(m => m[1] === '⏳').length; noSample += marks.filter(m => m[1] === '∅').length; engine += extra.length;
            const box = marks.length > 0 && ok === marks.length ? '[x]' : '[ ]';
            sections.push(`- ${box} **${format.id}** ${format.name} \`${format.extensions.map(e => `.${e}`).join(' ')}\` — ${ok}/${marks.length}` +
                (samples.has(format.id) ? '' : ' — no sample file'));
            if (marks.length > 0)
                sections.push(`  - ${marks.map(m => `${m[1]}${m[0]}`).join(' ')}`);
            for (const [to] of marks.filter(m => m[1] === '❌'))
                sections.push(`  - ❌ ${to}: ${(results[`${format.id}>${to}`].error ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
        }
        table.push(`| ${category} | ${counts.verified} | ${counts.failed} | ${counts.other} |`);
    }
    const total = verified + failed + pending + noSample + engine;
    writeFileSync(path.join(ROOT, 'CHECKLIST.md'), [
        '# Filee parity checklist', '',
        `Every conversion Filee ${catalog.version} offers, checked through Remold (\`npm run parity\`). Not committed (\`.parity/\` is in \`.gitignore\`).`, '',
        '✅ converted · ❌ failed (reason below) · ⏳ not checked yet · ∅ no sample file of the source format · ⚙ needs an optional Filee engine that isn\'t installed (`filee engines`)', '',
        `**${verified} ✅ · ${failed} ❌ · ${pending} ⏳ · ${noSample} ∅ · ${engine} ⚙ — ${total} conversions, ${catalog.formats.length} formats.**`, '',
        '| Category | ✅ | ❌ | other |', '|---|---|---|---|', ...table, ...sections, '',
    ].join('\n'));
    console.log(`CHECKLIST.md: ${verified} verified, ${failed} failed, ${pending} pending, ${noSample} no sample, ${engine} need an engine (of ${total})`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
