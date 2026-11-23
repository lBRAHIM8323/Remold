// Starts a real VS Code with Remold loaded on a throwaway workspace and runs suite.ts inside it, converting with the
// Filee at $REMOLD_FILEE (or the installed one). Downloads VS Code into .vscode-test/ the first time. On Linux, run
// under xvfb-run to keep the window off-screen.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { locateFilee } from '../../src/filee/locate';

async function main(): Promise<void> {
    const root = path.resolve(__dirname, '..', '..');
    // REMOLD_FILEE=managed tests the first-run setup: Remold downloads Filee itself into the fresh profile.
    const managed = process.env.REMOLD_FILEE === 'managed';
    let filee = managed ? undefined : locateFilee(process.env.REMOLD_FILEE);
    if (!filee && !managed)
        throw new Error('Filee not found: set REMOLD_FILEE to its command-line program, or to "managed".');
    const workspace = mkdtempSync(path.join(tmpdir(), 'remold-it-'));
    if (filee && process.env.DOTNET_ROOT && process.platform !== 'win32') {
        // A development build of Filee needs DOTNET_ROOT, which VS Code doesn't pass on to extensions; an installed
        // Filee doesn't. Wrap it in a script that sets it.
        const wrapper = path.join(mkdtempSync(path.join(tmpdir(), 'remold-filee-')), 'filee');
        writeFileSync(wrapper, `#!/bin/sh\nexport DOTNET_ROOT='${process.env.DOTNET_ROOT}'\nexec '${filee}' "$@"\n`);
        chmodSync(wrapper, 0o755);
        filee = wrapper;
    }
    copyFileSync(path.join(root, 'media', 'icon.png'), path.join(workspace, 'cat.png'));
    copyFileSync(path.join(root, 'media', 'icon.png'), path.join(workspace, 'dog.png'));
    writeFileSync(path.join(workspace, 'index.html'), '<img src="cat.png" alt="">\n');
    writeFileSync(path.join(workspace, 'notes.md'), '# Notes\n\nSome **text** to convert.\n');
    // remold.fileePath is a machine setting (a workspace must not choose which program runs), so it goes in the
    // user settings of a fresh profile.
    const userData = mkdtempSync(path.join(tmpdir(), 'remold-it-user-'));
    mkdirSync(path.join(userData, 'User'));
    writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify(managed ? { 'remold.fileeSource': 'managed' } : { 'remold.fileePath': filee }));
    await runTests({
        extensionDevelopmentPath: root,
        extensionTestsPath: path.join(__dirname, 'suite.js'),
        launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userData}`],
        extensionTestsEnv: { REMOLD_TEST_MODE: managed ? 'managed' : 'path' },
    });
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
