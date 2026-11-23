# Remold

[![CI](https://github.com/lBRAHIM8323/Remold/actions/workflows/ci.yml/badge.svg)](https://github.com/lBRAHIM8323/Remold/actions/workflows/ci.yml)

Convert files without leaving VS Code: right-click → **Convert to ▸ PDF**, **WEBP**, **MP3**, **Extract to
Folder**… Remold is the VS Code front end of [Filee](https://filee.sh), the offline file converter: everything
Filee converts (images, PDF, Word/Excel/PowerPoint and OpenDocument files, HWP, e-books, video, audio, archives,
subtitles, data, maps, fonts, CAD drawings, 3D models — 300+ formats), Remold converts. Files never leave your
computer.

> **Powered by [Filee](https://filee.sh)** by Myeonggu Kim ([KnifeLemon](https://github.com/KnifeLemon)) and
> [Filee contributors](https://github.com/KnifeLemon/Filee/graphs/contributors). All conversions are Filee's work;
> Remold adds the VS Code side. If Remold is useful to you, please ⭐
> [Filee on GitHub](https://github.com/KnifeLemon/Filee) too.

## Setup

If you have [Filee](https://filee.sh) 2.5 or later installed, Remold uses it. Otherwise, the first time you convert
something (or click **Set Up Filee…** in the **Convert to** menu), Remold asks before downloading Filee's official
package for your computer from [Filee's releases](https://github.com/KnifeLemon/Filee/releases) — about 140 MB,
once. Nothing is downloaded until you say yes. Only Filee's command line is used: no Filee window, icon or menu
entries, and its settings and engines stay in Remold's folder (`~/.local/share/remold`, `~/Library/Application
Support/Remold` or `%LocalAppData%\Remold`), which is removed when you uninstall Remold.

Every download is checked before it's used: Filee signs each release's checksum file with its update key (the same
check Filee's own updater does), and the package must match that checksum and run as the version it claims to be.

**Updates.** Once a day Remold looks for a newer Filee 2.x and updates its copy in the background; the old copy
stays in use if anything goes wrong. New formats Filee adds appear in Remold by themselves — no Remold update
needed. A Filee 3.0 is only used once a Remold version supports it. **Remold: Check for Filee Updates** checks now.
If you use your own Filee, update it from Filee's menu.

**Engines.** Some conversions need one of Filee's optional engines (Calibre for e-books, Pandoc, FFmpeg, the AI
upscaler, …). **More Formats…** lists them under *Needs an optional engine*; picking one, or **Remold: Install Filee
Engines…**, installs it with Filee's own download. Engines Filee can't download come with Filee's instructions — on
Linux, Word/Excel/PowerPoint files need LibreOffice and text recognition needs Tesseract from your distribution.

**Where it works.** Windows, macOS and Linux (x64 and ARM64), including Remote SSH, WSL, Dev Containers and
Codespaces, where Remold and Filee run on the remote machine. Not in VS Code for the Web (vscode.dev), which can't
run programs.

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

## Credits

- **[Filee](https://github.com/KnifeLemon/Filee)** — the converter behind every conversion in Remold, by Myeonggu
  Kim (KnifeLemon) and Filee contributors, MIT license. Remold runs Filee's command line, unchanged, from Filee's
  official releases. Remold is an independent project, not made or endorsed by the Filee authors. Bugs in a
  conversion's result belong in [Filee's issues](https://github.com/KnifeLemon/Filee/issues); bugs in menus,
  setup or anything else in VS Code belong here.
- The engines Filee uses (ImageMagick, LibreOffice, FFmpeg, Pandoc, 7-Zip and others) are credited in
  [Filee's third-party notices](https://github.com/KnifeLemon/Filee/blob/main/THIRD-PARTY-NOTICES.md).

## License

MIT. Remold contains no third-party code; Filee is a separate program under its own MIT license. See
`THIRD-PARTY-NOTICES.md`.
