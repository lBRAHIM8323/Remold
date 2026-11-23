// Bundles the extension and the conversion worker into dist/ and copies ImageMagick's WebAssembly next to them.
// --production minifies, --watch rebuilds on change, --tests bundles test/*.test.ts into out-test/.
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: !production, minify: production, logLevel: 'info' };

if (tests) {
    const entryPoints = readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`);
    await build({ ...common, entryPoints, outdir: 'out-test', sourcemap: true, minify: false });
    // Integration tests: run.ts launches VS Code, suite.ts runs inside it (where "vscode" is provided).
    await build({ ...common, entryPoints: ['test/integration/run.ts', 'test/integration/suite.ts'], outdir: 'out-test/integration',
        sourcemap: true, minify: false, external: ['vscode', '@vscode/test-electron'] });
} else {
    // Start from an empty dist/ so files from removed entry points never end up in the package.
    rmSync('dist', { recursive: true, force: true });
    mkdirSync('dist', { recursive: true });
    // The 32-bit build: the 64-bit one needs WebAssembly memory64, which older VS Code (Electron) builds lack.
    copyFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm'), 'dist/magick.wasm');
    // magick-wasm's Apache-2.0 license, and its NOTICE with the ImageMagick license and those of the libraries
    // compiled into magick.wasm. Both must ship with the extension.
    mkdirSync('dist/licenses', { recursive: true });
    // The package doesn't export package.json; its root is two folders above dist/x86/magick.wasm.
    const magickPackage = path.resolve(path.dirname(require.resolve('@imagemagick/magick-wasm/magick.wasm')), '..', '..');
    copyFileSync(path.join(magickPackage, 'LICENSE'), 'dist/licenses/magick-wasm-LICENSE.txt');
    copyFileSync(path.join(magickPackage, 'NOTICE'), 'dist/licenses/magick-wasm-NOTICE.txt');
    const options = { ...common, entryPoints: { extension: 'src/extension.ts', worker: 'src/worker.ts' }, outdir: 'dist', external: ['vscode'] };
    if (watch)
        await (await context(options)).watch();
    else
        await build(options);
}
