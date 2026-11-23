// Renders media/icon.svg to media/icon.png (128 px, the Marketplace icon) with magick-wasm's built-in SVG renderer (MSVG), so no SVG tool is needed.
// Run after changing the SVG: node scripts/render-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ConfigurationFiles, ImageMagick, MagickColors, MagickFormat, MagickReadSettings, initializeImageMagick } from '@imagemagick/magick-wasm';

const require = createRequire(import.meta.url);
// The built-in SVG renderer draws through MVG, which the default policy blocks because MVG can read other files. Allow
// it here only, for our own SVG; the extension keeps the default policy.
const configuration = ConfigurationFiles.default;
configuration.policy.data = configuration.policy.data.replace('<policy domain="coder" rights="none" pattern="MVG" />', '');
await initializeImageMagick(readFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm')), configuration);
// Render at 4× and scale down for smooth edges. The SVG uses solid colours only: this renderer can't draw gradients.
const settings = new MagickReadSettings({ format: MagickFormat.Msvg, density: 288, backgroundColor: MagickColors.Transparent });
const png = ImageMagick.read(readFileSync('media/icon.svg'), settings, image => {
    image.resize(128, 128);
    return image.write(MagickFormat.Png, data => data.slice());
});
writeFileSync('media/icon.png', png);
console.log('media/icon.png', png.length, 'bytes');
