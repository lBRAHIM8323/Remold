// Keeps package.json's menus in step with the quick targets and commands.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { QUICK_TARGET_IDS, QUICK_TARGET_TITLES } from '../src/filee/quick';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const { commands, menus } = manifest.contributes;

test('"Convert to" is in the Explorer and editor tab menus, for files Filee reads', () => {
    for (const menu of ['explorer/context', 'editor/title/context']) {
        const entry = menus[menu].find((m: { submenu?: string }) => m.submenu === 'remold.convertSubmenu');
        assert.ok(entry, menu);
        assert.match(entry.when, /resourceExtname in remold\.supported/);
    }
});

test('package.json matches src/filee/quick.ts (run node scripts/sync-menus.mjs after changing it)', () => {
    for (const id of QUICK_TARGET_IDS) {
        const command = commands.find((c: { command: string }) => c.command === `remold.to.${id}`);
        assert.equal(command?.title, QUICK_TARGET_TITLES[id], id);
        const item = menus['remold.convertSubmenu'].find((i: { command: string }) => i.command === `remold.to.${id}`);
        assert.equal(item?.when, `resourceExtname in remold.quick.${id}`);
    }
    assert.equal(commands.filter((c: { command: string }) => c.command.startsWith('remold.to.')).length, QUICK_TARGET_IDS.length);
});

test('before Filee is ready the submenu offers setting it up', () => {
    const items = menus['remold.convertSubmenu'];
    assert.equal(items.find((i: { command: string }) => i.command === 'remold.setupFilee')?.when, '!remold.ready');
    assert.equal(items.find((i: { command: string }) => i.command === 'remold.moreFormats')?.when, 'remold.ready');
});

test('uninstalling removes Remold\'s Filee', () => {
    assert.equal(manifest.scripts['vscode:uninstall'], 'node ./dist/uninstall.js');
    assert.ok(manifest.repository?.url.includes('lBRAHIM8323/Remold'));
});

test('every command in a menu is declared', () => {
    const declared = new Set(commands.map((c: { command: string }) => c.command));
    for (const entries of Object.values(menus) as { command?: string }[][])
        for (const entry of entries)
            if (entry.command)
                assert.ok(declared.has(entry.command), entry.command);
});
