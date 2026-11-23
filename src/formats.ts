// The image formats Remold reads and writes, shared by the extension and the conversion worker.
// Only the type is imported: the extension host loads this file too, and importing magick-wasm's values would bundle
// ImageMagick's JavaScript into it. The worker is the only part that runs ImageMagick.
import type { MagickFormat } from '@imagemagick/magick-wasm';

/** A format Remold can write. */
export interface TargetFormat {
    /** Stable id, also the file extension written. */
    readonly id: string;
    /** Name shown in the format picker. */
    readonly label: string;
    readonly description: string;
    readonly magick: MagickFormat;
    /** Whether the quality setting applies. */
    readonly lossy: boolean;
    /** Whether all frames of an animated or multi-page source are kept. */
    readonly animated: boolean;
    /** Common formats get their own entry in the "Convert to" menu; the rest are under "More formats…". */
    readonly common: boolean;
}

export const TARGET_FORMATS: readonly TargetFormat[] = [
    { id: 'png', label: 'PNG', description: 'Lossless, keeps transparency', magick: 'PNG', lossy: false, animated: false, common: true },
    { id: 'jpg', label: 'JPG', description: 'Small photos, no transparency', magick: 'JPEG', lossy: true, animated: false, common: true },
    { id: 'webp', label: 'WEBP', description: 'Small, keeps transparency and animation', magick: 'WEBP', lossy: true, animated: true, common: true },
    { id: 'avif', label: 'AVIF', description: 'Smallest, slow to encode', magick: 'AVIF', lossy: true, animated: false, common: true },
    { id: 'gif', label: 'GIF', description: 'Animation, 256 colours', magick: 'GIF', lossy: false, animated: true, common: true },
    { id: 'jxl', label: 'JPEG XL', description: 'Modern, lossless or lossy', magick: 'JXL', lossy: true, animated: false, common: false },
    { id: 'tiff', label: 'TIFF', description: 'Print and archiving, keeps all pages', magick: 'TIFF', lossy: false, animated: true, common: false },
    { id: 'bmp', label: 'BMP', description: 'Uncompressed bitmap', magick: 'BMP', lossy: false, animated: false, common: false },
    { id: 'ico', label: 'ICO', description: 'Windows icon, up to 256 px', magick: 'ICO', lossy: false, animated: false, common: true },
    { id: 'qoi', label: 'QOI', description: 'Fast lossless', magick: 'QOI', lossy: false, animated: false, common: false },
    { id: 'tga', label: 'TGA', description: 'Game textures', magick: 'TGA', lossy: false, animated: false, common: false },
    { id: 'jp2', label: 'JPEG 2000', description: 'Archiving and medical imaging', magick: 'JP2', lossy: true, animated: false, common: false },
];

/** File extensions Remold reads (lower case, without the dot). */
export const INPUT_EXTENSIONS: readonly string[] = [
    'png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'ico',
    'jxl', 'tga', 'qoi', 'psd', 'jp2', 'dds', 'exr', 'hdr', 'ppm', 'pcx', 'dng', 'cr2',
];

/**
 * Formats ImageMagick can't tell from the file's first bytes: TGA and ICO have no usable signature, and camera RAW
 * files look like TIFF, which would only give their small embedded preview.
 */
export const READ_FORMAT_HINTS: Readonly<Record<string, MagickFormat>> = {
    tga: 'TGA',
    ico: 'ICO',
    dng: 'DNG',
    cr2: 'CR2',
};

/** The lower-case extension of a path, without the dot ("" when it has none). */
export function extensionOf(path: string): string {
    const name = path.replace(/^.*[\\/]/, '');
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isSupportedInput(path: string): boolean {
    return INPUT_EXTENSIONS.includes(extensionOf(path));
}

/** Maps extensions that share a format to the target id (jpeg → jpg, tif → tiff). */
export function normaliseExtension(extension: string): string {
    return ({ jpeg: 'jpg', jfif: 'jpg', tif: 'tiff' } as Record<string, string>)[extension] ?? extension;
}

/**
 * The formats offered for `sources`: all of them, except the one every source already has (converting a PNG to PNG
 * isn't a conversion).
 */
export function targetsFor(sources: readonly string[]): TargetFormat[] {
    const formats = new Set(sources.map(s => normaliseExtension(extensionOf(s))));
    const only = formats.size === 1 ? [...formats][0] : undefined;
    return TARGET_FORMATS.filter(f => f.id !== only);
}

export function targetById(id: string): TargetFormat | undefined {
    return TARGET_FORMATS.find(f => f.id === id);
}
