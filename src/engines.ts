// Installing Filee's optional engines (Calibre for e-books, Pandoc, FFmpeg, the upscaler, ExifTool, …) from VS Code,
// with Filee's own download and checks. Engines Filee can't download (LibreOffice and Tesseract on Linux, say) come
// with Filee's instructions for installing them.
import * as vscode from 'vscode';
import type { FileeEngine } from './filee/cli';
import type { FileeService } from './fileeService';
import { formatSize } from './sizes';

const ENGINE_DESCRIPTIONS: Readonly<Record<string, string>> = {
    libreoffice: 'Word, Excel, PowerPoint and OpenDocument files',
    pandoc: 'Markdown, HTML, LaTeX, EPUB and other text formats',
    ghostscript: 'PostScript, EPS and PDF processing',
    ffmpeg: 'video and audio',
    calibre: 'e-books: MOBI, AZW3, LIT, …',
    tesseract: 'reading text in images and scans (OCR)',
    'upscayl-bin': 'AI image upscaling',
    exiftool: 'photo and media metadata',
};

interface EngineItem extends vscode.QuickPickItem {
    readonly engine: FileeEngine;
}

/** Lets the user pick engines that aren't installed and installs them. Returns whether anything was installed. */
export async function installEngines(service: FileeService, reason?: string): Promise<boolean> {
    const filee = await service.get();
    if (!filee)
        return false;
    const engines = (await filee.cli.engines()).filter(e => e.status === 'notinstalled' || (e as { outdated?: boolean }).outdated);
    if (engines.length === 0) {
        void vscode.window.showInformationMessage('Every optional Filee engine is installed.');
        return false;
    }
    const picked = await vscode.window.showQuickPick(engines.map((engine): EngineItem => ({
        label: engine.id,
        description: [ENGINE_DESCRIPTIONS[engine.id], engine.downloadable && engine.downloadSize ? formatSize(engine.downloadSize) : undefined,
            engine.status !== 'notinstalled' ? 'update' : undefined].filter(Boolean).join(' · '),
        detail: engine.downloadable ? undefined : engine.unavailableReason,
        picked: false,
        engine,
    })), {
        title: reason ?? 'Install Filee engines',
        placeHolder: 'Engines to install (Filee downloads and checks them)',
        canPickMany: true,
    });
    if (!picked || picked.length === 0)
        return false;

    let installed = false;
    for (const { engine } of picked) {
        if (!engine.downloadable) {
            // Filee can't download it here; its own instructions say how to get it.
            const choice = await vscode.window.showInformationMessage(`${engine.id}: ${engine.unavailableReason ?? 'Install it yourself, then reload Filee\'s formats.'}`,
                'Reload Formats');
            if (choice === 'Reload Formats')
                installed = true;
            continue;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Remold: installing Filee's ${engine.id} engine${engine.downloadSize ? ` (${formatSize(engine.downloadSize)})` : ''}`,
                cancellable: true,
            }, (_progress, token) => {
                const abort = new AbortController();
                token.onCancellationRequested(() => abort.abort());
                return filee.cli.installEngine(engine.id, abort.signal);
            });
            installed = true;
        } catch (error) {
            void vscode.window.showWarningMessage(`Couldn't install ${engine.id}: ${error instanceof Error ? error.message : error}`);
        }
    }
    if (installed)
        // New engines add targets: read Filee's formats again.
        await service.reload({ fresh: true });
    return installed;
}
