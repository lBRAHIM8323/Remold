// "Insert as WebP (Remold)" in VS Code's drop and paste menus for Markdown and HTML: the dropped or pasted image is
// converted and a link to the converted file is inserted. The conversion runs only if that option is picked.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ConversionEngine } from './engine';
import { TargetFormat, extensionOf, isSupportedInput, normaliseExtension, targetById } from './formats';
import { outputPathFor } from './outputPath';

const SELECTOR: vscode.DocumentSelector = [{ language: 'markdown', scheme: 'file' }, { language: 'html', scheme: 'file' }];
const KIND = vscode.DocumentDropOrPasteEditKind.Empty.append('remold', 'image');

/** Image MIME types a clipboard can hold, and the extension of each. */
const PASTE_TYPES: Readonly<Record<string, string>> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
    'image/avif': 'avif', 'image/tiff': 'tiff', 'image/heic': 'heic',
};

/** What to convert when the edit is applied. */
type Job = { readonly input: string | { bytes: Uint8Array; extension: string }; readonly output: string };

class RemoldDropEdit extends vscode.DocumentDropEdit {
    jobs: Job[] = [];
}

class RemoldPasteEdit extends vscode.DocumentPasteEdit {
    jobs: Job[] = [];
}

export function registerInsertProviders(engine: ConversionEngine): vscode.Disposable {
    const convert = async (jobs: readonly Job[], token: vscode.CancellationToken) => {
        const config = vscode.workspace.getConfiguration('remold');
        const target = insertTarget()!;
        for (const job of jobs) {
            if (token.isCancellationRequested)
                throw new vscode.CancellationError();
            await engine.convert({ input: job.input, outputPath: job.output, targetId: target.id, quality: config.get<number>('quality', 85) });
        }
    };

    return vscode.Disposable.from(
        vscode.languages.registerDocumentDropEditProvider(SELECTOR, {
            async provideDocumentDropEdits(document, _position, data) {
                const plan = await planFromUris(document, data);
                if (!plan)
                    return undefined;
                const edit = new RemoldDropEdit(plan.text, plan.title, KIND);
                edit.jobs = plan.jobs;
                return [edit];
            },
            async resolveDocumentDropEdit(edit: RemoldDropEdit, token) {
                await convert(edit.jobs, token);
                return edit;
            },
        }, { providedDropEditKinds: [KIND], dropMimeTypes: ['text/uri-list'] }),
        vscode.languages.registerDocumentPasteEditProvider(SELECTOR, {
            async provideDocumentPasteEdits(document, _ranges, data) {
                const plan = await planFromUris(document, data) ?? await planFromClipboardImage(document, data);
                if (!plan)
                    return undefined;
                const edit = new RemoldPasteEdit(plan.text, plan.title, KIND);
                edit.jobs = plan.jobs;
                return [edit];
            },
            async resolveDocumentPasteEdit(edit: RemoldPasteEdit, token) {
                await convert(edit.jobs, token);
                return edit;
            },
        }, { providedPasteEditKinds: [KIND], pasteMimeTypes: ['text/uri-list', ...Object.keys(PASTE_TYPES)] }));
}

interface Plan {
    readonly text: string;
    readonly title: string;
    readonly jobs: Job[];
}

function insertTarget(): TargetFormat | undefined {
    return targetById(vscode.workspace.getConfiguration('remold').get<string>('insertFormat', 'webp'));
}

/** Image files dropped or copied from the Explorer or a file manager. */
async function planFromUris(document: vscode.TextDocument, data: vscode.DataTransfer): Promise<Plan | undefined> {
    const target = insertTarget();
    const list = await data.get('text/uri-list')?.asString();
    if (!target || !list)
        return undefined;
    const sources = list.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'))
        .flatMap(l => { try { return [vscode.Uri.parse(l, true)]; } catch { return []; } })
        .filter(u => u.scheme === 'file' && isSupportedInput(u.fsPath)).map(u => u.fsPath);
    // Nothing to offer if every image already has the target format.
    if (sources.length === 0 || sources.every(s => normaliseExtension(extensionOf(s)) === target.id))
        return undefined;
    const reserved = new Set<string>();
    const jobs = sources.map(source => {
        const output = outputPathFor(source, target.id, outputFolder(), p => reserved.has(p) || existsSync(p));
        reserved.add(output);
        return { input: source, output };
    });
    return plan(document, target, jobs);
}

/** An image on the clipboard (a screenshot, say); it's saved next to the document. */
async function planFromClipboardImage(document: vscode.TextDocument, data: vscode.DataTransfer): Promise<Plan | undefined> {
    const target = insertTarget();
    if (!target)
        return undefined;
    for (const [mime, extension] of Object.entries(PASTE_TYPES)) {
        const file = data.get(mime)?.asFile();
        if (!file || normaliseExtension(extension) === target.id)
            continue;
        const bytes = await file.data();
        const name = file.name ? path.basename(file.name, path.extname(file.name)) : 'image';
        // The output is named as if the image were a file next to the document.
        const pseudoSource = path.join(path.dirname(document.uri.fsPath), `${name}.${extension}`);
        const output = outputPathFor(pseudoSource, target.id, outputFolder());
        return plan(document, target, [{ input: { bytes, extension }, output }]);
    }
    return undefined;
}

function plan(document: vscode.TextDocument, target: TargetFormat, jobs: Job[]): Plan {
    const folder = path.dirname(document.uri.fsPath);
    const links = jobs.map(job => {
        const relative = path.relative(folder, job.output).split(path.sep).join('/');
        const alt = path.basename(job.output, path.extname(job.output));
        return document.languageId === 'html'
            ? `<img src="${encodeURI(relative)}" alt="${escapeHtml(alt)}">`
            : `![${alt.replace(/[[\]]/g, '\\$&')}](${encodeURI(relative)})`;
    });
    return { text: links.join(document.languageId === 'html' ? '\n' : ' '), title: `Insert as ${target.label} (Remold)`, jobs };
}

function outputFolder(): string {
    return vscode.workspace.getConfiguration('remold').get<string>('outputFolder', '');
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
