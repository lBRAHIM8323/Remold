# Remold

Convert images without leaving VS Code. Right-click an image → **Convert to ▸ WEBP** and the new file appears,
selected, next to the original. Everything runs on your computer with ImageMagick compiled to WebAssembly: nothing is
uploaded and nothing else needs to be installed.

## Formats

- **Reads:** PNG, JPG/JPEG/JFIF, WEBP, GIF, BMP, TIFF, AVIF, HEIC/HEIF, ICO, JPEG XL, TGA, QOI, PSD, JPEG 2000, DDS,
  OpenEXR, Radiance HDR, PPM, PCX, and camera RAW (DNG, CR2).
- **Writes:** PNG, JPG, WEBP, AVIF, GIF, JPEG XL, TIFF, BMP, ICO, QOI, TGA, JPEG 2000.

Animated GIFs stay animated when converted to WEBP or GIF, and multi-page files keep their pages in TIFF; other
formats get the first frame. Transparent areas become white in JPG. Images larger than 256 px are scaled down for ICO.

## Use

- **Convert to ▸** — right-click one or more images in the Explorer (or an image's editor tab) → **Convert to** →
  PNG, JPG, WEBP, AVIF, GIF or ICO. The image's own format isn't listed. The converted file is selected in the
  Explorer and a message shows the result, for example `cat.png → cat.webp · 38 KB (−72%)`.
- **More Formats…** — the last item of the submenu, the **Convert Image…** button in the title bar of VS Code's
  image preview, and **Remold: Convert Image…** in the Command Palette open a picker with every format. For one
  image it measures each format first and shows the size it would have (`38 KB · −72% · smallest`).
- **Update References** — after converting, Remold looks for HTML, CSS, Markdown, JavaScript/TypeScript, Vue,
  Svelte and Astro files that refer to the old file (relative paths, `/root/paths`, `@/` and `~/` aliases) and
  offers to update them. Every change is shown in VS Code's Refactor Preview to check before it's applied.
- **Insert as WebP** — drop (with <kbd>Shift</kbd>) or paste an image into a Markdown or HTML file, then pick
  **Insert as WEBP (Remold)** from the drop/paste menu that appears: the image is converted and a link to the
  converted file is inserted. Works for images from the Explorer, your file manager and the clipboard (screenshots
  are saved next to the document). The format is set by `remold.insertFormat`.

Existing files are never replaced: converting `cat.png` again gives `cat (1).webp`. One image converts with a
spinner in the status bar; several show a progress notification you can cancel. Conversions run in a background
thread, so VS Code stays responsive. Details are in the **Remold** output channel.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `remold.quality` | `85` | Quality (1–100) for JPG, WEBP, AVIF, JPEG XL and JPEG 2000. |
| `remold.outputFolder` | `""` | Folder for converted files, relative to each source file (e.g. `converted`) or absolute. Empty means next to the source. |
| `remold.estimateSizes` | `true` | Measure each format's size in the picker (one image up to 25 MB). |
| `remold.insertFormat` | `webp` | Format used by **Insert as … (Remold)** when dropping or pasting. |
| `remold.referenceFiles` | `**/*.{html,…,astro}` | Files searched by **Update References**; empty turns it off. |

## Limits

WebAssembly is slower than native ImageMagick (roughly 2–5×) and can use at most 4 GB of memory, so very large images
can fail. Only files on disk are supported, which includes Remote SSH, WSL and Dev Containers, where Remold runs on
the remote machine.

## Development

```bash
npm install
npm test          # builds dist/, then runs the unit tests in test/ against it
npm run test:integration   # runs Remold inside a downloaded VS Code (Linux: prefix with xvfb-run -a)
npm run typecheck
npm run package   # builds remold-<version>.vsix
```

Press <kbd>F5</kbd> in VS Code to start a development window with the extension loaded.

## License

MIT. Bundled third-party software and its licenses: see `THIRD-PARTY-NOTICES.md`.
