// Finds where a text file refers to an image, so references can be updated after the image is converted.
// No VS Code dependency so tests can use it.
import * as path from 'node:path';

/** Characters that can be part of a file name; a match next to one is part of a longer name. */
const NAME_CHAR = /[\p{L}\p{N}_.\-]/u;
/** Characters that end a path in code, markup or CSS. */
const DELIMITER = /[\s'"`()<>=,;{}[\]]/;
/** Alias prefixes bundlers resolve to the project's source root (Vue, Nuxt, Vite, webpack). */
const ALIAS = /^(@\/|~\/|~)/;

/**
 * Offsets of the base name of `sourcePath` wherever `text` (the content of `documentPath`) refers to that file:
 * relative to the document, relative to a workspace root, root-relative ("/img/cat.png", matched by the end of the
 * source path, as web servers serve a public folder) or through an alias ("@/assets/cat.png"). Web URLs and other
 * files with the same name are left alone.
 */
export function findReferences(text: string, documentPath: string, sourcePath: string, roots: readonly string[] = []): { start: number; end: number }[] {
    const base = path.basename(sourcePath);
    const source = path.normalize(sourcePath);
    const found: { start: number; end: number }[] = [];
    for (let i = text.indexOf(base); i !== -1; i = text.indexOf(base, i + 1)) {
        const end = i + base.length;
        if (i > 0 && NAME_CHAR.test(text[i - 1]))
            continue;
        const after = text[end];
        // "cat.png.bak" is another file; "cat.png." at the end of a sentence is not.
        if (after !== undefined && after !== '.' && NAME_CHAR.test(after))
            continue;
        if (after === '.' && text[end + 1] !== undefined && NAME_CHAR.test(text[end + 1]))
            continue;
        let start = i;
        while (start > 0 && !DELIMITER.test(text[start - 1]))
            start--;
        if (refersTo(text.slice(start, end), documentPath, source, roots))
            found.push({ start: i, end });
    }
    return found;
}

/** Windows paths are compared without regard to case, as Windows does. */
const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const endsWith = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase().endsWith(b.toLowerCase()) : a.endsWith(b);

function refersTo(token: string, documentPath: string, source: string, roots: readonly string[]): boolean {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token) || token.startsWith('data:'))
        return false;
    let decoded: string;
    try {
        decoded = decodeURI(token);
    } catch {
        decoded = token;
    }
    if (ALIAS.test(decoded) || decoded.startsWith('/')) {
        const tail = path.normalize('/' + decoded.replace(ALIAS, ''));
        return endsWith(source, tail);
    }
    if (same(path.resolve(path.dirname(documentPath), decoded), source))
        return true;
    return roots.some(root => same(path.resolve(root, decoded), source));
}
