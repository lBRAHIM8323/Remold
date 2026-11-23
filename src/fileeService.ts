// Connects Remold to Filee: finds the Filee to use (the user's own, or a copy Remold downloads and keeps up to date),
// loads what it can convert, sets the menus' context keys, and tells the user what to do when there's a problem.
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Catalog } from './filee/catalog';
import { FileeCli, FileeVersionError } from './filee/cli';
import { locateFilee } from './filee/locate';
import { ManagedFilee } from './filee/managed';
import { QUICK_TARGET_IDS, menuContext } from './filee/quick';
import { MIN_VERSION, isSupportedVersion } from './filee/release';
import { formatSize } from './sizes';

const GET_FILEE = 'https://filee.sh';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_UPDATE_CHECK = 'remold.lastFileeUpdateCheck';

export interface Filee {
    readonly cli: FileeCli;
    readonly catalog: Catalog;
    /** "managed" when Remold downloaded it. */
    readonly source: 'managed' | 'installed';
}

type Source = 'auto' | 'managed' | 'installed';

export class FileeService implements vscode.Disposable {
    private loading: Promise<Filee | undefined> | undefined;
    private problem: string | undefined;
    private readonly managed: ManagedFilee;
    private readonly subscriptions: vscode.Disposable[] = [];
    private updating = false;

    constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {
        this.managed = new ManagedFilee(path.join(context.globalStorageUri.fsPath, 'filee'));
        this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('remold.fileePath') || e.affectsConfiguration('remold.fileeSource'))
                void this.reload();
        }));
        // Check for Filee updates now and then while VS Code stays open.
        const timer = setInterval(() => void this.checkForUpdate(false), 6 * 60 * 60 * 1000);
        this.subscriptions.push({ dispose: () => clearInterval(timer) });
    }

    dispose(): void {
        this.subscriptions.forEach(s => s.dispose());
    }

    /**
     * Filee and its catalog, loading them on first use. Undefined (after telling the user) when Filee can't be used.
     * When the user asked for something (not `quiet`) while Filee is still being set up, a notification says so
     * instead of nothing happening until it's ready.
     */
    get(options: { quiet?: boolean } = {}): Promise<Filee | undefined> {
        this.loading ??= this.load();
        let settled = false;
        void this.loading.finally(() => { settled = true; });
        const waiting = options.quiet ? this.loading : Promise.resolve().then(() => settled ? this.loading! : vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Remold is still setting up Filee; your conversion starts when it\'s ready…' },
            () => this.loading!));
        return waiting.then(filee => {
            if (!filee && !options.quiet)
                void this.explainProblem();
            return filee;
        });
    }

    /** Loads Filee again, after the load in progress (if any) has finished, so two loads never download at once. */
    reload(): Promise<Filee | undefined> {
        const previous = this.loading ?? Promise.resolve(undefined);
        this.loading = previous.catch(() => undefined).then(() => this.load());
        return this.get({ quiet: true });
    }

    /**
     * Updates Remold's own copy of Filee when a newer supported release is out. `now` checks even if the last check
     * was recent and reports the outcome; otherwise it runs at most once a day and only speaks when it updated.
     */
    async checkForUpdate(now: boolean): Promise<void> {
        const filee = await this.loading;
        if (filee?.source !== 'managed' || this.updating) {
            if (now)
                void vscode.window.showInformationMessage(filee ? `Remold uses your own Filee ${filee.catalog.version}; update it from Filee's menu.` : 'Remold has no Filee to update.');
            return;
        }
        const last = this.context.globalState.get<number>(LAST_UPDATE_CHECK, 0);
        if (!now && Date.now() - last < UPDATE_INTERVAL_MS)
            return;
        this.updating = true;
        try {
            await this.context.globalState.update(LAST_UPDATE_CHECK, Date.now());
            const release = await this.managed.update();
            if (!release) {
                if (now)
                    void vscode.window.showInformationMessage(`Filee ${filee.catalog.version} is the latest version.`);
                return;
            }
            this.log.appendLine(`Updating Filee ${filee.catalog.version} → ${release.version}`);
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Remold: updating Filee to ${release.version}` },
                () => this.managed.install(release));
            await this.reload();
            vscode.window.setStatusBarMessage(`$(check) Remold: Filee updated to ${release.version}`, 10000);
        } catch (error) {
            this.log.appendLine(`Filee update failed (the current copy stays): ${message(error)}`);
            if (now)
                void vscode.window.showWarningMessage(`Couldn't update Filee: ${message(error)}`);
        } finally {
            this.updating = false;
        }
    }

    private async load(): Promise<Filee | undefined> {
        const config = vscode.workspace.getConfiguration('remold');
        const source = config.get<Source>('fileeSource', 'auto');
        const configured = config.get<string>('fileePath', '').trim();
        try {
            let filee: Filee | undefined;
            if (configured)
                filee = await this.useInstalled(locateFilee(configured), `Filee wasn't found at "${configured}" (remold.fileePath).`, true);
            else if (source === 'installed')
                filee = await this.useInstalled(locateFilee(undefined), 'Filee isn\'t installed (remold.fileeSource is "installed").', true);
            else if (source === 'auto')
                filee = await this.useInstalled(locateFilee(undefined), undefined, false);
            filee ??= configured || source === 'installed' ? undefined : await this.useManaged();
            await this.setMenus(filee?.catalog);
            if (filee) {
                this.problem = undefined;
                if (filee.source === 'managed')
                    void this.checkForUpdate(false);
            }
            return filee;
        } catch (error) {
            this.problem = error instanceof FileeVersionError ? error.message : `Remold couldn't use Filee: ${message(error)}`;
            this.log.appendLine(this.problem);
            await this.setMenus(undefined);
            return undefined;
        }
    }

    /**
     * The user's own Filee at `program`. With `required`, a missing or too old one is the problem to report; without,
     * it's skipped (and Remold's own copy is used).
     */
    private async useInstalled(program: string | undefined, missing: string | undefined, required: boolean): Promise<Filee | undefined> {
        if (!program) {
            if (required)
                this.problem = missing;
            return undefined;
        }
        const cli = new FileeCli(program);
        const version = await cli.version().catch(() => undefined);
        if (!version || !isSupportedVersion(version)) {
            const reason = `The Filee at "${program}" is ${version ?? 'not working'}; Remold needs Filee ${MIN_VERSION} or later (2.x).`;
            this.log.appendLine(required ? reason : `${reason} Using Remold's own copy instead.`);
            if (required)
                this.problem = `${reason} Update Filee from its menu, or set remold.fileeSource to "auto".`;
            return undefined;
        }
        return { cli, catalog: await this.loadCatalog(cli, program), source: 'installed' };
    }

    /** Remold's own copy, downloading it the first time. */
    private async useManaged(): Promise<Filee | undefined> {
        let installed = this.managed.current();
        if (!installed) {
            if (!this.managed.supported) {
                this.problem = `Filee has no download for ${process.platform} ${process.arch}. Install Filee yourself and set remold.fileePath.`;
                return undefined;
            }
            installed = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Remold: setting up Filee, the converter (one-time download)',
                cancellable: true,
            }, async (progress, token) => {
                const abort = new AbortController();
                token.onCancellationRequested(() => abort.abort());
                try {
                    const release = await this.managed.latest(abort.signal);
                    let reported = 0;
                    return await this.managed.install(release, (received, total) => {
                        const percent = total > 0 ? Math.floor(received / total * 100) : 0;
                        if (percent > reported) {
                            progress.report({ message: `Filee ${release.version} · ${formatSize(received)} of ${formatSize(total)}`, increment: percent - reported });
                            reported = percent;
                        }
                    }, abort.signal);
                } catch (error) {
                    this.problem = abort.signal.aborted ? 'Setting up Filee was cancelled.' : `Couldn't set up Filee: ${message(error)}`;
                    this.log.appendLine(this.problem);
                    return undefined;
                }
            });
            if (!installed)
                return undefined;
            this.log.appendLine(`Installed Filee ${installed.version} at ${installed.program}`);
            await this.context.globalState.update(LAST_UPDATE_CHECK, Date.now());
        }
        const cli = new FileeCli(installed.program, this.managed.environment());
        return { cli, catalog: await this.loadCatalog(cli, installed.program), source: 'managed' };
    }

    private async loadCatalog(cli: FileeCli, program: string): Promise<Catalog> {
        const storage = this.context.globalStorageUri.fsPath;
        mkdirSync(storage, { recursive: true });
        const started = Date.now();
        const catalog = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Remold: reading Filee\'s formats' },
            () => Catalog.load(cli, path.join(storage, 'catalog.json')));
        this.log.appendLine(`Filee ${catalog.version} at ${program}: ${catalog.formats.length} formats (${Date.now() - started} ms)`);
        return catalog;
    }

    private async setMenus(catalog: Catalog | undefined): Promise<void> {
        const menus = catalog ? menuContext(catalog) : undefined;
        await vscode.commands.executeCommand('setContext', 'remold.ready', !!catalog);
        await vscode.commands.executeCommand('setContext', 'remold.supported', menus?.supported ?? []);
        for (const id of QUICK_TARGET_IDS)
            await vscode.commands.executeCommand('setContext', `remold.quick.${id}`, menus?.quick[id] ?? []);
    }

    private async explainProblem(): Promise<void> {
        const choice = await vscode.window.showErrorMessage(this.problem ?? 'Remold needs Filee to convert files.', 'Try Again', 'Settings', 'About Filee');
        if (choice === 'About Filee')
            await vscode.env.openExternal(vscode.Uri.parse(GET_FILEE));
        else if (choice === 'Settings')
            await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:lbrahim8323.remold filee');
        else if (choice === 'Try Again')
            await this.reload().then(filee => { if (!filee) void this.explainProblem(); });
    }
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
