// Remold's VS Code entry point: "Convert to ▸" in the Explorer and editor tab menus, the format picker (also on
// VS Code's image preview), reference updates after converting, and "Insert as WebP" when dropping or pasting.
import { statSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { convertBatch } from './conversion';
import { ConversionEngine } from './engine';
import { INPUT_EXTENSIONS, TARGET_FORMATS, TargetFormat, isSupportedInput } from './formats';
import { registerInsertProviders } from './insert';
import { pickFormat } from './picker';
import { formatSize, sizeChange } from './sizes';
import { referenceEdit } from './updateReferences';

let engine: ConversionEngine | undefined;
let log: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
    engine = new ConversionEngine(
        context.asAbsolutePath(path.join('dist', 'worker.js')),
        context.asAbsolutePath(path.join('dist', 'magick.wasm')));
    log = vscode.window.createOutputChannel('Remold');
    context.subscriptions.push(log, registerInsertProviders(engine));

    for (const target of TARGET_FORMATS.filter(t => t.common))
        context.subscriptions.push(vscode.commands.registerCommand(`remold.to.${target.id}`,
            async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
                const files = await chooseFiles(uri, uris);
                if (files.length > 0)
                    await convert(files, target);
            }));

    const pickAndConvert = async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const files = await chooseFiles(uri, uris);
        if (files.length === 0)
            return;
        const target = await pickFormat(files, engine!);
        if (target)
            await convert(files, target);
    };
    context.subscriptions.push(
        vscode.commands.registerCommand('remold.convertTo', pickAndConvert),
        vscode.commands.registerCommand('remold.moreFormats', pickAndConvert));
}

export async function deactivate(): Promise<void> {
    await engine?.dispose();
    engine = undefined;
}

/**
 * The images to convert: the Explorer selection, the clicked file, the image open in the editor, or a file picker.
 * Files that aren't supported images are left out, with a message if that leaves none.
 */
async function chooseFiles(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined): Promise<string[]> {
    let chosen = uris && uris.length > 0 ? uris : uri ? [uri] : activeImage();
    if (chosen.length === 0)
        chosen = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Convert', filters: { Images: [...INPUT_EXTENSIONS] } }) ?? [];
    const files = chosen.filter(f => f.scheme === 'file' && isSupportedInput(f.fsPath)).map(f => f.fsPath);
    if (chosen.length > 0 && files.length === 0)
        void vscode.window.showWarningMessage('Remold can only convert image files on disk.');
    return files;
}

/** The image shown in the active editor tab (VS Code's image preview), if any. */
function activeImage(): vscode.Uri[] {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? [input.uri] : [];
}

async function convert(files: readonly string[], target: TargetFormat): Promise<void> {
    const config = vscode.workspace.getConfiguration('remold');
    const single = files.length === 1;
    const result = await vscode.window.withProgress({
        // One image: a spinner in the status bar. Several: a notification that can be cancelled.
        location: single ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification,
        title: `Converting to ${target.label}`,
        cancellable: !single,
    }, (progress, token) => convertBatch(engine!, files, target, {
        quality: Math.min(100, Math.max(1, config.get<number>('quality', 85))),
        outputFolder: config.get<string>('outputFolder', ''),
        isCancelled: () => token.isCancellationRequested,
        onProgress: (done, total, file) => {
            if (file)
                progress.report({ message: single ? path.basename(file) : `${done + 1}/${total} ${path.basename(file)}`, increment: done === 0 ? 0 : 100 / total });
        },
    }));

    for (const c of result.converted)
        log!.appendLine(`${c.source} -> ${c.output} (${formatSize(c.size)})`);
    for (const f of result.failed)
        log!.appendLine(`FAILED ${f.source}: ${f.error}`);

    if (result.converted.length > 0)
        // Select the new file in the Explorer, next to the original.
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(result.converted[0].output));

    if (result.failed.length > 0) {
        const first = result.failed[0];
        const message = result.converted.length === 0 && result.failed.length === 1
            ? `Couldn't convert ${path.basename(first.source)}: ${first.error}`
            : `Converted ${result.converted.length} of ${files.length} images to ${target.label}; ${result.failed.length} failed.`;
        // Not awaited: the command finishes now, and the message waits for the user on its own.
        void vscode.window.showWarningMessage(message, 'Show Log').then(choice => { if (choice === 'Show Log') log!.show(); });
        if (result.converted.length === 0)
            return;
    }

    const references = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Looking for references' },
        () => referenceEdit(result.converted));

    const before = result.converted.reduce((sum, c) => sum + sizeOf(c.source), 0);
    const after = result.converted.reduce((sum, c) => sum + c.size, 0);
    const sizes = `${formatSize(after)}${before > 0 ? ` (${sizeChange(before, after)})` : ''}`;
    const message = result.converted.length === 1
        ? `${path.basename(result.converted[0].source)} → ${path.basename(result.converted[0].output)} · ${sizes}`
        : `Converted ${result.converted.length} images to ${target.label} · ${sizes}`;
    const update = references.count > 0 ? `Update ${references.count} Reference${references.count === 1 ? '' : 's'}…` : undefined;
    const actions = [...(result.converted.length === 1 ? ['Open'] : []), ...(update ? [update] : [])];
    void vscode.window.showInformationMessage(message, ...actions).then(choice => {
        if (choice === 'Open')
            return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(result.converted[0].output));
        if (choice !== undefined && choice === update)
            // Every change needs confirmation, so VS Code opens the Refactor Preview first.
            return vscode.workspace.applyEdit(references.edit, { isRefactoring: true });
    });
}

function sizeOf(file: string): number {
    try {
        return statSync(file).size;
    } catch {
        return 0;
    }
}
