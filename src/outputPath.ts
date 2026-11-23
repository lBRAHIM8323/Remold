// Chooses where a converted file goes without replacing an existing file.
import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * The path for `source` converted to `extension`, in `outputFolder` (relative to the source's folder, or absolute;
 * "" means the source's folder). Adds " (1)", " (2)", … when the name is taken.
 */
export function outputPathFor(source: string, extension: string, outputFolder: string,
    exists: (candidate: string) => boolean = existsSync): string {
    const folder = path.resolve(path.dirname(source), outputFolder);
    const base = path.basename(source, path.extname(source));
    let candidate = path.join(folder, `${base}.${extension}`);
    for (let n = 1; exists(candidate); n++)
        candidate = path.join(folder, `${base} (${n}).${extension}`);
    return candidate;
}
