// The "More formats…" picker: every format, with the size the image would have in each when there's one image.
import { statSync } from 'node:fs';
import * as vscode from 'vscode';
import type { ConversionEngine } from './engine';
import { TargetFormat, targetsFor } from './formats';
import { formatSize, sizeChange } from './sizes';

/** Estimating means converting the image once per format; past this size it takes too long to be worth it. */
const MAX_ESTIMATE_SOURCE = 25 * 1024 * 1024;

interface FormatItem extends vscode.QuickPickItem {
    readonly format?: TargetFormat;
}

export function pickFormat(files: readonly string[], engine: ConversionEngine): Promise<TargetFormat | undefined> {
    const config = vscode.workspace.getConfiguration('remold');
    const quality = config.get<number>('quality', 85);
    const targets = targetsFor(files);
    const sourceSize = files.length === 1 ? sizeOf(files[0]) : undefined;
    const estimate = config.get<boolean>('estimateSizes', true) && sourceSize !== undefined && sourceSize <= MAX_ESTIMATE_SOURCE;
    const sizes = new Map<string, number>();

    const picker = vscode.window.createQuickPick<FormatItem>();
    picker.title = files.length === 1 ? `Convert ${baseName(files[0])} to` : `Convert ${files.length} images to`;
    picker.placeholder = estimate ? 'Format (sizes appear as they are measured)' : 'Format';
    picker.matchOnDetail = true;

    const build = (): FormatItem[] => {
        const measured = [...sizes.values()].filter(Number.isFinite);
        const smallest = sizes.size === targets.length && measured.length > 0 ? Math.min(...measured) : undefined;
        const item = (format: TargetFormat): FormatItem => {
            const size = sizes.get(format.id);
            return {
                label: format.label,
                description: size === undefined ? (estimate ? 'measuring…' : undefined)
                    : !Number.isFinite(size) ? 'can\'t measure'
                    : `${formatSize(size)} · ${sizeChange(sourceSize!, size)}${size === smallest ? ' · smallest' : ''}`,
                detail: format.description,
                format,
            };
        };
        const common = targets.filter(t => t.common), more = targets.filter(t => !t.common);
        return [
            { label: 'Common', kind: vscode.QuickPickItemKind.Separator }, ...common.map(item),
            { label: 'More', kind: vscode.QuickPickItemKind.Separator }, ...more.map(item),
        ];
    };
    picker.items = build();

    return new Promise(resolve => {
        let open = true;
        picker.onDidAccept(() => {
            resolve(picker.selectedItems[0]?.format);
            picker.hide();
        });
        picker.onDidHide(() => {
            open = false;
            resolve(undefined);
            picker.dispose();
        });
        picker.show();

        if (!estimate)
            return;
        void (async () => {
            // One format at a time, in list order, so the first sizes show quickly; stops when the picker closes.
            for (const format of targets) {
                if (!open)
                    return;
                try {
                    sizes.set(format.id, await engine.estimate({ input: files[0], targetId: format.id, quality }));
                } catch {
                    sizes.set(format.id, Number.NaN);
                }
                if (!open)
                    return;
                // Replacing the items moves the highlight to the first one; put it back.
                const active = picker.activeItems[0]?.format?.id;
                picker.items = build();
                const again = picker.items.find(i => i.format?.id === active);
                if (again)
                    picker.activeItems = [again];
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

function baseName(file: string): string {
    return file.replace(/^.*[\\/]/, '');
}
