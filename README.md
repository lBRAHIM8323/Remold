# Remold

Convert files without leaving VS Code: right-click → **Convert to ▸ PDF**, **WEBP**, **MP3**, **Extract to
Folder**… Remold is the VS Code front end of [Filee](https://filee.sh), the offline file converter: everything
Filee converts (images, PDF, Word/Excel/PowerPoint and OpenDocument files, HWP, e-books, video, audio, archives,
subtitles, data, maps, fonts, CAD drawings, 3D models — 300+ formats), Remold converts. Files never leave your
computer.

## Setup

Nothing to install by hand. On first start Remold uses your own [Filee](https://filee.sh) if you have 2.5 or later;
otherwise it downloads Filee's official package for your computer from
[Filee's releases](https://github.com/KnifeLemon/Filee/releases) (about 140 MB, once, with a progress notification)
into VS Code's storage for Remold. Only Filee's command line is used — no Filee window, icon or menu entries — and
its settings and engines stay in Remold's folder.

Every download is checked before it's used: Filee signs each release's checksum file with its update key (the same
check Filee's own updater does), and the package must match that checksum and run as the version it claims to be.

**Updates.** Once a day Remold looks for a newer Filee 2.x and updates its copy in the background; the old copy
stays in use if anything goes wrong. New formats Filee adds appear in Remold by themselves — no Remold update
needed. A Filee 3.0 is only used once a Remold version supports it. **Remold: Check for Filee Updates** checks now.
If you use your own Filee, update it from Filee's menu.

Optional Filee engines (Calibre, Tesseract, …) are installed with Filee: `filee engines`. On Linux, Word/Excel/
PowerPoint conversions need LibreOffice from your distribution.

## Use

- **Convert to ▸** — right-click one or more files in the Explorer (or a file's editor tab) → **Convert to**. The
  submenu lists the common targets for that kind of file: PNG, JPG, WEBP… for images, PDF, DOCX, ODT… for
  documents, MP4, WEBM, GIF, MP3 for video, **Extract to Folder**, ZIP, 7Z for archives, and so on. The new file is
  selected in the Explorer and a message shows the result, for example `cat.png → cat.webp · 38 KB (−72%)`.
- **More Formats…** — the last item of the submenu (also **Remold: Convert File…** in the Command Palette and a
  button on VS Code's image preview) lists every format Filee can convert the file to, grouped by kind. For one
  image it measures the suggested formats first and shows their sizes (`38 KB · −72% · smallest`).
- **Update References** — after converting, Remold looks for HTML, CSS, Markdown, JavaScript/TypeScript, Vue,
  Svelte and Astro files that refer to the old file (relative paths, `/root/paths`, `@/` and `~/` aliases) and
  offers to update them. Every change is shown in VS Code's Refactor Preview to check before it's applied.
- **Insert as WEBP** — drop (with <kbd>Shift</kbd>) or paste an image into a Markdown or HTML file and pick
  **Insert as WEBP (Remold)** from the drop/paste menu: the image is converted and a link to the converted file is
  inserted. Works for images from the Explorer, your file manager and the clipboard (screenshots are saved next to
  the document). The format is set by `remold.insertFormat`.

Existing files are never replaced: Filee adds a number instead (`cat (2).webp`). One file converts with a spinner in
the status bar; several show a progress notification you can cancel. Details are in the **Remold** output channel.
**Remold: Reload Filee Formats** re-reads Filee after installing an engine.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `remold.fileeSource` | `auto` | `auto`: your Filee 2.5+ if installed, otherwise Remold's own copy. `managed`: always Remold's copy. `installed`: only yours; Remold downloads nothing. |
| `remold.fileePath` | `""` | A Filee command-line program to use instead (overrides `remold.fileeSource`). |
| `remold.quality` | `85` | Quality (1–100) for lossy image formats, passed to Filee. |
| `remold.outputFolder` | `""` | Folder for converted files, relative to each source file (e.g. `converted`) or absolute. Empty means next to the source. |
| `remold.estimateSizes` | `true` | Measure the suggested formats' sizes in **More Formats…** (images and vector graphics up to 25 MB). |
| `remold.insertFormat` | `webp` | Filee format used by **Insert as … (Remold)** when dropping or pasting. |
| `remold.referenceFiles` | `**/*.{html,…,astro}` | Files searched by **Update References**; empty turns it off. |

## Development

```bash
npm install
npm test                    # unit tests (a fake Filee stands in for the real one)
npm run typecheck
REMOLD_FILEE=/path/to/filee xvfb-run -a npm run test:integration   # in a downloaded VS Code, with real Filee
REMOLD_FILEE=managed xvfb-run -a npm run test:integration          # …with Remold downloading Filee itself
npm run parity -- --filee /path/to/filee   # converts a sample of every format to every target through Remold;
                                           # results in .parity/CHECKLIST.md (not committed)
npm run package             # builds remold-<version>.vsix
node scripts/sync-menus.mjs # after changing the quick targets in src/filee/quick.ts
```

Press <kbd>F5</kbd> in VS Code to start a development window with the extension loaded.

## License

MIT. Remold contains no third-party code; Filee is a separate program under its own MIT license. See
`THIRD-PARTY-NOTICES.md`.
