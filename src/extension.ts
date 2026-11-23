// Remold's VS Code entry point. Converting is done by Filee (https://filee.sh): the user's own, or a copy Remold
// downloads and keeps up to date. Remold reads Filee's formats at startup: "Convert to ▸" in the Explorer and editor tab menus, "More Formats…" with everything Filee offers,
// reference updates after converting, and "Insert as WEBP" when dropping or pasting images.
import * as vscode from 'vscode';
import { convertFiles } from './convertFiles';
import { installEngines } from './engines';
import { FileeService } from './fileeService';
import { QUICK_TARGET_IDS } from './filee/quick';
import { registerInsertProviders } from './insert';
import { pickTarget } from './picker';

export function activate(context: vscode.ExtensionContext): void {
    const log = vscode.window.createOutputChannel('Remold');
    if (process.env.REMOLD_TEST_MODE) {
        // Integration tests can't read the output channel; echo it to the test's console.
        const appendLine = log.appendLine.bind(log);
        log.appendLine = line => { console.log(`[remold] ${line}`); appendLine(line); };
    }
    const service = new FileeService(context, log);
    context.subscriptions.push(log, service, registerInsertProviders(service));
    // Load the catalog now so the menus are ready before the first right-click.
    void service.get({ quiet: true });

    for (const target of QUICK_TARGET_IDS)
        context.subscriptions.push(vscode.commands.registerCommand(`remold.to.${target}`, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            const filee = await service.get();
            const files = filee ? await chooseFiles(uri, uris) : [];
            if (filee && files.length > 0)
                await convertFiles(filee, files, target, log);
        }));

    const pickAndConvert = async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const filee = await service.get();
        const files = filee ? await chooseFiles(uri, uris) : [];
        if (!filee || files.length === 0)
            return;
        const picked = await pickTarget(filee, files);
        if (!picked)
            return;
        if (picked.needsEngine) {
            const name = filee.catalog.format(picked.target)?.name ?? picked.target;
            if (!(await installEngines(service, `${name} needs an optional Filee engine: pick the one to install`)))
                return;
            const reloaded = await service.get();
            await reloaded?.catalog.ensureTargets(files);
            if (!reloaded?.catalog.commonTargets(files).includes(picked.target)) {
                void vscode.window.showWarningMessage(`${name} still isn't available; another engine may be needed (Remold: Install Filee Engines…).`);
                return;
            }
            await convertFiles(reloaded, files, picked.target, log);
            return;
        }
        await convertFiles(filee, files, picked.target, log);
    };
    context.subscriptions.push(
        vscode.commands.registerCommand('remold.convertTo', pickAndConvert),
        vscode.commands.registerCommand('remold.moreFormats', pickAndConvert),
        vscode.commands.registerCommand('remold.updateFilee', () => service.checkForUpdate(true)),
        vscode.commands.registerCommand('remold.setupFilee', () => service.setUp()),
        vscode.commands.registerCommand('remold.installEngines', () => installEngines(service)),
        vscode.commands.registerCommand('remold.reloadFilee', async () => {
            const filee = await service.reload({ fresh: true });
            if (filee)
                void vscode.window.showInformationMessage(`Remold uses Filee ${filee.catalog.version}: ${filee.catalog.formats.length} formats.`);
            else
                await service.get();
        }));
}

export function deactivate(): void {
    // Nothing to stop: each conversion is its own Filee process, ended with its command.
}

/** The files to convert: the Explorer selection, the clicked file, the file open in the editor, or a file picker. */
async function chooseFiles(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined): Promise<string[]> {
    let chosen = uris && uris.length > 0 ? uris : uri ? [uri] : activeFile();
    if (chosen.length === 0)
        chosen = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Convert' }) ?? [];
    const files = chosen.filter(f => f.scheme === 'file').map(f => f.fsPath);
    if (chosen.length > 0 && files.length === 0)
        void vscode.window.showWarningMessage('Remold can only convert files on disk.');
    return files;
}

/** The file shown in the active editor tab, if any. */
function activeFile(): vscode.Uri[] {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? [input.uri] : [];
}
