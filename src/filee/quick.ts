// The "Convert to ▸" submenu: a short list of common targets for each kind of file. Everything else Filee can do is
// under "More Formats…". No VS Code dependency so tests can use it.
import type { Catalog } from './catalog';

/** Remold's choice of common targets per Filee category, most useful first. Unknown categories get none. */
export const QUICK_TARGETS: Readonly<Record<string, readonly string[]>> = {
    image: ['png', 'jpg', 'webp', 'avif', 'gif', 'ico', 'pdf'],
    vector: ['svg', 'png', 'pdf'],
    pdf: ['docx', 'png', 'jpg', 'txt'],
    document: ['pdf', 'docx', 'odt', 'txt', 'md', 'html'],
    hwp: ['pdf', 'docx'],
    spreadsheet: ['xlsx', 'csv', 'ods', 'pdf'],
    presentation: ['pdf', 'pptx', 'png'],
    text: ['pdf', 'docx', 'html', 'md'],
    data: ['json', 'csv', 'yaml', 'xml', 'xlsx'],
    ebook: ['epub', 'pdf', 'mobi', 'azw3'],
    video: ['mp4', 'webm', 'gif', 'mp3'],
    audio: ['mp3', 'wav', 'flac', 'm4a', 'ogg'],
    archive: ['zip', '7z', 'folder'],
    cad: ['pdf', 'dxf', 'svg', 'png'],
    font: ['ttf', 'otf', 'woff2'],
    subtitle: ['srt', 'vtt', 'ass'],
    geo: ['geojson', 'gpx', 'kml'],
    model3d: ['glb', 'stl', 'obj'],
};

/** Every target with its own command, in submenu order. */
export const QUICK_TARGET_IDS: readonly string[] = [...new Set(Object.values(QUICK_TARGETS).flat())];

/** Menu titles; the ids are Filee's. */
export const QUICK_TARGET_TITLES: Readonly<Record<string, string>> = {
    png: 'PNG', jpg: 'JPG', webp: 'WEBP', avif: 'AVIF', gif: 'GIF', ico: 'ICO', pdf: 'PDF', svg: 'SVG', docx: 'DOCX',
    txt: 'TXT', odt: 'ODT', md: 'Markdown', html: 'HTML', xlsx: 'XLSX', csv: 'CSV', ods: 'ODS', pptx: 'PPTX',
    json: 'JSON', yaml: 'YAML', xml: 'XML', epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', mp4: 'MP4', webm: 'WEBM',
    mp3: 'MP3', wav: 'WAV', flac: 'FLAC', m4a: 'M4A', ogg: 'OGG', zip: 'ZIP', '7z': '7Z', folder: 'Extract to Folder',
    dxf: 'DXF', ttf: 'TTF', otf: 'OTF', woff2: 'WOFF2', srt: 'SRT', vtt: 'VTT', ass: 'ASS', geojson: 'GeoJSON',
    gpx: 'GPX', kml: 'KML', glb: 'GLB', stl: 'STL', obj: 'OBJ',
};

/** Context key values for the menus' "when" clauses: file extensions as VS Code's resourceExtname gives them. */
export interface MenuContext {
    /** Extensions of every format Filee reads: "Convert to ▸" appears for them. */
    readonly supported: string[];
    /** Per quick target: extensions of the files whose submenu shows it. */
    readonly quick: Record<string, string[]>;
}

export function menuContext(catalog: Catalog): MenuContext {
    const supported = new Set<string>();
    const quick: Record<string, Set<string>> = Object.fromEntries(QUICK_TARGET_IDS.map(id => [id, new Set<string>()]));
    for (const format of catalog.formats) {
        // Until a format's targets are read, assume it reaches its category's quick targets; the command checks
        // again before converting, and the menus are set again once every format is known.
        const known = catalog.hasTargets(format.id);
        const targets = known ? catalog.targetsOf(format.id) : QUICK_TARGETS[format.category] ?? [];
        if (known && targets.length === 0)
            continue;
        // resourceExtname is the part after the last dot, so "tar.gz" shows as ".gz"; the submenu checks the full
        // name when it runs, and "More Formats…" is always right.
        const extensions = format.extensions.flatMap(e => variants(`.${e.split('.').pop()}`));
        extensions.forEach(e => supported.add(e));
        for (const target of QUICK_TARGETS[format.category] ?? [])
            if (target !== format.id && targets.includes(target))
                extensions.forEach(e => quick[target].add(e));
    }
    return {
        supported: [...supported],
        quick: Object.fromEntries(Object.entries(quick).map(([id, set]) => [id, [...set]])),
    };
}

/** ".jpg", ".JPG" and ".Jpg": the "in" operator compares exactly. */
function variants(extension: string): string[] {
    const lower = extension.toLowerCase();
    return [...new Set([lower, extension.toUpperCase(), lower.charAt(0) + lower.charAt(1).toUpperCase() + lower.slice(2)])];
}
