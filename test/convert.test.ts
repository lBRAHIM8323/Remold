// Converts generated images to every target format and checks the results with ImageMagick itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, before } from 'node:test';
import { ImageMagick, MagickColors, MagickFormat, MagickImageCollection, MagickImage, NoiseType, initializeImageMagick } from '@imagemagick/magick-wasm';
import { convertBytes } from '../src/convert';
import { READ_FORMAT_HINTS, TARGET_FORMATS, targetById } from '../src/formats';

before(async () => {
    await initializeImageMagick(readFileSync('dist/magick.wasm'));
});

function png(width: number, height: number, color = MagickColors.Red): Uint8Array {
    return ImageMagick.read(color, width, height, image => image.write(MagickFormat.Png, data => data.slice()));
}

function animatedGif(frames: number): Uint8Array {
    const collection = MagickImageCollection.create();
    const colors = [MagickColors.Red, MagickColors.Green, MagickColors.Blue];
    for (let i = 0; i < frames; i++) {
        const frame = MagickImage.create();
        frame.read(colors[i % colors.length], 16, 16);
        frame.animationDelay = 10;
        collection.push(frame);
    }
    const bytes = collection.write(MagickFormat.Gif, data => data.slice());
    collection.dispose();
    return bytes;
}

for (const target of TARGET_FORMATS) {
    test(`PNG converts to ${target.label}`, () => {
        const output = convertBytes(png(40, 30), target, { quality: 80, sourceExtension: 'png' });
        // TGA and ICO have no usable signature, so they have to be named when reading them back.
        const check = (images: { width: number; height: number }[]) => {
            assert.equal(images[0].width, 40);
            assert.equal(images[0].height, 30);
        };
        const hint = READ_FORMAT_HINTS[target.id];
        if (hint)
            ImageMagick.readCollection(output, hint, check);
        else
            ImageMagick.readCollection(output, check);
    });
}

test('converted output can be read back as the target format', () => {
    for (const id of ['webp', 'jpg', 'avif']) {
        const output = convertBytes(png(8, 8), targetById(id)!, { quality: 80, sourceExtension: 'png' });
        ImageMagick.read(output, image => assert.equal(image.format, targetById(id)!.magick));
    }
});

test('an animated GIF keeps its frames as WEBP', () => {
    const output = convertBytes(animatedGif(3), targetById('webp')!, { quality: 80, sourceExtension: 'gif' });
    ImageMagick.readCollection(output, images => assert.equal(images.length, 3));
});

test('an animated GIF becomes a single PNG frame', () => {
    const output = convertBytes(animatedGif(3), targetById('png')!, { quality: 80, sourceExtension: 'gif' });
    ImageMagick.readCollection(output, images => assert.equal(images.length, 1));
});

test('transparency becomes white in JPG', () => {
    const output = convertBytes(png(4, 4, MagickColors.Transparent), targetById('jpg')!, { quality: 90, sourceExtension: 'png' });
    ImageMagick.read(output, image => {
        const pixel = image.getPixels(pixels => pixels.getPixel(0, 0));
        // The JPG may be written as grayscale, so check every channel there is.
        assert.ok(pixel.length > 0 && pixel.every(value => value > 250), `expected white, got ${pixel.join(',')}`);
    });
});

test('large images are shrunk to 256 px for ICO', () => {
    const output = convertBytes(png(1000, 500), targetById('ico')!, { quality: 80, sourceExtension: 'png' });
    ImageMagick.read(output, MagickFormat.Ico, image => {
        assert.equal(image.width, 256);
        assert.equal(image.height, 128);
    });
});

test('quality changes the size of lossy output', () => {
    const noisy = ImageMagick.read(MagickColors.Gray, 200, 200, image => {
        image.addNoise(NoiseType.Random);
        return image.write(MagickFormat.Png, data => data.slice());
    });
    const low = convertBytes(noisy, targetById('jpg')!, { quality: 10, sourceExtension: 'png' });
    const high = convertBytes(noisy, targetById('jpg')!, { quality: 95, sourceExtension: 'png' });
    assert.ok(low.length < high.length);
});

test('an ICO file is read back as an image', () => {
    const ico = convertBytes(png(32, 32), targetById('ico')!, { quality: 80, sourceExtension: 'png' });
    const output = convertBytes(ico, targetById('png')!, { quality: 80, sourceExtension: 'ico' });
    ImageMagick.read(output, image => assert.equal(image.width, 32));
});

test('a file that is not an image fails with a message', () => {
    assert.throws(() => convertBytes(new TextEncoder().encode('not an image'), targetById('png')!, { quality: 80, sourceExtension: 'png' }));
});

