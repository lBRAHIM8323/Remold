// Starts a real VS Code with Remold loaded on a throwaway workspace and runs suite.ts inside it.
// Downloads VS Code into .vscode-test/ the first time. On Linux, run under xvfb-run to keep the window off-screen.
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

// A 1 × 1 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function main(): Promise<void> {
    const root = path.resolve(__dirname, '..', '..');
    const workspace = mkdtempSync(path.join(tmpdir(), 'remold-it-'));
    writeFileSync(path.join(workspace, 'cat.png'), PNG);
    writeFileSync(path.join(workspace, 'index.html'), '<img src="cat.png" alt="">\n');
    cpSync(path.join(workspace, 'cat.png'), path.join(workspace, 'dog.png'));
    await runTests({
        extensionDevelopmentPath: root,
        extensionTestsPath: path.join(__dirname, 'suite.js'),
        launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust'],
    });
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
