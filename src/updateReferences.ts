// Builds the workspace edit that updates references to converted images, shown in VS Code's Refactor Preview.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { findReferences } from './references';

/** Text files bigger than this are skipped: generated bundles, minified code. */
const MAX_FILE_SIZE = 2 * 1024 * 1024;

/** A converted file: references to `source` become references to `output`. */
export interface Converted {
    readonly source: string;
    readonly output: string;
}

export interface ReferenceEdit {
    readonly edit: vscode.WorkspaceEdit;
    readonly count: number;
}

/** References to the converted images' sources in the workspace's text files, as a confirm-first edit. */
export async function referenceEdit(converted: readonly Converted[], token?: vscode.CancellationToken): Promise<ReferenceEdit> {
    const edit = new vscode.WorkspaceEdit();
    let count = 0;
    const folders = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'file') ?? [];
    if (folders.length === 0 || converted.length === 0)
        return { edit, count };

    const glob = vscode.workspace.getConfiguration('remold').get<string>('referenceFiles', '');
    if (!glob)
        return { edit, count };
    const roots = folders.map(f => f.uri.fsPath);
    const uris = await vscode.workspace.findFiles(glob, '**/{node_modules,.git,dist,build,out}/**', 10000, token);
    const decoder = new TextDecoder();
    const bases = converted.map(c => path.basename(c.source));

    for (const uri of uris) {
        if (token?.isCancellationRequested)
            break;
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_SIZE)
            continue;
        const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
        if (!bases.some(base => text.includes(base)))
            continue;
        const lines = lineStarts(text);
        for (const conversion of converted) {
            const from = path.basename(conversion.source);
            const to = path.basename(conversion.output);
            for (const match of findReferences(text, uri.fsPath, conversion.source, roots)) {
                edit.replace(uri, new vscode.Range(position(lines, match.start), position(lines, match.end)), to,
                    { needsConfirmation: true, label: `${from} → ${to}` });
                count++;
            }
        }
    }
    return { edit, count };
}

function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++)
        if (text[i] === '\n')
            starts.push(i + 1);
    return starts;
}

function position(lines: readonly number[], offset: number): vscode.Position {
    let low = 0, high = lines.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lines[mid] <= offset)
            low = mid;
        else
            high = mid - 1;
    }
    return new vscode.Position(low, offset - lines[low]);
}
