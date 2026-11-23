// Converts files with Filee from a menu or the picker: progress, the result message, selecting the new file and
// offering to update references to the old one.
import { statSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Filee } from './fileeService';
import { formatSize, sizeChange } from './sizes';
import { Converted, referenceEdit } from './updateReferences';

export async function convertFiles(filee: Filee, files: readonly string[], target: string, log: vscode.OutputChannel): Promise<void> {
    const targetName = filee.catalog.format(target)?.name ?? target.toUpperCase();
    const convertible = files.filter(f => filee.catalog.commonTargets([f]).includes(target));
    if (convertible.length < files.length) {
        const skipped = files.filter(f => !convertible.includes(f)).map(f => path.basename(f));
        void vscode.window.showWarningMessage(`Filee can't convert ${skipped.join(', ')} to ${targetName}.`);
        if (convertible.length === 0)
            return;
    }
    const config = vscode.workspace.getConfiguration('remold');
    const outputSetting = config.get<string>('outputFolder', '');
    // Filee takes one output folder per run; with a relative setting each source folder gets its own.
    const groups = new Map<string, string[]>();
    for (const file of convertible) {
        const folder = outputSetting ? path.resolve(path.dirname(file), outputSetting) : '';
        groups.set(folder, [...(groups.get(folder) ?? []), file]);
    }

    const single = convertible.length === 1;
    const fractions = new Map<string, number>();
    const results = await vscode.window.withProgress({
        // One file: a spinner in the status bar. Several: a notification that can be cancelled.
        location: single ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification,
        title: `Converting to ${targetName}`,
        cancellable: !single,
    }, async (progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        let reported = 0;
        const all = [];
        for (const [folder, group] of groups) {
            if (abort.signal.aborted)
                break;
            try {
                all.push(...(await filee.cli.convert(group, target, {
                    outputFolder: folder || undefined,
                    quality: config.get<number>('quality', 85),
                    signal: abort.signal,
                    onProgress: (source, fraction) => {
                        fractions.set(source, fraction);
                        const done = [...fractions.values()].reduce((a, b) => a + b, 0) / convertible.length * 100;
                        progress.report({ message: path.basename(source), increment: Math.max(0, done - reported) });
                        reported = Math.max(reported, done);
                    },
                })).files);
            } catch (error) {
                if (abort.signal.aborted)
                    break;
                for (const source of group)
                    all.push({ source, state: 'failed', outputs: [], error: error instanceof Error ? error.message : String(error) });
            }
        }
        return all;
    });

    const converted: (Converted & { size: number; outputs: readonly string[] })[] = [];
    const failed = results.filter(r => r.state === 'failed');
    for (const r of results) {
        if (r.state === 'failed') {
            log.appendLine(`FAILED ${r.source}: ${r.error ?? 'no message'}`);
            continue;
        }
        if (r.outputs.length === 0)
            continue;
        const size = r.outputs.reduce((sum, o) => sum + sizeOf(o), 0);
        converted.push({ source: r.source, output: r.outputs[0], outputs: r.outputs, size });
        log.appendLine(`${r.source} -> ${r.outputs.join(', ')} (${formatSize(size)})`);
    }

    if (converted.length > 0)
        // Select the new file in the Explorer, next to the original.
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(converted[0].output));

    if (failed.length > 0) {
        const message = converted.length === 0 && failed.length === 1
            ? `Couldn't convert ${path.basename(failed[0].source)}: ${failed[0].error ?? 'Filee reported an error.'}`
            : `Converted ${converted.length} of ${convertible.length} files to ${targetName}; ${failed.length} failed.`;
        // Not awaited: the command finishes now, and the message waits for the user on its own.
        void vscode.window.showWarningMessage(message, 'Show Log').then(choice => { if (choice === 'Show Log') log.show(); });
        if (converted.length === 0)
            return;
    }
    if (converted.length === 0) {
        void vscode.window.showInformationMessage(`Nothing to convert: the ${targetName} files already exist.`);
        return;
    }

    // Only a file replaced by exactly one file can have its references updated (not pages or an extracted folder).
    const renamed = converted.filter(c => c.outputs.length === 1 && isFile(c.output));
    const references = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Looking for references' },
        () => referenceEdit(renamed));

    const before = converted.reduce((sum, c) => sum + sizeOf(c.source), 0);
    const after = converted.reduce((sum, c) => sum + c.size, 0);
    const sizes = after > 0 ? ` · ${formatSize(after)}${before > 0 ? ` (${sizeChange(before, after)})` : ''}` : '';
    const first = converted[0];
    const message = converted.length === 1
        ? `${path.basename(first.source)} → ${first.outputs.length === 1 ? path.basename(first.output) : `${first.outputs.length} files`}${sizes}`
        : `Converted ${converted.length} files to ${targetName}${sizes}`;
    const update = references.count > 0 ? `Update ${references.count} Reference${references.count === 1 ? '' : 's'}…` : undefined;
    const actions = [...(converted.length === 1 && isFile(first.output) ? ['Open'] : []), ...(update ? [update] : [])];
    void vscode.window.showInformationMessage(message, ...actions).then(choice => {
        if (choice === 'Open')
            return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(first.output));
        if (choice !== undefined && choice === update)
            // Every change needs confirmation, so VS Code opens the Refactor Preview first.
            return vscode.workspace.applyEdit(references.edit, { isRefactoring: true });
    });
}

/** Size of a file, or of the files in a folder (an extracted archive). */
function sizeOf(file: string): number {
    try {
        const stat = statSync(file);
        return stat.isFile() ? stat.size : 0;
    } catch {
        return 0;
    }
}

function isFile(file: string): boolean {
    try {
        return statSync(file).isFile();
    } catch {
        return false;
    }
}
