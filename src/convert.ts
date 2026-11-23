// Converts image bytes from one format to another with ImageMagick (WebAssembly). Runs inside the worker thread.
import { AlphaAction, IMagickImage, IMagickImageCollection, ImageMagick, MagickColors, MagickGeometry } from '@imagemagick/magick-wasm';
import { READ_FORMAT_HINTS, TargetFormat } from './formats';

export interface ConvertOptions {
    /** 1–100, used by lossy formats only. */
    readonly quality: number;
    /** Lower-case extension of the source file, used when the format can't be detected from its bytes. */
    readonly sourceExtension: string;
}

/** ICO files can't hold images larger than 256 × 256. */
const ICO_MAX = 256;

/**
 * Returns `input` converted to `target`. An animated or multi-page source keeps all frames when the target can hold
 * them; otherwise only the first frame is written. Throws when the input isn't an image ImageMagick can read.
 * ImageMagick must already be initialised.
 */
export function convertBytes(input: Uint8Array, target: TargetFormat, options: ConvertOptions): Uint8Array {
    const hint = READ_FORMAT_HINTS[options.sourceExtension];
    const handle = (images: IMagickImageCollection): Uint8Array => {
        if (images.length === 0)
            throw new Error('The file contains no image.');
        if (target.animated && images.length > 1) {
            // Frames of a GIF can be partial updates; coalescing turns each into a full picture so other formats show
            // them correctly.
            images.coalesce();
            for (const image of images)
                prepare(image, target, options);
            // Copy the bytes: ImageMagick frees its buffer when the callback returns.
            return images.write(target.magick, data => data.slice());
        }
        const first = images[0];
        prepare(first, target, options);
        return first.write(target.magick, data => data.slice());
    };
    return hint ? ImageMagick.readCollection(input, hint, handle) : ImageMagick.readCollection(input, handle);
}

function prepare(image: IMagickImage, target: TargetFormat, options: ConvertOptions): void {
    if (target.lossy)
        image.quality = options.quality;
    if (target.id === 'jpg' && image.hasAlpha) {
        // JPG has no transparency; without this, transparent areas turn black.
        image.backgroundColor = MagickColors.White;
        image.alpha(AlphaAction.Remove);
    }
    if (target.id === 'ico' && (image.width > ICO_MAX || image.height > ICO_MAX))
        image.resize(new MagickGeometry(ICO_MAX, ICO_MAX));
}
