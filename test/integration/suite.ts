// Runs inside VS Code (see run.ts): Remold's commands convert files with the real Filee in a real workspace.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const file = (name: string) => path.join(workspace, name);
    const tests: [string, () => Promise<void>][] = [
        ['commands are registered', async () => {
            await vscode.extensions.getExtension('lbrahim8323.remold')!.activate();
            const commands = await vscode.commands.getCommands(true);
            for (const id of ['remold.to.pdf', 'remold.to.webp', 'remold.to.mp4', 'remold.to.folder', 'remold.moreFormats', 'remold.convertTo', 'remold.reloadFilee', 'remold.setupFilee', 'remold.installEngines'])
                assert.ok(commands.includes(id), id);
        }],
        ['Filee is ready (downloaded first when managed) and its formats load', async () => {
            // The first start downloads Filee when managed, and reads every format's targets (cached afterwards).
            const started = Date.now();
            // "Set Up Filee" downloads Filee when managed (the test run answers the download question), or loads the
            // configured one.
            await vscode.commands.executeCommand('remold.setupFilee');
            console.log(`    loaded in ${Date.now() - started} ms`);
        }],
        ['image: Convert to ▸ WEBP writes the file next to the original', async () => {
            await vscode.commands.executeCommand('remold.to.webp', vscode.Uri.file(file('cat.png')));
            await waitFor(() => existsSync(file('cat.webp')));
        }],
        ['a multi-selection converts every file', async () => {
            const files = ['cat.png', 'dog.png'].map(f => vscode.Uri.file(file(f)));
            await vscode.commands.executeCommand('remold.to.jpg', files[0], files);
            await waitFor(() => existsSync(file('cat.jpg')) && existsSync(file('dog.jpg')));
        }],
        ['converting again never replaces the first output', async () => {
            const first = statSync(file('cat.webp')).mtimeMs;
            await vscode.commands.executeCommand('remold.to.webp', vscode.Uri.file(file('cat.png')));
            // Filee adds a number to the name: "cat (2).webp".
            await waitFor(() => readdirSync(workspace).some(f => /^cat \(\d+\)\.webp$/.test(f)));
            assert.equal(statSync(file('cat.webp')).mtimeMs, first, 'cat.webp is unchanged');
        }],
        ['text: Markdown to PDF', async () => {
            await vscode.commands.executeCommand('remold.to.pdf', vscode.Uri.file(file('notes.md')));
            await waitFor(() => existsSync(file('notes.pdf')), 60000);
        }],
        ['image to video: PNG to MP4', async () => {
            await vscode.commands.executeCommand('remold.to.mp4', vscode.Uri.file(file('dog.png')));
            await waitFor(() => existsSync(file('dog.mp4')), 60000);
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

async function waitFor(condition: () => boolean, timeout = 20000): Promise<void> {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeout)
            throw new Error('timed out');
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}
