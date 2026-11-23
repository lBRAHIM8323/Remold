// "Insert as WEBP (Remold)" in VS Code's drop and paste menus for Markdown and HTML: the dropped or pasted image is
// converted with Filee and a link to the converted file is inserted. The conversion runs only if that option is
// picked.
import { copyFileSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FileeService } from './fileeService';
import { outputPathFor } from './outputPath';

const SELECTOR: vscode.DocumentSelector = [{ language: 'markdown', scheme: 'file' }, { language: 'html', scheme: 'file' }];
const KIND = vscode.DocumentDropOrPasteEditKind.Empty.append('remold', 'image');

/** Image MIME types a clipboard can hold, and the extension of each. */
const PASTE_TYPES: Readonly<Record<string, string>> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
    'image/avif': 'avif', 'image/tiff': 'tiff', 'image/heic': 'heic',
};

/** What to convert when the edit is applied: a file, or pasted bytes with their extension. */
type Job = { readonly input: string | { bytes: Uint8Array; extension: string }; readonly output: string; readonly target: string };

class RemoldDropEdit extends vscode.DocumentDropEdit {
    jobs: Job[] = [];
}

class RemoldPasteEdit extends vscode.DocumentPasteEdit {
    jobs: Job[] = [];
}

export function registerInsertProviders(service: FileeService): vscode.Disposable {
    const run = async (jobs: readonly Job[], token: vscode.CancellationToken) => {
        const filee = await service.get();
        if (!filee)
            throw new Error('Filee isn\'t available.');
        const scratch = mkdtempSync(path.join(tmpdir(), 'remold-insert-'));
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        try {
            for (const [index, job] of jobs.entries()) {
                let input: string;
                if (typeof job.input === 'string')
                    input = job.input;
                else {
                    // Filee converts files, so pasted bytes are written to one first.
                    input = path.join(scratch, `pasted-${index}.${job.input.extension}`);
                    writeFileSync(input, job.input.bytes);
                }
                // Filee picks its own output name; convert into a private folder, then move it to the planned name
                // the inserted link already uses.
                const folder = path.join(scratch, `out-${index}`);
                const result = await filee.cli.convert([input], job.target, {
                    outputFolder: folder,
                    quality: vscode.workspace.getConfiguration('remold').get<number>('quality', 85),
                    signal: abort.signal,
                });
                const file = result.files[0];
                if (file?.state !== 'done' || file.outputs.length === 0)
                    throw new Error(`Filee couldn't convert ${path.basename(input)}: ${file?.error ?? 'no output'}`);
                mkdirSync(path.dirname(job.output), { recursive: true });
                copyFileSync(file.outputs[0], job.output, constants.COPYFILE_EXCL);
            }
        } finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    };

    return vscode.Disposable.from(
        vscode.languages.registerDocumentDropEditProvider(SELECTOR, {
            async provideDocumentDropEdits(document, _position, data) {
                const plan = await planFromUris(service, document, data);
                if (!plan)
                    return undefined;
                const edit = new RemoldDropEdit(plan.text, plan.title, KIND);
                edit.jobs = plan.jobs;
                return [edit];
            },
            async resolveDocumentDropEdit(edit: RemoldDropEdit, token) {
                await run(edit.jobs, token);
                return edit;
            },
        }, { providedDropEditKinds: [KIND], dropMimeTypes: ['text/uri-list'] }),
        vscode.languages.registerDocumentPasteEditProvider(SELECTOR, {
            async provideDocumentPasteEdits(document, _ranges, data) {
                const plan = await planFromUris(service, document, data) ?? await planFromClipboardImage(service, document, data);
                if (!plan)
                    return undefined;
                const edit = new RemoldPasteEdit(plan.text, plan.title, KIND);
                edit.jobs = plan.jobs;
                return [edit];
            },
            async resolveDocumentPasteEdit(edit: RemoldPasteEdit, token) {
                await run(edit.jobs, token);
                return edit;
            },
        }, { providedPasteEditKinds: [KIND], pasteMimeTypes: ['text/uri-list', ...Object.keys(PASTE_TYPES)] }));
}

interface Plan {
    readonly text: string;
    readonly title: string;
    readonly jobs: Job[];
}

/** The insert format and its file extension, if Filee is ready (offering a menu entry must not wait or prompt). */
async function insertTarget(service: FileeService) {
    const filee = await service.get({ quiet: true });
    const target = vscode.workspace.getConfiguration('remold').get<string>('insertFormat', 'webp');
    const format = filee?.catalog.format(target);
    return filee && format ? { filee, target, extension: format.extensions[0], name: format.name } : undefined;
}

/** Image files dropped or copied from the Explorer or a file manager. */
async function planFromUris(service: FileeService, document: vscode.TextDocument, data: vscode.DataTransfer): Promise<Plan | undefined> {
    const list = await data.get('text/uri-list')?.asString();
    const insert = list ? await insertTarget(service) : undefined;
    if (!list || !insert)
        return undefined;
    const sources = list.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'))
        .flatMap(l => { try { return [vscode.Uri.parse(l, true)]; } catch { return []; } })
        .filter(u => u.scheme === 'file').map(u => u.fsPath)
        // Only images that aren't already in the insert format and that Filee can convert to it.
        .filter(f => insert.filee.catalog.formatOf(f)?.category === 'image' && insert.filee.catalog.formatOf(f)?.id !== insert.target
            && insert.filee.catalog.commonTargets([f]).includes(insert.target));
    if (sources.length === 0)
        return undefined;
    const reserved = new Set<string>();
    const jobs = sources.map(source => {
        const output = outputPathFor(source, insert.extension, outputFolder(), p => reserved.has(p) || existsSync(p));
        reserved.add(output);
        return { input: source, output, target: insert.target };
    });
    return plan(document, insert.name, jobs);
}

/** An image on the clipboard (a screenshot, say); it's saved next to the document. */
async function planFromClipboardImage(service: FileeService, document: vscode.TextDocument, data: vscode.DataTransfer): Promise<Plan | undefined> {
    for (const [mime, extension] of Object.entries(PASTE_TYPES)) {
        const file = data.get(mime)?.asFile();
        if (!file)
            continue;
        const insert = await insertTarget(service);
        if (!insert || extension === insert.extension)
            return undefined;
        const bytes = await file.data();
        const name = file.name ? path.basename(file.name, path.extname(file.name)) : 'image';
        // The output is named as if the image were a file next to the document.
        const pseudoSource = path.join(path.dirname(document.uri.fsPath), `${name}.${extension}`);
        const output = outputPathFor(pseudoSource, insert.extension, outputFolder());
        return plan(document, insert.name, [{ input: { bytes, extension }, output, target: insert.target }]);
    }
    return undefined;
}

function plan(document: vscode.TextDocument, formatName: string, jobs: Job[]): Plan {
    const folder = path.dirname(document.uri.fsPath);
    const links = jobs.map(job => {
        const relative = path.relative(folder, job.output).split(path.sep).join('/');
        const alt = path.basename(job.output, path.extname(job.output));
        return document.languageId === 'html'
            ? `<img src="${encodeURI(relative)}" alt="${escapeHtml(alt)}">`
            : `![${alt.replace(/[[\]]/g, '\\$&')}](${encodeURI(relative)})`;
    });
    return { text: links.join(document.languageId === 'html' ? '\n' : ' '), title: `Insert as ${formatName} (Remold)`, jobs };
}

function outputFolder(): string {
    return vscode.workspace.getConfiguration('remold').get<string>('outputFolder', '');
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
