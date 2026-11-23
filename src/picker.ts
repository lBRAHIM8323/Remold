// "More Formats…": every format Filee can convert the chosen files to, grouped by kind. For one image it also
// measures what size each suggested format would have.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Filee } from './fileeService';
import { QUICK_TARGETS } from './filee/quick';
import { formatSize, sizeChange } from './sizes';

/** Measuring converts the file once per format; past this size, or for slow kinds of files, it isn't worth it. */
const MAX_ESTIMATE_SOURCE = 25 * 1024 * 1024;
const ESTIMATED_CATEGORIES = new Set(['image', 'vector']);

const CATEGORY_TITLES: Readonly<Record<string, string>> = {
    image: 'Images', vector: 'Vector graphics', pdf: 'PDF', document: 'Documents', hwp: 'Hangul (HWP)',
    spreadsheet: 'Spreadsheets', presentation: 'Presentations', text: 'Text and markup', data: 'Data',
    ebook: 'E-books', video: 'Video', audio: 'Audio', archive: 'Archives', cad: 'CAD', font: 'Fonts',
    subtitle: 'Subtitles', geo: 'Maps and GPS', model3d: '3D models',
};

interface FormatItem extends vscode.QuickPickItem {
    readonly target?: string;
}

export function pickTarget(filee: Filee, files: readonly string[]): Promise<string | undefined> {
    const { catalog } = filee;
    const targets = catalog.commonTargets(files);
    if (targets.length === 0) {
        void vscode.window.showWarningMessage(files.length === 1
            ? `Filee can't convert ${path.basename(files[0])}.`
            : 'Filee has no format all the selected files can be converted to. Select files of one kind.');
        return Promise.resolve(undefined);
    }
    const source = files.length === 1 ? catalog.formatOf(files[0]) : undefined;
    const suggested = (source ? QUICK_TARGETS[source.category] ?? [] : []).filter(t => targets.includes(t));
    const sourceSize = files.length === 1 ? sizeOf(files[0]) : undefined;
    const estimate = vscode.workspace.getConfiguration('remold').get<boolean>('estimateSizes', true)
        && !!source && ESTIMATED_CATEGORIES.has(source.category) && sourceSize !== undefined && sourceSize <= MAX_ESTIMATE_SOURCE;
    const sizes = new Map<string, number>();

    const picker = vscode.window.createQuickPick<FormatItem>();
    picker.title = files.length === 1 ? `Convert ${path.basename(files[0])} to` : `Convert ${files.length} files to`;
    picker.placeholder = `${targets.length} formats · type to filter`;
    picker.matchOnDescription = true;

    const item = (target: string): FormatItem => {
        const format = catalog.format(target);
        const size = sizes.get(target);
        const measured = [...sizes.values()].filter(Number.isFinite);
        const smallest = sizes.size === suggested.length && measured.length > 0 ? Math.min(...measured) : undefined;
        return {
            label: format?.name ?? target,
            description: size === undefined ? (estimate && suggested.includes(target) ? 'measuring…' : `.${format?.extensions[0] ?? target}`)
                : !Number.isFinite(size) ? 'can\'t measure'
                : `${formatSize(size)} · ${sizeChange(sourceSize!, size)}${size === smallest ? ' · smallest' : ''}`,
            target,
        };
    };
    const build = (): FormatItem[] => {
        const items: FormatItem[] = [];
        if (suggested.length > 0)
            items.push({ label: 'Suggested', kind: vscode.QuickPickItemKind.Separator }, ...suggested.map(item));
        const byCategory = new Map<string, string[]>();
        for (const target of targets.filter(t => !suggested.includes(t))) {
            const category = catalog.format(target)?.category ?? 'other';
            byCategory.set(category, [...(byCategory.get(category) ?? []), target]);
        }
        for (const [category, list] of byCategory)
            items.push({ label: CATEGORY_TITLES[category] ?? category, kind: vscode.QuickPickItemKind.Separator }, ...list.map(item));
        return items;
    };
    picker.items = build();

    return new Promise(resolve => {
        let open = true;
        const abort = new AbortController();
        picker.onDidAccept(() => {
            resolve(picker.selectedItems[0]?.target);
            picker.hide();
        });
        picker.onDidHide(() => {
            open = false;
            abort.abort();
            resolve(undefined);
            picker.dispose();
        });
        picker.show();
        if (!estimate)
            return;
        void (async () => {
            const scratch = mkdtempSync(path.join(tmpdir(), 'remold-size-'));
            try {
                // One format at a time, so the first sizes show quickly; stops when the picker closes.
                for (const target of suggested) {
                    if (!open)
                        return;
                    let size = Number.NaN;
                    try {
                        const folder = path.join(scratch, target);
                        const result = await filee.cli.convert([files[0]], target, { outputFolder: folder, signal: abort.signal });
                        const outputs = result.files[0]?.outputs ?? [];
                        if (result.files[0]?.state === 'done' && outputs.length > 0)
                            size = outputs.reduce((sum, o) => sum + (sizeOf(o) ?? 0), 0);
                    } catch { /* stays NaN */ }
                    if (!open)
                        return;
                    sizes.set(target, size);
                    // Replacing the items moves the highlight to the first one; put it back.
                    const active = picker.activeItems[0]?.target;
                    picker.items = build();
                    const again = picker.items.find(i => i.target === active);
                    if (again)
                        picker.activeItems = [again];
                }
            } finally {
                rmSync(scratch, { recursive: true, force: true });
            }
        })();
    });
}

function sizeOf(file: string): number | undefined {
    try {
        return statSync(file).size;
    } catch {
        return undefined;
    }
}
