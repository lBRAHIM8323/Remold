// Writes the "Convert to ▸" commands and menu entries into package.json from src/filee/quick.ts, so the two never
// drift apart. Run after changing the quick targets: node scripts/sync-menus.mjs (test/manifest.test.ts checks it).
import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const { outputFiles } = buildSync({ entryPoints: ['src/filee/quick.ts'], bundle: true, format: 'cjs', platform: 'node', write: false });
const module = { exports: {} };
new Function('module', 'exports', outputFiles[0].text)(module, module.exports);
const { QUICK_TARGET_IDS, QUICK_TARGET_TITLES } = module.exports;

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const contributes = manifest.contributes;
const keep = contributes.commands.filter(c => !c.command.startsWith('remold.to.'));
contributes.commands = [
    ...QUICK_TARGET_IDS.map(id => ({ command: `remold.to.${id}`, title: QUICK_TARGET_TITLES[id], category: 'Remold' })),
    ...keep,
];
contributes.menus['remold.convertSubmenu'] = [
    // Each target shows only for files Filee can convert to it (context keys set from Filee's formats at startup).
    ...QUICK_TARGET_IDS.map((id, n) => ({ command: `remold.to.${id}`, when: `resourceExtname in remold.quick.${id}`, group: `1_quick@${n}` })),
    { command: 'remold.moreFormats', when: 'remold.ready', group: '2_more@1' },
    // Before Filee is set up the submenu offers just that.
    { command: 'remold.setupFilee', when: '!remold.ready', group: '2_more@2' },
];
contributes.menus.commandPalette = [
    ...QUICK_TARGET_IDS.map(id => ({ command: `remold.to.${id}`, when: 'false' })),
    { command: 'remold.moreFormats', when: 'false' },
];
writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`package.json: ${QUICK_TARGET_IDS.length} quick targets`);
