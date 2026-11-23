// Bundles the extension into dist/.
// --production minifies, --watch rebuilds on change, --tests bundles test/*.test.ts into out-test/.
import { build, context } from 'esbuild';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: !production, minify: production, logLevel: 'info' };

if (tests) {
    rmSync('out-test', { recursive: true, force: true });
    const entryPoints = readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`);
    await build({ ...common, entryPoints, outdir: 'out-test', sourcemap: true, minify: false });
    // Integration tests: run.ts launches VS Code, suite.ts runs inside it (where "vscode" is provided).
    await build({ ...common, entryPoints: ['test/integration/run.ts', 'test/integration/suite.ts'], outdir: 'out-test/integration',
        sourcemap: true, minify: false, external: ['vscode', '@vscode/test-electron'] });
} else {
    // Start from an empty dist/ so files from removed entry points never end up in the package.
    rmSync('dist', { recursive: true, force: true });
    mkdirSync('dist', { recursive: true });
    const options = { ...common, entryPoints: { extension: 'src/extension.ts', uninstall: 'src/uninstall.ts' }, outdir: 'dist', external: ['vscode'] };
    if (watch)
        await (await context(options)).watch();
    else
        await build(options);
}
