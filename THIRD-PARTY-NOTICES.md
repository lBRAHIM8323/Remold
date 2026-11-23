# Third-party notices

Remold is MIT-licensed (see `LICENSE`) and contains no third-party code.

## Filee

Every conversion in Remold is done by **Filee** (https://filee.sh, https://github.com/KnifeLemon/Filee), MIT
license, Copyright (c) 2026 Myeonggu Kim (KnifeLemon) and Filee contributors. Remold runs either the user's own
Filee or Filee's official release package, which Remold downloads from Filee's GitHub releases on first use. That
package comes with Filee's own LICENSE and THIRD-PARTY-NOTICES.md for Filee and the engines it bundles. Remold
doesn't include or change Filee. Remold is an independent project, not made or endorsed by the Filee authors.

## Development only

`scripts/render-icon.mjs` renders the icon with magick-wasm (Apache-2.0, https://github.com/dlemstra/magick-wasm),
which includes ImageMagick (ImageMagick License). It is a development dependency and is not part of the extension.
