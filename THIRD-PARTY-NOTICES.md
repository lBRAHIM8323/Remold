# Third-party notices

Remold is MIT-licensed (see `LICENSE`). It bundles the following software, each under its own license.

| Component | License | Project |
|---|---|---|
| magick-wasm (`dist/magick.wasm` and the JavaScript bundled into `dist/`) | Apache-2.0 | https://github.com/dlemstra/magick-wasm |
| ImageMagick, compiled into `magick.wasm` | ImageMagick License | https://imagemagick.org |
| The image libraries compiled into `magick.wasm` (libpng, libjpeg-turbo, libwebp, libheif, libaom, libjxl, OpenJPEG, LibRaw, zlib and others) | Their own licenses | listed in magick-wasm's NOTICE |

The build copies magick-wasm's license and NOTICE file into the extension, at `dist/licenses/magick-wasm-LICENSE.txt`
and `dist/licenses/magick-wasm-NOTICE.txt`. The NOTICE file contains the full ImageMagick license and the license of
every library compiled into `magick.wasm`.

ImageMagick is a trademark of ImageMagick Studio LLC. Remold is not made or endorsed by ImageMagick Studio LLC.
