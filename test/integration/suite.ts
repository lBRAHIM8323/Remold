// Runs inside VS Code (see run.ts): Remold's commands convert files and find references in a real workspace.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const tests: [string, () => Promise<void>][] = [
        ['commands are registered', async () => {
            await vscode.extensions.getExtension('lbrahim8323.remold')!.activate();
            const commands = await vscode.commands.getCommands(true);
            for (const id of ['remold.to.png', 'remold.to.jpg', 'remold.to.webp', 'remold.to.avif', 'remold.to.gif', 'remold.to.ico', 'remold.moreFormats', 'remold.convertTo'])
                assert.ok(commands.includes(id), id);
        }],
        ['Convert to ▸ WEBP writes the file next to the original', async () => {
            await vscode.commands.executeCommand('remold.to.webp', vscode.Uri.file(path.join(workspace, 'cat.png')));
            await waitFor(() => existsSync(path.join(workspace, 'cat.webp')));
        }],
        ['a multi-selection converts every file', async () => {
            const files = ['cat.png', 'dog.png'].map(f => vscode.Uri.file(path.join(workspace, f)));
            await vscode.commands.executeCommand('remold.to.jpg', files[0], files);
            await waitFor(() => existsSync(path.join(workspace, 'cat.jpg')) && existsSync(path.join(workspace, 'dog.jpg')));
        }],
        ['converting again never replaces the first output', async () => {
            await vscode.commands.executeCommand('remold.to.webp', vscode.Uri.file(path.join(workspace, 'cat.png')));
            await waitFor(() => existsSync(path.join(workspace, 'cat (1).webp')));
        }],
    ];
    const failures: string[] = [];
    for (const [name, body] of tests) {
        try {
            await body();
            console.log(`  ✔ ${name}`);
        } catch (error) {
            console.log(`  ✖ ${name}: ${error instanceof Error ? error.message : error}`);
            failures.push(name);
        }
    }
    if (failures.length > 0)
        throw new Error(`${failures.length} integration test(s) failed: ${failures.join(', ')}`);
}

async function waitFor(condition: () => boolean, timeout = 15000): Promise<void> {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeout)
            throw new Error('timed out');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
